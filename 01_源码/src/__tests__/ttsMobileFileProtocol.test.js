// ttsMobileFileProtocol.test.js —— 【v3.8.354 手机端修复 R3 回归】
// 场景：安卓 App 内页面跑在 file:///android_asset/www/index.html 下（MainActivity.kt:92），
//       底层 Chromium 110。该环境下 Web Audio 的 decodeAudioData 对 Blob 的 MP3/WAV
//       支持面明显窄于桌面 —— 反复尝试只会白耗 CPU、拖慢首句，且**必然**失败。
//       修复前另有一个粘滞缺陷：`_gap.fallback` 一旦被置 true 就永久锁死，
//       一次网络/解码抖动会让整场朗读都失去无缝效果。
// 本测试锁死：
//   1) file:// 下 gapAvailable() === false，且不做任何解码尝试（decodeCalls=0）
//   2) file:// 下音频直接落到 <audio> 分段队列（仍能出声）
//   3) https 下 decodeAudioData 单次失败不锁 fallback（failStreak=1）
//   4) https 下连续失败 2 次才锁 fallback（GAP_FAIL_LIMIT=2）
//   5) gaplessStop 复位 failStreak / fallback（新一轮仍愿意尝试无缝）
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const __mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in __mem ? __mem[k] : null),
  setItem: (k, v) => { __mem[k] = String(v) },
  removeItem: (k) => { delete __mem[k] },
  clear: () => { for (const k of Object.keys(__mem)) delete __mem[k] }
}

let m
let decodeCalls
let audioEls

function installEnv({ protocol = 'https:', failPattern = [] } = {}) {
  decodeCalls = 0
  audioEls = []
  const AC = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 16000; this.destination = {} }
    resume() { return Promise.resolve() }
    createBuffer(c, l, s) {
      const d = Array.from({ length: c }, () => new Float32Array(l))
      return { numberOfChannels: c, length: l, sampleRate: s, duration: l / s, getChannelData: (i) => d[i] }
    }
    createBufferSource() {
      return { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null, onerror: null }
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} } }
    decodeAudioData() {
      const idx = decodeCalls++
      if (failPattern[idx]) return Promise.reject(new Error('decode fail (android file://)'))
      return Promise.resolve(this.createBuffer(1, 16000, 16000))
    }
  }
  class FakeAudio {
    constructor() { this.src = ''; this.paused = true; this.currentTime = 0; this.onended = null; this.onerror = null; audioEls.push(this) }
    play() { return Promise.resolve() }
    pause() { this.paused = true }
    load() {}
  }
  // 引擎一律通过 window 访问（window.AudioContext / window.Audio / location），
  // 所以必须把宿主对象挂在 window 上，而不是只 stub globalThis。
  const win = {
    AudioContext: AC,
    Audio: FakeAudio,
    // 注意：必须实现 slice() —— 生产代码对 Blob 调 gapBytes(...).slice(0)，
    // 真实 Blob 有 slice，假的没有会让 gapDecode 抛错并被误记为「解码失败」。
    Blob: class {
      constructor(p) { this.parts = p }
      slice() { return this }
    },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {}
  }
  const loc = { protocol, href: protocol + '//x/index.html' }
  Object.defineProperty(win, 'location', { value: loc, configurable: true })
  vi.stubGlobal('window', win)
  // 兼容直接读 globalThis 的代码路径
  vi.stubGlobal('AudioContext', AC)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('Blob', win.Blob)
  vi.stubGlobal('URL', win.URL)
  vi.stubGlobal('location', loc)
  return { AC, FakeAudio }
}

beforeEach(async () => {
  for (const k of Object.keys(__mem)) delete __mem[k]
  vi.resetModules()
  // 引擎模块顶层会读 window，先给一个最小 window 再加载
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} })
  m = await import('../utils/ttsEngine')
})

afterEach(() => { vi.unstubAllGlobals() })

describe('R3 安卓 App file:// 协议降级', () => {
  it('file:// 下 gapAvailable() === false（不做必然失败的无缝尝试）', () => {
    installEnv({ protocol: 'file:' })
    expect(m.gapAvailable()).toBe(false)
  })

  it('file:// 下入队完全不触发解码，音频落到 <audio> 分段队列（保证仍能出声）', async () => {
    installEnv({ protocol: 'file:' })
    for (let i = 0; i < 3; i++) m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 100))
    expect(decodeCalls).toBe(0)          // 一次解码都不尝试
    expect(audioEls.length).toBeGreaterThanOrEqual(1) // 直接走 <audio>
  })

  it('gapDebug() 在 file:// 下报 fileProtocol=true、available=false', () => {
    installEnv({ protocol: 'file:' })
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    const d = m.gapDebug()
    expect(d.fileProtocol).toBe(true)
    expect(d.available).toBe(false)
  })

  it('https 下 gapAvailable() === true（网页版/桌面端保持无缝播放）', () => {
    installEnv({ protocol: 'https:' })
    expect(m.gapAvailable()).toBe(true)
  })
})

describe('R3 解码失败不粘滞（连续失败计数）', () => {
  it('单次解码失败不锁 fallback（failStreak=1）', async () => {
    installEnv({ protocol: 'https:', failPattern: [true] })
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 100))
    const d = m.gapDebug()
    expect(d.failStreak).toBe(1)
    expect(d.fallback).toBe(false) // 关键：不再一次失败就永久锁死
  })

  it('连续失败 2 次才锁定 fallback（GAP_FAIL_LIMIT=2）', async () => {
    installEnv({ protocol: 'https:', failPattern: [true, true, true] })
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 60))
    expect(m.gapDebug().failStreak).toBe(1)
    expect(m.gapDebug().fallback).toBe(false)
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 60))
    expect(m.gapDebug().failStreak).toBe(2)
    expect(m.gapDebug().fallback).toBe(true) // 第 2 次失败后锁定
  })

  it('中间成功一次就把 failStreak 清零（不累计「跨轮」失败）', async () => {
    // 注意：gapDecode 在 gaplessEnqueue 内**立即并行**发起，所以必须逐块 await，
    // 才能构造出「先失败、再成功」的真实时序；否则两次解码会并发抢同一个 failStreak。
    installEnv({ protocol: 'https:', failPattern: [true, false] })
    await m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 30))
    expect(m.gapDebug().failStreak).toBe(1) // 第 1 块失败
    expect(m.gapDebug().fallback).toBe(false)
    await m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 30))
    expect(m.gapDebug().failStreak).toBe(0) // 第 2 块成功 → 清零
    expect(m.gapDebug().fallback).toBe(false)
  })
})

describe('R3 gaplessStop 复位降级状态', () => {
  it('连续失败锁定 fallback 后，gaplessStop 把 failStreak / fallback 归零', async () => {
    installEnv({ protocol: 'https:', failPattern: [true, true, true] })
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 60))
    m.gaplessEnqueue(new Blob([new Uint8Array([1, 2, 3, 4])]), 'audio/mpeg')
    await new Promise((r) => setTimeout(r, 60))
    expect(m.gapDebug().fallback).toBe(true)

    m.gaplessStop()

    const d = m.gapDebug()
    expect(d.fallback).toBe(false)
    expect(d.failStreak).toBe(0)
  })

  it('file:// 下 gaplessStop 后仍判定为不可用（协议约束优先于复位）', async () => {
    installEnv({ protocol: 'file:' })
    m.gaplessStop()
    expect(m.gapAvailable()).toBe(false)
  })
})
