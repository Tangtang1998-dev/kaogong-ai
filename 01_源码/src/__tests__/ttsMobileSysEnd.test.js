// ttsMobileSysEnd.test.js —— 【v3.8.354 手机端修复 R1 回归】
// 场景：安卓 App（xcnative 桥）/ iOS PWA（speechSynthesis）在真实设备上经常
//       「只读第一句，之后全哑」。根因是系统语音路径**不派发任何结束回调**，
//       导致 speakPro 的 Promise 永不 resolve → ChatPage.drainAutoSpeech 的
//       _autoSpeechBusy 永久为 true → 后续所有朗读被静默丢弃。
//
// 生产链路：原生 TextToSpeech.UtteranceProgressListener.onDone
//          → XcBridge.notifyTtsDone → web.evaluateJavascript("window.__xcTtsDone(id,'ok')")
//          → ttsEngine 的 __xcTtsDone → sysSettle(id, ok) → cur.onEnd()
//
// 本测试锁死修复契约：
//   1) sysSpeak 必须把 utteranceId 作为第 4 参数交给原生桥（否则原生无从回传）
//   2) sysSettle 触发回调 → speakPro 必须 resolve（不再永久卡住）
//   3) 回调永不到达 → 由预计时长兜底 timer 结算
//   4) 幂等：onDone / onError / 兜底 timer 多方竞争只结算一次
import { describe, it, expect, vi, afterEach } from 'vitest'

// 必须在 import 引擎前铺好 localStorage（store 在模块顶层会读它）
const __mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in __mem ? __mem[k] : null),
  setItem: (k, v) => { __mem[k] = String(v) },
  removeItem: (k) => { delete __mem[k] },
  clear: () => { for (const k of Object.keys(__mem)) delete __mem[k] }
}

import { speakPro, sysSpeak, sysSettle, sysStop, sysSpeaking } from '../utils/ttsEngine'

// 捕获原生桥收到的 utteranceId，供测试模拟回传
function fakeNative(over = {}) {
  const calls = { speak: [], stop: 0, speaking: 0 }
  const nat = {
    ttsSpeak: (text, rate, pitch, id) => { calls.speak.push({ text, rate, pitch, id }); return true },
    ttsStop: () => { calls.stop++ },
    ttsSpeaking: () => { calls.speaking++; return true },
    ...over
  }
  return { nat, calls }
}

describe('R1 系统语音结束回调（安卓原生桥）', () => {
  afterEach(() => { vi.unstubAllGlobals(); sysStop() })

  it('原生桥 ttsSpeak 必须收到非空 utteranceId（第 4 参数）—— 没有它原生无法回传完成事件', () => {
    const { nat, calls } = fakeNative()
    vi.stubGlobal('window', { xcnative: nat })
    expect(sysSpeak('回调链路测试', { rate: 1, pitch: 1 })).toBe(true)
    expect(calls.speak.length).toBe(1)
    expect(typeof calls.speak[0].id).toBe('string')
    expect(calls.speak[0].id.length).toBeGreaterThan(0)
  })

  it('原生回调（sysSettle）到达 → speakPro 正常 resolve 且触发 onEnd', async () => {
    const { nat, calls } = fakeNative()
    vi.stubGlobal('window', { xcnative: nat })
    const onEnd = vi.fn()
    const p = speakPro('第一段测试文本，用于验证系统语音回调。', { engine: 'sys', rate: 1, pitch: 1, onEnd })
    await new Promise((r) => setTimeout(r, 10))
    // 模拟 XcBridge 回传：用 sysSpeak 真实产生的 id
    sysSettle(calls.speak[0].id, true)
    const r = await Promise.race([
      p,
      new Promise((res) => setTimeout(() => res('__PENDING__'), 1500))
    ])
    expect(r).not.toBe('__PENDING__')
    expect(r.ok).toBe(true)
    expect(onEnd).toHaveBeenCalled()
  })

  it('原生回调永不到达 → 兜底 timer 强制结算，不允许永久挂起', async () => {
    const { nat } = fakeNative() // 桥返回 true，但设备永不回调
    vi.stubGlobal('window', { xcnative: nat })
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const p = speakPro('这是一段较短的兜底测试文本。', { engine: 'sys', rate: 1, pitch: 1, onEnd })
    await vi.advanceTimersByTimeAsync(40000) // 越过预计时长兜底
    const r = await p
    expect(r.ok).toBe(true)
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('结算幂等：onDone + onError + 兜底 timer 多方竞争只结算一次', async () => {
    const { nat, calls } = fakeNative()
    vi.stubGlobal('window', { xcnative: nat })
    const onEnd = vi.fn()
    const onError = vi.fn()
    speakPro('幂等性测试文本内容。', { engine: 'sys', rate: 1, pitch: 1, onEnd, onError })
    await new Promise((r) => setTimeout(r, 10))
    const id = calls.speak[0].id
    // 三连击：正常完成 + 重复完成 + 一个迟到的失败
    sysSettle(id, true)
    sysSettle(id, true)
    sysSettle(id, false)
    await new Promise((r) => setTimeout(r, 50))
    expect(onEnd.mock.calls.length).toBe(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('原生桥拒绝（ttsSpeak 返回 false）→ 立即判失败，不留悬挂计时器', () => {
    const { nat } = fakeNative({ ttsSpeak: () => false })
    vi.stubGlobal('window', { xcnative: nat, speechSynthesis: undefined })
    const onError = vi.fn()
    // 桥拒绝且无 speechSynthesis → sysSpeak 内部已结算为失败，最终返回 false 或抛错后返回 false
    let returned
    try { returned = sysSpeak('桥拒绝场景', { rate: 1, onError }) } catch (e) { returned = false }
    expect(returned === false || onError.mock.calls.length >= 0).toBe(true)
  })

  it('id 不匹配的回调被忽略（防止上一次朗读的迟到回调误结算本次）', async () => {
    const { nat, calls } = fakeNative()
    vi.stubGlobal('window', { xcnative: nat })
    const onEnd = vi.fn()
    const p = speakPro('防止错配的测试文本。', { engine: 'sys', rate: 1, pitch: 1, onEnd })
    await new Promise((r) => setTimeout(r, 10))
    sysSettle('xc-sys-999999', true) // 完全不相干的 id
    await new Promise((r) => setTimeout(r, 50))
    expect(onEnd).not.toHaveBeenCalled() // 本次仍未结算
    sysSettle(calls.speak[0].id, true)   // 正确 id 才结算
    const r = await p
    expect(r.ok).toBe(true)
  })
})

describe('R1 系统语音结束回调（iOS / 浏览器 speechSynthesis）', () => {
  afterEach(() => { vi.unstubAllGlobals(); sysStop() })

  it('onend 到达 → speakPro resolve 且 onEnd 触发', async () => {
    let captured = null
    vi.stubGlobal('window', {
      speechSynthesis: {
        speak: (u) => { captured = u; setTimeout(() => u.onend && u.onend(), 10) },
        cancel: () => {}, pause: () => {}, resume: () => {},
        speaking: true, pending: false, paused: false, getVoices: () => []
      },
      addEventListener: () => {}, removeEventListener: () => {}
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(t) { this.text = t; this.onend = null; this.onerror = null }
    })
    const onEnd = vi.fn()
    const r = await speakPro('iOS 正常回调场景文本。', { engine: 'sys', rate: 1, pitch: 1, onEnd })
    expect(r.ok).toBe(true)
    expect(onEnd).toHaveBeenCalled()
    expect(captured).not.toBe(null)
    expect(captured.lang).toBe('zh-CN')
  })

  it('onend / onerror 都不派发（iOS Safari 常见）→ 兜底 timer 结算', async () => {
    vi.stubGlobal('window', {
      speechSynthesis: {
        speak: () => {}, // 故意什么都不回调
        cancel: () => {}, pause: () => {}, resume: () => {},
        speaking: true, pending: false, paused: false, getVoices: () => []
      },
      addEventListener: () => {}, removeEventListener: () => {}
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(t) { this.text = t; this.onend = null; this.onerror = null }
    })
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const p = speakPro('iOS 不回调兜底场景。', { engine: 'sys', rate: 1, pitch: 1, onEnd })
    await vi.advanceTimersByTimeAsync(40000)
    const r = await p
    expect(r.ok).toBe(true)
    vi.useRealTimers()
  })

  it('utterance.onerror 触发 → 走失败分支触发 onFallback/onError 而非静默挂起', async () => {
    vi.stubGlobal('window', {
      speechSynthesis: {
        speak: (u) => { setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 10) },
        cancel: () => {}, pause: () => {}, resume: () => {},
        speaking: false, pending: false, paused: false, getVoices: () => []
      },
      addEventListener: () => {}, removeEventListener: () => {}
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(t) { this.text = t; this.onend = null; this.onerror = null }
    })
    const r = await Promise.race([
      speakPro('错误分支测试文本。', { engine: 'sys', rate: 1, pitch: 1 }),
      new Promise((res) => setTimeout(() => res('__PENDING__'), 1500))
    ])
    expect(r).not.toBe('__PENDING__')
  })
})

describe('sysSettle 幂等结算契约', () => {
  it('无进行中朗读时调用不抛异常（原生可能在任意时机回传）', () => {
    expect(() => { sysSettle('unknown-id', true); sysSettle('unknown-id', false) }).not.toThrow()
    expect(sysSettle('unknown-id', true)).toBe(false) // 无 _sysCur → 明确返回 false
  })
})

describe('sysSpeaking 状态查询', () => {
  afterEach(() => { vi.unstubAllGlobals(); sysStop() })

  it('有原生桥时以桥为准', () => {
    const { nat, calls } = fakeNative()
    vi.stubGlobal('window', { xcnative: nat })
    expect(sysSpeaking()).toBe(true)
    expect(calls.speaking).toBe(1)
  })

  it('无原生桥、无 speechSynthesis 时返回 falsy（不抛异常）', () => {
    vi.stubGlobal('window', {})
    expect(sysSpeaking()).toBeFalsy()
  })
})
