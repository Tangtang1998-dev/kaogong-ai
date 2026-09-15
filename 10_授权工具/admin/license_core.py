"""Offline license signing and verification for the admin desktop tool.

The private key is intentionally never embedded in the executable. Keep it
beside the executable (or select it manually) and back it up separately.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)


CHINA_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")
DEVICE_RE = re.compile(r"^XC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$")
LICENSE_PREFIX = "XC1"
FEATURES = ["chat", "quiz", "wrong", "tts", "search", "pdf"]

PUBLIC_JWK: dict[str, str] = {
    "kty": "EC",
    "crv": "P-256",
    "x": "_eTtxfkTlCNxT5oL_JlxK9Vy5poKtJrNPhPl738Ctlo",
    "y": "ofbmtixWhaQQTyFgirnWvB7CLdkR7Pys7exu04RDLhc",
}

PLANS: dict[str, dict[str, Any]] = {
    "month": {
        "name": "单月订阅",
        "price": 39,
        "days": 30,
        "description": "自签发日起 30 天",
    },
    "quarter": {
        "name": "季度订阅",
        "price": 99,
        "days": 90,
        "description": "自签发日起 90 天",
    },
    "halfyear": {
        "name": "半年卡",
        "price": 169,
        "days": 180,
        "description": "自签发日起 180 天；一次付款，不自动扣款",
    },
    "year": {
        "name": "年卡",
        "price": 299,
        "days": 365,
        "description": "自签发日起 365 天；一次付款，不自动扣款",
    },
    "gk": {
        "name": "国考季票",
        "price": 129,
        "expire_date": "2026-12-06",
        "description": "有效期至 2026-12-06 国考笔试结束",
    },
    "province": {
        "name": "省考季票",
        "price": 129,
        "description": "有效期由管理员按本省考试周期设置",
    },
}


class LicenseError(ValueError):
    """Raised when license input or key material is invalid."""


@dataclass(frozen=True)
class LicenseResult:
    label: str
    plan: str
    device: str
    license_id: str
    issued_at: int
    expires_at: int
    code: str
    customer: str = ""
    order_id: str = ""
    note: str = ""

    @property
    def expire_text(self) -> str:
        return format_china_time(self.expires_at)

    @property
    def issued_text(self) -> str:
        return format_china_time(self.issued_at)

    @property
    def customer_message(self) -> str:
        lines = [
            f"您购买的是：{self.label}",
            f"授权设备：{self.device}",
            f"有效期至：{self.expire_text}",
            "",
            "请在软件或网页的“会员”页面输入以下激活码：",
            self.code,
            "",
            "提示：激活码与设备码绑定，请勿转发给其他人。",
        ]
        return "\n".join(lines)

    def as_record(self) -> dict[str, Any]:
        return {
            "generated_at": format_china_time(int(time.time() * 1000)),
            "customer": self.customer,
            "order_id": self.order_id,
            "device": self.device,
            "plan": self.plan,
            "plan_name": self.label,
            "license_id": self.license_id,
            "issued_at": self.issued_text,
            "expires_at": self.expire_text,
            "note": self.note,
            "code": self.code,
        }


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    raw = str(value or "").strip()
    raw += "=" * (-len(raw) % 4)
    try:
        return base64.urlsafe_b64decode(raw.encode("ascii"))
    except Exception as exc:  # noqa: BLE001 - surfaced as a domain error
        raise LicenseError("激活码编码损坏") from exc


def normalize_device_code(value: str) -> str:
    raw = str(value or "").strip().upper().replace(" ", "").replace("—", "-").replace("_", "-")
    raw = raw.replace("－", "-")
    if raw and not raw.startswith("XC-"):
        raw = "XC-" + raw.removeprefix("XC")
    return raw


def validate_device_code(value: str) -> str:
    code = normalize_device_code(value)
    if not DEVICE_RE.fullmatch(code):
        raise LicenseError("设备码格式应为 XC-XXXX-XXXX-XXXX")
    return code


def format_china_time(timestamp_ms: int) -> str:
    dt = datetime.fromtimestamp(int(timestamp_ms) / 1000, tz=CHINA_TZ)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def china_end_of_day(date_text: str) -> int:
    try:
        day = datetime.strptime(str(date_text).strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise LicenseError("到期日期格式应为 YYYY-MM-DD") from exc
    end = datetime.combine(day, dt_time(23, 59, 59, 999000), tzinfo=CHINA_TZ)
    return int(end.timestamp() * 1000)


def add_china_days_end_of_day(now_ms: int, days: int) -> int:
    current = datetime.fromtimestamp(int(now_ms) / 1000, tz=CHINA_TZ)
    target = current + timedelta(days=int(days))
    end = datetime.combine(target.date(), dt_time(23, 59, 59, 999000), tzinfo=CHINA_TZ)
    return int(end.timestamp() * 1000)


def resolve_expiry(plan: str, expire_date: str = "", now_ms: int | None = None) -> tuple[int, str]:
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    if plan not in PLANS:
        raise LicenseError(f"未知套餐：{plan}")
    definition = PLANS[plan]
    if plan == "month":
        return add_china_days_end_of_day(now_ms, int(definition["days"])), definition["name"]
    if plan == "quarter":
        return add_china_days_end_of_day(now_ms, int(definition["days"])), definition["name"]
    if plan == "halfyear":
        return add_china_days_end_of_day(now_ms, int(definition["days"])), definition["name"]
    if plan == "year":
        return add_china_days_end_of_day(now_ms, int(definition["days"])), definition["name"]
    if plan == "gk":
        return china_end_of_day(str(definition["expire_date"])), definition["name"]
    if plan == "province":
        if not str(expire_date).strip():
            raise LicenseError("省考季票必须填写到期日期")
        expires_at = china_end_of_day(expire_date)
        if expires_at <= now_ms:
            raise LicenseError("省考季票到期日期必须晚于当前时间")
        return expires_at, definition["name"]
    raise LicenseError(f"暂不支持套餐：{plan}")


def license_id_from_now(now_ms: int | None = None) -> str:
    value = int(now_ms if now_ms is not None else time.time() * 1000)
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    encoded = ""
    current = value
    while current:
        current, remainder = divmod(current, 36)
        encoded = digits[remainder] + encoded
    return "XC-" + (encoded or "0")


def _jwk_int(value: str) -> int:
    return int.from_bytes(b64url_decode(value), "big")


def private_key_from_jwk(jwk: dict[str, Any]) -> ec.EllipticCurvePrivateKey:
    if not isinstance(jwk, dict) or jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise LicenseError("私钥不是有效的 P-256 JWK")
    missing = [key for key in ("x", "y", "d") if not str(jwk.get(key) or "")]
    if missing:
        raise LicenseError("私钥缺少字段：" + ", ".join(missing))
    try:
        public_numbers = ec.EllipticCurvePublicNumbers(
            _jwk_int(str(jwk["x"])),
            _jwk_int(str(jwk["y"])),
            ec.SECP256R1(),
        )
        private_numbers = ec.EllipticCurvePrivateNumbers(_jwk_int(str(jwk["d"])), public_numbers)
        return private_numbers.private_key()
    except Exception as exc:  # noqa: BLE001 - convert crypto errors to UI-safe errors
        raise LicenseError("私钥内容无效") from exc


def public_key_from_jwk(jwk: dict[str, Any]) -> ec.EllipticCurvePublicKey:
    if not isinstance(jwk, dict) or jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise LicenseError("公钥不是有效的 P-256 JWK")
    try:
        return ec.EllipticCurvePublicNumbers(
            _jwk_int(str(jwk["x"])),
            _jwk_int(str(jwk["y"])),
            ec.SECP256R1(),
        ).public_key()
    except Exception as exc:  # noqa: BLE001
        raise LicenseError("公钥内容无效") from exc


def load_private_key(path: str | Path) -> tuple[ec.EllipticCurvePrivateKey, dict[str, Any]]:
    key_path = Path(path).expanduser().resolve()
    try:
        jwk = json.loads(key_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LicenseError(f"找不到私钥文件：{key_path}") from exc
    except json.JSONDecodeError as exc:
        raise LicenseError("私钥不是有效的 JSON 文件") from exc
    key = private_key_from_jwk(jwk)
    expected = public_key_from_jwk(PUBLIC_JWK).public_numbers()
    actual = key.public_key().public_numbers()
    if (expected.x, expected.y) != (actual.x, actual.y):
        raise LicenseError("所选私钥与当前客户端内置公钥不匹配")
    return key, jwk


def _signature_to_p1363(signature_der: bytes) -> bytes:
    r, s = decode_dss_signature(signature_der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def _signature_from_p1363(signature_raw: bytes) -> bytes:
    if len(signature_raw) != 64:
        raise LicenseError("激活码签名长度无效")
    r = int.from_bytes(signature_raw[:32], "big")
    s = int.from_bytes(signature_raw[32:], "big")
    return encode_dss_signature(r, s)


def decode_license(code: str) -> dict[str, Any]:
    parts = str(code or "").strip().split(".")
    if len(parts) != 3 or parts[0] != LICENSE_PREFIX:
        raise LicenseError("激活码格式不正确")
    try:
        payload = json.loads(b64url_decode(parts[1]).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, LicenseError) as exc:
        raise LicenseError("激活码内容损坏") from exc
    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise LicenseError("激活码版本不支持")
    return payload


def verify_license(code: str, expected_device: str = "", now_ms: int | None = None) -> dict[str, Any]:
    parts = str(code or "").strip().split(".")
    if len(parts) != 3 or parts[0] != LICENSE_PREFIX:
        raise LicenseError("激活码格式不正确")
    payload = decode_license(code)
    if expected_device:
        device = validate_device_code(expected_device)
        if device not in payload.get("devices", []):
            raise LicenseError("激活码与设备码不匹配")
    expires_at = int(payload.get("exp") or 0)
    if expires_at <= int(now_ms if now_ms is not None else time.time() * 1000):
        raise LicenseError("激活码已过期")
    try:
        public_key = public_key_from_jwk(PUBLIC_JWK)
        public_key.verify(
            _signature_from_p1363(b64url_decode(parts[2])),
            parts[1].encode("utf-8"),
            ec.ECDSA(hashes.SHA256()),
        )
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, LicenseError):
            raise
        raise LicenseError("激活码签名无效") from exc
    return payload


def generate_license(
    private_key: ec.EllipticCurvePrivateKey,
    device: str,
    plan: str,
    *,
    expire_date: str = "",
    exam: str = "",
    customer: str = "",
    order_id: str = "",
    note: str = "",
    now_ms: int | None = None,
) -> LicenseResult:
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    device_code = validate_device_code(device)
    expires_at, label = resolve_expiry(plan, expire_date=expire_date, now_ms=now_ms)
    resolved_exam = str(exam or "").strip()
    if plan == "gk" and not resolved_exam:
        resolved_exam = "national"
    payload = {
        "v": 1,
        "lid": license_id_from_now(now_ms),
        "plan": plan,
        "exam": resolved_exam,
        "exp": expires_at,
        "devices": [device_code],
        "features": FEATURES,
        "iat": now_ms,
    }
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_part = b64url_encode(payload_text.encode("utf-8"))
    signature_der = private_key.sign(payload_part.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    code = f"{LICENSE_PREFIX}.{payload_part}.{b64url_encode(_signature_to_p1363(signature_der))}"
    verify_license(code, device_code, now_ms=now_ms)
    return LicenseResult(
        label=label,
        plan=plan,
        device=device_code,
        license_id=str(payload["lid"]),
        issued_at=now_ms,
        expires_at=expires_at,
        code=code,
        customer=str(customer or "").strip(),
        order_id=str(order_id or "").strip(),
        note=str(note or "").strip(),
    )


def migrate_license(
    private_key: ec.EllipticCurvePrivateKey,
    old_code: str,
    new_device: str,
    *,
    customer: str = "",
    order_id: str = "",
    note: str = "",
    now_ms: int | None = None,
) -> LicenseResult:
    """Reissue an unexpired license to a new device while keeping its expiry."""
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    old_payload = verify_license(old_code, now_ms=now_ms)
    device_code = validate_device_code(new_device)
    expires_at = int(old_payload.get("exp") or 0)
    if expires_at <= now_ms:
        raise LicenseError("原激活码已过期，不能迁移")
    plan = str(old_payload.get("plan") or "month")
    label = str((PLANS.get(plan) or {}).get("name") or plan)
    old_lid = str(old_payload.get("lid") or "")
    payload = {
        "v": 1,
        "lid": license_id_from_now(now_ms),
        "plan": plan,
        "exam": str(old_payload.get("exam") or ""),
        "exp": expires_at,
        "devices": [device_code],
        "features": old_payload.get("features") or FEATURES,
        "iat": now_ms,
        "migratedFrom": old_lid,
    }
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_part = b64url_encode(payload_text.encode("utf-8"))
    signature_der = private_key.sign(payload_part.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    code = f"{LICENSE_PREFIX}.{payload_part}.{b64url_encode(_signature_to_p1363(signature_der))}"
    verify_license(code, device_code, now_ms=now_ms)
    migration_note = str(note or "").strip()
    if not migration_note:
        migration_note = f"迁移自授权编号 {old_lid or '未知'}"
    return LicenseResult(
        label=label,
        plan=plan,
        device=device_code,
        license_id=str(payload["lid"]),
        issued_at=now_ms,
        expires_at=expires_at,
        code=code,
        customer=str(customer or "").strip(),
        order_id=str(order_id or "").strip(),
        note=migration_note,
    )


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RecordStore:
    """Append-only CSV/JSONL license log for customer support."""

    FIELDS = [
        "generated_at",
        "customer",
        "order_id",
        "device",
        "plan",
        "plan_name",
        "license_id",
        "issued_at",
        "expires_at",
        "note",
        "code",
    ]

    def __init__(self, base_dir: str | Path):
        self.base_dir = Path(base_dir)

    @property
    def csv_path(self) -> Path:
        return self.base_dir / "授权记录.csv"

    @property
    def jsonl_path(self) -> Path:
        return self.base_dir / "授权记录.jsonl"

    def ensure_dir(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def append(self, result: LicenseResult) -> None:
        self.ensure_dir()
        record = result.as_record()
        exists = self.csv_path.exists()
        with self.csv_path.open("a", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=self.FIELDS)
            if not exists:
                writer.writeheader()
            writer.writerow(record)
        with self.jsonl_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + os.linesep)

    def append_many(self, results: Iterable[LicenseResult]) -> int:
        count = 0
        for result in results:
            self.append(result)
            count += 1
        return count

    def read_all(self) -> list[dict[str, str]]:
        if not self.csv_path.exists():
            return []
        with self.csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    def export(self, target: str | Path) -> Path:
        target_path = Path(target)
        self.ensure_dir()
        if not self.csv_path.exists():
            with self.csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
                csv.DictWriter(handle, fieldnames=self.FIELDS).writeheader()
        target_path.write_bytes(self.csv_path.read_bytes())
        return target_path


def locate_private_key(app_dir: Path) -> Path | None:
    """Find a private key without ever embedding it in the executable."""
    candidates = [
        app_dir / "private-key.json",
        app_dir / "密钥" / "private-key.json",
        app_dir.parent / "private-key.json",
        app_dir.parent / "密钥" / "private-key.json",
        Path.cwd() / "private-key.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def self_test(private_key_path: str | Path) -> dict[str, Any]:
    key, _ = load_private_key(private_key_path)
    checks: list[dict[str, Any]] = []
    for plan in ("month", "quarter", "halfyear", "year", "gk", "province"):
        expire_date = "2027-03-31" if plan == "province" else ""
        result = generate_license(
            key,
            "XC-TEST-0001-ABCD",
            plan,
            expire_date=expire_date,
            customer="self-test",
        )
        verify_license(result.code, result.device)
        checks.append({"plan": plan, "code_length": len(result.code), "expires_at": result.expires_at})
    invalid_rejected = False
    try:
        verify_license("XC1.bad.bad", "XC-TEST-0001-ABCD")
    except LicenseError:
        invalid_rejected = True
    if not invalid_rejected:
        raise LicenseError("自检失败：损坏激活码未被拒绝")
    return {
        "ok": True,
        "checked_at": format_china_time(int(time.time() * 1000)),
        "checks": checks,
        "public_key_fingerprint": hashlib.sha256(
            json.dumps(PUBLIC_JWK, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
    }
