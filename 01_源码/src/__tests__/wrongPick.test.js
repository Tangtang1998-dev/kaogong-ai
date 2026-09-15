// wrongPick（截图/出题卡存错题取题源）回归
import { describe, it, expect } from 'vitest'
import { quizTextOf, pickWrongSource } from '../utils/wrongPick'
import { rawToQuiz, explainFrom } from '../utils/petBatch'
const mkQuiz = (extra = {}) => ({ role: 'assistant', quiz: { stem: '材料…问基期是多少？', options: [{ k: 'A', t: '100' }, { k: 'B', t: '120' }], answer: 'B' }, ...extra })
describe('quizTextOf', () => {
  it('组装题干与 A-D 选项', () => {
    const t = quizTextOf({ stem: '题目', options: [{ k: 'A', t: '甲' }, { k: 'B', t: '乙' }] })
    expect(t).toContain('题目')
    expect(t).toContain('A. 甲')
    expect(t).toContain('B. 乙')
  })
})
describe('pickWrongSource', () => {
  const ocrUser = { role: 'user', content: { text: '这题怎么做', imgs: ['data:image/png;base64,xx'] }, _curImgRead: '2023年GDP…问增长量？\nA. 100\nB. 200' }
  it('优先取截图 OCR 全文（而非用户短文字）', () => {
    const msgs = [ocrUser, { role: 'assistant', content: '答案是 B，解析……' }]
    const r = pickWrongSource(msgs, 1)
    expect(r.source).toBe('ocr')
    expect(r.q).toContain('GDP')
    expect(r.imgs.length).toBe(1)
  })
  it('有结构化题目卡时优先题目卡', () => {
    const msgs = [ocrUser, mkQuiz({ orgImg: ['data:image/png;base64,yy'] }), { role: 'assistant', content: '讲解……' }]
    const r = pickWrongSource(msgs, 2)
    expect(r.source).toBe('quiz')
    expect(r.q).toContain('A. 100')
  })
  it('纯文字问答回退最近用户提问', () => {
    const msgs = [{ role: 'user', content: '第一问：中心理解怎么做' }, { role: 'assistant', content: '答1' }, { role: 'user', content: '第二问：这题选什么' }, { role: 'assistant', content: '答2' }]
    const r = pickWrongSource(msgs, 3)
    expect(r.source).toBe('text')
    expect(r.q).toContain('第二问')
  })
  it('点较早的 AI 回复时取它自己那轮的用户提问，而不是最新的', () => {
    const msgs = [
      { role: 'user', content: '早期问题A' },
      { role: 'assistant', content: '早答A' },
      { role: 'user', content: '后期问题B' },
      { role: 'assistant', content: '晚答B' }
    ]
    const r = pickWrongSource(msgs, 1)
    expect(r.q).toContain('早期问题A')
  })
})

describe('截图存错题完整整理', () => {
  it('OCR 文本会被整理成题干、A-D 选项和答案', () => {
    const qz = rawToQuiz('某市2025年GDP同比增长5.2%，问增长量约是多少？\nA. 100亿元\nB. 120亿元\nC. 140亿元\nD. 160亿元\n答案：B')
    expect(qz).toBeTruthy()
    expect(qz.stem).toContain('GDP')
    expect(qz.options.length).toBe(4)
    expect(qz.answer).toBe('B')
  })

  it('AI 回复中的答案解析会被提取为错题解析', () => {
    const reply = '正确答案是 B。\n\n解析：先定位现期量和增长率，再用增长量公式计算，A/C/D 的数值均与材料口径不符。'
    const exp = explainFrom(reply)
    expect(exp).toContain('现期量')
    expect(exp).toContain('A/C/D')
  })
})
