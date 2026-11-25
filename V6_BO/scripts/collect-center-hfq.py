#!/usr/bin/env python3
"""Bounded private-research BaoStock capture. No orders, files, or messages.

The parent process owns the supplier budget and process timeout. SDK fields are
preserved as SDK evidence, never described as the vendor's original wire bytes.
Reference: https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md
"""
import argparse
import contextlib
import datetime
import io
import json
import re
import sys
import time


def stamp():
    return int(time.time() * 1000)


def read_rows(query, required, limit):
    if getattr(query, "error_code", None) != "0":
        raise ValueError("BaoStock query failed")
    fields = list(getattr(query, "fields", []))
    if len(fields) != len(set(fields)) or not set(required).issubset(fields):
        raise ValueError("BaoStock fields missing or duplicated")
    rows = []
    while query.next():
        if len(rows) >= limit:
            raise ValueError("BaoStock row bound exceeded")
        values = query.get_row_data()
        if len(values) != len(fields):
            raise ValueError("BaoStock row width mismatch")
        rows.append(dict(zip(fields, values)))
    if getattr(query, "error_code", None) != "0":
        raise ValueError("BaoStock incomplete result stream")
    return rows


def collect(bs, code, start, end, calendar_end, clock=stamp):
    started = clock()
    source_code = ("sh." if code.startswith("6") else "sz.") + code
    fields = "date,code,open,high,low,close,volume,amount,adjustflag,tradestatus,turn"
    query = bs.query_history_k_data_plus(
        source_code, fields, start_date=start, end_date=end,
        frequency="d", adjustflag="1")
    rows = read_rows(query, fields.split(","), 500)
    received = clock()
    calendar = bs.query_trade_dates(start_date=start, end_date=calendar_end)
    days = read_rows(calendar, ["calendar_date", "is_trading_day"], 550)
    calendar_received = clock()
    if not started <= received <= calendar_received:
        raise ValueError("BaoStock capture clock moved backwards")
    return {
        "schemaVersion": 1, "source": "baostock", "code": code,
        "captureKind": "sdk-field-snapshot", "startedAt": started,
        "receivedAt": received, "completedAt": calendar_received,
        "request": {"frequency": "d", "adjustflag": "1", "start": start, "end": end},
        "rows": rows,
        "calendar": {"source": "baostock:query_trade_dates",
                     "receivedAt": calendar_received, "start": start,
                     "end": calendar_end, "rows": days},
        "canTrade": False, "canNotify": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--calendar-end", required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"(?:60|68|00|30)\d{4}", args.code):
        raise ValueError("Unsupported A-share code")
    start, end, calendar_end = [datetime.date.fromisoformat(v) for v in
                                (args.start, args.end, args.calendar_end)]
    if not 0 < (end - start).days <= 500 or not 0 <= (calendar_end - end).days <= 14:
        raise ValueError("Research interval out of bounds")
    try:
        import baostock as bs
    except ImportError:
        print(json.dumps({"status": "missing-dependency", "source": "baostock"}))
        return 0
    # Login/logout diagnostics contain no research evidence and must not corrupt
    # the one bounded JSON response consumed by the server.
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
        if getattr(login, "error_code", None) != "0":
            raise ValueError("BaoStock login failed")
        try:
            result = collect(bs, args.code, args.start, args.end, args.calendar_end)
        finally:
            bs.logout()
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # The parent displays a specific supplier failure; no SDK traceback,
        # environment details or partial result can masquerade as a capture.
        print(json.dumps({"status": "source-failed", "source": "baostock"}))
        sys.exit(0)
