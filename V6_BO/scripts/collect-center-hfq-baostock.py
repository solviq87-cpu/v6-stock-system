#!/usr/bin/env python3
"""Bounded centre-only BaoStock hfq export. No installation, orders or credentials.

The SDK's DAILY records contain dates, not exchange-original quote clocks.
All timestamps here are explicitly local receipt times; the Node normalizer
preserves observedAt=null and the original centre time gate still applies.
"""
import argparse
import contextlib
import datetime
import io
import json
import re
import sys
import time

BEIJING = datetime.timezone(datetime.timedelta(hours=8))
MAX_BYTES = 1024 * 1024


def millis():
    return time.time_ns() // 1_000_000


def query_rows(query, fields, maximum):
    columns = list(getattr(query, "fields", []))
    if getattr(query, "error_code", None) != "0" or len(columns) > 32 or \
            len(set(columns)) != len(columns) or not set(fields).issubset(columns):
        raise ValueError("source-result-invalid")
    rows = []
    while query.next():
        if len(rows) >= maximum:
            raise ValueError("source-result-over-limit")
        values = query.get_row_data()
        if len(values) != len(columns):
            raise ValueError("source-columns-incomplete")
        rows.append(dict(zip(columns, values)))
    if getattr(query, "error_code", None) != "0":
        raise ValueError("source-stream-incomplete")
    return rows


def collect(bs, symbols, start, end, clock=millis):
    started = clock()
    calendar_end = (datetime.date.fromisoformat(end) + datetime.timedelta(days=30)).isoformat()
    calendar_rows = query_rows(bs.query_trade_dates(start_date=start, end_date=calendar_end),
                               ["calendar_date", "is_trading_day"], 400)
    calendar = {"source": "baostock:query_trade_dates", "errorCode": "0", "complete": True,
                "startDate": start, "endDate": calendar_end, "receivedAt": clock(), "rows": calendar_rows}
    stocks = []
    fields = "date,code,open,high,low,close,volume,amount,adjustflag,tradestatus"
    for symbol in symbols:
        source_code = ("sh." if symbol.startswith("6") else "sz.") + symbol
        rows = query_rows(bs.query_history_k_data_plus(source_code, fields, start_date=start, end_date=end,
                                                      frequency="d", adjustflag="1"), fields.split(","), 370)
        stocks.append({"code": source_code, "errorCode": "0", "complete": True, "frequency": "d",
                       "adjustflag": "1", "receivedAt": clock(), "rows": rows})
    completed = clock()
    if completed < started or completed - started > 55_000:
        raise ValueError("source-clock-or-duration-invalid")
    return {"schemaVersion": 1, "mode": "baostock-center-hfq-export-v1", "completed": True,
            "start": start, "end": end, "startedAt": started, "completedAt": completed,
            "stocks": stocks, "calendar": calendar, "canTrade": False,
            "receiptTimeMeaning": "local-request-completion-not-source-quote-time"}


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--allow-research-fetch", action="store_true")
    args = parser.parse_args(argv)
    symbols = args.symbols.split(",")
    start, end = datetime.date.fromisoformat(args.start), datetime.date.fromisoformat(args.end)
    now = datetime.datetime.now(BEIJING)
    if not args.allow_research_fetch or not 1 <= len(symbols) <= 3 or len(set(symbols)) != len(symbols) or \
            any(not re.fullmatch(r"(?:60|68|00|30)\d{4}", symbol) for symbol in symbols) or \
            not 0 <= (end - start).days <= 366 or end > now.date() or end == now.date() and now.hour < 16:
        raise ValueError("source-preflight-blocked")
    # Respect the already reviewed BaoStock-only research enablement. Importing
    # a new SDK or creating an adapter never changes that access decision.
    from pathlib import Path
    config = Path(__file__).resolve().parent.parent / "config"
    catalog = json.loads((config / "data-source-catalog.json").read_text())
    registry = json.loads((config / "data-source-registry-2026.json").read_text())
    if not any(row["id"] == "baostock" and row.get("access") == "enabled-private-research" for row in catalog["sources"]) or \
            not any(row["id"] == "baostock" and row.get("access") == "guarded-research" for row in registry["sources"]):
        raise ValueError("source-access-blocked")
    try:
        import baostock as bs
    except ImportError:
        return 78
    # The SDK logs to stdout. Only the checked JSON envelope may leave this
    # process; provider diagnostics and arbitrary exception text are omitted.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        login = bs.login()
        if getattr(login, "error_code", None) != "0":
            raise ValueError("source-login-failed")
        try:
            result = collect(bs, symbols, args.start, args.end)
        finally:
            bs.logout()
    raw = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(raw.encode("utf-8")) > MAX_BYTES:
        raise ValueError("source-receipt-over-limit")
    print(raw)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        print("centre-hfq-collection-failed", file=sys.stderr)
        sys.exit(1)
