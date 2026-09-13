// 错题详情切换隔离：每个题目只展示自己的复盘状态，禁止跨题复用 UI 草稿和历史错因。
export function wrongDetailKeyOf(index, q) {
  if (!q) return 'none'
  const fingerprint = [q.id || '', q.qhash || '', q.at || q.time || '', String(q.question || q.q || q.stem || '').slice(0, 80)].join('|')
  return String(index) + ':' + fingerprint
}

export function ownWrongReasons(q, presetReasons = [], selectedReasons = []) {
  const preset = new Set(Array.isArray(presetReasons) ? presetReasons : [])
  const selected = new Set(Array.isArray(selectedReasons) ? selectedReasons : [])
  const adopted = q && q.reasonCoach && Array.isArray(q.reasonCoach.adopted) ? q.reasonCoach.adopted : []
  const own = [...(q && Array.isArray(q.reasons) ? q.reasons : []), ...adopted]
  return [...new Set(own.map((x) => String(x || '').trim()).filter(Boolean))]
    .filter((r) => !preset.has(r) && !selected.has(r))
}
