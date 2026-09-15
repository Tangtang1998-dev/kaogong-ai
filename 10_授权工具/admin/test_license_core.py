import tempfile
import unittest
from pathlib import Path

from license_core import (
    LicenseError,
    RecordStore,
    generate_license,
    load_private_key,
    migrate_license,
    normalize_device_code,
    resolve_expiry,
    self_test,
    verify_license,
)


PRIVATE_KEY = Path(__file__).resolve().parents[1] / "private-key.json"


class LicenseCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key, _ = load_private_key(PRIVATE_KEY)

    def test_normalize_device_code(self):
        self.assertEqual(normalize_device_code("abcd-1234-efgh"), "XC-ABCD-1234-EFGH")
        self.assertEqual(normalize_device_code("xc － abcd _ 1234 － efgh"), "XC-ABCD-1234-EFGH")

    def test_all_plans_generate_and_verify(self):
        for plan in ("month", "quarter", "halfyear", "year", "gk", "province"):
            with self.subTest(plan=plan):
                result = generate_license(
                    self.key,
                    "XC-ABCD-1234-EFGH",
                    plan,
                    expire_date="2027-03-31" if plan == "province" else "",
                )
                payload = verify_license(result.code, result.device)
                self.assertEqual(payload["plan"], plan)
                self.assertEqual(payload["devices"], ["XC-ABCD-1234-EFGH"])

    def test_device_binding_is_enforced(self):
        result = generate_license(self.key, "XC-ABCD-1234-EFGH", "month")
        with self.assertRaisesRegex(LicenseError, "不匹配"):
            verify_license(result.code, "XC-WXYZ-5678-IJKL")

    def test_tampered_code_is_rejected(self):
        result = generate_license(self.key, "XC-ABCD-1234-EFGH", "month")
        parts = result.code.split(".")
        parts[1] = parts[1][:-1] + ("A" if parts[1][-1] != "A" else "B")
        with self.assertRaises(LicenseError):
            verify_license(".".join(parts), result.device)

    def test_province_requires_future_date(self):
        with self.assertRaisesRegex(LicenseError, "到期日期"):
            resolve_expiry("province", "", now_ms=1_700_000_000_000)
        with self.assertRaisesRegex(LicenseError, "晚于当前"):
            resolve_expiry("province", "2020-01-01", now_ms=1_700_000_000_000)

    def test_record_store_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RecordStore(tmp)
            result = generate_license(self.key, "XC-ABCD-1234-EFGH", "quarter", customer="测试客户")
            store.append(result)
            rows = store.read_all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["customer"], "测试客户")
            self.assertEqual(rows[0]["code"], result.code)
            self.assertTrue(store.jsonl_path.exists())

    def test_license_can_migrate_to_new_device_with_same_expiry(self):
        source = generate_license(self.key, "XC-ABCD-1234-EFGH", "halfyear")
        migrated = migrate_license(self.key, source.code, "XC-WXYZ-5678-IJKL", customer="迁移用户")
        payload = verify_license(migrated.code, migrated.device)
        self.assertEqual(payload["exp"], source.expires_at)
        self.assertEqual(payload["plan"], "halfyear")
        self.assertEqual(payload["devices"], ["XC-WXYZ-5678-IJKL"])

    def test_self_test(self):
        report = self_test(PRIVATE_KEY)
        self.assertTrue(report["ok"])
        self.assertEqual(len(report["checks"]), 6)


if __name__ == "__main__":
    unittest.main()
