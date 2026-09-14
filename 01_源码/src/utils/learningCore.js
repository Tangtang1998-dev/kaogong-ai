// learningCore.js —— 统一学习画像与每日训练计划（纯函数）
import { buildPetDashboard } from './petProfile'
import { ymdKey } from './memorySrs'
import { buildErrorPatterns } from './wrongPattern'

function attemptsSummary(attempts = []) {
  const byPlate = {}
  let total = 0
  let correct = 0
  for (const a of attempts || []) {
    if (!a) continue
    const plate = String(a.plate || '未分类')
    const row = byPlate[plate] || (byPlate[plate] = { total: 0, correct: 0, wrong: 0 })
    total++
    row.total++
    if (a.ok) { correct++; row.correct++ } else { row.wrong++ }
  }
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    byPlate
  }
}

function studySummary(study = {}) {
  const today = ymdKey(new Date())
  const todaySec = Number(study[today] || study[today.replace(/-/g, '/')] || 0) || 0
  const totalSec = Object.values(study || {}).reduce((a, b) => a + (Number(b) || 0), 0)
  return { todaySeconds: todaySec, totalSeconds: totalSec, todayMinutes: Math.round(todaySec / 60), totalMinutes: Math.round(totalSec / 60) }
}

export function buildLearningProfile(input = {}) {
  const pet = buildPetDashboard(input)
  const att = attemptsSummary(input.attempts)
  const study = studySummary(input.study)
  const errorPatterns = buildErrorPatterns(input.wqs)
  const activePlates = Array.isArray(pet.activePlates) ? pet.activePlates : []
  return {
    ...pet,
    attempts: att,
    study,
    errorPatterns,
    coldStart: !att.total && !activePlates.length,
    generatedAt: Date.now()
  }
}

function task(id, title, reason, minutes, action, done = false) {
  return { k: id, label: title, reason, minutes, action, done }
}

export function buildDailyPlan({ profile = {}, existingTasks = [] } = {}) {
  const out = []
  const overall = profile.overall || {}
  const weak = profile.weak || null
  const focusType = profile.focusType || null
  const due = Number(overall.due) || 0
  const unreviewed = Number(overall.unreviewed) || 0
  const repeated = Number(overall.repeated) || 0
  const coverage = Number(overall.coverage) || 0

  if (due > 0) out.push(task('due', '复习 ' + Math.min(3, due) + ' 道到期错题', '今天到期错题 ' + due + ' 道，优先消除遗忘风险', 10, { type: 'tab', target: 'wq', prompt: '带我先复习今天到期的错题。' }))
  if (unreviewed > 0) out.push(task('review', '复盘 ' + Math.min(3, unreviewed) + ' 道未复盘错题', '还有 ' + unreviewed + ' 道错题未复盘，避免错题只囤不消化', 12, { type: 'tab', target: 'wq', prompt: '从我的错题里挑3道最值得先复盘的，陪我逐步完成复盘。' }))
  if (repeated > 0) out.push(task('repeat', '处理 ' + repeated + ' 次复错', '存在重复错误，需要先定位判断习惯问题', 15, { type: 'tab', target: 'wq', prompt: '筛出我复错最多的错题，带我做原因对比。' }))
  if (weak && focusType) out.push(task('focus', '精准练「' + weak.label + ' · ' + focusType.type + '」', '当前最集中题型：错 ' + focusType.wrongs + ' 道、复错 ' + focusType.repeated + ' 次', 20, { type: 'tab', target: 'chat', prompt: '围绕「' + weak.label + '/' + focusType.type + '」做一次精准诊断，并出1道同类题。' }))
  if (coverage > 0 && coverage < 3) out.push(task('coverage', '做一组全科摸底', '当前只覆盖 ' + coverage + ' 个板块，需要补一次覆盖', 25, { type: 'tab', target: 'chat', prompt: '根据我目前覆盖不足的板块，给我一组混合摸底题。' }))
  if (!out.length) out.push(task('keep', '完成一组混合巩固题', '当前没有明显积压，保持手感即可', 20, { type: 'tab', target: 'chat', prompt: '根据我的当前数据，给我一组混合巩固题。' }))

  const custom = (existingTasks || []).filter((t) => t && t.custom)
  return [...out, ...custom]
}

export default { buildLearningProfile, buildDailyPlan }
