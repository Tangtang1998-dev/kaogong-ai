import { describe, it, expect, beforeEach } from 'vitest'

const mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v) },
  removeItem: (k) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length }
}

describe('历史对话全量持久化与上传', () => {
  beforeEach(() => localStorage.clear())

  it('超过 200 条历史对话仍完整保存并进入云端信封', async () => {
    const { store, saveMsgs } = await import('../store')
    const { makeCloudEnvelope, collectCloudData } = await import('../utils/cloudSync')
    store.msgs = Array.from({ length: 260 }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: '历史消息 ' + i, t: 1690000000000 + i }))
    const bigImg = 'data:image/png;base64,' + 'A'.repeat(800100)
    store.msgs[0].imgs = [bigImg]
    expect(saveMsgs()).toBe(true)
    const saved = JSON.parse(localStorage.getItem('xc_msgs'))
    expect(saved).toHaveLength(260)
    expect(saved[0].content).toBe('历史消息 0')
    expect(saved[0].imgs[0]).toBe('')
    localStorage.setItem('xc_wqs', JSON.stringify([{ id: 'w1', question: '完整错题' }]))
    store.wqs = [{ id: 'w1', question: '完整错题' }]
    const env = makeCloudEnvelope(collectCloudData().data)
    expect(JSON.parse(env.data.xc_msgs)).toHaveLength(260)
    expect(JSON.parse(env.data.xc_msgs)[0].imgs[0]).toBe(bigImg)
    expect(JSON.parse(env.data.xc_wqs)).toHaveLength(1)
  })
})
