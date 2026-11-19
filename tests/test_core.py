import numpy as np
import pandas as pd
import pytest

from analysis_core import (
    normalize_spot, normalize_history, screen_spot, validate_code, moving_average_backtest,
)


def sample_history(n=90, down_after=None):
    dates = pd.bdate_range("2026-01-01", periods=n)
    cl = [10.0] * min(25, n) + [10 + (i - 24) * 0.1 for i in range(25, n)]
    if down_after is not None:
        for i in range(down_after, n):
            cl[i] = max(1, cl[down_after - 1] - (i - down_after + 1) * 0.35)
    arr = np.array(cl, dtype=float)
    return pd.DataFrame({
        "日期": dates, "开盘": arr + .02, "最高": arr + .25,
        "最低": arr - .25, "收盘": arr, "成交量": np.full(n, 1000),
    })


def test_spot_rejects_empty():
    with pytest.raises(ValueError):
        normalize_spot(pd.DataFrame())


def test_spot_missing_fields_fails():
    with pytest.raises(ValueError):
        normalize_spot(pd.DataFrame({"代码": ["600519"]}))


def test_spot_does_not_fabricate_zero():
    r = normalize_spot(pd.DataFrame({
        "代码": ["600519", "000001"], "名称": ["甲", "乙"],
        "最新价": [10, 0], "涨跌幅": [1.2, 2.3],
    }))
    assert len(r) == 1
    assert pd.isna(r.iloc[0]["成交额"])


def test_spot_filter():
    df = normalize_spot(pd.DataFrame({
        "代码": ["600519", "000001"], "名称": ["甲", "乙"],
        "最新价": [10, 8], "涨跌幅": [3, -3], "换手率": [3, 1],
        "成交额": [3e8, 2e7], "量比": [1.5, 0.7],
    }))
    assert screen_spot(df, 0, 6, 2, 1, 1)["代码"].tolist() == ["600519"]


def test_spot_minimum_excludes_unknown():
    df = normalize_spot(pd.DataFrame({
        "代码": ["600519"], "名称": ["甲"], "最新价": [10], "涨跌幅": [2],
    }))
    assert screen_spot(df, -10, 10, 1).empty
    assert len(screen_spot(df, -10, 10, 1, include_missing=True)) == 1


def test_history_invalid_rows_removed():
    h = sample_history(5)
    h.loc[0, "收盘"] = -1
    assert len(normalize_history(h)) == 4


def test_history_unsorted_duplicate_dates():
    h = sample_history(5)
    h = pd.concat([h.iloc[::-1], h.iloc[[1]]], ignore_index=True)
    assert len(normalize_history(h)) == 5
    assert normalize_history(h)["日期"].is_monotonic_increasing


def test_code_validation():
    assert validate_code("600519") == "600519"
    for code in ("", "../../", "abc123", "60051", "900901"):
        with pytest.raises(ValueError):
            validate_code(code)


def test_backtest_signal_next_open():
    curve, logs, metrics = moving_average_backtest(sample_history(), 5, 20)
    assert (logs["信号日期"] < logs["成交日期"]).all()
    assert (logs["数量"] % 100 == 0).all()
    assert metrics["期末权益"] > 0
    assert (curve["策略权益"] > 0).all()


def test_backtest_t_plus_one():
    _, logs, _ = moving_average_backtest(sample_history(down_after=50), 5, 20)
    buys = pd.to_datetime(logs.loc[logs["方向"] == "买入", "成交日期"])
    sells = pd.to_datetime(logs.loc[logs["方向"] == "卖出", "成交日期"])
    assert len(buys) >= 1 and len(sells) >= 1
    assert (sells.iloc[0] > buys.iloc[0])


def test_backtest_rejects_bad_windows():
    with pytest.raises(ValueError):
        moving_average_backtest(sample_history(), 20, 5)


def test_backtest_costs_reduce_equity():
    h = sample_history(down_after=60)
    _, _, free = moving_average_backtest(
        h, 5, 20, commission_rate=0, min_commission=0, sell_stamp_tax=0, slippage_rate=0,
    )
    _, _, charged = moving_average_backtest(
        h, 5, 20, commission_rate=0.001, min_commission=5,
        sell_stamp_tax=0.0005, slippage_rate=0.001,
    )
    assert charged["期末权益"] < free["期末权益"]
