"""Offline regression: partial BaoStock industry streams must not be published."""
import datetime
import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location(
    "industry_collector", pathlib.Path(__file__).parents[1] / "scripts" / "collect-baostock-industry.py")
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)


class Query:
    fields = ["updateDate", "code", "industry", "industryClassification"]
    error_code = "0"

    def __init__(self, fail):
        self.index = 0
        self.fail = fail

    def next(self):
        if self.index == 15:
            if self.fail:
                self.error_code = "10002007"
            return False
        self.index += 1
        return True

    def get_row_data(self):
        return ["2026-11-09", f"sh.{600000 + self.index}", "制造业", "证监会行业分类"]


class SDK:
    def __init__(self, fail):
        self.fail = fail
        self.logged_out = False

    def login(self):
        return type("Login", (), {"error_code": "0"})()

    def query_stock_industry(self):
        return Query(self.fail)

    def logout(self):
        self.logged_out = True


class StreamTests(unittest.TestCase):
    def test_error_after_all_apparently_valid_rows_is_rejected(self):
        sdk = SDK(True)
        with self.assertRaisesRegex(ValueError, "中途失败"):
            COLLECTOR.export(sdk, "证监会行业分类", datetime.datetime(2026, 11, 10))
        self.assertTrue(sdk.logged_out)

    def test_successful_complete_stream_keeps_current_snapshot_contract(self):
        sdk = SDK(False)
        result = COLLECTOR.export(sdk, "证监会行业分类", datetime.datetime(2026, 11, 10))
        self.assertTrue(result["completed"])
        self.assertEqual(result["declaredRows"], 15)
        self.assertFalse(result["historicalMembershipVerified"])
        self.assertTrue(sdk.logged_out)


if __name__ == "__main__":
    unittest.main()
