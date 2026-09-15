import { describe, it, expect, beforeEach } from 'vitest'
import { PLANS, TRIAL_POINT_COSTS, licenseState, licenseInit, activateLicenseCode, consumeLicensePoints, verifyLicenseCode, promotionState, planPrice, trialPointCost, paidRenewalState } from '../utils/license'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
}

const CODE = 'XC1.eyJ2IjoxLCJsaWQiOiJYQy1NVTJBWUFWQiIsInBsYW4iOiJwcm92aW5jZSIsImV4YW0iOiJ0ZXN0IiwiZXhwIjoyMDUxMjc5OTk5MDAwLCJkZXZpY2VzIjpbIlhDLVRFU1QtMDAwMC0wMDAxIl0sImZlYXR1cmVzIjpbImNoYXQiLCJxdWl6Iiwid3JvbmciLCJ0dHMiLCJzZWFyY2giLCJwZGYiXSwiaWF0IjoxNzg5NDU0NDA5MDk1fQ.LC8sKcMChU-YoMxpQUbSwRntaCoh8VlJkhjPBayPIvVsfC6W_AwsBD91Pu4V4do8G2hj0w-707wJQbFc3Lc36w'

describe('离线授权', () => {
  beforeEach(() => {
    localStorage.clear()
    licenseState.ready = false
    licenseState.active = true
    licenseState.mode = 'none'
    licenseState.trialPoints = 30
    licenseState.message = ''
  })

  it('签名激活码只能在匹配设备上通过', async () => {
    expect((await verifyLicenseCode(CODE, 'XC-TEST-0000-0001')).ok).toBe(true)
    expect((await verifyLicenseCode(CODE, 'XC-TEST-9999-9999')).ok).toBe(false)
    expect((await verifyLicenseCode(CODE.replace('XC1.', 'XC2.'), 'XC-TEST-0000-0001')).ok).toBe(false)
  })

  it('正式版套餐包含月、季度、半年和年卡，且均无自动扣款', async () => {
    expect(PLANS.map((p) => p.id)).toEqual(['month', 'quarter', 'halfyear', 'year', 'gk', 'province'])
    expect(PLANS.find((p) => p.id === 'halfyear')).toMatchObject({ price: 169, days: 180 })
    expect(PLANS.find((p) => p.id === 'year')).toMatchObject({ price: 299, days: 365 })
  })

  it('本周日 08:00-22:00 所有套餐限时立减 5 元', async () => {
    expect(promotionState(Date.parse('2026-09-20T07:59:59+08:00')).active).toBe(false)
    expect(promotionState(Date.parse('2026-09-20T08:00:00+08:00')).active).toBe(true)
    expect(promotionState(Date.parse('2026-09-20T22:00:00+08:00')).active).toBe(true)
    expect(promotionState(Date.parse('2026-09-20T22:00:01+08:00')).active).toBe(false)
    expect(planPrice(PLANS.find((p) => p.id === 'month'), Date.parse('2026-09-20T12:00:00+08:00'))).toBe(34)
    expect(planPrice(PLANS.find((p) => p.id === 'year'), Date.parse('2026-09-20T12:00:00+08:00'))).toBe(294)
  })

  it('首次运行自动开始 7 天 30 点试用', async () => {
    await licenseInit()
    expect(licenseState.mode).toBe('trial')
    expect(licenseState.active).toBe(true)
    expect(licenseState.trialPoints).toBe(30)
    expect(licenseState.trialDaysLeft).toBe(7)
  })

  it('试用对话每次扣 5 点，其他 AI 功能每次扣 1 点', async () => {
    await licenseInit()
    expect(TRIAL_POINT_COSTS).toEqual({ chat: 5, feature: 1 })
    expect(trialPointCost('chat')).toBe(5)
    expect(trialPointCost('feature')).toBe(1)
    expect(consumeLicensePoints(trialPointCost('chat')).ok).toBe(true)
    expect(licenseState.trialPoints).toBe(25)
    expect(consumeLicensePoints(trialPointCost('feature')).ok).toBe(true)
    expect(licenseState.trialPoints).toBe(24)
  })

  it('试用点数不足时拒绝请求，扣完后锁定全部 AI', async () => {
    await licenseInit()
    const r = consumeLicensePoints(30)
    expect(r.ok).toBe(true)
    expect(licenseState.trialPoints).toBe(0)
    expect(licenseState.active).toBe(false)
    expect(consumeLicensePoints(trialPointCost('chat')).ok).toBe(false)
    expect(consumeLicensePoints(trialPointCost('feature')).ok).toBe(false)
  })

  it('正式会员不消耗试用点数，只受到期时间限制', async () => {
    localStorage.setItem('xc_device_code_v1', 'XC-TEST-0000-0001')
    const a = await activateLicenseCode(CODE)
    expect(a.ok).toBe(true)
    expect(licenseState.mode).toBe('paid')
    const before = licenseState.trialPoints
    const r = consumeLicensePoints(999)
    expect(r).toMatchObject({ ok: true, cost: 0 })
    expect(licenseState.trialPoints).toBe(before)
  })

  it('会员到期前 3 天进入续订提醒，到期后强制停用', () => {
    const now = Date.parse('2026-09-15T12:00:00+08:00')
    expect(paidRenewalState(now + 4 * 86400000, now).due).toBe(false)
    expect(paidRenewalState(now + 3 * 86400000, now)).toMatchObject({ due: true, daysLeft: 3, expired: false })
    expect(paidRenewalState(now - 1, now)).toMatchObject({ due: false, daysLeft: 0, expired: true })
  })
})
