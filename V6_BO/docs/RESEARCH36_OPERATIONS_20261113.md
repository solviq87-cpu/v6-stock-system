# 36种策略研究：协议、操作和验证边界

## 功能定位

这是对现有完整工程的增量研究能力，保留原四套策略和原10项战法，不改变原生产评分、参数、通知或账户。36项分为趋势7、量价资金6、短线热点8、基本面6、事件与智能9。定义见 `strategies/research36.json`，每项有稳定ID、版本、启停、条件、单位、研究时效与失效条件。

阈值是明确的**待验证研究假设**，不是已优化参数，也不代表这些战法被证明有效。引擎、HTTP、页面与CLI始终输出 `canTrade:false`，概率为null。字段证据的来源和时间是导入方声明，`verifiedExternal:false`；字符串来源和本地哈希不能证明外部真实性。

## 研究输入

`evaluate`输入为 `{stock:{code,bars?,features?},asOf,config?}`。时间均为正整数Unix毫秒；`asOf`是本次决策时点，不是自动补给缺失数据的接收时间。

每个 features 字段必须独立提供：

| 字段 | 约束 |
|---|---|
| value | 有限number或规则指定的boolean；null、空串、数字字符串不得当0 |
| unit | 必须与目录中的明确单位一致；percent为百分点，ratio为比值，CNY为人民币金额，percentile为0至100口径的百分位 |
| code | 与当前六位股票代码一致 |
| source / evidenceId | 非空来源及原证据引用；须由采集/导入系统实际提供 |
| observedAt / availableAt / recordedAt | 原始观察、实际可得、本机记录时点；依次不晚于asOf，研究时效按observedAt判定 |
| simulated / retracted | 明确为true时拒绝作为候选证据；不因缺字段就认证真实 |

过期、未来、错股票、撤稿、单位错和缺来源输出 `insufficient_data`，条件分保持null。真实0可以参与规则比较。完整但不匹配的条件列入反对证据；匹配条件列入支持证据。所有规则参数及输入都有内容指纹供回放比对。

技术指标可从 `bars` 推导部分字段，但每根必须有日期、完整OHLCV、final=true、priceBasis=unadjusted、来源、observedAt/availableAt/recordedAt。无时点的中间K线会阻止推导，不能静默跳过形成假窗口；明确晚于决策时刻的K线不参与计算。当前自动推导包括均线比值、过去窗口高点突破、量比、MACD、RSI、价格位置等。竞价、筹码、资金、财务、新闻及部分复合事件仍依赖合法且时点完整的上游特征，**没有伪造这些特征或声称自动源全部接通**。

## 配置与去重

`config`按稳定策略ID设置 `{enabled,weight,thresholds}`。weight范围0至100，负值、非数值、未知字段及生产开关拒绝；0权重或停用不产生研究候选。thresholds只允许修改已有条件、相同类型和合法区间。配置仅作用于本次研究，生产参数不变。

同一家族最多选择一个候选代表，其余列入冗余信号。这是透明的家族上限，**不是经验相关系数估计**；不同家族可能仍相关，不能据命中数量宣称独立交叉验证。研究结果的score是条件覆盖分，不是胜率或涨停概率。

## 入口

- 原 `/research.html` 新增“36种策略研究”：读取目录、逐项启停/权重/数字阈值、导入证据JSON、分析、查看支持/反对/缺失及失效条件。沿用现有开发者令牌，结果不保存到浏览器长期存储。换令牌、换文件、隐藏页面或离线会使旧请求失效并清空结果。
- `GET /api/research/strategy36` 读取目录；`POST`只计算单股研究，不提供回测或下单；均要求编辑者、no-store。POST上限256KB，拒绝未来asOf。
- 原 `strategy-service` 可显式设置 `factorOptions.includeResearch36=true`，使用逐股票 `research36Features` 和明确asOf；默认路径不增加此计算，不改变pass/finalScore。

从V6_BO执行：

```sh
node scripts/research36.js catalog
node scripts/research36.js evaluate /private/evidence.json /private/new-run.json
node scripts/research36.js backtest /private/backtest-input.json /private/new-backtest.json
node scripts/research36.js experiment /private/windows-input.json /private/new-experiment.json
```

输出文件以0600、排他创建和fsync保存完整输入、配置、时点及结果；同名文件或符号链接不覆盖。不传输出路径时只输出JSON，调用方须自行保存。没有在生产服务器自动启动或持久化任务。

## 回测与分窗

`backtest`输入：`{strategyId,stocks,evidenceByDate,config,options}`。stocks沿用既有逐日持仓账本格式。evidenceByDate为日期→代码→字段证据；不能以今天的财务/新闻/因子数据反填过去。严格要求逐日ST/停牌/可交易状态、日期一致；既有账本负责次日执行、T+1、停牌、涨跌停、资金持仓、成本与流动性/风险参数。本接口不允许覆盖选择器或关闭严格门禁。

回测返回原净值、订单、成交、回撤等，加零无风险/252期约定下的夏普、利润因子、平均盈亏比和双边区间换手；样本不足、没有亏损或零波动时相关指标为null。另运行同池等额定期持有基准，使用相同账本和成本。**不是指数/ETF市场基准认证**，也不证明交易日历或公司行为真实完整。最多200只、每只3000根、合计50000根，避免无界运算。

`experiment`在上述输入上增加3至12个 `{label,role,start,end}` 窗口，role包含train/validation/test。窗口必须有数据覆盖、按序不重叠，并隔离至少holdDays+1个索引；所有窗口使用同一配置指纹，各窗口独立从初始资金开始。它提供固定参数分窗/滚动评估，**不执行参数拟合**，标签本身不能认证事前注册、样本外独立性或真实未来成熟。`outOfSampleValidated`继续为false。

## 本批测试与局限

53项专项实际通过：36个规则组逐项匹配/缺失，真实零与非法数值，错股票/单位/未来/旧证据，配置和输出突变隔离，K线可得时点，固定参数分窗，既有账本T+1与迟到证据，CLI不可覆盖，实际HTTP分支权限/边界，以及页面文本渲染、迟到响应、离线和令牌清理。

首次专项发现“缺记录时点的中间K线被过滤后仍可计算”的问题，已改为拒绝该段推导并保留失败日志。首次本地浏览器缺安装文件；系统Chromium因socket权限启动失败；下载headless shell所得文件无法解压。已将三视口浏览器检查加入CI；未得到实际运行结果前不称浏览器/真机通过。测试与完整最终版本详见 `FULL_UPGRADE_EXECUTION_20261113.md`。
