# V6 公开规则独立研究接入（2026-11-09）

## 来源与复用边界
- VeighNa CTA 示例文档：https://github.com/vnpy/vnpy/blob/master/docs/community/app/cta_strategy.md ，公开策略使用 Bollinger、CCI、ATR 形成通道型规则；原例用于期货分钟线，包含做空、止损和委托，本模块**没有照搬代码、参数、绩效或交易动作**。
- 历史 ATR–RSI 示例：https://github.com/chenzj810/vnpy-stock/blob/master/docker/dockerTrader/ctaStrategy/strategy/strategyAtrRsi.py 。原策略是期货分钟线示例，并无可直接移植的 A 股日线收益证据。
- 通用指标定义参考：https://backtrader.readthedocs.io/en/latest/user-guide/indicators/indicators.html ，本地独立计算指标，不要求安装交易库或外部账户接口。

## 两条新增研究规则
1. `vnpy_boll_cci_atr`：最近一根**完整日线收盘**高于**此前20日**收盘价布林上轨（SMA20+2倍总体标准差），CCI14>100；ATR14/收盘价介于1%–9%；当日成交量至少为此前20日均量1.2倍。
2. `vnpy_atr_rsi`：按 Wilder 递推的 RSI5 从≤55上穿55；收盘价在此前20日均线之上；ATR22/收盘价介于1%–9%。

以上门槛全部是**待样本外回测的本地假设**，不是来源项目收益证明，不是最优参数，不构成买入建议。指标和判断只读取截至当前样本的历史，不读取未来交易日。源指标计算若数据不足、K线异常、缺日期连续性、停牌、ST、退市风险或量为零，则分别输出 `insufficient_data`、`risk_blocked`，不能补虚构命中股票。

## 模块边界与交付
- 独立只读 `src/strategy/open-source-research-signals.js`，没有修改原有五族策略、四套原选股系统、风险评分或模拟账本。
- `src/core/research-explanation-projection.js` 在已验证结构的历史样本上逐股调用研究规则，将**确实命中**的结果加入个股理由和按规则筛选列表。未命中仅展示诊断条件，不进入该策略命中池。
- 大盘风险为 `risk_off` 时，研究技术形态仍可显示命中，但提示弱市风险；不因此改学习因子权重，也不绕开原有风险门禁。
- 实验报告始终 `historicalOnly=true`、`verifiedLive=false`、`canTrade=false`、`officialCandidate=false`。任何实盘/实时认证、跨市场迁移、交易执行、复权一致性和样本外收益验收均未完成。
- 测试：`node --test tests/open-source-research-signals.test.js`；GitHub Actions 执行全量 V6 后端与网页回归，失败不可合并。

## 尚待研究
按同一审计规范分批评估行业动量、板块领先/轮动、成交量确认和弱市逆势强度等，并与现有15因子、10战法及K线规则做重叠相关性检查，禁止重复加权制造虚假共振。
