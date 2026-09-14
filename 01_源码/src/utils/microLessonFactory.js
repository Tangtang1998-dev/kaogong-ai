// microLessonFactory.js —— 结构化微课分镜工厂（纯函数）
export const LESSON_SCENE_TYPES = ['hook', 'deep', 'flow', 'process', 'example', 'compare', 'checkpoint', 'trap', 'summary', 'apply']

function text(v) { return String(v == null ? '' : v) }

export function buildMicroLesson(card = {}, wrongs = []) {
  const plate = text(card.plate || '行测')
  const type = text(card.type || '核心方法')
  const steps = Array.isArray(card.steps) ? card.steps : []
  const traps = Array.isArray(card.traps) ? card.traps : []
  const signs = Array.isArray(card.signs) ? card.signs : []
  const wrongSample = (wrongs || [])[0]
  const example = wrongSample
    ? { q: text(wrongSample.question || wrongSample.q || wrongSample.stem || '').slice(0, 900), opts: wrongSample.options ? wrongSample.options.map((o) => text(o.k || '') + ' ' + text(o.t || o.text || '')) : ['正确项', '主体偷换', '范围扩大', '无关项'], answer: text(wrongSample.answer || 'A'), path: '先把题干结构还原，再比较主体、方向、范围和力度。' }
    : card.example || { q: '示例题：先识别题型信号，再按步骤定位命题结构。', opts: ['A 只重复背景', 'B 直接对应方法步骤', 'C 主体偷换', 'D 无关项'], answer: 'B', path: 'B 与方法步骤一一对应。' }

  return {
    title: plate + ' · ' + type,
    objective: '学完后能独立识别「' + type + '」的信号，按步骤处理题目，并说清最容易错在哪里。',
    takeaways: [text(card.tip || '先判题型，再走方法步骤。'), text(steps[0] || '把方法落到第一步动作。'), text(traps[0] || '警惕主体、方向、范围和力度陷阱。')],
    scenes: [
      { type: 'hook', icon: '🎯', title: '这道题真正考什么', body: '不是背概念，而是识别命题结构。', points: ['识别信号：' + (signs.join('；') || '先找题型关键词'), '考试目标：把材料翻译成可判断的结构'] },
      { type: 'deep', icon: '🔬', title: '为什么这个方法成立', body: text(card.detail || card.tip || '先找论据与结论的共同话题，再判断选项作用。'), points: ['先看命题人改变哪一块', '再判断选项作用方向', '最后比较力度和范围'] },
      { type: 'flow', icon: '🧭', title: '读题先翻译，不先看选项', body: '先把题干压缩成“谁想让谁相信什么”。', points: ['找主体', '找结论', '找证据', '找隐藏前提'] },
      { type: 'process', icon: '🪜', title: '按步骤拆解', body: steps.join(' → ') || '题型识别 → 结构还原 → 选项比较 → 回文验证', points: steps },
      { type: 'example', icon: '📝', title: wrongSample ? '用你的错题走一遍' : '跟着例题走一遍', body: '把方法放进真实题目里，才叫会。', example },
      { type: 'compare', icon: '⚖️', title: '比较选项，不比“谁更像”', body: '统一用主体、方向、范围、力度四把尺子。', points: ['主体是否一致', '方向是否对应', '范围是否偷换', '力度是否相当'] },
      { type: 'checkpoint', icon: '🧠', title: '停下来检查一下', body: '题干里最重要的第一步应该是什么？', options: [{ k: 'A', t: '先看哪个选项熟悉' }, { k: 'B', t: '先把结构翻译出来' }], answer: 'B', explain: '先还原结构，才不会被熟悉词带跑。' },
      { type: 'trap', icon: '⚠️', title: '最容易错在哪里', body: traps.join('；') || '主体偷换、范围扩大、方向反转、力度不足。', points: traps },
      { type: 'summary', icon: '🧠', title: '把方法变成动作', body: text(card.tip || '先翻译题干，再做判断。'), points: ['下次先复述结构', '再定位证据', '最后比较选项方向'] },
      { type: 'apply', icon: '🚀', title: '现在就应用', body: '把刚学的方法立刻用一道题检验。', points: ['去 AI 出题练同类题', '把方法加入记忆复习'] }
    ]
  }
}

export function lessonMasterySummary(mastery = {}, sceneCount = 0) {
  const values = Array.isArray(mastery) ? mastery : Object.values(mastery || {})
  const understood = values.filter(Boolean).length
  const total = Math.max(sceneCount, understood)
  return { understood, total, pct: total ? Math.round((understood / total) * 100) : 0 }
}

export function readLessonProgress() {
  try { return JSON.parse(localStorage.getItem('xc_lesson_progress') || '{}') || {} } catch (e) { return {} }
}

export function writeLessonProgress(patch) {
  const cur = readLessonProgress()
  const next = { ...cur, ...(patch || {}) }
  try { localStorage.setItem('xc_lesson_progress', JSON.stringify(next)) } catch (e) {}
  return next
}

export default { LESSON_SCENE_TYPES, buildMicroLesson, lessonMasterySummary, readLessonProgress, writeLessonProgress }
