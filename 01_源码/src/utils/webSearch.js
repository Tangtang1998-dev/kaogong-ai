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

function chinaDate(offsetDays = 0, base = new Date()) {
  const d = new Date(base.getTime() + offsetDays * 86400000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t) => (parts.find((x) => x.type === t) || {}).value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function weekdayZh(date) {
  const d = new Date(date + 'T12:00:00+08:00')
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || ''
}

function wantsHoliday(query) {
  const q = String(query || '')
  return /(今天|今日|明天|昨日|昨天|现在).*(节日|节假日|放假|假期)|什么是?(节日|节假日)|什么节日/.test(q)
}

function wantsMeeting(query) {
  return /会议|大会|峰会|论坛|全会|常务会/.test(String(query || ''))
}

function holidayDateFromQuery(query) {
  const q = String(query || '')
  const m = q.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  if (/昨天|昨日/.test(q)) return chinaDate(-1)
  if (/明天/.test(q)) return chinaDate(1)
  return chinaDate(0)
}

function expandRelativeQuery(query) {
  const q = String(query || '').trim()
  if (!/(今天|今日|现在|明天|昨天|昨日)/.test(q)) return q
  const date = holidayDateFromQuery(q)
  return `${q} ${date} ${weekdayZh(date)}`
}

function beijingNowText() {
  const now = new Date()
  const date = chinaDate(0, now)
  const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return `${date} ${weekdayZh(date)} ${time}（北京时间）`
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

async function searchHoliday(query, signal) {
  if (!wantsHoliday(query)) return []
  const date = holidayDateFromQuery(query)
  const data = await fetchJson('https://timor.tech/api/holiday/info/' + date, signal, 6000)
  if (!data || Number(data.code) !== 0) return []
  const holiday = data.holiday
  const type = data.type || {}
  const weekday = type.name || weekdayZh(date)
  const title = date + (holiday && holiday.name ? '：' + holiday.name : ' 节假日查询')
  const snippet = holiday && holiday.name
    ? `${date} 是${weekday}，法定节假日：${holiday.name}${holiday.wage ? '，加班工资按 ' + holiday.wage + ' 倍计算' : ''}。`
    : `${date} 是${weekday}，查询结果不是全国统一的法定节假日；可能是普通周末/工作日或非全国性纪念日。`
  return [{ title, snippet, url: 'https://timor.tech/api/holiday/info/' + date, source: '节假日 API' }]
}

export async function searchGovMeetings(query, signal, limit = 5) {
  if (!wantsMeeting(query)) return []
  const q = /全会|峰会|论坛|常务会|代表大会/.test(query) ? cleanText(query, 80) : '会议'
  const url = 'https://sousuo.www.gov.cn/search-gov/data?t=zhengcelibrary&q=' + encodeURIComponent(q) + '&timetype=timeqb&sort=time&sortType=1&searchfield=title&p=1&n=' + Math.max(10, limit)
  const data = await fetchJson(url, signal, 8000)
  const cat = data && data.searchVO && data.searchVO.catMap ? data.searchVO.catMap : {}
  const rows = []
  for (const key of ['otherfile', 'gongwen', 'bumenfile']) {
    const list = cat[key] && Array.isArray(cat[key].listVO) ? cat[key].listVO : []
    for (const x of list) rows.push(x)
  }
  const seen = new Set()
  const items = []
  for (const row of rows) {
    const link = String(row.url || row.link || '').trim()
    const title = cleanText(row.title, 180)
    if (!link || !title || seen.has(link)) continue
    seen.add(link)
    items.push({ title, snippet: `${cleanText(row.pubtimeStr, 20)} ${cleanText(row.summary, 420)}`.trim(), url: link, source: '中国政府网' })
    if (items.length >= limit) break
  }
  if (!items.length) return []
  const date = holidayDateFromQuery(query)
  const hitToday = items.find((x) => String(x.snippet).includes(date.replace(/-/g, '.')) || String(x.snippet).includes(date))
  const top = hitToday || items[0]
  const answer = hitToday
    ? `检索到 ${date} 相关的中国政府网会议信息：${top.title}。`
    : `截至当前日期，中国政府网可检索到的会议信息中没有明确标注 ${date} 当天召开的重大会议；最近一条相关会议信息为 ${top.snippet.slice(0, 120)}。`
  return [{ title: answer, snippet: answer, url: top.url, source: '中国政府网' }, ...items.filter((x) => x.url !== top.url)]
}

export function clearWebSearchCache() {
  cache.clear()
}

export async function searchWeb(query, opts = {}) {
  const q = cleanText(query, 220)
  const datedQ = expandRelativeQuery(q)
  const limit = Math.max(1, Math.min(8, Number(opts.limit) || 5))
  if (!q) return { ok: false, query: '', items: [], provider: 'DuckDuckGo / Wikipedia', error: '搜索内容为空' }
  const key = q + '|' + limit
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.value, cached: true }
  const settled = await Promise.allSettled([
    searchHoliday(q, opts.signal),
    searchGovMeetings(q, opts.signal, limit),
    searchWikipedia(datedQ, opts.signal, limit),
    searchDuckDuckGo(datedQ, opts.signal, limit)
  ])
  const groups = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value)
  let items = mergeResults(groups, limit)
  if (wantsHoliday(q) && Array.isArray(groups[0]) && groups[0].length) {
    const date = holidayDateFromQuery(q)
    const shortDate = date.slice(5).replace('-', '月') + '日'
    items = [groups[0][0], ...items.filter((it) => it.source !== '节假日 API' && (String(it.title + it.snippet).includes(date) || String(it.title + it.snippet).includes(shortDate)))].slice(0, limit)
  }
  let directAnswer = wantsHoliday(q) && items[0] && items[0].source === '节假日 API' ? items[0].snippet : ''
  let kind = directAnswer ? 'holiday' : 'web'
  if (wantsMeeting(q) && Array.isArray(groups[1]) && groups[1].length) {
    const gov = groups[1][0]
    items = [gov, ...items.filter((it) => it.url !== gov.url)].slice(0, limit)
    directAnswer = gov.snippet
    kind = 'meeting'
  }
  const errors = settled.filter((x) => x.status === 'rejected').map((x) => cleanText(x.reason && x.reason.message, 120))
  const value = items.length
    ? { ok: true, query: q, datedQuery: datedQ, items, provider: '节假日 API / 中国政府网 / DuckDuckGo / Wikipedia', error: '', cached: false, kind, directAnswer }
    : { ok: false, query: q, datedQuery: datedQ, items: [], provider: '节假日 API / 中国政府网 / DuckDuckGo / Wikipedia', error: errors.join('；') || '未检索到公开结果', cached: false }
  cache.set(key, { at: Date.now(), value })
  return value
}

export function buildWebSearchContext(query, result) {
  const q = cleanText(query, 220)
  const items = result && Array.isArray(result.items) ? result.items : []
  const nowLine = '当前时间：' + beijingNowText() + '。本轮联网功能已经实际执行，不得回答“我无法联网”“我不知道今天的日期”或把日期问题推回给用户。'
  if (!items.length) {
    return '\n\n【联网检索状态】' + nowLine + '\n公开搜索源本轮未返回可用结果；涉及实时信息时只能说明“本次检索未找到可靠结果”，不得编造来源、时间或数据。'
  }
  const lines = [
    '\n\n【联网检索结果｜必须是用于核验的最新外部资料】',
    nowLine,
    '检索词：' + q,
    '使用纪律：下列摘要来自公开网页，可能不完整；若与用户提供的题目材料冲突，以用户材料为准。涉及实时政策、考试时间、新闻事件或数据时，请优先参考这些结果，并在回答末尾列出实际采用的来源编号。没有采用的来源不要强行引用，不得编造 URL。'
  ]
  items.forEach((it, i) => {
    lines.push(`[${i + 1}] ${it.title}\n摘要：${it.snippet || '（无摘要）'}\nURL：${it.url}`)
  })
  return '\n' + lines.join('\n')
}

export default { searchWeb, buildWebSearchContext, clearWebSearchCache }
