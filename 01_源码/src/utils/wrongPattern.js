// wrongPattern.js —— 错题错误模式聚类与补救计划（纯函数）
import { wrongTaxonKey, taxonOf } from './wrongTaxonomy'

function reasonKey(q) {
  const rs = Array.isArray(q && q.reasons) ? q.reasons : []
  return rs.map((r) => String(r || '').trim().slice(0, 40)).filter(Boolean).join('|')
}

export function buildErrorPatterns(wqs = []) {
  const map = {}
  for (const q of wqs || []) {
    if (!q) continue
    const tax = taxonOf(q)
    const key = wrongTaxonKey(q) || [tax.group, tax.sub || '', tax.type || ''].join('|')
    const p = map[key] || (map[key] = {
      key,
      group: tax.group || '未分类',
      sub: tax.sub || '',
      type: tax.type || '',
      count: 0,
      repeated: 0,
      reasons: {},
      questions: []
    })
    p.count++
    const repeatedN = Number((q.reviewStats && q.reviewStats.e) || 0)
    p.repeated += repeatedN
    const rk = reasonKey(q)
    if (rk) p.reasons[rk] = (p.reasons[rk] || 0) + 1
    if (p.questions.length < 5) p.questions.push(q)
  }
  return Object.values(map)
    .map((p) => ({ ...p, reasons: Object.entries(p.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3) }))
    .sort((a, b) => (b.repeated * 2 + b.count) - (a.repeated * 2 + a.count))
}

export function buildRemediationPlan(pattern, _wqs = [], attempts = []) {
  const q = pattern && pattern.questions && pattern.questions[0]
  const attemptRows = (attempts || []).filter((a) => a && taxonOf({ subject: a.plate, variant: a.variant }).group === pattern.group)
  const recentCorrect = attemptRows.filter((a) => a.ok).slice(-3).length
  return {
    patternKey: pattern.key,
    oneLine: '你主要在「' + pattern.group + (pattern.type ? ' · ' + pattern.type : '') + '」上反复出错。',
    steps: [
      { kind: 'recall', title: '先复述命题结构', body: q ? String(q.stem || '').slice(0, 160) : '回顾该题型中你的常见错误原因。' },
      { kind: 'contrast', title: '做一道同考点对比题', body: buildContrastQuestionRequest(pattern) },
      { kind: 'retest', title: '隔天重测', body: recentCorrect >= 2 ? '近期已连续答对，可进入下一道同类题。' : '完成对比题后再做一次同类重测，通过后更新掌握度。' }
    ]
  }
}

export function buildContrastQuestionRequest(pattern) {
  return '围绕「' + pattern.group + (pattern.type ? ' / ' + pattern.type : '') + '」出一题，重点考察我容易混淆的判断边界，并明确标注正确项与三个干扰项的错误原因。'
}

export function recordRetest(pattern, ok) {
  const next = { patternKey: pattern && pattern.key, ok: !!ok, at: Date.now() }
  if (ok) next.next = '通过重测，建议安排间隔复习'
  else next.next = '重测失败，建议回到对比题再练一次'
  return next
}

export default { buildErrorPatterns, buildRemediationPlan, buildContrastQuestionRequest, recordRetest }
