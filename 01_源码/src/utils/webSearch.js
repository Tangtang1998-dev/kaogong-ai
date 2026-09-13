const CACHE_TTL = 10 * 60 * 1000
const cache = new Map()

function cleanText(v, max = 500) {
  return String(v || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function resultKey(it) {
  return String((it && (it.url || it.title)) || '').trim().toLowerCase()
}

function mergeResults(groups, limit) {
  const out = []
  const seen = new Set()
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const key = resultKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(item)
      if (out.length >= limit) return out
    }
  }
  return out
}

async function fetchJson(url, signal, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

async function searchWikipedia(query, signal, limit) {
  const base = 'https://zh.wikipedia.org/w/api.php'
  const searchUrl = base + '?action=query&list=search&format=json&origin=*&utf8=1&srlimit=' + limit + '&srsearch=' + encodeURIComponent(query)
  const list = await fetchJson(searchUrl, signal)
  const rows = list && list.query && Array.isArray(list.query.search) ? list.query.search : []
  if (!rows.length) return []
  const titles = rows.map((x) => x.title).filter(Boolean).slice(0, limit)
  const detailUrl = base + '?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*&utf8=1&titles=' + encodeURIComponent(titles.join('|'))
  let pages = []
  try {
    const detail = await fetchJson(detailUrl, signal)
    pages = Object.values((detail && detail.query && detail.query.pages) || {})
  } catch (e) {}
  const byTitle = new Map(pages.map((p) => [p.title, p]))
  return titles.map((title) => {
    const page = byTitle.get(title) || {}
    const intro = cleanText(page.extract, 520)
    const fallback = rows.find((x) => x.title === title) || {}
    return {
      title,
      snippet: intro || cleanText(fallback.snippet, 320),
      url: page.fullurl || ('https://zh.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/\s+/g, '_'))),
      source: 'Wikipedia'
    }
  }).filter((x) => x.snippet || x.title)
}

function flattenDuckTopics(list, out, depth = 0) {
  if (!Array.isArray(list) || depth > 2) return
  for (const item of list) {
    if (!item) continue
    if (item.Text && item.FirstURL) out.push({ title: cleanText(item.Text, 120), snippet: cleanText(item.Text, 360), url: item.FirstURL, source: 'DuckDuckGo' })
    if (Array.isArray(item.Topics)) flattenDuckTopics(item.Topics, out, depth + 1)
  }
}

async function searchDuckDuckGo(query, signal, limit) {
  const url = 'https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&skip_disambig=1&q=' + encodeURIComponent(query)
  const data = await fetchJson(url, signal)
  const out = []
  if (data && (data.AbstractText || data.AbstractURL)) {
    out.push({
      title: cleanText(data.Heading || query, 120),
      snippet: cleanText(data.AbstractText || data.Answer || data.Definition, 520),
      url: data.AbstractURL || ('https://duckduckgo.com/?q=' + encodeURIComponent(query)),
      source: 'DuckDuckGo'
    })
  }
  flattenDuckTopics(data && data.RelatedTopics, out)
  return out.slice(0, limit)
}

export function clearWebSearchCache() {
  cache.clear()
}

export async function searchWeb(query, opts = {}) {
  const q = cleanText(query, 220)
  const limit = Math.max(1, Math.min(8, Number(opts.limit) || 5))
  if (!q) return { ok: false, query: '', items: [], provider: 'DuckDuckGo / Wikipedia', error: '搜索内容为空' }
  const key = q + '|' + limit
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.value, cached: true }
  const settled = await Promise.allSettled([
    searchWikipedia(q, opts.signal, limit),
    searchDuckDuckGo(q, opts.signal, limit)
  ])
  const groups = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value)
  const items = mergeResults(groups, limit)
  const errors = settled.filter((x) => x.status === 'rejected').map((x) => cleanText(x.reason && x.reason.message, 120))
  const value = items.length
    ? { ok: true, query: q, items, provider: 'DuckDuckGo / Wikipedia', error: '', cached: false }
    : { ok: false, query: q, items: [], provider: 'DuckDuckGo / Wikipedia', error: errors.join('；') || '未检索到公开结果', cached: false }
  cache.set(key, { at: Date.now(), value })
  return value
}

export function buildWebSearchContext(query, result) {
  const q = cleanText(query, 220)
  const items = result && Array.isArray(result.items) ? result.items : []
  if (!items.length) {
    return '\n\n【联网检索状态】本轮已开启联网检索，但公开搜索源未返回可用结果。涉及实时信息时必须明确说明“无法联网核实”，不得编造来源、时间或数据。'
  }
  const lines = [
    '\n\n【联网检索结果｜必须是用于核验的最新外部资料】',
    '检索词：' + q,
    '使用纪律：下列摘要来自公开网页，可能不完整；若与用户提供的题目材料冲突，以用户材料为准。涉及实时政策、考试时间、新闻事件或数据时，请优先参考这些结果，并在回答末尾列出实际采用的来源编号。没有采用的来源不要强行引用，不得编造 URL。'
  ]
  items.forEach((it, i) => {
    lines.push(`[${i + 1}] ${it.title}\n摘要：${it.snippet || '（无摘要）'}\nURL：${it.url}`)
  })
  return '\n' + lines.join('\n')
}

export default { searchWeb, buildWebSearchContext, clearWebSearchCache }
