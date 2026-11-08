# 策略来源与实盘证据核对（2026-11-08）

基线：`6bead0b`。本报告记录来源核对；代码实现和验证边界见 STRATEGY_RESEARCH.md。不接券商、不下单、不部署。来源为作者原文、官方仓库和官方文档，链接核对日期为2026-11-08；可变分支链接不等于冻结版本。

在本次查阅的来源中，**六项均未找到“确切策略版本＋真实账户＋独立核验＋费用后结果＋明确区间及交易样本”的完整实盘证据**。因此全部保持 `liveVerified: false`。这不表示它们没有人实盘使用，而是本次证据不足以认证。胜率、预测准确率、策略净收益是不同指标，不能相互替代，也不将项目流行度称为效果证明。

## 证据口径与候选结论

- `official-code`：能够核对规则、参数和执行流程，不能推出收益。
- `author-research`：作者描述历史研究或示例，未独立复现、未认证真实账户净业绩。
- `framework-live-support`：框架有实盘接口/引擎，属于工程能力，不能升级为该策略的实盘业绩。
- `verified-live`：必须有上述完整且可追溯的真实账户证据；本表没有此等级。

| ID | 完整策略候选 | 当前证据 | liveVerified | 接入判断 |
|---|---|---|---|---|
| donchian20_atr | Donchian20/10＋ATR趋势策略 | official-code | false | 保留当前接入，重点完善持仓、退出与风险预算 |
| rsi2_mean_reversion | 趋势内RSI2均值回归 | author-research；RSI指标有官方代码 | false | 保留当前接入，明确次日开盘变体和长期预热 |
| momentum20_rotation | Qlib式有限换仓轮动 | official-code | false | 保留当前接入，需要真实历史持仓状态，修正最低持有期语义 |
| vnpy_boll_cci | vn.py布林突破＋CCI＋ATR退出 | official-code；framework-live-support | false | 推荐新增为独立研究策略，明确日线只做多改动 |
| vnpy_atr_rsi | vn.py波动扩张＋RSI动量＋跟踪退出 | official-code；framework-live-support | false | 推荐新增研究变体，禁止原价差和盘中参数直接当A股最优参数 |
| dual_momentum | 月度双动量资产轮动 | author-research | false | 暂缓；先补ETF总收益、现金/债券及月度历史数据 |

## 1. Donchian20/10＋ATR

官方Backtide示例默认入场窗口20、退出窗口10、ATR窗口20，突破最高价入场、跌破最低价退出，并按ATR配置风险。Backtrader的Donchian示例明确默认窗口从上一根开始，防止当前最高价把突破条件吞掉。[Backtide规则](https://tvdboom.github.io/backtide/v0.1/api/models/strategies/turtletrading/)、[Backtrader窗口](https://www.backtrader.com/recipes/indicators/donchian/donchian/)。

系统约定：在t日收盘，`U20=max(high[t-20:t])`、`L10=min(low[t-10:t])`，右端不含t；空仓且`close[t]>U20`计划入场，持仓且`close[t]<L10`计划退出，最早下一交易日开盘执行。ATR风险线、风险预算、无加仓/无做空属于系统显式变体，不能称为完整原版海龟。需要至少21根合格日线及ATR预热、当前持仓和入场ATR状态；持有到退出条件成立，没有来源保证的固定盈利周期。

许可：[Backtide MIT](https://tvdboom.github.io/backtide/v0.1/license/)；[Backtrader GPL3](https://github.com/mementum/backtrader/blob/master/LICENSE)。依据公式独立实现，不复制GPL策略代码。现有`platform_breakout`已有突破入口，新增价值是持仓生命周期与风险约束，不能重复计为额外证据。

## 2. Connors RSI2趋势内回归

作者Larry Connors的原文给出：价格高于200日均线且RSI2收于5以下买入，RSI2收于70以上退出；原文讨论收盘成交，并未给出可独立核验的账户净收益记录。[作者原文](https://tradingmarkets.com/recent/how_to_enter_and_exit_a_position_on_the_close-677551)。

系统约定：`close>SMA200 && RSI2<5`入场、`RSI2>70`退出，确认信号后下一交易日开盘计划，退出优先、不摊平。至少200根有效日线，保存持仓和入场日；短期回归持有到退出信号，任何最长持有期、趋势失效退出或风险线均标注为新增规则。平滑及零涨跌约定要固定：[LEAN RSI实现](https://github.com/QuantConnect/Lean/blob/master/Indicators/RelativeStrengthIndex.cs)默认Wilder，平均亏损为零时返回100；不能混用其他库的常数序列中性值却称为完全一致。

许可：文章未提供开源代码许可，仅引用来源和规则；LEAN指标源码为Apache2。该研究针对股票/ETF回调，并不证明A股或次日开盘变体有相同效果。

## 3. Qlib TopK-Dropout轮动：源码语义

它是组合持仓策略，不是预测模型；分数来源可以是现有动量或模型，但替换来源后需单独验证。[官方文档](https://qlib.readthedocs.io/en/latest/component/strategy.html)、[MIT源码](https://github.com/microsoft/qlib/blob/main/qlib/contrib/strategy/signal_strategy.py)。

`method_buy=top`时先取最多`n_drop+topk-currentCount`只最佳未持仓候选，与旧仓合并排序，再从末尾`n_drop`名中选出旧仓为预选卖出，避免卖高买低。`hold_thresh`默认为1，卖出前按配置交易步检查持有计数；不是必须持有若干自然日，也不是每天强制卖满D只。分数来自上一交易步。默认`risk_degree=0.95`，新买入分配可用现金，旧仓不每天重调等权。

系统需保存逐日持仓、建仓日和预算，平分同分时固定证券代码排序；最低持有期/不可成交拦截后，按实际可释放槽位与预算补仓。源代码先确定候选再检查持有期，不能把预选卖出数当已成交数。K、D、调仓频率、现有20日动量和等权预算都是系统参数，不能冒充Qlib证实的最优组合。原默认涨跌停开关对双向交易作保守禁止，也不能直接当A股精确成交规则。

## 4. vn.py Boll＋CCI＋ATR：新增优先项

[官方BollChannelStrategy](https://github.com/vnpy/vnpy_ctastrategy/blob/main/vnpy_ctastrategy/strategies/boll_channel_strategy.py)原例使用15分钟柱，布林窗口18、倍数3.4，CCI10，ATR30，退出倍数5.2，固定数量1。空仓且CCI>0时在布林上轨挂买入停止单；多仓按持有期间最高价减`5.2×当前ATR30`设置退出停止单。原版也有做空，ATR变化可使退出线回落，并非必然单调收紧。至少满足指标预热，保存持仓和持有期间最高价。

可接入**日线只做多研究变体**：CCI10>0且收盘突破上轨产生次日开盘入场计划，持仓在收盘跌破ATR退出线时计划退出，禁止把同柱最高价、最低价同时解释成确定成交路径。日线确认和下一开盘执行均改变了原策略，参数只能作为来源默认值；数量1不是A股通用仓位单位，改用独立研究预算及证券交易单位。

其价值是波动自适应通道及明确退出，相比已有平台突破有部分重叠，必须与Donchian做增量比较。许可为[MIT](https://github.com/vnpy/vnpy_ctastrategy/blob/main/LICENSE)。

## 5. vn.py ATR-RSI：新增第二项

[官方AtrRsiStrategy](https://github.com/vnpy/vnpy_ctastrategy/blob/main/vnpy_ctastrategy/strategies/atr_rsi_strategy.py)原例从tick生成分钟柱：ATR22高于最近10个ATR22均值，且RSI5>66时做多；持多仓在持有期间最高价回落0.8%时退出。固定数量1；空头规则为RSI5<34。ATR均值包含当前ATR。原例`close+5`是报价积极程度的实现参数，不是“涨5元才入场”的指标条件。

可接入日线只做多研究变体：沿用波动扩张与RSI动量入场，次日开盘计划；收盘确认百分比跟踪退出。所需数据为OHLC、ATR/RSI预热、持仓与持有期间最高价，持有到退出。0.8%是原分钟级默认值，不可宣传为日线/A股适宜参数；系统应显示参数来源及研究变体身份，不搬用`close+5`、做空或盘中T+0。许可同为MIT。

这与Connors低RSI回归方向相反，是动量策略。它能补充策略场景，但不算独立市场信息；最终是否保留取决于费用后样本外增益。

vn.py的[CTA模块说明](https://github.com/vnpy/vnpy_ctastrategy)描述开发、回测、优化和自动交易流程；[主框架](https://github.com/vnpy/vnpy)列出A股交易网关。两者证明框架的执行能力，没有证明这两个示例版本的胜率、净收益或真实账户实盘表现。本系统不因此连接这些网关。

## 6. 月度双动量：暂缓数据门槛较高的候选

作者公开GEM以美国股票、非美国股票和债券指数为资产集合，按月重评相对/绝对动量。作者FAQ说明可先用美国股票与国库券收益比较绝对动量，再比较两类股票相对强弱；顺序变动可能改变配置。作者GEM页面明确说明其业绩不是实际基金或投资组合业绩，且没有扣除管理费、交易成本等。[GEM原文](https://www.optimalmomentum.com/global-equities-momentum/)、[作者FAQ](https://www.optimalmomentum.com/faq/)。

研究计划只能另立**A股ETF双动量变体**：预先冻结可交易ETF池、月末按过去12个月总收益排序，超过预先定义现金基准才持有领先ETF，否则转防御资产；下一交易日开盘调仓，持有到下一月度决策。并列保留原仓、无有效候选保持现金。ETF替代、现金门槛、全仓/上限仓位均须独立定义，不能称为原GEM的认证实现。需要13个以上月末的总收益序列、分红、月历及防御资产数据，当前个股短历史OHLC不能替代。

作者网站[使用条款](https://www.optimalmomentum.com/disclaimer/)并非开源许可，禁止未经许可复制其数据/内容到商业服务。只保存出处和独立研究设计，不移植其收益表；未核实到适合直接复用的官方开源GEM代码，故暂缓。

## 接入验收

先保留当前三项完整策略；Boll-CCI与ATR-RSI列为后续独立验证候选，尚未写入可运行目录；双动量等待ETF数据。所有候选保持研究用途，不生成真实订单、不自动调正式权重。

需逐项验证：未来柱/迟到数据不改变过去计划；退出优先；交易日计数及最低持有期；候选卖出受阻后不虚增买入；T+1可卖数量；停牌、涨跌停和缺失成交数据保持受阻；复权指标价不直接作为原始成交价；现金、费用、滑点和证券交易单位一致。报告应按冻结版本输出费用后收益、最大回撤、换手、持仓期、有效交易数、受阻比例及分时段样本外结果；达到这些条件仍不自动升级为`verified-live`。

本轮验证仅为官方来源核对和文档结构检查，未新增收益数字、未声称策略效果提升。代码测试和最终整体验证由并行实现任务记录。本文件可单独删除回滚，不影响现有业务行为。
