import { describe, it, expect, beforeEach } from 'vitest'
import { PLANS, licenseState, licenseInit, consumeLicensePoints, verifyLicenseCode } from '../utils/license'

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

  it('首次运行自动开始 7 天 30 点试用', async () => {
    await licenseInit()
    expect(licenseState.mode).toBe('trial')
    expect(licenseState.active).toBe(true)
    expect(licenseState.trialPoints).toBe(30)
    expect(licenseState.trialDaysLeft).toBe(7)
  })

  it('试用点数会被逐次扣减，扣完后锁定 AI', async () => {
    await licenseInit()
    const r = consumeLicensePoints(30)
    expect(r.ok).toBe(true)
    expect(licenseState.trialPoints).toBe(0)
    expect(licenseState.active).toBe(false)
    expect(consumeLicensePoints(1).ok).toBe(false)
  })
})
