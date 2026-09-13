import { describe, it, expect } from 'vitest'
import { applyLocalMerge, hydrateStoreFromPlan, mergeArrays, mergeSyncData, shouldSyncKey, syncScopeFromBackup, makeCloudEnvelope, cloudEnvelopeMeta, syncDataHash, syncOverview, saveSyncState, restoreCloudSnapshot, collectCloudData } from '../utils/cloudSync'
import { webdavFileUrl, webdavSyncUrl, describeWebdavHttp } from '../utils/webdav'
import { store } from '../store'

const testMem = new Map()
globalThis.localStorage = {
  getItem: (k) => (testMem.has(k) ? testMem.get(k) : null),
  setItem: (k, v) => testMem.set(k, String(v)),
  removeItem: (k) => testMem.delete(k),
  key: (i) => [...testMem.keys()][i] ?? null,
  get length() { return testMem.size }
}

describe('cloudSync 多端安全合并', () => {
  it('远端/本机不同集合都保留，不整包覆盖', () => {
    const a = [{ id: 1, t: 1690000000100, stem: 'A' }, { id: 2, t: 1690000000200, stem: 'B' }]
    const b = [{ id: 3, t: 1690000000300, stem: 'C' }]
    const m = mergeArrays(a, b)
    expect(m.map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('同 id 按更新时间取新，且远端只新增项不丢', () => {
    const a = [{ id: 'q1', t: 1690000000100, answer: 'A' }]
    const b = [{ id: 'q1', t: 1690000000300, answer: 'B' }, { id: 'q2', t: 1690000000400, answer: 'C' }]
    const m = mergeArrays(a, b)
    expect(m.find((x) => x.id === 'q1').answer).toBe('B')
    expect(m.some((x) => x.id === 'q2')).toBe(true)
  })

  it('本机无未上传改动时，同 id 同时间戳优先采用云端新版本', () => {
    const time = 1690000000100
    const local = [{ id: 'q1', t: time, question: '网页旧题面' }]
    const remote = [{ id: 'q1', t: time, question: '手机新题面' }]
    expect(mergeArrays(local, remote, 'xc_wqs', false)[0].question).toBe('网页旧题面')
    expect(mergeArrays(local, remote, 'xc_wqs', true)[0].question).toBe('手机新题面')
    const merged = mergeSyncData({ xc_wqs: JSON.stringify(local) }, { xc_wqs: JSON.stringify(remote) }, {}, { preferRemote: true })
    expect(JSON.parse(merged.xc_wqs)[0].question).toBe('手机新题面')
  })

  it('学习数据与设置同步，仅排除纯本机 UI，密钥字段只上传占位', () => {
    expect(shouldSyncKey('xc_msgs')).toBe(true)
    expect(shouldSyncKey('xc_cfg')).toBe(true)
    expect(shouldSyncKey('xc_chat_draft')).toBe(true)
    expect(shouldSyncKey('xc_recent_qs')).toBe(true)
    expect(shouldSyncKey('xc_auth')).toBe(false)
    expect(shouldSyncKey('xc_pet_pos_d')).toBe(false)
    const scoped = syncScopeFromBackup({ data: { xc_msgs: '[]', xc_cfg: '{}', xc_pet_pos_d: '{}', xc_pet: '{}' } })
    expect(Object.keys(scoped).sort()).toEqual(['xc_cfg', 'xc_msgs', 'xc_pet'])
  })

  it('设置随云端同步，但密钥只上传占位且恢复时保留本机真实密钥', () => {
    testMem.clear()
    testMem.set('xc_cfg', JSON.stringify({ text: { key: 'sk-local-secret-12345678' }, webdav: { pass: 'local-pass' } }))
    const env = makeCloudEnvelope({ xc_cfg: testMem.get('xc_cfg') })
    const uploaded = JSON.parse(env.data.xc_cfg)
    expect(uploaded.text.key).toBe('***')
    expect(uploaded.webdav.pass).toBe('***')
    restoreCloudSnapshot(env)
    const restored = JSON.parse(testMem.get('xc_cfg'))
    expect(restored.text.key).toBe('sk-local-secret-12345678')
    expect(restored.webdav.pass).toBe('local-pass')
  })

  it('同步时修复 xc_tasks 里被二次序列化的任务数组', () => {
    const legacy = JSON.stringify({ date: '2026-09-07', items: JSON.stringify([{ k: 'p', done: false }]) })
    const scoped = syncScopeFromBackup({ data: { xc_tasks: legacy } })
    const parsed = JSON.parse(scoped.xc_tasks)
    expect(Array.isArray(parsed.items)).toBe(true)
    expect(parsed.items).toHaveLength(1)
  })

  it('本机未修改且云端更新时，标量采用云端；本机也改了则本机优先', () => {
    const base = { xc_mode: 'all' }
    const local = { xc_mode: 'all' }
    const remote = { xc_mode: 'luoji' }
    expect(mergeSyncData(local, remote, base).xc_mode).toBe('luoji')
    expect(mergeSyncData({ xc_mode: 'tutu' }, remote, base).xc_mode).toBe('tutu')
  })

  it('远端空数组/空对象也能把本机已有项带去云端', () => {
    const local = { xc_msgs: JSON.stringify([{ id: 'm1', t: 1690000000100, role: 'user' }]) }
    const remote = { xc_msgs: JSON.stringify([]) }
    const merged = mergeSyncData(local, remote, {})
    expect(JSON.parse(merged.xc_msgs)).toHaveLength(1)
  })

  it('错题永久删除墓碑会过滤本地与云端旧记录', () => {
    const local = {
      xc_wqs: JSON.stringify([]),
      xc_wq_deleted: JSON.stringify([{ id: 'w1', qhash: 'q1', t: 1690000000100 }])
    }
    const remote = {
      xc_wqs: JSON.stringify([{ id: 'w1', question: '已经删除的旧题', t: 1690000000000 }])
    }
    const merged = mergeSyncData(local, remote, {})
    expect(JSON.parse(merged.xc_wqs)).toEqual([])
    expect(JSON.parse(merged.xc_wq_deleted)).toHaveLength(1)
  })

  it('applyLocalMerge 下载远端后把两端集合安全合并并写回本机', () => {
    testMem.clear()
    testMem.set('xc_msgs', JSON.stringify([{ id: 'm1', t: 1690000000100, role: 'user', text: '本机' }]))
    const backup = {
      data: {
        xc_msgs: JSON.stringify([{ id: 'm2', t: 1690000000300, role: 'assistant', text: '云端' }]),
        xc_cfg: '{"webdav":{"pass":"secret"}}'
      }
    }
    const plan = applyLocalMerge({ data: { xc_msgs: testMem.get('xc_msgs') } }, backup, {})
    const localItems = JSON.parse(JSON.parse(JSON.stringify(localStorage.getItem('xc_msgs'))))
    expect(localItems.map((x) => x.id)).toEqual(['m1', 'm2'])
    expect(plan.sameAsRemote).toBe(false)
    expect(JSON.parse(localStorage.getItem('xc_cfg')).webdav.pass).toBe('secret')
  })

  it('同步合并后把对话记录回填到界面（此前只回填错题，导致“另一端对话没同步”）', () => {
    testMem.clear()
    const local = { id: 'm1', t: 1690000000100, role: 'user', content: '本机消息' }
    const remote = { id: 'm2', t: 1690000000200, role: 'assistant', content: '云端消息' }
    testMem.set('xc_msgs', JSON.stringify([local]))
    const backup = { data: { xc_msgs: JSON.stringify([remote]) } }
    const plan = applyLocalMerge({ data: { xc_msgs: testMem.get('xc_msgs') } }, backup, {})
    store.msgs = []
    hydrateStoreFromPlan(plan)
    expect(store.msgs.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('单向下载云端时优先恢复错题集，并立即回填 store.wqs', () => {
    testMem.clear()
    store.wqs = [{ id: 'old', question: '网页旧错题' }]
    testMem.set('xc_wqs', JSON.stringify(store.wqs))
    const remoteWqs = [{ id: 'm1', t: 1690000000300, question: '手机最新错题' }]
    const env = makeCloudEnvelope({
      xc_msgs: JSON.stringify([{ id: 'msg1', t: 1690000000200, role: 'assistant', content: '云端对话' }]),
      xc_wqs: JSON.stringify(remoteWqs)
    })
    const base = globalThis.localStorage
    const writes = []
    globalThis.localStorage = {
      ...base,
      setItem(k, v) { writes.push(k); base.setItem(k, v) },
      getItem(k) { return base.getItem(k) }
    }
    try {
      const report = restoreCloudSnapshot(env)
      expect(writes[0]).toBe('xc_wqs')
      expect(report.failed).toEqual([])
      expect(JSON.parse(testMem.get('xc_wqs'))[0].question).toBe('手机最新错题')
      expect(store.wqs[0].question).toBe('手机最新错题')
    } finally {
      globalThis.localStorage = base
    }
  })

  it('云端错题集写入失败时，下载返回明确错误而不是误报成功', () => {
    testMem.clear()
    testMem.set('xc_wqs', JSON.stringify([{ id: 'old', question: '旧错题' }]))
    const env = makeCloudEnvelope({ xc_wqs: JSON.stringify([{ id: 'new', question: '新错题' }]) })
    const base = globalThis.localStorage
    globalThis.localStorage = {
      ...base,
      setItem(k, v) { if (k !== 'xc_wqs') base.setItem(k, v) },
      getItem(k) { return base.getItem(k) }
    }
    try {
      expect(() => restoreCloudSnapshot(env)).toThrow('云端错题集未写入本机')
      expect(JSON.parse(testMem.get('xc_wqs'))[0].question).toBe('旧错题')
    } finally {
      globalThis.localStorage = base
    }
  })

  it('坚果云根地址/目录地址自动补齐成可写的 JSON 文件地址', () => {
    expect(webdavFileUrl('https://dav.jianguoyun.com/dav/')).toBe('https://dav.jianguoyun.com/dav/xingce-ai.json')
    expect(webdavFileUrl('https://dav.jianguoyun.com/dav')).toBe('https://dav.jianguoyun.com/dav/xingce-ai.json')
    expect(webdavFileUrl('https://dav.jianguoyun.com/dav/我的行测/')).toBe('https://dav.jianguoyun.com/dav/我的行测/xingce-ai.json')
    expect(webdavFileUrl('https://dav.jianguoyun.com/dav/行测AI备份.json')).toBe('https://dav.jianguoyun.com/dav/行测AI备份.json')
    expect(webdavSyncUrl('https://dav.jianguoyun.com/dav/行测AI备份.json')).toBe('https://dav.jianguoyun.com/dav/行测AI备份.sync.json')
  })

  it('404 上传/下载会给出中文修复指引，401 提示应用密码', () => {
    expect(describeWebdavHttp(404, 'PUT')).toContain('坚果云模板')
    expect(describeWebdavHttp(401, 'GET')).toContain('应用密码')
    expect(describeWebdavHttp(409, 'PUT')).toContain('冲突')
  })

  it('版本信封携带本机设备信息，并可判断本机是否有未上传改动', () => {
    testMem.clear()
    testMem.set('xc_mode', 'fast')
    const env = makeCloudEnvelope(collectCloudData().data)
    expect(env.device.id).toBeTruthy()
    expect(cloudEnvelopeMeta(env).deviceLabel).toBe('网页/桌面端')
    saveSyncState({ kind: 'ge', baseHash: syncDataHash(env), localT: env.t, remoteT: env.t })
    expect(syncOverview().dirty).toBe(false)
    testMem.set('xc_mode', 'luoji')
    store.mode = 'luoji'
    expect(syncOverview().dirty).toBe(true)
  })
})
