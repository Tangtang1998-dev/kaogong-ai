// questionFactory.js —— 题型蓝图与确定性出题校验
import { localQuizVerify } from './quizVerify'
import { plateChecks } from './quizVerifyProfiles'

const BASE_SPEC = {
  minOptions: 4,
  requireAnswer: true,
  requireSvg: false,
  numericCheck: false,
  fallback: 'local',
  distractionTypes: []
}

const SPECS = {
  判断推理: { ...BASE_SPEC, distractionTypes: ['偷换概念', '以偏概全', '因果倒置', '无关项'] },
  逻辑判断: { ...BASE_SPEC, distractionTypes: ['偷换概念', '论证方向反', '无关项', '力度不足'] },
  图形推理: { ...BASE_SPEC, requireSvg: true, distractionTypes: ['相似规律', '局部规律', '方向反', '数量误差'] },
  言语理解: { ...BASE_SPEC, distractionTypes: ['主体不符', '范围扩大', '无中生有', '程度过度'] },
  资料分析: { ...BASE_SPEC, numericCheck: true, distractionTypes: ['时间口径', '单位口径', '基期现期混用', '方向相反'] },
  数量关系: { ...BASE_SPEC, numericCheck: true, distractionTypes: ['计算误差', '漏条件', '单位错误', '舍入错误'] },
  常识判断: { ...BASE_SPEC, distractionTypes: ['张冠李戴', '无中生有', '时间错误', '概念混淆'] },
  政治理论: { ...BASE_SPEC, distractionTypes: ['表述绝对', '主体错误', '时间错误', '概念偷换'] },
  定义判断: { ...BASE_SPEC, distractionTypes: ['要件缺失', '要件偷换', '反向关系', '过度引申'] },
  类比推理: { ...BASE_SPEC, distractionTypes: ['一级关系错', '二级关系错', '方向反', '人工自然混淆'] }
}

export function questionSpecOf(subject, variant = '') {
  const s = String(subject || '').trim()
  const v = String(variant || '').trim()
  const base = SPECS[s] || BASE_SPEC
  if (s === '言语理解' && /填空|选词/.test(v)) return { ...base, variant: v, fallback: 'yan-local', distractionTypes: ['搭配不当', '语境不符', '词义偏差', '感情色彩错'] }
  if (s === '资料分析') return { ...base, variant: v, fallback: 'data-local' }
  if (s === '数量关系') return { ...base, variant: v, fallback: 'data-local' }
  return { ...base, variant: v }
}

export function validateGeneratedQuestion(q, subject, variant = '') {
  const errors = []
  const lv = localQuizVerify(q, subject)
  if (!lv.ok) errors.push(lv.reason)
  try { errors.push(...(plateChecks(q, subject, variant) || [])) } catch (e) {}

  const spec = questionSpecOf(subject, variant)
  const stem = String((q && q.stem) || '')
  const optionText = ((q && q.options) || []).map((o) => String((o && o.t) || (o && o.text) || '')).join(' ')
  const hasSvg = /<svg|```svg/i.test(stem + ' ' + optionText)
  if (spec.requireSvg && !hasSvg) errors.push('图推题题干/选项必须包含 SVG 图形')

  if (spec.numericCheck && q && Array.isArray(q.options)) {
    const texts = q.options.map((o) => String((o && o.t) || (o && o.text) || '').trim())
    const nums = texts.map((t) => {
      const m = String(t).replace(/,/g, '').match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*(%|％)?/)
      return m ? m[1] + (m[2] || '') : ''
    }).filter(Boolean)
    if (nums.length >= 4 && new Set(nums).size !== nums.length) errors.push('数值选项存在重复')
  }

  return { ok: errors.length === 0, errors, spec }
}

export default { questionSpecOf, validateGeneratedQuestion }
