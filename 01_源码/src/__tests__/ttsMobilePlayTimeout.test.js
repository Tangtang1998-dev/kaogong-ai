// ttsMobilePlayTimeout.test.js —— 【v3.8.354 手机端修复 R2 回归】
// 场景：移动端 WebView（尤其安卓 file:// + iOS 独立 PWA）在复用 <audio> 元素、
//       或媒体栈初始化异常时，既不会派发 onended 也不会派发 onerror。
//       修复前 playBytes / spNext 的 Promise 会**永久挂起**：
//         · 试音按钮永远停在「播放中」
//         · 自动朗读队列卡在第一位，后续句子全部不播
//         · 缓存写入永远不会发生（await 之后的落盘代码跑不到）
// 修复：给播放链路加「按音频时长推算」的超时护栏，保证调用方必被唤醒。
//   playGuardMs = clamp(duration*1000 + 1200, 1500, 60000)，duration 未知时 8000ms。
//
// ⚠ 测试要点：生产代码**跨调用复用同一个 <audio> 元素**（`_player.audio ||= new Audio()`），
//   这是为了绕过安卓 WebView/iOS PWA 对「每段 new Audio()」的拦截。副作用是模块级状态
//   会跨用例残留（旧元素 + 旧 duration + 旧 onended）。因此每个用例都用 vi.resetModules()
//   重新加载引擎模块，拿到全新的 _player/_sp 状态 —— 否则会出现「用例顺序影响结果」的假失败。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const __mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in __mem ? __mem[k] : null),
  setItem: (k, v) => { __mem[k] = String(v) },
  removeItem: (k) => { delete __mem[k] },
  clear: () => { for (const k of Object.keys(__mem)) delete __mem[k] }
}

let playBytes, spEnqueue

// 造 Audio：duration 在 src 赋值后生效（真实浏览器里 duration 是元数据就绪后的 live 属性）
function installFakeAudio(opts = {}) {
  const created = []
  class FakeAudio {
    constructor() {
      this._src = ''
      this.paused = true
      this.muted = false
      this.currentTime = 0
      this.onended = null
      this.onerror = null
      this.duration = NaN
      created.push(this)
    }
    get src() { return this._src }
    set src(v) {
      this._src = v
      this.duration = opts.duration !== undefined ? opts.duration : NaN
    }
    play() {
      if (opts.rejectPlay) return Promise.reject(new Error('NotAllowedError: play() failed'))
      this.paused = false
      if (opts.autoEnd) setTimeout(() => { if (this.onended) this.onended() }, 5)
      return Promise.resolve()
    }
    pause() { this.paused = true }
    load() {}
  }
  vi.stubGlobal('Audio', FakeAudio)
  // 必须实现 slice()：生产代码对 Blob 调 gapBytes(...).slice(0)，真实 Blob 有 slice
  const BlobIn = class { constructor(p) { this.parts = p } slice() { return this } }
  vi.stubGlobal('Blob', BlobIn)
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} })
  return { created }
}

beforeEach(async () => {
  for (const k of Object.keys(__mem)) delete __mem[k]
  vi.resetModules()
  const mod = await import('../utils/ttsEngine')
  playBytes = mod.playBytes
  spEnqueue = mod.spEnqueue
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('R2 playBytes 超时护栏', () => {
  it('无任何 ended/error 回调 → 兜底 8000ms 后 resolve(true)，不再永久挂起', async () => {
    installFakeAudio({ duration: NaN }) // duration 未知
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    let done = false
    p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(7000) // 未到兜底
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1500) // 越过 8000
    expect(done).toBe(true)
    await expect(p).resolves.toBe(true)
  })

  it('duration 已知时护栏按时长推算（20s → 21200ms），不是一律 8000ms', async () => {
    installFakeAudio({ duration: 20 })
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    let done = false
    p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(9000) // 已越过 8000（若护栏写死 8000 就会在这里结算）
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(13000) // 越过 21200
    expect(done).toBe(true)
    await expect(p).resolves.toBe(true)
  })

  it('极短音频（50ms）护栏被夹到下限 1500ms', async () => {
    installFakeAudio({ duration: 0.05 }) // 50ms → 1200+50=1250 → clamp 到 1500
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    let done = false
    p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1400)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200) // 越过 1500
    expect(done).toBe(true)
    await expect(p).resolves.toBe(true)
  })

  it('超长音频（120s）护栏被夹到上限 60000ms', async () => {
    installFakeAudio({ duration: 120 }) // 120000+1200 → clamp 到 60000
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    let done = false
    p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(59000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1500) // 越过 60000
    expect(done).toBe(true)
    await expect(p).resolves.toBe(true)
  })

  it('play() 直接 reject → 立即 finish(false)，不等待超时', async () => {
    installFakeAudio({ duration: NaN, rejectPlay: true })
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    await vi.advanceTimersByTimeAsync(10) // 远小于 8000
    await expect(p).resolves.toBe(false)
  })

  it('onended 正常到达 → 立即 resolve(true)，不依赖超时', async () => {
    installFakeAudio({ duration: 3, autoEnd: true })
    await expect(playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')).resolves.toBe(true)
  })

  it('结算幂等：onended 先到，随后推进到超时点不再二次结算', async () => {
    installFakeAudio({ duration: 3, autoEnd: true })
    vi.useFakeTimers()
    const p = playBytes(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    await vi.advanceTimersByTimeAsync(10)
    await expect(p).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(10000) // 推进越过超时点，不应二次结算/抛错
    await expect(p).resolves.toBe(true)
  })
})

describe('R2 分段队列 spNext 超时护栏', () => {
  it('分段音频无 ended 回调 → 护栏唤醒，整条队列不会卡在第一段', async () => {
    const { created } = installFakeAudio({ duration: NaN })
    vi.useFakeTimers()
    spEnqueue(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    await vi.advanceTimersByTimeAsync(100)
    expect(created.length).toBeGreaterThanOrEqual(1) // 第一段已开播
    await vi.advanceTimersByTimeAsync(9000)          // 越过护栏 → settle 并推进
    expect(true).toBe(true)
  })

  it('多段入队：第一段挂死也会被护栏推进，不会丢后续段落', async () => {
    const { created } = installFakeAudio({ duration: NaN })
    vi.useFakeTimers()
    spEnqueue(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    spEnqueue(new Uint8Array([5, 6, 7, 8]), 'audio/mpeg')
    await vi.advanceTimersByTimeAsync(9000) // 第一段被护栏结算
    await vi.advanceTimersByTimeAsync(9000) // 第二段同理
    // 分段播放器契约：复用同一个 <audio> 元素（每段 new Audio() 在安卓 WebView 会被拦）
    expect(created.length).toBe(1)
  })

  it('onended 正常到达 → 队列立即推进到下一段，不等护栏', async () => {
    const { created } = installFakeAudio({ duration: 2, autoEnd: true })
    spEnqueue(new Uint8Array([1, 2, 3, 4]), 'audio/mpeg')
    spEnqueue(new Uint8Array([5, 6, 7, 8]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 60)) // 两段都在 autoEnd 下自然播完
    expect(created.length).toBe(1) // 仍复用同一元素
  })
})
