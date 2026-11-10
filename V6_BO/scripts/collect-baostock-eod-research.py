#!/usr/bin/env python3
"""Operator-invoked bounded BaoStock research export, NOT a trading data feed.

Requires an explicit --allow-research-fetch flag and a separate review of the
provider's applicable rights. No unattended network polling or credentials.
"""
import argparse
import contextlib
import datetime
import io
import json
import os
import pathlib
import re
import sys
import tempfile
import time


BEIJING = datetime.timezone(datetime.timedelta(hours=8))
MAX_COLLECTION_SECONDS = 10 * 60


def beijing_clock():
    return datetime.datetime.now(BEIJING)


def safe_output(value):
    file = pathlib.Path(value)
    if not file.is_absolute() or "public" in file.parts:
        raise ValueError("输出必须是私有绝对路径")
    for component in (file, *file.parents):
        if component.is_symlink():
            raise ValueError("不允许符号链接输出")
    return file


def rows(query, required, limit):
    if getattr(query, "error_code", None) != "0":
        raise ValueError("BaoStock查询没有成功返回")
    columns = list(getattr(query, "fields", []))
    if not set(required).issubset(set(columns)) or len(columns) > 64 or \
       len(set(columns)) != len(columns):
        raise ValueError("BaoStock查询结果缺少关键字段或返回重复列")
    result = []
    while query.next():
        if len(result) >= limit:
            raise ValueError("BaoStock查询结果超出有界研究上限")
        values = query.get_row_data()
        if len(values) != len(columns):
            raise ValueError("BaoStock返回列数不一致")
        result.append(dict(zip(columns, values)))
    # Some SDK result streams can report an error after one or more rows.
    # "next() returned False" alone is NOT a completeness certificate.
    if getattr(query, "error_code", None) != "0":
        raise ValueError("BaoStock查询中途失败，拒绝不完整的结果")
    return result


def build_bundle(bs, codes, start, end, dataset_id, clock=beijing_clock):
    stamp = clock().astimezone(BEIJING)
    if stamp.strftime("%Y-%m-%d") != end or stamp.hour < 16:
        raise ValueError("只允许当日北京时间16点后记录完成收盘数据")
    started_at = int(stamp.timestamp() * 1000)
    previous_at = started_at

    def record_observed():
        nonlocal previous_at
        stamp = clock().astimezone(BEIJING)
        observed = int(stamp.timestamp() * 1000)
        if stamp.strftime("%Y-%m-%d") != end or stamp.hour < 16 or \
           observed < previous_at or \
           observed - started_at > MAX_COLLECTION_SECONDS * 1000:
            raise ValueError("BaoStock采集查询耗时过久、跨日或时钟倒退；拒绝发布")
        previous_at = observed
        return observed
    # Do not use today's weekday pattern as a stand-in for the actual exchange
    # calendar. Query the provider's explicit trading dates before stock data.
    calendar_query = bs.query_trade_dates(start_date=start, end_date=end)
    days = rows(calendar_query, ["calendar_date", "is_trading_day"], 500)
    calendar_observed = record_observed()
    dates = [r["calendar_date"] for r in days if r["is_trading_day"] == "1"]
    if len(dates) < 32 or dates[-1] != end:
        raise ValueError("真实交易日历不足32日或最后交易日不是今天")
    if any(r["is_trading_day"] not in ("0", "1") for r in days):
        raise ValueError("BaoStock交易日状态缺失")
    stocks = []
    for code in codes:
        source = ("sh." if code.startswith("6") else "sz.") + code
        daily = bs.query_history_k_data_plus(
            source,
            "date,code,open,high,low,close,volume,amount,adjustflag,tradestatus",
            start_date=start,
            end_date=end,
            frequency="d",
            adjustflag="3",
        )
        kline_rows = rows(
            daily,
            ["date", "code", "open", "high", "low", "close",
             "volume", "amount", "adjustflag", "tradestatus"],
            500,
        )
        kline_observed = record_observed()
        adjust = bs.query_adjust_factor(
            code=source, start_date=start, end_date=end
        )
        adjust_rows = rows(adjust, ["code", "dividOperateDate"], 500)
        adjust_observed = record_observed()
        stocks.append({
            "code": source,
            "kline": {
                "source": "baostock:query_history_k_data_plus",
                "errorCode": "0", "complete": True, "frequency": "d",
                "adjustflag": "3", "startDate": start, "endDate": end,
                "observedAt": kline_observed, "rows": kline_rows,
            },
            "adjust": {
                "source": "baostock:query_adjust_factor",
                "errorCode": "0", "complete": True,
                "startDate": start, "endDate": end,
                "observedAt": adjust_observed, "rows": adjust_rows,
            },
        })
    completed_at = record_observed()
    return {
        "schemaVersion": 1,
        "mode": "baostock-eod-research-export-v1",
        "source": "baostock", "completed": True,
        "asOf": end, "startedAt": started_at,
        "observedAt": completed_at,
        "datasetId": dataset_id, "canTrade": False,
        "claimedProviderCertified": False,
        "calendar": {
            "source": "baostock:query_trade_dates",
            "errorCode": "0", "complete": True,
            "startDate": start, "endDate": end,
            "observedAt": calendar_observed, "tradeDates": dates,
        },
        "stocks": stocks,
    }


def publish(output, bundle):
    dest = safe_output(output)
    raw = (json.dumps(bundle, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")) + "\n").encode("utf-8")
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("原始研究包超过4MiB，必须缩小已授权采集范围")
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, staging = tempfile.mkstemp(prefix=".baostock-eod-", dir=dest.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(staging, dest)  # O_EXCL-equivalent, no overwrite.
        parent = os.open(dest.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        os.unlink(staging)


def parse_args(argv, clock=beijing_clock):
    p = argparse.ArgumentParser()
    p.add_argument("--codes", required=True,
                   help="1 to 5 comma-separated A-share stock codes")
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p.add_argument("--dataset-id", default="baostock-research-v1")
    p.add_argument("--output", required=True)
    p.add_argument("--allow-research-fetch", action="store_true")
    a = p.parse_args(argv)
    codes = a.codes.split(",")
    if len(codes) < 1 or len(codes) > 5 or len(set(codes)) != len(codes) or \
       any(not re.fullmatch(r"(60|68|00|30)\d{4}", c) for c in codes):
        raise ValueError("仅支持1至5只不重复沪深A股，不允许全市场无界抓取")
    start = datetime.date.fromisoformat(a.start)
    end = datetime.date.fromisoformat(a.end)
    if start > end or (end - start).days < 45 or \
       (end - start).days > 365 or not \
       re.fullmatch(r"[A-Za-z0-9_.:-]{3,120}", a.dataset_id):
        raise ValueError("日期范围需为45至365自然日，datasetId必须是显式版本")
    if not a.allow_research_fetch:
        raise ValueError("默认禁止网络请求；仅在操作者审查供应商许可后显式启用")
    # Preflight BEFORE importing the SDK and calling login (which is itself
    # a network request). An invalid day or an existing target must never
    # consume a provider connection.
    current = clock().astimezone(BEIJING)
    if current.date() != end or current.hour < 16:
        raise ValueError("采集日期须等于今日北京时间，且已到16点")
    dest = safe_output(a.output)
    if dest.exists():
        raise ValueError("BaoStock采集输出已存在，拒绝登录及覆盖")
    return codes, start.isoformat(), end.isoformat(), a.dataset_id, a.output


def main(argv):
    codes, start, end, dataset_id, output = parse_args(argv, clock=beijing_clock)
    try:
        import baostock as bs
    except ImportError as e:
        raise ValueError("缺少baostock依赖；未发起网络请求") from e
    # BaoStock's login prints messages; never leak raw SDK output into logs.
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
        if login.error_code != "0":
            raise ValueError("BaoStock登录失败")
        try:
            bundle = build_bundle(bs, codes, start, end, dataset_id)
        finally:
            bs.logout()
    publish(output, bundle)
    print(json.dumps({
        "status": "research-export-only-not-certified",
        "day": bundle["asOf"],
        "stocks": len(bundle["stocks"]),
        "tradingDates": len(bundle["calendar"]["tradeDates"]),
        "providerLicenseIndependentlyVerified": False,
        "verifiedLive": False, "canTrade": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception:
        print("BaoStock来源/许可/采集日期/字段/文件核验失败；无研究包发布",
              file=sys.stderr)
        sys.exit(1)
