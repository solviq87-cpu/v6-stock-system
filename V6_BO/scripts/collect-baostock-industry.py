#!/usr/bin/env python3
"""Optional ONE-SHOT BaoStock industry classification export for private research.

No provider calls until the operator explicitly permits one. No credentials,
no stock-price retrieval, no quote timestamp fabrication, and no overwrite.
"""
import argparse
import contextlib
import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from zoneinfo import ZoneInfo

BEIJING = ZoneInfo("Asia/Shanghai")
STANDARDS = ("证监会行业分类", "申万一级行业")
CODE = re.compile(r"^(?:sh\.(?:60|68)\d{4}|sz\.(?:00|30)\d{4})$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--standard", choices=STANDARDS, default=STANDARDS[0])
    parser.add_argument("--allow-research-fetch", action="store_true")
    options = parser.parse_args(argv)
    dest = Path(options.output)
    if not dest.is_absolute() or dest.is_symlink() or dest.exists():
        raise ValueError("研究结果路径必须是未使用的绝对路径，不能覆盖旧文件")
    if not options.allow_research_fetch:
        raise ValueError("默认禁止访问供应商；请在确认供应商许可后显式启用研究采集")
    return options


def export(bs, standard, clock):
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
        if login.error_code != "0":
            raise ValueError("BaoStock登录失败")
        try:
            result = bs.query_stock_industry(date=clock.strftime("%Y-%m-%d"))
            if result.error_code != "0":
                raise ValueError("BaoStock行业分类查询失败")
            fields = result.fields
            required = {"updateDate", "code", "industry", "industryClassification"}
            if not fields or not required.issubset(fields):
                raise ValueError("BaoStock行业分类字段不完整")
            all_rows, matched = 0, []
            while result.next():
                all_rows += 1
                if all_rows > 10000:
                    raise ValueError("BaoStock行业分类结果超过上限")
                row = dict(zip(fields, result.get_row_data()))
                if row["industryClassification"] != standard or not CODE.fullmatch(row["code"]):
                    continue
                matched.append({k: row[k] for k in (
                    "updateDate", "code", "industry", "industryClassification")})
        finally:
            bs.logout()
    if not 15 <= len(matched) <= 10000:
        raise ValueError("行业分类有效成分不足或结果太大")
    versions = {r["updateDate"] for r in matched}
    if len(versions) != 1 or any(not DAY.fullmatch(x) for x in versions):
        raise ValueError("行业分类版本混杂，需人工核对")
    update_date = versions.pop()
    if dt.date.fromisoformat(update_date) > clock.date():
        raise ValueError("行业分类版本在未来")
    if (clock.date() - dt.date.fromisoformat(update_date)).days > 28:
        raise ValueError("行业分类版本已过期，不作为当日分类")
    codes = [r["code"] for r in matched]
    if len(codes) != len(set(codes)):
        raise ValueError("同一标准的行业成分股代码重复")
    return {
        "schemaVersion": 1,
        "source": "baostock:query_stock_industry",
        "completed": True,
        "standard": standard,
        "updateDate": update_date,
        "observedAt": int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000),
        "declaredRows": len(matched),
        "rows": matched,
        "upstreamLicenseIndependentlyVerified": False,
        "canTrade": False,
    }


def publish(dest, data):
    raw = (json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("BaoStock行业研究包超过4MiB")
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, staging = tempfile.mkstemp(prefix=".industry-classification-", dir=dest.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(staging, dest)
        directory_fd = os.open(dest.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        os.unlink(staging)


def main(argv):
    args = parse(argv)
    # No network calls or SDK import during parse/preflight.
    try:
        import baostock as bs
    except ImportError as exc:
        raise ValueError("请在授权后自行安装BaoStock SDK") from exc
    now = dt.datetime.now(BEIJING)
    bundle = export(bs, args.standard, now)
    publish(Path(args.output), bundle)
    print(json.dumps({
        "mode": "industry-membership-export-only", "rows": bundle["declaredRows"],
        "classificationDate": bundle["updateDate"],
        "providerLicenseIndependentlyVerified": False,
        "verifiedLive": False, "canTrade": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception:
        print("BaoStock行业来源/许可/采集字段或文件检查失败；没有可用新分类包", file=sys.stderr)
        sys.exit(1)
