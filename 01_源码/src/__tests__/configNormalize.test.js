import { describe, it, expect } from 'vitest'
import { normalizeCfg } from '../store'
import { mergeMaskedConfig } from '../utils/dataBackup'

describe('配置跨版本归一化', () => {
  it('补全缺失或损坏的语音阅读、TTS 与模型分类对象', () => {
    const c = normalizeCfg({
      text: null,
      vision: { prov: '不存在' },
      fig: null,
      rd: null,
      ttsDash: null,
      ttsMode: '损坏值',
      customModels: { text: { qwen: [{ id: 'my-model' }, null, {}] } }
    })
    expect(c.text.prov).toBe('ds')
    expect(c.text.model).toBe('deepseek-flash')
    expect(c.vision.prov).toBe('ds')
    expect(c.vision.model).toBe('deepseek-flash')
    expect(c.fig.prov).toBe('sf')
    expect(c.rd.prov).toBe('ds')
    expect(c.rd.model).toBe('deepseek-flash')
    expect(c.ttsDash.model).toBe('qwen3-tts-instruct-flash')
    expect(Array.isArray(c.ttsDash.customVoices)).toBe(true)
    expect(c.ttsMode).toBe('sys')
    expect(c.customModels.text.qwen).toEqual([{ id: 'my-model', label: 'my-model' }])
  })

  it('切换服务商后自动选择该服务商的有效模型', () => {
    const c = normalizeCfg({ rd: { prov: 'qwen', model: '已下线模型' } })
    expect(c.rd.prov).toBe('qwen')
    expect(c.rd.model).toBe('qwen3.8-max')
    expect(c.rd.url).toContain('dashscope.aliyuncs.com')
  })

  it('保留自定义服务商的手填模型，并修复百炼音色数组', () => {
    const c = normalizeCfg({ rd: { prov: 'custom', model: 'my-gateway-model' }, ttsDash: { customVoices: '坏数据' } })
    expect(c.rd.prov).toBe('custom')
    expect(c.rd.model).toBe('my-gateway-model')
    expect(c.ttsDash.customVoices).toEqual([])
  })

  it('递归补全其它嵌套配置，同时保留允许为 null 的标量设置', () => {
    const c = normalizeCfg({
      webdav: null,
      github: null,
      voiceCustom: { hidden: null },
      petCustom: null,
      ttsPitch: null,
      globalVoice: null
    })
    expect(c.webdav.url).toBe('')
    expect(c.github.token).toBe('')
    expect(c.voiceCustom.hidden).toEqual({})
    expect(c.voiceCustom.names).toEqual({})
    expect(c.petCustom.name).toBe('自定义人物')
    expect(c.ttsPitch).toBeNull()
    expect(c.globalVoice).toBeNull()
  })

  it('手动备份恢复时空 Key / *** 都不会覆盖本机真实密钥', () => {
    const local = { text: { key: 'sk-local' }, webdav: { pass: 'local-pass' } }
    const masked = mergeMaskedConfig({ text: { key: '' }, webdav: { pass: '***' } }, local)
    expect(masked.text.key).toBe('sk-local')
    expect(masked.webdav.pass).toBe('local-pass')
  })
})
