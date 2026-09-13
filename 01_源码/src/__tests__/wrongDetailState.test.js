import { describe, it, expect } from 'vitest'
import { wrongDetailKeyOf, ownWrongReasons } from '../utils/wrongDetailState'

describe('错题详情跨题隔离', () => {
  it('题目指纹变化时强制重建详情组件', () => {
    expect(wrongDetailKeyOf(0, { id: 'q1', question: '第一题' })).not.toBe(wrongDetailKeyOf(1, { id: 'q2', question: '第二题' }))
    expect(wrongDetailKeyOf(0, { id: 'q1', question: '第一题' })).toContain('q1')
  })

  it('历史错因只取本题已保存或已采纳内容', () => {
    const q = {
      id: 'q1',
      reasons: ['本题错因', '已选错因', '预设错因'],
      reasonCoach: { adopted: ['本题错因', 'AI 采纳错因'] }
    }
    expect(ownWrongReasons(q, ['预设错因'], ['已选错因'])).toEqual(['本题错因', 'AI 采纳错因'])
  })
})
