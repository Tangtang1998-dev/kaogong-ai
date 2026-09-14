import { describe, it, expect } from 'vitest'
import { buildErrorPatterns, buildRemediationPlan, buildContrastQuestionRequest } from '../utils/wrongPattern'
import { buildMicroLesson, lessonMasterySummary } from '../utils/microLessonFactory'
import { resolveContentItem, verifyContentIntegrity } from '../utils/contentManifest'

describe('剩余阶段纯函数', () => {
  it('错题模式按题型聚类且不跨题型', () => {
    const wqs = [
      { subject: '判断推理', sub: '逻辑判断', variant: '削弱型', reasons: ['因果倒置'], reviewStats: { e: 2 } },
      { subject: '判断推理', sub: '逻辑判断', variant: '加强型', reasons: ['排除他因'], reviewStats: { e: 0 } }
    ]
    const patterns = buildErrorPatterns(wqs)
    expect(patterns.length).toBe(2)
    expect(patterns[0].type).not.toBe(patterns[1].type)
  })

  it('对比题请求包含题型', () => {
    const pattern = { group: '判断推理', type: '削弱型' }
    expect(buildContrastQuestionRequest(pattern)).toContain('判断推理')
    expect(buildRemediationPlan(pattern, [], []).steps.length).toBe(3)
  })

  it('微课分镜和掌握度可用', () => {
    const course = buildMicroLesson({ plate: '判断推理', type: '削弱型', steps: ['找结论', '看方向'] }, [])
    expect(course.scenes.length).toBeGreaterThan(7)
    expect(lessonMasterySummary({ 0: true, 1: true }, course.scenes.length).pct).toBe(20)
  })

  it('内容清单有主备镜像，完整性校验能发现大小不一致', async () => {
    const item = resolveContentItem('index.json')
    expect(item.primary).toBeTruthy()
    expect(item.fallbacks.length).toBeGreaterThan(0)
    const r = await verifyContentIntegrity(new ArrayBuffer(8), { size: 9 })
    expect(r.ok).toBe(false)
  })
})
