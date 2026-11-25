"""Offline contract tests: no installed SDK, login, or network is required."""
import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "collect-center-hfq.py"
SPEC = importlib.util.spec_from_file_location("center_hfq_collector", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
FIELDS = "date,code,open,high,low,close,volume,amount,adjustflag,tradestatus,turn".split(",")
BAR = ["2026-06-08", "sh.600001", "10", "10.5", "9.5", "10.2", "10000", "101000", "1", "1", "1.2"]
ARGS = ["--code", "600001", "--start", "2026-06-01", "--end", "2026-06-08", "--calendar-end", "2026-06-22"]


class Query:
    def __init__(self, fields, rows, end_error="0"):
        self.fields, self.rows, self.error_code = fields, rows, "0"
        self.index, self.end_error = -1, end_error

    def next(self):
        self.index += 1
        if self.index < len(self.rows):
            return True
        self.error_code = self.end_error
        return False

    def get_row_data(self):
        return self.rows[self.index]


def sdk():
    result = mock.Mock()
    result.login.return_value.error_code = "0"
    result.query_history_k_data_plus.return_value = Query(FIELDS, [BAR])
    result.query_trade_dates.return_value = Query(
        ["calendar_date", "is_trading_day"],
        [["2026-06-08", "1"], ["2026-06-09", "1"]])
    return result


class CollectorContract(unittest.TestCase):
    def test_explicit_hfq_and_original_receipt_clocks(self):
        provider = sdk()
        clock = iter([100, 200, 300])
        result = module.collect(provider, "600001", "2026-06-01", "2026-06-08", "2026-06-22", lambda: next(clock))
        provider.query_history_k_data_plus.assert_called_once_with(
            "sh.600001", ",".join(FIELDS), start_date="2026-06-01", end_date="2026-06-08", frequency="d", adjustflag="1")
        provider.query_trade_dates.assert_called_once_with(start_date="2026-06-01", end_date="2026-06-22")
        self.assertEqual(result["rows"][0], dict(zip(FIELDS, BAR)))
        self.assertEqual([result["startedAt"], result["receivedAt"], result["completedAt"]], [100, 200, 300])
        self.assertEqual(result["calendar"]["receivedAt"], 300)
        self.assertEqual(result["captureKind"], "sdk-field-snapshot")
        self.assertIs(result["canTrade"], False)

    def test_initial_and_final_query_errors_never_produce_partial_success(self):
        query = Query(FIELDS, [BAR])
        query.error_code = "1001"
        with self.assertRaisesRegex(ValueError, "query failed"):
            module.read_rows(query, FIELDS, 500)
        with self.assertRaisesRegex(ValueError, "incomplete result stream"):
            module.read_rows(Query(FIELDS, [BAR], "1001"), FIELDS, 500)

    def test_duplicate_missing_fields_row_width_and_limits_fail_closed(self):
        for fields in [FIELDS + ["close"], FIELDS[:-1]]:
            with self.assertRaisesRegex(ValueError, "fields missing or duplicated"):
                module.read_rows(Query(fields, [BAR]), FIELDS, 500)
        with self.assertRaisesRegex(ValueError, "width mismatch"):
            module.read_rows(Query(FIELDS, [BAR[:-1]]), FIELDS, 500)
        with self.assertRaisesRegex(ValueError, "row bound exceeded"):
            module.read_rows(Query(FIELDS, [BAR] * 501), FIELDS, 500)

    def test_backward_capture_clock_fails_closed(self):
        clock = iter([300, 200, 400])
        with self.assertRaisesRegex(ValueError, "clock moved backwards"):
            module.collect(sdk(), "600001", "2026-06-01", "2026-06-08", "2026-06-22", lambda: next(clock))

    def test_bad_identity_and_ranges_stop_before_login(self):
        provider = sdk()
        with mock.patch.dict(sys.modules, {"baostock": provider}):
            for index, value in [(1, "BABA"), (3, "2026-06-09"), (7, "2026-06-23")]:
                args = list(ARGS)
                args[index] = value
                with self.assertRaises(ValueError):
                    module.main(args)
        provider.login.assert_not_called()

    def test_missing_sdk_returns_explicit_missing_dependency(self):
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {"baostock": None}), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(ARGS), 0)
        self.assertEqual(json.loads(out.getvalue()), {"status": "missing-dependency", "source": "baostock"})

    def test_login_diagnostics_are_not_raw_evidence_and_logout_runs_on_failed_stream(self):
        provider = sdk()
        def login():
            print("SDK login diagnostic")
            return mock.Mock(error_code="0")
        provider.login.side_effect = login
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {"baostock": provider}), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(ARGS), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["source"], "baostock")
        self.assertNotIn("diagnostic", out.getvalue())
        provider.logout.assert_called_once()
        provider = sdk()
        provider.query_history_k_data_plus.return_value.error_code = "1001"
        with mock.patch.dict(sys.modules, {"baostock": provider}):
            with self.assertRaisesRegex(ValueError, "query failed"):
                module.main(ARGS)
        provider.logout.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
