// 离线授权码生成器。私钥只保留在本机，不进入网页或 APK。
// 用法示例：
//   node generate-license.mjs --plan=month --device=XC-XXXX-XXXX-XXXX
//   node generate-license.mjs --plan=quarter --device=XC-XXXX-XXXX-XXXX
//   node generate-license.mjs --plan=gk --device=XC-XXXX-XXXX-XXXX
//   node generate-license.mjs --plan=province --exam=guizhou --expire=2027-03-20 --device=XC-XXXX-XXXX-XXXX
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const privateJwk = JSON.parse(fs.readFileSync(path.join(here, 'private-key.json'), 'utf8'))

function arg(name, d = '') {
  const p = `--${name}=`
  const hit = process.argv.find((x) => x.startsWith(p))
  return hit ? hit.slice(p.length) : d
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

const plan = String(arg('plan', 'month')).toLowerCase()
const device = String(arg('device', '')).trim()
const exam = String(arg('exam', plan === 'gk' ? 'national' : '')).trim()
const now = Date.now()
const expiryArg = String(arg('expire', '')).trim()
let exp = 0
let label = ''

if (plan === 'month') { exp = addDays(now, 30); label = '标准月付' }
else if (plan === 'quarter') { exp = addDays(now, 90); label = '标准季度付' }
else if (plan === 'gk') { exp = new Date('2026-12-06T23:59:59+08:00').getTime(); label = '国考季票' }
else if (plan === 'province') { exp = expiryArg ? new Date(expiryArg + 'T23:59:59+08:00').getTime() : 0; label = '省考季票' }
else { console.error('未知套餐：' + plan); process.exit(2) }

if (!device) { console.error('缺少 --device=设备码'); process.exit(2) }
if (!Number.isFinite(exp) || exp <= now) { console.error('到期时间无效，省考季票请传 --expire=YYYY-MM-DD'); process.exit(2) }

const payload = {
  v: 1,
  lid: 'XC-' + Date.now().toString(36).toUpperCase(),
  plan,
  exam: exam || '',
  exp,
  devices: [device],
  features: ['chat', 'quiz', 'wrong', 'tts', 'search', 'pdf'],
  iat: now
}
const payloadText = JSON.stringify(payload)
const payloadPart = b64url(payloadText)
const signature = crypto.sign('sha256', Buffer.from(payloadPart), {
  key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363'
})
const code = 'XC1.' + payloadPart + '.' + b64url(signature)
console.log(JSON.stringify({ label, device, exp, expireText: new Date(exp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), code }, null, 2))
