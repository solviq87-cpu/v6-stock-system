"""纯数据处理和回测，不包含网络请求、账户或交易接口。"""
from __future__ import annotations
import re
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

SPOT_COLUMNS = ["代码", "名称", "最新价", "涨跌幅", "成交额", "换手率", "量比", "总市值"]
HIST_COLUMNS = ["日期", "开盘", "最高", "最低", "收盘", "成交量"]


def numeric(s: pd.Series) -> pd.Series:
    """非数字当作缺失值，不把未知数据伪造成 0。"""
    return pd.to_numeric(s.astype(str).str.replace(",", "", regex=False), errors="coerce")


def normalize_spot(raw: pd.DataFrame) -> pd.DataFrame:
    if raw is None or raw.empty:
        raise ValueError("行情来源返回空数据，无法展示或选股")
    required = ["代码", "名称", "最新价", "涨跌幅"]
    missing = [c for c in required if c not in raw.columns]
    if missing:
        raise ValueError("实时行情字段缺失：" + "、".join(missing))
    d = raw.copy()
    d["代码"] = d["代码"].astype(str).str.strip().str.replace(r"\.0$", "", regex=True).str.zfill(6)
    d = d[d["代码"].str.match(r"^(?:0|3|4|6|8)\d{5}$")].copy()
    d["名称"] = d["名称"].fillna("未知").astype(str)
    for c in SPOT_COLUMNS[2:]:
        if c not in d:
            d[c] = float("nan")
        d[c] = numeric(d[c])
    d = d[d["最新价"] > 0].drop_duplicates("代码", keep="last")
    if d.empty:
        raise ValueError("行情没有可验证的有效价格，拒绝展示空或伪造数据")
    return d[SPOT_COLUMNS].reset_index(drop=True)


def screen_spot(
    df: pd.DataFrame,
    pct_low: float = -10.0,
    pct_high: float = 10.0,
    turnover_min: float = 0.0,
    amount_min_yi: float = 0.0,
    ratio_min: float = 0.0,
    include_missing: bool = False,
) -> pd.DataFrame:
    if pct_low > pct_high:
        raise ValueError("涨跌幅下限不可高于上限")
    out = df.copy()
    conditions = [out["涨跌幅"].between(pct_low, pct_high)]
    for col, minimum in (("换手率", turnover_min), ("成交额", amount_min_yi * 1e8), ("量比", ratio_min)):
        if minimum > 0:
            cond = out[col] >= minimum
            if include_missing:
                cond = cond | out[col].isna()
            conditions.append(cond)
    for cond in conditions:
        out = out.loc[cond.reindex(out.index, fill_value=False)]
    return out.sort_values(["涨跌幅", "成交额"], ascending=[False, False], na_position="last")


def normalize_history(raw: pd.DataFrame) -> pd.DataFrame:
    if raw is None or raw.empty:
        raise ValueError("历史日线为空，无法进行回测")
    missing = [x for x in HIST_COLUMNS if x not in raw.columns]
    if missing:
        raise ValueError("历史日线缺少字段：" + "、".join(missing))
    d = raw[HIST_COLUMNS].copy()
    d["日期"] = pd.to_datetime(d["日期"], errors="coerce")
    for c in HIST_COLUMNS[1:]:
        d[c] = numeric(d[c])
    d = d.dropna(subset=["日期", "开盘", "最高", "最低", "收盘"])
    d = d[(d["开盘"] > 0) & (d["最高"] > 0) & (d["最低"] > 0) & (d["收盘"] > 0)]
    d = d[(d["最高"] >= d[["开盘", "收盘", "最低"]].max(axis=1)) &
          (d["最低"] <= d[["开盘", "收盘", "最高"]].min(axis=1))]
    d = d.sort_values("日期").drop_duplicates("日期", keep="last").reset_index(drop=True)
    if len(d) < 2:
        raise ValueError("有效日线数量不足，拒绝计算分析结果")
    return d


def validate_code(symbol: str) -> str:
    code = str(symbol).strip()
    if not re.fullmatch(r"(?:0|3|4|6|8)\d{5}", code):
        raise ValueError("股票代码应为以 0/3/4/6/8 开头的六位 A股代码")
    return code


def moving_average_backtest(
    df: pd.DataFrame,
    short_window: int = 5,
    long_window: int = 20,
    initial_cash: float = 100000.0,
    commission_rate: float = 0.0003,
    min_commission: float = 5.0,
    sell_stamp_tax: float = 0.0005,
    slippage_rate: float = 0.0005,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, float]]:
    """教学型日线回测：t 日收盘产生信号，最早 t+1 日开盘成交。

    单股票、100 股整手、A股 T+1、手续费滑点，未模拟停牌、涨跌停、
    分红和公司行为，绝不可直接用于交易。
    """
    if not (2 <= short_window < long_window):
        raise ValueError("短均线必须 >=2 且小于长均线")
    if initial_cash <= 0 or min(commission_rate, min_commission, sell_stamp_tax, slippage_rate) < 0:
        raise ValueError("本金与成本参数不合法")
    d = normalize_history(df).copy()
    if len(d) < long_window + 2:
        raise ValueError("历史数据至少需要长均线天数 + 2 天")
    d["MA短"] = d["收盘"].rolling(short_window, min_periods=short_window).mean()
    d["MA长"] = d["收盘"].rolling(long_window, min_periods=long_window).mean()
    d["目标持仓"] = (d["MA短"] > d["MA长"]).fillna(False)
    cash = float(initial_cash)
    shares = 0
    last_buy_day = -1
    equity = []
    actions: List[dict] = []
    for i, row in d.iterrows():
        day_open = float(row["开盘"])
        target = bool(d.iloc[i - 1]["目标持仓"]) if i >= 1 else False
        signal_day = d.iloc[i - 1]["日期"].strftime("%Y-%m-%d") if i >= 1 else ""
        trade_date = row["日期"].strftime("%Y-%m-%d")
        if shares > 0 and not target and i > last_buy_day:
            price = day_open * (1.0 - slippage_rate)
            proceeds = shares * price
            commission = max(min_commission, proceeds * commission_rate)
            tax = proceeds * sell_stamp_tax
            cash += proceeds - commission - tax
            actions.append({"信号日期": signal_day, "成交日期": trade_date, "方向": "卖出", "价格": round(price, 3), "数量": shares, "费用及税": round(commission + tax, 2)})
            shares = 0
        elif shares == 0 and target:
            price = day_open * (1.0 + slippage_rate)
            lot_cost = 100 * price
            if lot_cost > 0 and cash >= lot_cost + min_commission:
                lots = int((cash - min_commission) // lot_cost)
                while lots > 0:
                    quantity = lots * 100
                    gross = quantity * price
                    fee = max(min_commission, gross * commission_rate)
                    if gross + fee <= cash + 1e-8:
                        break
                    lots -= 1
                if lots > 0:
                    shares = lots * 100
                    gross = shares * price
                    fee = max(min_commission, gross * commission_rate)
                    cash -= gross + fee
                    last_buy_day = i
                    actions.append({"信号日期": signal_day, "成交日期": trade_date, "方向": "买入", "价格": round(price, 3), "数量": shares, "费用及税": round(fee, 2)})
        equity.append(cash + shares * float(row["收盘"]))
    d["策略权益"] = equity
    d["买入持有参考"] = initial_cash * d["收盘"] / float(d.iloc[0]["收盘"])
    d["累计收益率"] = d["策略权益"] / initial_cash - 1
    running_max = d["策略权益"].cummax()
    d["回撤"] = d["策略权益"] / running_max - 1
    stats = {
        "策略收益率": float(d.iloc[-1]["累计收益率"]),
        "最大回撤": float(d["回撤"].min()),
        "买入持有收益率（未扣成本）": float(d.iloc[-1]["收盘"] / d.iloc[0]["收盘"] - 1),
        "成交笔数": float(len(actions)),
        "期末权益": float(d.iloc[-1]["策略权益"]),
        "期末持股（股）": float(shares),
    }
    return d, pd.DataFrame(actions, columns=["信号日期", "成交日期", "方向", "价格", "数量", "费用及税"]), stats
