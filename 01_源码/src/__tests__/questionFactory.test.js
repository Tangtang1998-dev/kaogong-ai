import { describe, it, expect } from 'vitest'
import { questionSpecOf, validateGeneratedQuestion } from '../utils/questionFactory'

const q = (extra = {}) => ({
  stem: '某研究调查了两组人群的锻炼情况与抑郁风险。研究人员据此认为，经常锻炼有助于降低抑郁风险。',
  options: [
    { k: 'A', t: '两组在其他方面没有显著差异' },
    { k: 'B', t: '调查采用国际通用量表' },
    { k: 'C', t: '经常锻炼者通常饮食更健康' },
    { k: 'D', t: '锻炼时长存在明显差别' }
  ],
  answer: 'A',
  ...extra
})

describe('questionFactory', () => {
  it('为六大板块和细分题型返回题模', () => {
    for (const subject of ['判断推理', '言语理解', '图形推理', '资料分析', '数量关系', '常识判断', '政治理论']) {
      const spec = questionSpecOf(subject)
      expect(spec.minOptions).toBe(4)
      expect(spec.requireAnswer).toBe(true)
    }
  })

  it('图推题缺少 SVG 时判失败', () => {
    const r = validateGeneratedQuestion(q(), '图形推理', '位置规律')
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toContain('SVG')
  })

  it('缺选项时判失败', () => {
    const r = validateGeneratedQuestion(q({ options: [{ k: 'A', t: '对' }] }), '判断推理', '削弱型')
    expect(r.ok).toBe(false)
  })
})
