#!/usr/bin/env python3
"""Offline BaoStock SDK contract. No network calls or real SDK import."""
import datetime
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "collect-center-hfq-baostock.py"
SPEC = importlib.util.spec_from_file_location("center_hfq_collector", SCRIPT)
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
DAY = "2026-11-23"


class Query:
    def __init__(self, fields, rows, fail=False):
        self.fields = fields
        self.rows = rows
        self.error_code = "0"
        self.position = -1
        self.fail = fail

    def next(self):
        self.position += 1
        if self.position >= len(self.rows):
            if self.fail:
                self.error_code = "-1"
            return False
        return True

    def get_row_data(self):
        return [self.rows[self.position][field] for field in self.fields]


class SDK:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def query_trade_dates(self, start_date, end_date):
        self.calls.append(("calendar", start_date, end_date))
        start, end = datetime.date.fromisoformat(start_date), datetime.date.fromisoformat(end_date)
        rows = [{"calendar_date": (start + datetime.timedelta(days=i)).isoformat(), "is_trading_day": "1"}
                for i in range((end - start).days + 1)]
        return Query(["calendar_date", "is_trading_day"], rows)

    def query_history_k_data_plus(self, symbol, fields, **kwargs):
        self.calls.append(("bars", symbol, kwargs))
        row = {"code": symbol, "date": DAY, "open": "10", "high": "10", "low": "10", "close": "10",
               "volume": "100000", "amount": "1000000", "adjustflag": "1", "tradestatus": "1"}
        return Query(fields.split(","), [row], self.fail)


class CollectorTests(unittest.TestCase):
    def test_exact_hfq_and_actual_receipt_clock(self):
        sdk = SDK()
        times = iter([1000, 1200, 1400, 1600])
        result = COLLECTOR.collect(sdk, ["600000"], DAY, DAY, clock=lambda: next(times))
        self.assertEqual(sdk.calls[1][2]["adjustflag"], "1")
        self.assertEqual(sdk.calls[1][2]["frequency"], "d")
        self.assertEqual(result["stocks"][0]["receivedAt"], 1400)
        self.assertEqual(result["calendar"]["receivedAt"], 1200)
        self.assertEqual(result["completedAt"], 1600)
        self.assertFalse(result["canTrade"])
        self.assertNotIn("observedAt", result["stocks"][0]["rows"][0])

    def test_sdk_error_after_final_row_is_not_complete(self):
        with self.assertRaisesRegex(ValueError, "source-stream-incomplete"):
            COLLECTOR.collect(SDK(fail=True), ["600000"], DAY, DAY)

    def test_clock_reversal_or_long_capture_cannot_claim_completed(self):
        for values in [[1000, 1200, 1400, 999], [1000, 1200, 1400, 57001]]:
            times = iter(values)
            with self.assertRaisesRegex(ValueError, "source-clock-or-duration-invalid"):
                COLLECTOR.collect(SDK(), ["600000"], DAY, DAY, clock=lambda: next(times))

    def test_missing_field_and_bounded_result(self):
        with self.assertRaisesRegex(ValueError, "source-result-invalid"):
            COLLECTOR.query_rows(Query(["date"], [{"date": DAY}]), ["date", "amount"], 3)
        with self.assertRaisesRegex(ValueError, "source-result-over-limit"):
            COLLECTOR.query_rows(Query(["date"], [{"date": DAY}, {"date": DAY}]), ["date"], 1)


if __name__ == "__main__":
    unittest.main()
