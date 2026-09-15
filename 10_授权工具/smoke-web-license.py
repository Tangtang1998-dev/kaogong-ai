import base64
import json
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

HERE = Path(__file__).resolve().parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9421
PROFILE = tempfile.mkdtemp(prefix="xc_license_smoke_")


def b64url_decode(s):
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def b64url_encode(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_code(device):
    jwk = json.loads((HERE / "private-key.json").read_text(encoding="utf-8"))
    d = int.from_bytes(b64url_decode(jwk["d"]), "big")
    key = ec.derive_private_key(d, ec.SECP256R1())
    now = int(time.time() * 1000)
    payload = {
        "v": 1,
        "lid": "SMOKE-PY",
        "plan": "month",
        "exam": "",
        "exp": now + 30 * 86400000,
        "devices": [device],
        "features": ["chat", "quiz", "wrong", "tts", "search", "pdf"],
        "iat": now,
    }
    part = b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    der = key.sign(part.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return "XC1." + part + "." + b64url_encode(raw)


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=20)
        self.i = 0

    def send(self, method, params=None):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                return msg

    def eval(self, expression):
        msg = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        return msg["result"]["result"].get("value")


proc = subprocess.Popen(
    [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*", f"--user-data-dir={PROFILE}", "--no-first-run", "--disable-gpu", "about:blank"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
try:
    listing = None
    for _ in range(80):
        try:
            listing = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
            break
        except Exception:
            time.sleep(0.25)
    if not listing:
        raise RuntimeError("Chrome CDP 未启动")
    target = next(x for x in listing if x.get("type") == "page")
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
    cdp.send("Page.navigate", {"url": "http://127.0.0.1:5199/?v=3.8.361-smoke#/chat"})
    time.sleep(4.5)
    trial = json.loads(cdp.eval("JSON.stringify({trial:JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'null'),device:localStorage.getItem('xc_device_code_v1'),gate:!!document.querySelector('.license-gate')})"))
    if not trial.get("trial") or trial["trial"].get("points") != 30 or not trial.get("device") or trial.get("gate"):
        raise RuntimeError("全新试用初始化失败: " + json.dumps(trial, ensure_ascii=False))
    cdp.eval("(()=>{const t=JSON.parse(localStorage.getItem('xc_offline_trial_v1')||'{}');t.start=Date.now()-8*86400000;t.points=0;localStorage.setItem('xc_offline_trial_v1',JSON.stringify(t));location.reload();return 'ok'})()")
    time.sleep(3.5)
    expired = json.loads(cdp.eval("JSON.stringify({gate:!!document.querySelector('.license-gate'),text:(document.querySelector('.license-gate')||{}).innerText||''})"))
    if not expired.get("gate") or "正式版授权" not in expired.get("text", ""):
        raise RuntimeError("试用到期未出现付费门: " + json.dumps(expired, ensure_ascii=False))
    code = make_code(trial["device"])
    activated = json.loads(cdp.eval("(async()=>{const i=document.querySelector('.license-activate input');const b=document.querySelector('.license-activate button');i.value=" + json.dumps(code) + ";i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));b.click();await new Promise(r=>setTimeout(r,1600));return JSON.stringify({gate:!!document.querySelector('.license-gate'),saved:(JSON.parse(localStorage.getItem('xc_offline_license_v1')||'{}').code||'').slice(0,4)})})()"))
    if activated.get("gate") or activated.get("saved") != "XC1.":
        raise RuntimeError("激活码全流程失败: " + json.dumps(activated, ensure_ascii=False))
    shot = cdp.send("Page.captureScreenshot", {"format": "png"})
    (HERE / "smoke-web-license.png").write_bytes(base64.b64decode(shot["result"]["data"]))
    print(json.dumps({"ok": True, "trial": trial, "expiredGate": True, "activated": activated, "screenshot": str(HERE / "smoke-web-license.png")}, ensure_ascii=False, indent=2))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    shutil.rmtree(PROFILE, ignore_errors=True)
