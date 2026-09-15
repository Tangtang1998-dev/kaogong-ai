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
const promoCountdown = computed(() => {
  if (!promo.value.upcoming) return ''
  const ms = Math.max(0, promo.value.startsAt - promoNow.value)
  const totalHours = Math.ceil(ms / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return days > 0 ? days + ' 天 ' + hours + ' 小时' : hours + ' 小时'
})

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
        <em v-if="licenseState.mode === 'paid'">剩余 {{ licenseState.paidDaysLeft }} 天 · 到期：{{ expireText }}</em>
        <em v-else-if="licenseState.mode === 'trial'">剩余 {{ licenseState.trialDaysLeft }} 天 · {{ licenseState.trialPoints }} 点</em>
      </div>

      <div v-if="licenseState.mode === 'trial'" class="license-points-rule">
        <b>试用点数规则</b>
        <p>普通 AI 对话每次消耗 5 点；错题整理、AI 出题、微课、萌宠分析等其他 AI 功能每次消耗 1 点。</p>
        <p>点数耗尽后，所有 AI 功能会立即停止，不会继续调用模型；学习数据、错题和设置仍可查看与导出。</p>
      </div>

      <div v-else-if="licenseState.mode === 'paid'" class="license-points-rule paid">
        <b>正式会员无点数限制</b>
        <p>你使用自己的 API Key，会员有效期内所有 AI 功能都不消耗试用点数；正式会员只受到期时间约束。</p>
      </div>

      <div v-if="licenseState.renewalDue" class="license-renewal">
        <b>续订提醒</b>
        <p>{{ licenseState.renewalMessage }}</p>
      </div>

      <div class="license-promo" :class="promo.state">
        <b>{{ promo.active ? '🔥 限时活动进行中' : promo.upcoming ? '📅 限时活动预告' : '限时活动' }}</b>
        <span v-if="promo.upcoming">2026-09-20 周日 08:00–22:00，所有订阅立减 5 元；距离开始约 {{ promoCountdown }}。开始后页面会自动显示活动价，无需领券。</span>
        <span v-else-if="promo.active">2026-09-20 周日 08:00–22:00 内购买任意会员立减 5 元。当前已自动显示活动价，按活动价付款即可，无需领券。</span>
        <span v-else>活动已于 2026-09-20 22:00 结束，当前恢复原价。</span>
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
        <p v-if="promo.active">活动参与方式：在 2026-09-20 周日 08:00–22:00 内扫码付款，备注设备码后四位并注明“周日立减”，按页面活动价支付即可；活动价不与其他优惠叠加。</p>
        <p v-else-if="promo.upcoming">活动开始前可按原价购买；希望参加立减 5 元活动，请在 2026-09-20 周日 08:00–22:00 内付款。到点后页面会自动切换为活动价，无需提前报名或领取优惠券。</p>
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
          <li>正式会员使用自己的 API Key，会员期内不消耗试用点数；到期前 3 天开始提醒续订，到期后统一停止 AI 功能。</li>
          <li>虚拟商品激活后不支持无理由退款；未激活且未使用的订单，请付款前与管理员确认规则。</li>
          <li>本周日活动仅限 2026-09-20 08:00–22:00 内完成付款的订单，每种订阅立减 5 元；过期不补、不可追溯、不与其他优惠叠加。</li>
          <li>活动无需领券或报名：到活动时间后会员页自动显示活动价，按活动价付款并备注“周日立减”即可。提前或超时付款均按原价处理。</li>
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
.license-points-rule.paid { border-color: rgba(52,211,153,.38); background: rgba(52,211,153,.07); }
.license-renewal { margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(251,191,36,.55); border-radius: 11px; color: var(--text); background: rgba(251,191,36,.12); }
.license-renewal b { font-size: calc(12.5px * var(--ui-fs-scale, 1)); }
.license-renewal p { margin: 5px 0 0; color: var(--text2); font-size: calc(11px * var(--ui-fs-scale, 1)); line-height: 1.6; }
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
.license-promo.upcoming { color: var(--text2); background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.32); }
.license-promo.ended { color: var(--text3); background: rgba(127,127,127,.06); border-color: var(--glass-border); }
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
