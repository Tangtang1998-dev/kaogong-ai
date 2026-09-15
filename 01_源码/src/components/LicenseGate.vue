<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { PLANS, licenseState, activateLicenseCode, licenseDeviceCode, promotionState, planPrice } from '../utils/license'
import { setClipboard } from '../utils/platform'

const props = defineProps({ manual: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const code = ref('')
const busy = ref(false)
const err = ref('')
const copied = ref(false)
const promoNow = ref(Date.now())
const selectedPlanId = ref(PLANS.some((p) => p.id === licenseState.plan) ? licenseState.plan : 'month')

const visible = computed(() => props.manual || (!licenseState.active && !licenseState.viewOnly))
const expireText = computed(() => licenseState.expiresAt ? new Date(licenseState.expiresAt).toLocaleString('zh-CN') : '未激活')
const selectedPlan = computed(() => PLANS.find((p) => p.id === selectedPlanId.value) || PLANS[0])
const promo = computed(() => promotionState(promoNow.value))

function selectPlan(id) { selectedPlanId.value = id }
function displayPrice(plan) { return planPrice(plan, promoNow.value) }

watch(() => props.manual, (open) => {
  if (open && PLANS.some((p) => p.id === licenseState.plan)) selectedPlanId.value = licenseState.plan
})

let promoTimer = null
onMounted(() => { promoTimer = setInterval(() => { promoNow.value = Date.now() }, 30000) })
onUnmounted(() => { if (promoTimer) clearInterval(promoTimer) })

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

      <div v-if="licenseState.mode === 'trial'" class="license-points-rule">
        <b>试用点数规则</b>
        <p>普通 AI 对话每次消耗 5 点；错题整理、AI 出题、微课、萌宠分析等其他 AI 功能每次消耗 1 点。</p>
        <p>点数耗尽后，所有 AI 功能会立即停止，不会继续调用模型；学习数据、错题和设置仍可查看与导出。</p>
      </div>

      <div v-if="promo.active" class="license-promo">
        <b>限时活动</b>
        <span>2026-09-20 周日 08:00–22:00，所有订阅立减 5 元，不与其他优惠叠加。</span>
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
          <strong>¥{{ displayPrice(p) }}<del v-if="promo.active">¥{{ p.price }}</del></strong>
          <p>{{ p.days ? p.days + ' 天' : '考试周期' }}</p>
        </button>
      </div>

      <div class="license-detail">
        <div class="ld-head"><b>{{ selectedPlan.name }}</b><span>¥{{ displayPrice(selectedPlan) }} · {{ selectedPlan.days ? selectedPlan.days + ' 天' : '考试周期' }}</span></div>
        <p>{{ selectedPlan.summary }}</p>
        <ul><li v-for="item in selectedPlan.details" :key="item">{{ item }}</li></ul>
        <p v-if="promo.active" class="ld-promo">活动价已自动立减 5 元，原价 ¥{{ selectedPlan.price }}。</p>
      </div>

      <div class="license-buy">
        <b>购买方式</b>
        <p>请到粉丝群置顶消息扫描收款码。付款备注请填写设备码后四位，并将付款截图和设备码私发给管理员。</p>
        <p>收到激活码后，填入下方输入框即可解锁。离线版使用你自己的 API Key。</p>
      </div>

      <div class="license-notes">
        <b>订阅须知与免责声明</b>
        <ul>
          <li>会员绑定购买时的设备码，一个激活码默认只对对应设备生效。</li>
          <li>设备码和会员购买记录会作为独立的会员凭据包，随你自己配置的 Gitee、GitHub 或 WebDAV 私有同步账号迁移。换手机、iPad 或电脑时，在新设备的「数据同步」中下载云端或智能合并即可自助恢复会员。</li>
          <li>请勿把同步仓库、WebDAV 账号或会员凭据包分享给他人，否则对方可能读取或冒用你的会员记录。</li>
          <li>更换设备、卸载软件、清除浏览器站点数据、清除应用数据、恢复出厂设置、使用无痕模式、修改系统时间、使用非官方修改版本等个人操作导致会员丢失或失效的，本店概不负责；核对订单后可在合理范围内协助迁移。</li>
          <li>激活码与到期时间以签发记录为准。请勿公开转发激活码，避免被他人滥用。</li>
          <li>所有套餐均为一次付款、固定有效期，不自动续费、不自动扣款、不默认续约。</li>
          <li>虚拟商品激活后不支持无理由退款；未激活且未使用的订单，请付款前与管理员确认规则。</li>
          <li>本周日活动仅限 2026-09-20 08:00–22:00 内完成付款的订单，每种订阅立减 5 元；过期不补、不可追溯、不与其他优惠叠加。</li>
        </ul>
      </div>

      <div class="license-migrate">
        <b>跨设备会员自助迁移</b>
        <p>换手机、iPad 或电脑时，在新设备打开「数据同步」，登录同一个 Gitee、GitHub 或 WebDAV 同步账号，再点「下载云端最新」或「智能合并」即可。</p>
        <small>设备码和会员购买记录会随你自己的私有同步数据一起迁移，不需要再联系管理员手动签发。请勿把同步仓库或 WebDAV 账号分享给别人。</small>
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
.license-points-rule { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(127,127,127,.04); }
.license-points-rule b { font-size: calc(12.5px * var(--ui-fs-scale, 1)); }
.license-points-rule p { margin: 5px 0 0; color: var(--text2); font-size: calc(11px * var(--ui-fs-scale, 1)); line-height: 1.6; }
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
.ld-promo { color: var(--accent) !important; font-weight: 600; }
.license-promo { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; padding: 9px 11px; border-radius: 11px; color: #9a5a00; background: #fff5d6; border: 1px solid #f1cf73; font-size: calc(11px * var(--ui-fs-scale, 1)); }
.license-promo b { flex: 0 0 auto; }
.license-plan strong del { margin-left: 6px; color: var(--text3); font-size: 11px; font-weight: 400; }
.license-buy, .license-device, .license-activate { border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(127,127,127,.045); }
.license-buy { padding: 10px 12px; }
.license-buy b { font-size: calc(13px * var(--ui-fs-scale, 1)); }
.license-buy p { margin: 5px 0 0; color: var(--text2); font-size: calc(11.5px * var(--ui-fs-scale, 1)); line-height: 1.65; }
.license-notes, .license-migrate { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(127,127,127,.04); }
.license-notes b, .license-migrate b { font-size: calc(12.5px * var(--ui-fs-scale, 1)); }
.license-notes ul { margin: 7px 0 0; padding-left: 17px; color: var(--text2); font-size: calc(10.5px * var(--ui-fs-scale, 1)); line-height: 1.65; }
.license-migrate p { margin: 6px 0; color: var(--text2); font-size: calc(11px * var(--ui-fs-scale, 1)); line-height: 1.6; }
.license-migrate input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(127,127,127,.05); color: var(--text); outline: none; }
.license-migrate button { margin-top: 8px; padding: 8px 12px; border: 1px solid var(--accent); border-radius: 8px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; }
.license-migrate small { display: block; margin-top: 7px; color: var(--text3); line-height: 1.55; }
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
