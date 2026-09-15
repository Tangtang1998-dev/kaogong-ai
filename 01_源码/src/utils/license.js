/* global crypto, atob */
// license.js —— 离线付费授权：7 天试用 + ECDSA P-256 签名激活码。
// 客户端只含公钥；私钥保存在本机 10_授权工具/private-key.json，不进入网页和 APK。
import { reactive } from 'vue'

const STORAGE_KEY = 'xc_offline_license_v1'
const DEVICE_KEY = 'xc_device_code_v1'
const TRIAL_DAYS = 7
const TRIAL_POINTS = 30
const PUBLIC_JWK = { kty: 'EC', crv: 'P-256', x: '_eTtxfkTlCNxT5oL_JlxK9Vy5poKtJrNPhPl738Ctlo', y: 'ofbmtixWhaQQTyFgirnWvB7CLdkR7Pys7exu04RDLhc' }

export const PLANS = [
  { id: 'month', name: '标准月付', price: 39, days: 30, tag: '短期使用' },
  { id: 'quarter', name: '标准季度付', price: 99, days: 90, tag: '推荐' },
  { id: 'gk', name: '国考季票', price: 129, exam: 'national', tag: '到国考笔试后 7 天' },
  { id: 'province', name: '省考季票', price: 129, exam: 'province', tag: '到所选省考笔试后 7 天' }
]

export const licenseState = reactive({
  ready: false,
  active: true,
  mode: 'none',
  plan: '',
  planName: '未激活',
  expiresAt: 0,
  deviceCode: '',
  trialPoints: TRIAL_POINTS,
  trialDaysLeft: TRIAL_DAYS,
  viewOnly: false,
  message: ''
})

function now() { return Date.now() }

function readJson(key, d = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? d } catch (e) { return d }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
}

function randomPart() {
  const a = new Uint8Array(8)
  try { crypto.getRandomValues(a) } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256) }
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8).toUpperCase()
}

export function getDeviceCode() {
  let code = ''
  try { code = String(localStorage.getItem(DEVICE_KEY) || '').trim() } catch (e) {}
  if (!/^XC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    code = 'XC-' + randomPart().slice(0, 4) + '-' + randomPart().slice(0, 4) + '-' + randomPart().slice(0, 4)
    try { localStorage.setItem(DEVICE_KEY, code) } catch (e) {}
  }
  return code
}

function b64urlToBytes(s) {
  let x = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  while (x.length % 4) x += '='
  const bin = atob(x)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function verifyLicenseCode(code, deviceCode = getDeviceCode()) {
  const raw = String(code || '').trim()
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== 'XC1') return { ok: false, msg: '激活码格式不正确' }
  let payload = null
  try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) } catch (e) { return { ok: false, msg: '激活码内容损坏' } }
  if (!payload || payload.v !== 1) return { ok: false, msg: '激活码版本不支持' }
  if (!Array.isArray(payload.devices) || !payload.devices.includes(deviceCode)) return { ok: false, msg: '激活码与当前设备不匹配' }
  if (!(Number(payload.exp) > now())) return { ok: false, msg: '激活码已过期' }
  try {
    const key = await crypto.subtle.importKey('jwk', PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[1]))
    if (!ok) return { ok: false, msg: '激活码签名无效' }
  } catch (e) {
    return { ok: false, msg: '当前环境无法校验激活码' }
  }
  return { ok: true, payload }
}

function readTrial() {
  const d = readJson('xc_offline_trial_v1', null)
  if (d && Number(d.start) > 0) return d
  const fresh = { start: now(), points: TRIAL_POINTS, device: getDeviceCode() }
  writeJson('xc_offline_trial_v1', fresh)
  return fresh
}

function applyTrial() {
  const t = readTrial()
  const leftMs = t.start + TRIAL_DAYS * 86400000 - now()
  licenseState.trialPoints = Math.max(0, Number(t.points) || 0)
  licenseState.trialDaysLeft = Math.max(0, Math.ceil(leftMs / 86400000))
  if (leftMs > 0 && licenseState.trialPoints > 0) {
    licenseState.active = true
    licenseState.mode = 'trial'
    licenseState.plan = 'trial'
    licenseState.planName = '免费试用'
    licenseState.expiresAt = t.start + TRIAL_DAYS * 86400000
    licenseState.message = '试用剩余 ' + licenseState.trialDaysLeft + ' 天 · ' + licenseState.trialPoints + ' 点'
    return true
  }
  licenseState.active = false
  licenseState.mode = 'expired'
  licenseState.plan = ''
  licenseState.planName = '试用已结束'
  licenseState.message = licenseState.trialPoints <= 0 ? '试用点数已用完，请激活正式套餐' : '7 天试用已到期，请激活正式套餐'
  return false
}

export async function licenseInit() {
  licenseState.deviceCode = getDeviceCode()
  const saved = readJson(STORAGE_KEY, null)
  if (saved && saved.code) {
    const r = await verifyLicenseCode(saved.code, licenseState.deviceCode)
    if (r.ok) {
      const p = r.payload
      licenseState.active = true
      licenseState.mode = 'paid'
      licenseState.plan = p.plan || 'month'
      licenseState.planName = (PLANS.find((x) => x.id === p.plan) || {}).name || '正式套餐'
      licenseState.expiresAt = Number(p.exp) || 0
      licenseState.message = '已激活 · 到期 ' + new Date(licenseState.expiresAt).toLocaleDateString('zh-CN')
      licenseState.ready = true
      return licenseState
    }
  }
  applyTrial()
  licenseState.ready = true
  return licenseState
}

export async function activateLicenseCode(code) {
  const r = await verifyLicenseCode(code, getDeviceCode())
  if (!r.ok) return r
  writeJson(STORAGE_KEY, { code: String(code || '').trim(), activatedAt: now() })
  await licenseInit()
  return { ok: true, payload: r.payload }
}

export function consumeLicensePoints(cost = 1) {
  if (!licenseState.ready || licenseState.mode === 'paid') return { ok: true, cost: 0 }
  if (licenseState.mode !== 'trial' || !licenseState.active) return { ok: false, msg: licenseState.message || '请先激活正式套餐' }
  const t = readTrial()
  const need = Math.max(1, Number(cost) || 1)
  if ((Number(t.points) || 0) < need) {
    licenseState.trialPoints = 0
    licenseState.active = false
    licenseState.mode = 'expired'
    licenseState.message = '试用点数已用完，请激活正式套餐'
    writeJson('xc_offline_trial_v1', t)
    return { ok: false, msg: licenseState.message }
  }
  t.points = (Number(t.points) || 0) - need
  writeJson('xc_offline_trial_v1', t)
  licenseState.trialPoints = t.points
  if (t.points <= 0) {
    licenseState.active = false
    licenseState.mode = 'expired'
    licenseState.message = '试用点数已用完，请激活正式套餐'
  } else {
    licenseState.message = '试用剩余 ' + licenseState.trialDaysLeft + ' 天 · ' + t.points + ' 点'
  }
  return { ok: true, cost: need }
}

export function requireLicense(cost = 1) {
  // 未初始化的测试环境保持放行，避免底层纯函数单测被授权门干扰。
  if (!licenseState.ready) return { ok: true, cost: 0 }
  return consumeLicensePoints(cost)
}

export function licenseDeviceCode() {
  return getDeviceCode()
}

export default { PLANS, licenseState, licenseInit, activateLicenseCode, verifyLicenseCode, requireLicense, consumeLicensePoints, licenseDeviceCode }
