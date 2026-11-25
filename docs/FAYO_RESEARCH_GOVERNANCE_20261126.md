# FAYO 研究可信度阶段一（2026-11-26）

基线 dev b9b44474be7fd27732e37d868ed64dbfddd3e8e9；工作分支 feat/fayo-research-governance-20261126。改前 Git 对象可通过该 SHA 恢复，未制作本地完整 bundle（本环境无法克隆私有仓库）。生产 data/durable/账本及运行配置未取得，不等于生产冷备。没有上线、通知、成交、角色或模型审批变更。

## 已实现增量

- 08/21：core/probability-reliability.js 和 scripts/probability-reliability.js 提供研究登记、事前冻结、分目标的独立时间校准/验证。原概率合同保留，修复继承属性误识别。预测值必须为 0–1，模型版本/指纹、来源、可知时间和交易日历一致；校准标签必须在验证开始前成熟，禁止重复股票日。固定十箱，校准及验证各至少 100 条、20 个信号日、正负标签各 10 条；拟合箱至少 20 条。报告 Brier、log loss、ECE、可靠性曲线、按日删除一组的敏感性范围（不是置信区间）。阈值为本轮保守研究缺省值，未以真实样本证明最佳。
- 25：修正四策略回放边界，训练信号跨到验证期执行不得进入样本外。
- 26：独立策略纸面估算复用原 historical-session 开盘涨跌停及历史股票池门禁，拒绝显式复权成交价、停牌、ST、禁交易及公司行为不完整估算。未知涨跌停制度不再用固定 10% 猜测。仍非成交回执或完整账本；原完整回测/账户不改。未做逐笔成交量/费用表全面迁移。

## 运行合同

在 V6_BO 执行：
- node scripts/probability-reliability.js register PRIVATE_INPUT.json （输入 plan；须在校准开始之前登记）
- node scripts/probability-reliability.js freeze PRIVATE_INPUT.json （输入已登记 plan、prediction、calendar；以运行时钟冻结，距预测不超过60秒）
- node scripts/probability-reliability.js evaluate PRIVATE_INPUT.json （输入 plan、predictions、outcomes、calendar、可选 asOf）

输出写 stdout，命令不访问网络、不改生产参数、不写任何账户。操作者在原私有证据目录保存原始输入与输出、哈希及实际记录时间，不能把自声明 JSON/哈希当作外部真实性或不可回溯登记证明。正式与 test scope 分离，测试结果固定 fixture-only；真实来源及采集接线尚待核验。日历使用原 trading-calendar 合同。实际净盈利目标必须从原 verifiedSettlement 与权威权益证据接入，目前明确排除，不拿价格涨幅代替。

## 交互/风险接口

报告 mode=probability-reliability-research，scope、target、targetLabel、modelVersion、modelFingerprint、planFingerprint、asOf、policy、exclusions、expectedValidation、calibration、validationRaw、validationCalibrated、calibratedCoverage、comparisonOnIdenticalRows；calibrationCertified/canTrade/canApprove/productionWeightsChanged 固定 false。curve.meanPrediction 为模型估计（0–1）；curve.observedFrequency 为对应样本历史频率（0–1），带 samples、days。规则分仍为原 score，绝不显示为概率。严禁把 validationCalibrated 当作已认证概率；没有独立真实存证、试验预算审计及批准，不消费至生产。组间消费应只读，不公开私有原始证据。

## 按任务编号交接

| 编号 | 当前状态 | 复用/剩余 |
|---|---|---|
| 07 | 已有待增强 | factor-shadow-evolution 已有 shadowDecay/cooldown；strategy-health-monitor 与 research-risk-center 的跨成本/环境证据衰减统一仍待接线 |
| 08 | 校准机制已实现，效果未验证 | 原信号冻结、成熟标签生产采集、不可回写档案、预算绑定及独立存证待接；净结算标签待原账本适配 |
| 09 | 已有待整合 | strategy-health-monitor、factor-health、factor-marginal-contribution、factor-redundancy；统一同股票池成本体检待完成 |
| 10 | 已有待增强 | observed-market-regime、sector-h5-market-regime-stress；按趋势/震荡/修复/退潮独立样本表现待验证 |
| 12 | 已有待增强 | factor-model-comparison 原配对 IC 和影子审批；同成本真实成交增益及风险边界未验证 |
| 13 | 依赖待整合 | intelligence-execution-validation 已核对原结算成本与 T+1；统一权益和市场行业仓位/执行归因未完成 |
| 21 | 合同增量，待全链扫描 | 原 probability-contract 保留；全页面/报告/通知接线未验收 |
| 24 | 已有待整合 | factor-redundancy 与 factor-marginal-contribution 原训练/验证/留出证据，不自动删除原因子 |
| 25 | 回放分割缺陷修复 | 原 factor-global-trial-budget 继续使用；本次独立校准 CLI 尚未接预算，严禁晋级 |
| 26 | 纸面估算门禁增强 | 原 historical-session 与 unadjusted 价基复用，尚需完整回归及现场逐笔 |
| 28 | 审批规则原样保留 | 候选自动研究仍无审批权限；正式变更继续走原五关及人工批准 |

## 验证

本地 Node v22.16.0：新概率模块 node --check 与五项隔离 node --test tests/probability-reliability.test.js 通过；CLI node --check 通过。合成测试只验证逻辑。其他代码修复及原全量、HTTP、/ 与 /m 依赖 PR CI，本报告不声称其通过；没有完整源码克隆和运行环境。真实成熟样本 0（本次工作环境取得），策略收益/有效性/概率认证均未验证。合并必须先看精确 HEAD 全量回归与受影响检查，另进行生产冷备和现场核验。

## 增量二：原研究报告接线

07/09：原 unified-strategy-project 将同一股票池交易日与行情审核传入 strategy-health-monitor。按两个 20 日窗口，中间隔离 2 个交易日（本回放标签为第二个交易日开盘），排除末尾未成熟两日。每窗至少 20 笔估算、10 个有效信号日和 80% 规则观察覆盖，按信号日等权，最近为负且变化不高于 -1 个百分点时提出纸面表现复核。不声称统计显著性，行情不足、样本不足分别返回未知，实际成本、因子、环境、执行偏差未同范围关联时不认证策略衰减。该阈值为保守研究默认值，不是生产阈值。

13：原 intelligence-execution-validation 各成本情景追加 attribution，从已经校验的原结算凭据拆分实际价格盈亏、原费用、净盈亏、勾稽残差；另列假设追加费用/滑点压力结果。不重新记账。缺连续权益、指数/行业、仓位、委托和时间证据时相应归因为 null。接口供风险组读取，不能当作账户收益。

新增 tests/fayo-research-diagnosis.test.js 供原 CI 执行。提交前用同一纯函数体在隔离 JS 运行时执行 8 个逻辑断言，全部通过；不是 Node 全量测试，也不是真实市场研究。上述新增接线尚需精确 HEAD 的 CI 与现场证据核验。
