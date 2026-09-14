// contentManifest.js —— 真题/PDF 内容清单与镜像解析（纯函数）
export const CONTENT_SOURCES = [
  { id: 'local', label: '本地/内置', base: './zhenti-pdf/' },
  { id: 'jsdelivr', label: 'jsDelivr 国内加速', base: 'https://cdn.jsdelivr.net/gh/ly7638714/kaogong-ai@main/01_%E6%BA%90%E7%A0%81/public/zhenti-pdf/' },
  { id: 'github', label: 'GitHub 备用', base: 'https://raw.githubusercontent.com/ly7638714/kaogong-ai/main/01_%E6%BA%90%E7%A0%81/public/zhenti-pdf/' },
  { id: 'gitee', label: 'Gitee 国内兜底', base: 'https://gitee.com/KKAALY13/kaogong-ai/raw/main/01_%E6%BA%90%E7%A0%81/public/zhenti-pdf/' }
]

export function resolveContentItem(name = '', opts = {}) {
  const clean = String(name || '').replace(/^\/+/, '')
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources : CONTENT_SOURCES
  const order = Array.isArray(opts.order) ? opts.order : []
  const ordered = [...order, ...sources.filter((s) => !order.some((x) => (x && x.id) === (s && s.id)))]
  return {
    name: clean,
    candidates: ordered.map((s) => ({ id: s.id, label: s.label, url: (s.base || '').replace(/\/?$/, '/') + encodeURI(clean) })),
    primary: ordered[0] ? { id: ordered[0].id, label: ordered[0].label, url: (ordered[0].base || '').replace(/\/?$/, '/') + encodeURI(clean) } : null,
    fallbacks: ordered.slice(1).map((s) => ({ id: s.id, label: s.label, url: (s.base || '').replace(/\/?$/, '/') + encodeURI(clean) }))
  }
}

export async function verifyContentIntegrity(buffer, expected = {}) {
  const out = { ok: true, size: 0, sha256: '', errors: [] }
  const bytes = buffer instanceof ArrayBuffer ? buffer : (buffer && buffer.buffer ? buffer.buffer : null)
  if (!bytes) { out.ok = false; out.errors.push('空文件'); return out }
  out.size = bytes.byteLength
  if (Number(expected.size) > 0 && bytes.byteLength !== Number(expected.size)) out.errors.push('文件大小不一致')
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    out.sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (expected.sha256 && String(expected.sha256).toLowerCase() !== out.sha256) out.errors.push('SHA256 不一致')
  } catch (e) {}
  out.ok = out.errors.length === 0
  return out
}

export default { CONTENT_SOURCES, resolveContentItem, verifyContentIntegrity }
