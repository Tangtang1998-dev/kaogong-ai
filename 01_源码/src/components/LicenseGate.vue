<script setup>
import { ref, computed, watch } from 'vue'
import { PLANS, licenseState, activateLicenseCode, licenseDeviceCode } from '../utils/license'
import { setClipboard } from '../utils/platform'

const props = defineProps({ manual: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const code = ref('')
const busy = ref(false)
const err = ref('')
const copied = ref(false)
const selectedPlanId = ref(PLANS.some((p) => p.id === licenseState.plan) ? licenseState.plan : 'month')

const visible = computed(() => props.manual || (!licenseState.active && !licenseState.viewOnly))
const expireText = computed(() => licenseState.expiresAt ? new Date(licenseState.expiresAt).toLocaleString('zh-CN') : '未激活')
const selectedPlan = computed(() => PLANS.find((p) => p.id === selectedPlanId.value) || PLANS[0])

function selectPlan(id) { selectedPlanId.value = id }

watch(() => props.manual, (open) => {
  if (open && PLANS.some((p) => p.id === licenseState.plan)) selectedPlanId.value = licenseState.plan
})

async function copyDevice() {
  const c = licenseDeviceCode()
  try { await setClipboard(c) } catch (e) { try { await navigator.clipboard.writeText(c) } catch (_) {} }
  copied.value = true
  setTimeout(() => { copied.value = false }, 1800)
}

async function activate() {
  err.value = ''
  busy.value = true
  try {
    const r = await activateLicenseCode(code.value)
    if (!r.ok) { err.value = r.msg || '激活失败'; return }
    code.value = ''
    emit('close')
  } finally {
    busy.value = false
  }
}

function viewOnly() {
  licenseState.viewOnly = true
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="license-gate" @click.self="!licenseState.active && !manual && viewOnly()">
    <section class="license-panel" role="dialog" aria-label="会员购买与激活">
      <header class="license-head">
        <div>
          <b>正式版授权</b>
          <span>{{ licenseState.active ? licenseState.message : '试用结束，激活后继续使用 AI 功能' }}</span>
        </div>
        <button v-if="manual" class="license-x" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="license-status" :class="{ ok: licenseState.active }">
        <span>当前方案</span>
        <b>{{ licenseState.planName }}</b>
        <em v-if="licenseState.mode === 'paid'">到期：{{ expireText }}</em>
        <em v-else-if="licenseState.mode === 'trial'">剩余 {{ licenseState.trialDaysLeft }} 天 · {{ licenseState.trialPoints }} 点</em>
      </div>

      <div class="license-plans">
        <button
          v-for="p in PLANS"
          :key="p.id"
          type="button"
          class="license-plan"
          :class="{ hot: p.id === 'quarter', on: p.id === selectedPlanId }"
          :aria-pressed="p.id === selectedPlanId"
          @click="selectPlan(p.id)"
        >
          <div class="lp-top"><b>{{ p.name }}</b><span v-if="p.tag">{{ p.tag }}</span></div>
          <strong>¥{{ p.price }}</strong>
          <p>{{ p.days ? p.days + ' 天' : '考试周期' }}</p>
        </button>
      </div>

      <div class="license-detail">
        <div class="ld-head"><b>{{ selectedPlan.name }}</b><span>¥{{ selectedPlan.price }} · {{ selectedPlan.days ? selectedPlan.days + ' 天' : '考试周期' }}</span></div>
        <p>{{ selectedPlan.summary }}</p>
        <ul><li v-for="item in selectedPlan.details" :key="item">{{ item }}</li></ul>
      </div>

      <div class="license-buy">
        <b>购买方式</b>
        <p>请到粉丝群置顶消息扫描收款码。付款备注请填写设备码后四位，并将付款截图和设备码私发给管理员。</p>
        <p>收到激活码后，填入下方输入框即可解锁。离线版使用你自己的 API Key。</p>
      </div>

      <div class="license-device">
        <span>当前设备码</span>
        <code>{{ licenseDeviceCode() }}</code>
        <button @click="copyDevice">{{ copied ? '已复制' : '复制' }}</button>
      </div>

      <div class="license-activate">
        <input v-model.trim="code" placeholder="粘贴 XC1 开头的激活码" autocomplete="off" spellcheck="false" @keyup.enter="activate" />
        <button class="btn btn-pri" :disabled="busy || !code" @click="activate">{{ busy ? '校验中…' : '激活' }}</button>
      </div>
      <div v-if="err" class="license-err">{{ err }}</div>

      <footer class="license-foot">
        <button v-if="!licenseState.active && !manual" class="btn btn-gh" @click="viewOnly">先查看本地数据</button>
        <button v-if="manual && licenseState.active" class="btn btn-gh" @click="emit('close')">关闭</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.license-gate { position: fixed; inset: 0; z-index: 12000; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(2,6,23,.72); backdrop-filter: blur(10px); }
.license-panel { width: min(560px, 96vw); max-height: min(86vh, 720px); overflow: auto; padding: 18px; border: 1px solid var(--glass-border-hi); border-radius: 16px; background: var(--glass-bg-strong); color: var(--text); box-shadow: 0 24px 70px rgba(0,0,0,.48); }
.license-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.license-head b { display: block; font-size: calc(18px * var(--ui-fs-scale, 1)); }
.license-head span { display: block; margin-top: 3px; color: var(--text3); font-size: calc(12px * var(--ui-fs-scale, 1)); }
.license-x { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--text2); font-size: 24px; cursor: pointer; }
.license-status { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; padding: 10px 12px; border: 1px solid rgba(251,113,133,.35); border-radius: 12px; background: rgba(251,113,133,.08); }
.license-status.ok { border-color: rgba(52,211,153,.35); background: rgba(52,211,153,.08); }
.license-status span { color: var(--text3); font-size: 12px; }
.license-status b { color: var(--text); }
.license-status em { grid-column: 1 / -1; color: var(--text3); font-size: calc(11px * var(--ui-fs-scale, 1)); font-style: normal; }
.license-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; margin: 14px 0 10px; }
.license-plan { min-width: 0; padding: 10px; border: 1px solid var(--glass-border); border-radius: 10px; background: rgba(127,127,127,.06); color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.license-plan:hover { border-color: var(--accent); }
.license-plan.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.license-plan.hot { border-color: var(--accent); background: var(--accent2); }
.lp-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.lp-top b { font-size: calc(12px * var(--ui-fs-scale, 1)); }
.lp-top span { color: var(--accent); font-size: 9px; white-space: nowrap; }
.license-plan strong { display: block; margin-top: 8px; font-size: calc(20px * var(--ui-fs-scale, 1)); }
.license-plan p { margin: 3px 0 0; color: var(--text3); font-size: 11px; }
.license-detail { margin-bottom: 12px; padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(127,127,127,.04); }
.ld-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.ld-head b { font-size: calc(13px * var(--ui-fs-scale, 1)); }
.ld-head span { color: var(--accent); font-size: 11px; white-space: nowrap; }
.license-detail p { margin: 6px 0 4px; color: var(--text2); font-size: calc(11.5px * var(--ui-fs-scale, 1)); line-height: 1.55; }
.license-detail ul { margin: 4px 0 0; padding-left: 17px; color: var(--text3); font-size: calc(11px * var(--ui-fs-scale, 1)); line-height: 1.65; }
.license-buy, .license-device, .license-activate { border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(127,127,127,.045); }
.license-buy { padding: 10px 12px; }
.license-buy b { font-size: calc(13px * var(--ui-fs-scale, 1)); }
.license-buy p { margin: 5px 0 0; color: var(--text2); font-size: calc(11.5px * var(--ui-fs-scale, 1)); line-height: 1.65; }
.license-device { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px; }
.license-device span { flex: 0 0 auto; color: var(--text3); font-size: 11px; }
.license-device code { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); font-size: 12px; }
.license-device button { border: 0; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; }
.license-activate { display: flex; gap: 8px; margin-top: 10px; padding: 8px; }
.license-activate input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: calc(12px * var(--ui-fs-scale, 1)); }
.license-activate .btn { flex: 0 0 auto; padding-inline: 16px; }
.license-err { margin-top: 8px; color: var(--red); font-size: 12px; }
.license-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
@media (max-width: 640px) {
  .license-gate { padding: 8px; align-items: flex-end; }
  .license-panel { width: 100%; max-height: 88dvh; border-radius: 16px 16px 8px 8px; padding: 14px; }
  .license-plans { grid-template-columns: 1fr 1fr; gap: 6px; }
  .license-plan { padding: 8px; }
  .license-plan strong { font-size: 18px; }
  .license-device { flex-wrap: wrap; }
  .license-device code { flex-basis: 100%; order: 2; }
  .license-device button { order: 3; }
}
</style>
