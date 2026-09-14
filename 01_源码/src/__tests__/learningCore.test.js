import { describe, it, expect, beforeEach } from 'vitest'
import { buildLearningProfile, buildDailyPlan } from '../utils/learningCore'

const base = {
  msgs: [
    { role: 'user', content: { text: '这道削弱题怎么做' }, t: Date.now() },
    { role: 'assistant', content: '解析如下' }
  ],
  wqs: [
    { subject: '判断推理', sub: '逻辑判断', variant: '削弱型', reviewed: false, digested: false, createdAt: Date.now(), mastery: 40 }
  ],
  attempts: [
    { plate: '判断推理', variant: '削弱型', ok: false, t: Date.now() },
    { plate: '资料分析', variant: '基期', ok: true, t: Date.now() }
  ],
  study: {},
  streak: 1,
  todayChecked: false
}

describe('learningCore', () => {
  beforeEach(() => { try { localStorage.clear() } catch (e) {} })

  it('汇总对话、错题、作答与学习时长', () => {
    const p = buildLearningProfile(base)
    expect(p.overall.asks).toBe(1)
    expect(p.overall.wrongs).toBe(1)
    expect(p.attempts.total).toBe(2)
    expect(p.study.totalSeconds).toBe(0)
  })

  it('空数据不崩溃', () => {
    const p = buildLearningProfile({})
    expect(p.coldStart).toBe(true)
    expect(p.overall.asks).toBe(0)
  })

  it('每日计划优先处理到期错题', () => {
    const profile = buildLearningProfile({
      ...base,
      wqs: [{ subject: '判断推理', digested: true, dueAt: Date.now() - 1, reviewed: false }]
    })
    const plan = buildDailyPlan({ profile })
    expect(plan[0].k).toBe('due')
  })
})
