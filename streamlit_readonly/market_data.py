"""只读 AKShare 适配器；数据失败就报错，不回退到假行情。"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
import pandas as pd

from streamlit_readonly.analysis_core import normalize_history, normalize_spot, validate_code

TZ = ZoneInfo("Asia/Shanghai")


def spot() -> tuple[pd.DataFrame, datetime]:
    import akshare as ak
    raw = ak.stock_zh_a_spot_em()
    # 抓取时间不是交易所原始报价时间。
    captured_at = datetime.now(TZ)
    return normalize_spot(raw), captured_at


def history(code: str, start: str, end: str) -> tuple[pd.DataFrame, datetime]:
    import akshare as ak
    symbol = validate_code(code)
    raw = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start, end_date=end, adjust="")
    captured_at = datetime.now(TZ)
    return normalize_history(raw), captured_at
