# V6 因子自主学习第二阶段：稳定性、市场状态与独立保留测试（2026-11-10）

## 本阶段新增的智能判断
上一版 shadow evolution（PR #58）可通过冻结因子、五交易日成熟结果及样本外检验，自动提出研究权重和不可覆盖版本，但训练主要参考**整个训练段的平均 Spearman IC**，可能被短暂好运气或行情环境切换误导。

本次在原有只读研究沙盒内新增 **factor-learning-reliability** 门禁，不修改任何正式15个因子、原四套策略、账户、行情采集和电脑/手机主页。

- **因子持续性判断**：记录每因子已成熟交易日数、平均/中位数 IC、训练前后半段 IC、同方向出现比例；要求至少15个独立训练日、平均绝对IC不少于0.03、每日同向比例至少60%，最近半段仍保持相同方向且绝对均值不少于0.05。不是简单“某个月涨得多就升权”。
- **证据置信收缩**：同一因子即使达标，研究权重更新会根据有效天数、方向稳定度和最近表现自动缩小；旧的每轮最多±8%、相对正式权重50%～150%的硬边界不变。短期IC反转、样本不足和无效时间戳使权重变化等于零。
- **市场状态留痕**：冻结因子时可选输入既有 market-shock-learning-gate 所认可的同日指数及市场广度数据。只在信号出现前已有足够证据时记录 systemic-selloff 或 not-systemic-selloff；缺数据一律 unknown。训练期如果两个市场环境各已有至少8个样本日，但该因子在两种环境下出现方向相反的明显IC（两边绝对平均IC至少0.08），阻止对它自动调权。未提供市场状态仍可做基础学习，但不声称已完成环境泛化验证。
- **不同时间段验证**：新旧模型除了已有验证和测试整体平均 IC 均需提升，还要求同一验证段和测试段的前、后两半段表现均未出现明显恶化。任一半段表现恶化超过0.001，保持已有研究权重不自动升级。
- **新证据才重新升级**：一旦某版研究模型已经通过验证，下一次进化所依赖的保留测试必须有**至少5个比旧版最后研究日更晚的、全新成熟观察日**。不能重复在看过的旧保留集上调参宣称再获样本外提升。
- **历史血缘保护**：新版本需要复用旧模型曾经消费过的冻结因子指纹及观察快照指纹。若历史冻结数据被替换或改写，拒绝自动继续，不用新报告悄悄覆盖旧证据。现有训练、验证和测试之间也由只看最后一天完成日的边界检查加强为**逐日**未来收益观察截止检查。

## 运行方式
与上一版完全一致：
- 一次性：npm run factor:shadow:once -- /private/factor-manifest.json /private/models
- 定期：npm run factor:shadow:watch -- /private/factor-manifest.json /private/models --interval 60000
- 人工单次：npm run factor:shadow -- evolve /private/manifest.json /private/new-report.json [/private/previous-accepted.json]

冻结特征的输入新增可选 **marketContext**（保留既有市场冲击门禁 schemaVersion=1、source=imported、tradeDate、指数涨跌、上涨家数广度、observedAt、coverage 的原协议），只以**信号当时时点**调用门禁，不用未来的市场行情去标注历史信号。没有该字段时保存 unknown，不追补旧记录或强制改写历史。

沙盒研究模型会新增 factorLearning[factorId] 的 meanIC / recentMeanIC / directionConsistencyPct / assessedRegimes / confidence / reasons / suggestedWeightMultiplier 等解释字段，并显示验证与新鲜保留测试的分段稳定性。任何研究参数仍不被正式V6策略消费；不能下单、自动改变账户或模拟成交。

## 科学与运维限制
- 当日宏观环境和报告中 source=imported、SHA256指纹是**协议与一致性声明**，不是独立验证的数据源或交易所认证。
- 此统计使用未复权五日价格变化的 Spearman 横截面秩相关，不包含申购可成交性、交易费、滑点、市场基准、行业及市值中性化和多重试验控制。训练期样本日可能有相同股票跨日出现，仍有统计相关性；更多严格研究与审计需要后续任务。
- 新方法更保守，意味着真实研究中有可能长时间都**不升版**，这是正确结果，不应为让数字增长而降低门槛。
- 有旧版报告时，可能需要至少额外五个成熟交易日才能获得下一次独立保留测试。任何原始观察内容变更都应人工审计、创建新的研究链，而不是覆盖旧模型。
- 尚未部署 WorkBuddy 自动研究进程，也未完成真实授权因子生产者或手机Safari现场验收。

## 验收
    node --test tests/factor-learning-reliability.test.js tests/factor-shadow-evolution.test.js
    npm run check
    npm test

无因子调整的场景必须返回保留/暂停，不允许误报“模型已经更智能地赚钱”。
