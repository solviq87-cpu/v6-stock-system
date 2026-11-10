#!/usr/bin/env python3
"""Offline SDK-contract tests: never import, log into, or contact BaoStock."""
import datetime
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "collect-baostock-eod-research.py"
spec = importlib.util.spec_from_file_location("offline_baostock_collector", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CN = datetime.timezone(datetime.timedelta(hours=8))
DAY = "2026-11-09"
START = "2026-09-01"


def at(hour, minute=0, second=0, date=DAY):
    return datetime.datetime.fromisoformat(date + "T" +
        f"{hour:02d}:{minute:02d}:{second:02d}+08:00")


class FakeClock:
    def __init__(self, start=None, seconds=1):
        self.current = start or at(16, 0)
        self.seconds = seconds

    def __call__(self):
        stamp = self.current
        self.current += datetime.timedelta(seconds=self.seconds)
        return stamp


class FakeQuery:
    def __init__(self, fields, source_rows, fail_after=None):
        self.fields = list(fields)
        self.data = list(source_rows)
        self.error_code = "0"
        self.cursor = 0
        self.fail_after = fail_after

    def next(self):
        if self.fail_after is not None and self.cursor >= self.fail_after:
            self.error_code = "-1"
            return False
        if self.cursor >= len(self.data):
            return False
        self.cursor += 1
        return True

    def get_row_data(self):
        return [self.data[self.cursor - 1].get(f, "") for f in self.fields]


def exchange_dates():
    start = datetime.date.fromisoformat(START)
    end = datetime.date.fromisoformat(DAY)
    dates = []
    while start <= end:
        if start.weekday() < 5:
            dates.append(start.isoformat())
        start += datetime.timedelta(days=1)
    return dates


class FakeBao:
    def __init__(self, fail=None):
        self.fail = fail
        self.calls = []
        self.days = exchange_dates()

    def query_trade_dates(self, start_date, end_date):
        self.calls.append(("calendar", start_date, end_date))
        dt = datetime.date.fromisoformat(start_date)
        end = datetime.date.fromisoformat(end_date)
        rows = []
        while dt <= end:
            rows.append({
                "calendar_date": dt.isoformat(),
                "is_trading_day": "1" if dt.weekday() < 5 else "0",
            })
            dt += datetime.timedelta(days=1)
        return FakeQuery(["calendar_date", "is_trading_day"], rows,
                         fail_after=5 if self.fail == "calendar" else None)

    def query_history_k_data_plus(self, code, fields, start_date, end_date,
                                  frequency, adjustflag):
        self.calls.append(("daily", code, start_date, end_date,
                           frequency, adjustflag))
        source = []
        for i, d in enumerate(self.days):
            closed = i == 4
            source.append({
                "date": d,
                "code": code,
                "open": "10.00",
                "high": "10.01",
                "low": "9.99",
                "close": "10.00",
                "volume": "0" if closed else "100",
                "amount": "0" if closed else "1000.00",
                "adjustflag": "3",
                "tradestatus": "0" if closed else "1",
            })
        return FakeQuery(fields.split(","), source,
                         fail_after=10 if self.fail == "daily" else None)

    def query_adjust_factor(self, code, start_date, end_date):
        self.calls.append(("adjust", code, start_date, end_date))
        rows = [{"code": code, "dividOperateDate": self.days[10]}]
        return FakeQuery(["code", "dividOperateDate"], rows,
                         fail_after=0 if self.fail == "adjust" else None)


class BaoStockCollectorOfflineTests(unittest.TestCase):
    def create_bundle(self, clock=None, fail=None):
        fake = FakeBao(fail)
        bundle = module.build_bundle(fake, ["600001"], START, DAY,
                                     "offline-unit-batch",
                                     clock=clock or FakeClock())
        return fake, bundle

    def test_realistic_sdk_method_shapes_and_query_order(self):
        fake, result = self.create_bundle()
        self.assertEqual([x[0] for x in fake.calls],
                         ["calendar", "daily", "adjust"])
        self.assertEqual(result["source"], "baostock")
        self.assertFalse(result["canTrade"])
        self.assertLessEqual(result["startedAt"],
                             result["calendar"]["observedAt"])
        self.assertLessEqual(result["calendar"]["observedAt"],
                             result["stocks"][0]["kline"]["observedAt"])
        self.assertLessEqual(result["stocks"][0]["kline"]["observedAt"],
                             result["stocks"][0]["adjust"]["observedAt"])
        self.assertLessEqual(result["stocks"][0]["adjust"]["observedAt"],
                             result["observedAt"])
        self.assertEqual(result["calendar"]["tradeDates"], exchange_dates())
        self.assertEqual(len(result["stocks"][0]["kline"]["rows"]),
                         len(exchange_dates()))
        self.assertEqual(result["stocks"][0]["kline"]["adjustflag"], "3")
        self.assertEqual(result["stocks"][0]["kline"]["rows"][4]["tradestatus"], "0")

    def test_query_error_after_partial_rows_never_reports_complete(self):
        for stage in ("calendar", "daily", "adjust"):
            with self.subTest(stage=stage):
                with self.assertRaisesRegex(ValueError, "中途失败"):
                    self.create_bundle(fail=stage)

    def test_duplicate_fields_and_mismatched_row_lengths_fail(self):
        duplicate = FakeQuery(["code", "code"], [{"code": "sh.600001"}])
        with self.assertRaisesRegex(ValueError, "重复列"):
            module.rows(duplicate, ["code"], 10)
        malformed = FakeQuery(["code", "date"],
                              [{"code": "sh.600001", "date": "2026-09-01"}])
        malformed.get_row_data = lambda: ["one"]
        with self.assertRaisesRegex(ValueError, "列数不一致"):
            module.rows(malformed, ["code", "date"], 10)

    def test_clock_expiration_and_rewind_never_emit_bundle(self):
        with self.assertRaisesRegex(ValueError, "耗时过久"):
            self.create_bundle(clock=FakeClock(seconds=601))
        timeline = [at(16, 0, 2), at(16, 0, 3), at(16, 0, 1)]
        with self.assertRaisesRegex(ValueError, "时钟倒退"):
            self.create_bundle(clock=lambda: timeline.pop(0))

    def test_invalid_day_and_existing_output_block_before_login(self):
        with tempfile.TemporaryDirectory() as root:
            out = pathlib.Path(root) / "private" / "out.json"
            args = ["--codes", "600001", "--start", START,
                    "--end", DAY, "--output", str(out),
                    "--allow-research-fetch"]
            with self.assertRaisesRegex(ValueError, "采集日期"):
                module.parse_args(args, clock=lambda: at(15, 59))
            with self.assertRaisesRegex(ValueError, "采集日期"):
                module.parse_args(args, clock=lambda: at(16, 30, date="2026-11-10"))
            self.assertEqual(module.parse_args(
                args, clock=lambda: at(16, 30))[0], ["600001"])
            out.parent.mkdir()
            out.write_text("existing")
            with self.assertRaisesRegex(ValueError, "已存在"):
                module.parse_args(args, clock=lambda: at(16, 30))
            # The public entrypoint must not import the optional SDK nor login.
            sdk = mock.Mock()
            with mock.patch.object(module, "beijing_clock",
                                   return_value=at(16, 30)), \
                 mock.patch.dict(sys.modules, {"baostock": sdk}):
                with self.assertRaisesRegex(ValueError, "已存在"):
                    module.main(args)
            sdk.login.assert_not_called()

    def test_collection_can_replay_offline_through_existing_node_eod_validator(self):
        if shutil.which("node") is None:
            self.skipTest("Node unavailable")
        _, bundle = self.create_bundle()
        with tempfile.TemporaryDirectory() as root:
            base = pathlib.Path(root)
            raw = base / "private" / "raw.json"
            out = base / "private" / "history.json"
            module.publish(str(raw), bundle)
            self.assertEqual(raw.stat().st_mode & 0o777, 0o600)
            proc = subprocess.run([
                "node", str(ROOT / "scripts" / "baostock-eod-research.js"),
                str(raw), str(out),
            ], text=True, capture_output=True, timeout=10)
            # The bundle is historical: the Node normalizer legitimately
            # audits it at the current time without re-freezing old signals.
            self.assertEqual(proc.returncode, 0, proc.stderr)
            result = json.loads(out.read_text())
            self.assertEqual(result["provider"], "baostock")
            self.assertEqual(result["priceBasis"], "unadjusted")
            self.assertTrue(result["stocks"][0]["bars"][4]["suspended"])
            self.assertIn(exchange_dates()[10],
                          result["stocks"][0]["corporateActions"])
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                module.publish(str(raw), bundle)

    def test_raw_collection_cannot_write_public_or_alias_paths(self):
        with tempfile.TemporaryDirectory() as root:
            base = pathlib.Path(root)
            with self.assertRaisesRegex(ValueError, "私有"):
                module.safe_output(str(base / "public" / "raw.json"))
            source = base / "source"
            source.mkdir()
            alias = base / "alias"
            alias.symlink_to(source, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "符号链接"):
                module.safe_output(str(alias / "raw.json"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
