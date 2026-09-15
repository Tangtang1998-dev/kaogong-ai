import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9421
const profile = path.join(os.tmpdir(), 'xc_license_smoke_' + Date.now())
const privateJwk = JSON.parse(fs.readFileSync(path.join(here, 'private-key.json'), 'utf8'))
const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore', detached: false })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

let ws
let seq = 0
const pending = new Map()
async function cdp(method, params = {}) {
  const id = ++seq
  const p = new Promise((resolve) => pending.set(id, resolve))
  ws.send(JSON.stringify({ id, method, params }))
  return p
}
async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text || 'runtime error')
  return r.result && r.result.result ? r.result.result.value : undefined
}
async function makeCode(device) {
  const now = Date.now()
  const payload = { v: 1, lid: 'SMOKE-' + now.toString(36), plan: 'month', exam: '', exp: now + 30 * 86400000, devices: [device], features: ['chat', 'quiz', 'wrong', 'tts', 'search', 'pdf'], iat: now }
  const part = b64url(JSON.stringify(payload))
  const sig = crypto.sign('sha256', Buffer.from(part), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' })
  return 'XC1.' + part + '.' + b64url(sig)
}

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); if (r.ok) break } catch (e) {}
    await sleep(250)
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const target = list.find((x) => x.type === 'page')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp('Page.navigate', { url: 'http://127.0.0.1:5199/?v=3.8.361-smoke#/chat' })
  await sleep(4500)
  const trial = await evalJs(`JSON.stringify({ trial: JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'null'), device: localStorage.getItem('xc_device_code_v1'), gate: !!document.querySelector('.license-gate'), body: document.body.innerText.slice(0,120) })`)
  const trialObj = JSON.parse(trial)
  if (!trialObj.trial || trialObj.trial.points !== 30 || !trialObj.device || trialObj.gate) throw new Error('全新用户试用初始化失败: ' + trial)
  await evalJs(`(()=>{const t=JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'{}');t.start=Date.now()-8*86400000;t.points=0;localStorage.setItem('xc_offline_trial_v1',JSON.stringify(t));location.reload();return 'expired'})()`)
  await sleep(3500)
  const expired = JSON.parse(await evalJs(`JSON.stringify({gate:!!document.querySelector('.license-gate'),text:(document.querySelector('.license-gate')||{}).innerText||''})`))
  if (!expired.gate || !expired.text.includes('正式版授权')) throw new Error('试用到期未出现付费门: ' + JSON.stringify(expired))
  const code = await makeCode(trialObj.device)
  const activated = await evalJs(`(async()=>{const i=document.querySelector('.license-activate input');const b=document.querySelector('.license-activate button');if(!i||!b)return JSON.stringify({ok:false,msg:'no input'});i.value=${JSON.stringify(code)};i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));b.click();await new Promise(r=>setTimeout(r,1500));return JSON.stringify({gate:!!document.querySelector('.license-gate'),saved:(JSON.parse(localStorage.getItem('xc_offline_license_v1')||'{}').code||'').slice(0,4)})})()`)
  const act = JSON.parse(activated)
  if (act.gate || act.saved !== 'XC1.') throw new Error('激活码全流程失败: ' + activated)
  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(here, 'smoke-web-license.png'), Buffer.from(shot.result.data, 'base64'))
  console.log(JSON.stringify({ ok: true, trial: trialObj, expiredGate: true, activated: act, screenshot: path.join(here, 'smoke-web-license.png') }, null, 2))
} finally {
  try { ws && ws.close() } catch (e) {}
  try { child.kill() } catch (e) {}
}
