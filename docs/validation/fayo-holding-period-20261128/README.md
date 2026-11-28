# 固定期限原回测：原引擎复用与实际消费（候选，未发布）

父源 `dc713d00ba543748c9e62fcb0237bc9774fc5b77`，上一隔离组合 `0cb21c6f7cdb7eccd126d611f909ce0ef30e2a07`，总管dev `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`。按最新指令组织三大批：F01—F18的100项、F19—F37的76项、F38—F50的52项；这是F任务归档口径，原历史任务、合同、大陆自主运行、效率及最终UI另按原分母贯穿，不改原编号或责任人。本增量跨前两批复用同一研究流程，不能当任何一大批已完成。

## 本轮九项关联处置

|任务|实际处置及消费者|仍未证明或恢复条件|
|---|---|---|
|F12.1 统一竞技场|保留上批原四体系接线；原HTTP同时启用四体系与多期限时两项独立输出，旧结果保持|本次期限来自原混合研究扫描器，不代表原四体系或全部策略族完成竞技；不合并排名|
|F12.3 分期限评价|新增薄适配，预先列明1/3/5/10/20日持有参数，原回测工作台实际调用原runValidatedBacktest；相同默认期限直接复用|局部接线，非最优持有期、独立净优势或正式准入；止损/受阻使实际持有时间不同|
|F12.4 综合评价|复用原费用后净值、回撤、订单、平仓及未平仓记录，原结果完整下载；无买入不评价，未全平仓不填成熟账户收益|尾部损失、容量、真实滑点、统计与经济价值未认证，保留待验|
|F20.1 净收益目标|复用原手续费、卖出税费、滑点及退出约束，按期限单列账户估值与全部平仓后的纸面变化|没有新增收益预测器；原估算不是实际成交净收益，未成交和未知不填标签；保留待验|
|F32.1 收益路径|复用每期限原逐日净值、现金流、订单、退出与未平仓轨迹，完整导出而非仅保留最末收益|不是MFE/MAE预测或最高点成交证明，未补分钟路径；保留待验|
|F32.2 多期限匹配|同一数据及公共配置指纹分开运行固定期限；原分割指标各自保留，界面明确目标与实际退出的区别|局部研究消费；没有按事后最高收益选择期限，不自动学习或改策略|
|F32.3 路径标签|分层，继续原收盘排队/下一开盘成交的可复现模型，不新增日K内三重障碍成交推断|原数据不足以确定日K高低先后；三重障碍/删失需独立预注册及合格路径数据，不把未实现写成失败或已完成|
|F35.1 选择偏差|计算前形成固定参数协议快照，五个结果完整保留；失败/超额保留attempts，全部比较不可用而非选择局部赢家|这不是原独立试验登记和留出批准；trialBudgetVerified、independentHoldoutCertified均false，原研究登记链待接|
|F48.4 决策复现|数据、共同参数、各期限完整结果分别绑定指纹；离线原函数、HTTP worker、UI下载同结果；精确代码由native回执及Git版本另绑|不是所有在线decisionId/撤权消费者都已贯通；原局部状态不升级为完整签收|

F12.3、F32.2取得新增局部证据；其余只更新已有处置或复用证据。全量状态由统一台账派生，不能按上表行数算新增完成。

## 计算及预算合同

`holding-period-comparison.js`只是原回测适配器。原historical-validation、research-v2-position-ledger-backtest、position-ledger-backtest、费用、独立入场风险与原四体系引擎均逐字节未改，见`original-engine-unchanged.json`。默认完整实验不计算多期限；显式`includeHoldingPeriodComparison:true`复用基准结果，常见默认只运行五次，非预设默认最多六次。原30秒worker、单飞及任务公共预算保持。

原数据/参数验证、未复权门禁、T+1、费用、停牌/限价、现金守恒、原止损/容量/组合风险完整保留。固定期限各自有现金与持仓轨迹，后续入场集合可能不同，不能称作同一信号队列的条件收益因果比较。公式与原结果逐项相同，没有新权威账户、成交算法或生产风险参数。

总计算量按证券×K线×原回测次数（有splitDay时计三段）限定60000单位；完整交互证据40000行。超过预算保留原单期限结果，将整个比较标不可用，不截取盈利期限、交易或估值。部分期限失败保留已尝试和失败原因，不输出可选择的半份成绩。大任务沿原`node scripts/validate-history.js input.json report.json`按明确单一期限离线研究。这里的单位只是程序配额，不等于CPU或秒级性能测量。

## 数据及实际验证

复用上批归档新浪600000未复权120根日K、原接收时点与原始字节指纹 `897cc0471978459dca8f1f2d0f191fd9c77ad7a4d76f0b30e0f2ab6b645b1bf3`。输入仍在`../fayo-strategy-comparison-20261128/history.json`及原source-receipt.json；没有新请求或重采。此前原解码器回执绑定未变化代码，不重复验证解析器。新适配在内核禁网下逐期限与原函数完整结果一致。

真实归档在五个期限均无买入、无平仓、93个原逐日估值点；原现金未动不当作0收益赢家。证券/公司行为/因子/历史股票池及持续许可未独立认证，不能倒填因子或冒充前向运行。原扫描器的空结果不能外推全市场没有机会。

- 新增11项协议/界面检查；相关32项、内核禁网32项及原静态检查通过。正向费用/T+1/平仓和未平仓使用隔离合成选择器，真实原财务引擎执行；不将测试夹具收益当真实策略成绩。
- 原鉴权服务5项控制：默认不计算、显式可用、只读拒绝、非法开关拒绝、原四体系同时启用仍独立一致。原HTTP200业务拒绝语义不变，检查ok/readOnly/result，200不表示授权。
- 实际Chromium1366/390/320分别上传原档案、点击入口、读取原state后结果保持、完整表格横向可访问、协议展开及实际下载通过；五个原报告各93估值点与空订单完整保留。真实软件截图不是AI效果图；受控时钟、空账户与浏览器视口不是实际手机、实盘或大陆线路验收。
- 源全量及精确提交CI、最终组合全量和浏览器另绑最终版本，见full-summary.json及后续验收包，不移用旧绿灯。

## 复现及回退

在V6_BO复用已有依赖：

```sh
node --test tests/holding-period-comparison.test.js tests/holding-period-view.test.js tests/historical-validation-integration.test.js tests/historical-validation-merge-hardening.test.js tests/position-ledger-backtest.test.js tests/strategy-comparison-protocol.test.js tests/strategy-comparison-view.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-period-offline python tests/helpers/deny-network-connect.py node ../docs/validation/fayo-holding-period-20261128/offline.cjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-period-ui node ../docs/validation/fayo-holding-period-20261128/native.cjs
npm run check
npm test
```

Python为已有Playwright环境，Chromium为`/usr/bin/chromium`。回退只回代码及兼容配置，不覆盖新账本或研究历史。无新增服务、模型、采集、通知、权威账本、外部API或依赖。生产发布及正式用途审批沿原唯一机制。
