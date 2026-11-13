# A5 中央治理判断冻结补充

基线 `7ef3d560bdcc3a1b02fe17eae6f07ccc4a37ae26`。本批只记录实际 `govTake` 已计算的判断，不改四策略、模型计算、排序、门槛、额度、冷却或放行结果；未进行合并、部署、供应商访问、真实通知或生产账户操作。

## 已记录的范围

`govTake` 返回并在可扩展候选上保存冻结的 `governanceEvidence`，包含原质量刻度及 kind、实际融合值及 kind、事件目标和实际经验样本数据、有效 MP、D5 的 `up3Next` 事件底线及样本门、force 质量门豁免、EV 原返回结果及实际已计算的费后值/有效门槛、占位前总量/逐票次数/同模块标志/冷却时点/额度，以及当次 `allow`、结构化原因和原拒绝文案。普通/强势的有效额度单独保存；原配置 0 表示不限时，实际 `Infinity` 保存为 `quota:null,quotaUnlimited:true`。

采证不另调 `fusedProb`、MP、EV、quota 或角色评估器。某个早退分支后尚未执行的 gate 保持 `null`；EV 无统计、无有效桶和不显著分别标识，不为取得门槛再计算一次。`govFilter` 的比较排序仍沿原路径执行，不将排序阶段的值冒充放行阶段的融合值。

对象身份由 `WeakMap` 保留，故 sealed/non-extensible 候选仍能从实际返回值及学习入口取得同一次 trace。可信 trace 使用进程内 `WeakSet` 标记；学习入口核对实际候选身份，归档入口再核对 code、类型（含四类 tick 的原别名）、实际评估时点和采集边界。`govFilter` 每次处理候选前清理上轮 trace，缺评分的早退不会继承旧的 allowed 判断。该状态不作为额外选择或放行条件。

## 实际调用顺序与时间

sector/pool/trend/bigmoney/bigmoney-B/similar 的实际通知候选先经 `govFilter→govTake`，其后才执行 `learningSignalExtra→logSignal→captureProductionSignal`。pre/buzhang 的直调同样在登记学习观察前治理。tick 的实际顺序为 `govTake→logSignal` 的独立 observation，再冻结 trigger 并入队；不会向已落盘的首次样本或旧 trigger 回填后来决定。

tick 的 `a.ts` 来自扫描开始，治理决定可能发生在该时点之后。本批保留原 `triggerAt`，新增 schema 2 的可选 `capturedAt`，表示本次证据封装开始的实际时点，而非消息送达或磁盘写入完成。`governanceEvidence.phase` 明示 `reservation-review`；`reviewedAt` 为原行审核时点（不可扩展行无该字段时保持 null），`stateAt` 为原冷却/占位计算所用的 `now`，`evaluatedAt` 为该次决定封装时点。允许 `triggerAt < evaluatedAt <= capturedAt`，不把后来判断改写成扫描开始已知的条件。新闻仍按原 `triggerAt` 保留因果截止，不使用较晚 `capturedAt` 选取新闻。

## 兼容、边界与持久性

`governanceEvidence` 为 schema 2 可选字段，最多16KiB，类型/代码/时点不匹配或超限时明确 unavailable；无该字段及无 `capturedAt` 的旧档案保持原字节和哈希可读，不做迁移。实际新增 trace 始终 `status:partial`，嵌套模型/EV 内部和生产者/发送全链仍列为缺项；归档保留 `INCOMPLETE_GOVERNANCE_RULES`。它不把13类生产者的条件 coverage 升格为 complete，也不认证行情、概率或收益。

scope 仅为 `central-governance-reservation`。后续 trim、`govRelease` 或发送失败不得改写该决定，实际发送仍属于 receipt/pushlog。拒绝 trace 会返回并可挂在候选上；原拒绝路径未执行 `logSignal` 时，本批不会新建持久信号档案，不能声称所有拒绝都有持久审计。模块日额度等外围门、原有模块空占行为未展开或改动。auczt/aucres/ztsent/yier/lianban 等未走 `govTake` 的路径保持缺失/unknown；持续大单 repeat 由独立 `takeRepeat` 判断，其新类型不会冒用首条 fastin trace。

通过既有私有 signal journal 写入，深冻结、内容哈希、不可覆盖发布及重启回放约束继续适用。占位退回和下一次观察均不改变旧文件。证据字段未混入学习样本统计，首日样本的学习时点和去重政策保留。

## 验证与回滚

新增专项直接运行真实源函数：23组边界在相同 fixture 下与上述精确基线比较返回行为、计数、写入和 evaluator 调用次数，另覆盖真实 EV 的普通/普跌门、D5 事件和等值/薄样本、三种 force 通道、排序、quota/cooldown、sealed 行、缺评分复用、类型/对象身份、真实 tick 的前进时钟、不可变档案、release、重启和旧 schema 2 固定样本。旧样本 fixture 由基线 `signal-evidence-chain.js` 生成，保留原指纹。

复现命令（在仓库根运行，输出目录只用于测试材料）：

```sh
git show 7ef3d560bdcc3a1b02fe17eae6f07ccc4a37ae26:V6_BO/server.js > /workspace/next-output/governance-baseline-server.js
V6_TEST_GOVERNANCE_BASELINE_PATH=/workspace/next-output/governance-baseline-server.js V6_GOVERNANCE_REPORT_PATH=/workspace/next-output/governance-before-after.json node --test --test-reporter=tap V6_BO/tests/governance-signal-evidence.test.js
```

本分支10个定向文件共91 tests、0 fail/skip，结果以 `/workspace/next-output/governance-final-targeted.tap` 的完整 TAP 结尾为准；同时运行既有证据/生产门禁/概率目标/条件采证/私有 HTTP 重启回放及仪表盘回执隐私测试。HTTP 服务在临时副本启动，使用合成访问记录并禁止 http/https/fetch 外发。未运行全量，由主集成统一执行；真实来源持续采样、真实送达和真机验收未执行。初次专项两项因 VM fixture 缺真实 helper 失败，补入 `govReleaseAll` 和 `reviewSnapshotFields` 后重跑，未更改业务代码规避测试。

回滚仅 revert 本独立提交并保留私有档案目录；旧读取器按原 schema 2 哈希读取新增可选字段，不删除新旧证据或统计。两张锁定主页的 Git Blob 保持原值。
