import base64
import json
import time
from pathlib import Path

import websocket
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

HERE = Path(__file__).resolve().parent
WS_URL = json.loads(__import__('urllib.request').request.urlopen('http://127.0.0.1:9334/json').read())[0]['webSocketDebuggerUrl']


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def make_code(device):
    jwk = json.loads((HERE / 'private-key.json').read_text(encoding='utf-8'))
    d = int.from_bytes(base64.urlsafe_b64decode(jwk['d'] + '=' * (-len(jwk['d']) % 4)), 'big')
    key = ec.derive_private_key(d, ec.SECP256R1())
    now = int(time.time() * 1000)
    payload = {'v': 1, 'lid': 'MUMU-SMOKE', 'plan': 'quarter', 'exam': '', 'exp': now + 90 * 86400000, 'devices': [device], 'features': ['chat', 'quiz', 'wrong', 'tts', 'search', 'pdf'], 'iat': now}
    part = b64u(json.dumps(payload, separators=(',', ':')).encode())
    r, s = decode_dss_signature(key.sign(part.encode(), ec.ECDSA(hashes.SHA256())))
    return 'XC1.' + part + '.' + b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=20)
        self.i = 0

    def send(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({'id': self.i, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.i:
                return m

    def eval(self, expression):
        m = self.send('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
        return m['result']['result'].get('value')


cdp = CDP(WS_URL)
cdp.send('Runtime.enable')
time.sleep(1)
trial = json.loads(cdp.eval("JSON.stringify({trial:JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'null'),device:localStorage.getItem('xc_device_code_v1'),gate:!!document.querySelector('.license-gate')})"))
if not trial.get('trial') or trial['trial'].get('points') != 30 or not trial.get('device') or trial.get('gate'):
    raise RuntimeError('MuMu 全新用户试用初始化失败: ' + json.dumps(trial, ensure_ascii=False))
cdp.eval("(()=>{const t=JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'{}');t.start=Date.now()-8*86400000;t.points=0;localStorage.setItem('xc_offline_trial_v1',JSON.stringify(t));location.reload();return 'ok'})()")
time.sleep(3.5)
expired = json.loads(cdp.eval("JSON.stringify({gate:!!document.querySelector('.license-gate'),text:(document.querySelector('.license-gate')||{}).innerText||''})"))
if not expired.get('gate') or '正式版授权' not in expired.get('text', ''):
    raise RuntimeError('MuMu 到期付费门未出现: ' + json.dumps(expired, ensure_ascii=False))
code = make_code(trial['device'])
activated = json.loads(cdp.eval("(async()=>{const i=document.querySelector('.license-activate input');const b=document.querySelector('.license-activate button');i.value=" + json.dumps(code) + ";i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));b.click();await new Promise(r=>setTimeout(r,1800));return JSON.stringify({gate:!!document.querySelector('.license-gate'),saved:(JSON.parse(localStorage.getItem('xc_offline_license_v1')||'{}').code||'').slice(0,4)})})()"))
if activated.get('gate') or activated.get('saved') != 'XC1.':
    raise RuntimeError('MuMu 激活失败: ' + json.dumps(activated, ensure_ascii=False))
shot = cdp.send('Page.captureScreenshot', {'format': 'png'})
(HERE / 'smoke-mumu-license.png').write_bytes(base64.b64decode(shot['result']['data']))
print(json.dumps({'ok': True, 'trial': trial, 'expiredGate': True, 'activated': activated, 'screenshot': str(HERE / 'smoke-mumu-license.png')}, ensure_ascii=False, indent=2))
