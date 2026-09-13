import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { searchWeb, buildWebSearchContext, clearWebSearchCache } from '../utils/webSearch'

describe('webSearch 联网检索增强', () => {
  beforeEach(() => clearWebSearchCache())
  afterEach(() => { vi.unstubAllGlobals(); clearWebSearchCache() })

  it('合并公开搜索源，并把 URL 注入模型上下文', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('list=search')) return { ok: true, json: async () => ({ query: { search: [{ title: '人工智能', snippet: '人工智能搜索摘要' }] } }) }
      if (u.includes('prop=extracts')) return { ok: true, json: async () => ({ query: { pages: { 1: { title: '人工智能', extract: '人工智能详细介绍', fullurl: 'https://zh.wikipedia.org/wiki/人工智能' } } } }) }
      return { ok: true, json: async () => ({ Heading: 'AI', AbstractText: 'AI 公开摘要', AbstractURL: 'https://example.com/ai', RelatedTopics: [{ Text: '机器学习相关条目', FirstURL: 'https://example.com/ml' }] }) }
    }))
    const r = await searchWeb('人工智能', { limit: 5 })
    expect(r.ok).toBe(true)
    expect(r.items.length).toBeGreaterThanOrEqual(2)
    expect(r.items.some((x) => x.url.includes('wikipedia.org'))).toBe(true)
    const ctx = buildWebSearchContext('人工智能', r)
    expect(ctx).toContain('https://example.com/ai')
    expect(ctx).toContain('不得编造 URL')
  })

  it('无搜索结果时要求模型如实说明，不允许伪造来源', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    const r = await searchWeb('完全无结果测试', { limit: 3 })
    expect(r.ok).toBe(false)
    const ctx = buildWebSearchContext('完全无结果测试', r)
    expect(ctx).toContain('本次检索未找到可靠结果')
    expect(ctx).toContain('不得编造来源')
  })

  it('“今天是什么节日”自动锚定当天日期并查询节假日 API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('timor.tech')) return { ok: true, json: async () => ({ code: 0, type: { type: 1, name: '周日', week: 7 }, holiday: null }) }
      if (u.includes('list=search')) return { ok: true, json: async () => ({ query: { search: [] } }) }
      return { ok: true, json: async () => ({}) }
    }))
    const r = await searchWeb('今天是什么节日', { limit: 5 })
    expect(r.ok).toBe(true)
    expect(r.datedQuery).toMatch(/20\d{2}-\d{2}-\d{2}/)
    expect(r.items[0].source).toBe('节假日 API')
    expect(r.directAnswer).toContain('不是全国统一的法定节假日')
    expect(r.items[0].snippet).toContain('不是全国统一的法定节假日')
  })
})
