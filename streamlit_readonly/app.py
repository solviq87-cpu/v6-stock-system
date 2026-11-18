"""天枢智策 A股只读看盘网页。

无实盘账户、券商、自动下单、AI 云服务调用。
部署：streamlit run app.py --server.address 0.0.0.0 --server.port 7860
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
import hmac
import os

import pandas as pd
import streamlit as st

from analysis_core import moving_average_backtest, screen_spot, validate_code
from market_data import TZ, history, spot

st.set_page_config(page_title="天枢智策 · A股研究面板", page_icon="📈", layout="wide", initial_sidebar_state="expanded")
st.markdown("""<style>
:root {--primary-color:#ef647f}
[data-testid="stAppViewContainer"] {background:linear-gradient(135deg,#0e1424 0%,#131528 55%,#221b37 100%);color:#f5f5f9}
[data-testid="stSidebar"] {background:#151b2c}
[data-testid="stMetric"] {border:1px solid #40415f;border-radius:15px;padding:14px;background:#21263a}
[data-testid="stTabs"] button {font-weight:600}
</style>""", unsafe_allow_html=True)


def authenticated() -> bool:
    required = os.environ.get("DASHBOARD_PASSWORD", "")
    if not required or required in ("CHANGE_ME", "password", "123456"):
        st.error("安全门禁：尚未配置有效 DASHBOARD_PASSWORD。请在托管平台环境变量中设置强密码。")
        st.info("为了避免被公众直接访问，网页默认拒绝在无密码时启动数据面板。")
        return False
    if st.session_state.get("access_granted", False):
        return True
    st.title("🔐 天枢智策 · 私人看盘")
    st.caption("仅供本人研究使用 · 无交易入口 · 不保证行情实时性")
    pwd = st.text_input("请输入私有访问密码", type="password")
    if st.button("进入分析面板", type="primary"):
        if hmac.compare_digest(pwd, required):
            st.session_state.access_granted = True
            st.rerun()
        else:
            st.error("密码不正确")
    return False


if not authenticated():
    st.stop()


@st.cache_data(ttl=120, show_spinner=False)
def cached_spot():
    return spot()


@st.cache_data(ttl=3600, show_spinner=False)
def cached_history(code: str, start: str, end: str):
    return history(code, start, end)


with st.sidebar:
    st.header("📈 天枢智策")
    st.caption("A股 · 研究终端 / 只读")
    if st.button("刷新行情缓存"):
        cached_spot.clear()
        cached_history.clear()
        st.rerun()
    if st.button("退出登录"):
        st.session_state.access_granted = False
        st.rerun()
    st.divider()
    st.caption("仅公开数据；报价可能延迟或失效。无账户系统、交易功能、自动交易及外部 AI API。")

today_cn = datetime.now(TZ).date()
st.title("天枢智策 · A股研究面板")
st.caption("公开行情快照 / 条件选股 / 历史技术分析 / 教学型回测 · 非投资建议")

market_tab, screen_tab, stock_tab, backtest_tab = st.tabs(["📊 行情", "🔎 条件选股", "📈 个股", "🧪 简单回测"])

snapshot = None
snapshot_error = ""
try:
    with st.spinner("正在读取 AKShare 行情快照…"):
        snapshot, read_time = cached_spot()
except Exception as ex:
    snapshot_error = f"AKShare 行情快照不可用：{type(ex).__name__}: {str(ex)[:220]}"

with market_tab:
    st.subheader("A股市场快照")
    if snapshot is None:
        st.error(snapshot_error)
        st.info("不要把历史日线当成实时行情。可以切换「个股」和「简单回测」继续使用历史数据功能。")
    else:
        st.caption(f"AKShare 快照 · 本次抓取：{read_time.strftime('%Y-%m-%d %H:%M:%S')}（北京时间） · 交易所原始报价时间：来源未提供，不能验证实时性")
        advances = int((snapshot["涨跌幅"] > 0).sum())
        declines = int((snapshot["涨跌幅"] < 0).sum())
        flat = int((snapshot["涨跌幅"] == 0).sum())
        a, b, c, d = st.columns(4)
        a.metric("可用股票数", f"{len(snapshot):,}")
        b.metric("上涨", f"{advances:,}")
        c.metric("下跌", f"{declines:,}")
        d.metric("平盘", f"{flat:,}")
        query = st.text_input("按代码或名称搜索", placeholder="如：600519、贵州茅台")
        table = snapshot
        if query.strip():
            table = table[table["代码"].str.contains(query.strip(), regex=False) | table["名称"].str.contains(query.strip(), regex=False)]
        sort_col = st.selectbox("排序指标", ["涨跌幅", "成交额", "换手率", "量比"], index=0)
        st.dataframe(table.sort_values(sort_col, ascending=False, na_position="last").head(300), use_container_width=True, hide_index=True)
        st.download_button("导出当前结果 CSV", table.to_csv(index=False).encode("utf-8-sig"), file_name="A股行情快照.csv", mime="text/csv")

with screen_tab:
    st.subheader("条件选股（筛选，不是交易建议）")
    if snapshot is None:
        st.error(snapshot_error)
    else:
        c1, c2 = st.columns(2)
        with c1:
            lower = st.number_input("涨跌幅下限（%）", value=-3.0, step=1.0)
            turnover = st.number_input("最小换手率（%）", min_value=0.0, value=1.0, step=0.5)
            ratio = st.number_input("最小量比（0为不限）", min_value=0.0, value=0.0, step=0.1)
        with c2:
            upper = st.number_input("涨跌幅上限（%）", value=7.0, step=1.0)
            amount = st.number_input("最低成交额（亿元）", min_value=0.0, value=1.0, step=0.5)
            include_missing = st.checkbox("允许缺失指标通过附加筛选", value=False)
        try:
            selection = screen_spot(snapshot, lower, upper, turnover, amount, ratio, include_missing)
            st.metric("满足条件", f"{len(selection):,} 只")
            st.dataframe(selection.head(500), use_container_width=True, hide_index=True)
            st.download_button("下载选股清单 CSV", selection.to_csv(index=False).encode("utf-8-sig"), file_name="选股结果.csv", mime="text/csv")
            st.caption("排序只是指定条件的数学筛选，没有经过样本外验证，不代表上涨概率。")
        except ValueError as ex:
            st.warning(str(ex))

with stock_tab:
    st.subheader("个股历史行情")
    code = st.text_input("六位股票代码", value="600519", key="history_code", max_chars=6)
    col1, col2 = st.columns(2)
    start = col1.date_input("开始日期", value=today_cn - timedelta(days=365), key="hist_start")
    end = col2.date_input("结束日期", value=today_cn, key="hist_end")
    if st.button("查看历史走势", type="primary"):
        try:
            validate_code(code)
            if start >= end:
                raise ValueError("结束日期必须晚于开始日期")
            rows, downloaded = cached_history(code, start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
            st.session_state["hist_data"] = rows
            st.session_state["hist_code_loaded"] = code
            st.session_state["hist_time"] = downloaded
        except Exception as ex:
            st.error(f"获取历史行情失败：{type(ex).__name__}: {str(ex)[:240]}")
    if "hist_data" in st.session_state:
        rows = st.session_state.hist_data.copy()
        st.caption(f"代码 {st.session_state.hist_code_loaded} · 历史原始未复权日线 · 最新可用交易日：{rows.iloc[-1]['日期']:%Y-%m-%d} · 源头报价时间不能验证")
        rows["MA5"] = rows["收盘"].rolling(5).mean()
        rows["MA20"] = rows["收盘"].rolling(20).mean()
        st.line_chart(rows.set_index("日期")[["收盘", "MA5", "MA20"]], use_container_width=True)
        st.bar_chart(rows.set_index("日期")["成交量"].fillna(0), use_container_width=True)
        st.dataframe(rows.tail(40).iloc[::-1], use_container_width=True, hide_index=True)
        st.caption("停牌、除权、复权、公司行为未做专业化处理，不可据此下单。")

with backtest_tab:
    st.subheader("均线交叉策略 · 教学型回测")
    st.caption("使用历史不复权日线。只根据前一日收盘信号，次日开盘模拟成交；100 股整手和 A 股 T+1；模拟手续费、卖出印花税及滑点。")
    bc1, bc2 = st.columns(2)
    symbol = bc1.text_input("回测股票代码", "600519", max_chars=6, key="bt_code")
    years = bc2.selectbox("回测历史区间", [1, 2, 3, 5], index=1, format_func=lambda x: f"近{x}年")
    sc, lc = st.columns(2)
    sw = sc.number_input("短均线周期", min_value=2, max_value=100, value=5, step=1)
    lw = lc.number_input("长均线周期", min_value=3, max_value=200, value=20, step=1)
    cash = st.number_input("模拟初始本金（元）", min_value=1000, value=100000, step=10000)
    fee_bp = st.number_input("佣金率（万分之）", min_value=0.0, max_value=30.0, value=3.0, step=1.0)
    slip_bp = st.number_input("单边滑点（万分之）", min_value=0.0, max_value=50.0, value=5.0, step=1.0)
    stamp_bp = st.number_input("卖出印花税（万分之）", min_value=0.0, max_value=30.0, value=5.0, step=1.0)
    if st.button("运行回测", type="primary"):
        try:
            validate_code(symbol)
            today = today_cn
            start_day = today - timedelta(days=int(years) * 365 + 5)
            data, retrieved = cached_history(symbol, start_day.strftime("%Y%m%d"), today.strftime("%Y%m%d"))
            curve, log, metrics = moving_average_backtest(data, int(sw), int(lw), float(cash), fee_bp / 10000.0, 5.0, stamp_bp / 10000.0, slip_bp / 10000.0)
            st.session_state.bt_output = (curve, log, metrics, symbol)
        except Exception as ex:
            st.error(f"回测失败：{type(ex).__name__}: {str(ex)[:260]}")
    if "bt_output" in st.session_state:
        curve, log, metrics, tag = st.session_state.bt_output
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("策略收益率", f"{metrics['策略收益率']:.2%}")
        m2.metric("最大回撤", f"{metrics['最大回撤']:.2%}")
        m3.metric("买入持有参考", f"{metrics['买入持有收益率（未扣成本）']:.2%}")
        m4.metric("模拟成交笔数", int(metrics["成交笔数"]))
        st.line_chart(curve.set_index("日期")[["策略权益", "买入持有参考"]], use_container_width=True)
        st.dataframe(log.iloc[::-1], use_container_width=True, hide_index=True)
        st.caption("期末持仓按最后收盘价估值，未计最终平仓税费；收益不保证，未模拟停牌/无法成交/涨跌停、分红等，非专业级回测。")