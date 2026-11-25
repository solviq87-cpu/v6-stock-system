# 绯曜 FAYO 独立集成暂停快照（WIP，未完成验收）

用户要求暂停后续开发，本文件只保存暂停时已经存在的集成成果和半成品。本分支不作为发布候选，不推送 `dev`，不进行最终合并、生产部署或真实通知。后续是否恢复工作由新总管聊天「绯曜 FAYO｜总管与最终交付」统一安排。

## 固定输入与范围

工作分支：`integration/fayo-validation-20261126`。基线为 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。本次暂停前最后一个本地集成提交为 `e35163a652e8374997a7bfc419e9a9834b73acfe`；包含本文件和半成品的 WIP 提交由 Git 历史及交接清单另行确定，不使用自引用提交号。

以下精确输入已纳入本地历史，不表示已经合入 `dev`，也不表示所有功能交付完成：

| PR | 本批纳入的精确 head |
| --- | --- |
| #353 | `c3c26519b005db219265c5b9b5718d8d053d8928` |
| #356 | `ba4f2703715e58e676c62decbbe521731d073703` |
| #357 | `03d314dcec9c528d7fc46fe21c5a11939dc015d8` |
| #358 | `1c5675e70fc48c1666894b5e17c6d6961660ba16` |
| #359 | `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f` |
| #360 | `aecebd190075269cb5af588afc9ace4819954558` |
| #361 | `5ea32ac70a753ecf6880757630d219c05c2417df` |
| #362 | `a72f953c93e25a8a26ac784ecd7b68eaa7d71465` |
| #364 | `11cfd240afc4c542a268243ca8028dc87d0fc16d` |
| #365 | `4c9f41509fe1ef6be089c61ae85e4ccdcbd5fbd9` |

明确未纳入：

- 风险四级状态补丁 #366：`0dbd214a21ec60c1d8d1062ab66d034ec0ef00e5`，依赖 #359。其独立验证结果属于该补丁，不能作为本分支组合通过的证据。暂停后没有合并或应用。
- 质量与固定变异补丁：依赖 #361，暂停时尚未收到最终可合入 SHA；本分支没有这套新代码。
- #363：已知快照 `d2b9b428f35e07bbe7cc6d6f5411d3a79e385d49`，原组仍修复已知反例，本批未纳入。不因此删除其原 67—78 项或改变负责人。
- 暂停后其他组新增提交：不自动追随，须由总管重新确定验证输入。

## 已处理的实际冲突

1. 共享浏览器 workflow 保留全部组的真实检查入口，移除会令必需状态永远不产生的路径过滤，保留 #364 对堆叠 PR 目标分支的覆盖。本树共有 15 个 FAYO 浏览器脚本入口；这不等于 15 个浏览器任务已经在本树实际通过。
2. 原生页面、导航和 SW 保留风险、研究证据、回放及 evolution 资源。隔离应用版本为 `20261126ab`，前端修订 `integration-audit-20261126-2`，缓存后缀 `integration-audit-2`。保留精确浏览器版本断言；这些标识不是生产发布版本。
3. `paper-application-service.js` 保留 #356 的原对账、持久防御、CAS 审批、只读服务、统一待买预算与原服务自动预览；同时保留 #361/#365 的 15 秒原报价和只读报价阻断。
4. `publish(next, previousRevision, validateBeforeWrite)` 透传最终自动报价校验：JSON 序列化之后核验一次，并通过 #364 的 `atomicWrite(..., {beforeRename})` 在临时文件写入、fsync、close 之后、原账本替换之前再次核验。无校验器时传 `undefined`，不会把 `null` 当函数调用。
5. #357/#358 在研究档案和 worker 的冲突按功能合并：保留新事件种类、evolution/evidence/view 入口，以及原写入锁内、磁盘 I/O 后的授权复核。没有用旧版整文件覆盖其他组入口。
6. #360 的 warmup 反例与 #357 修正同属测试夹具问题，保留 #360 对真实 EMA 差异的断言；没有把它改成算法优化或效果提升。
7. 原各组 HANDOFF/DEPLOYMENT 历史记录保留，不能把其中不同提交的单组结果或旧负责人称谓当成本次最终状态。后续合并重新引入了第二个 `CURRENT_CHECKPOINT_END`；暂停时仅登记，未再修改或重新运行上下文检查。

## 已保存但未完成的防御接线

对应原账户风险与恢复边界，不新增任务编号或平行风险规则。

- `V6_BO/src/core/account-safety-risk-evidence.js` 是尚未接线的只读投影模块。它复用 `reconcileAccountSnapshot` 与 `defensiveStatus`，从同一原账本的 revision/fingerprint 分别记录对账与防御状态，不创建账本、订单或授权。
- 拟提供稳定根因 `account/reconciliation`、`account/defensive-control`。只有原防御事件 `open`、`approved=true`、原回执哈希匹配，且同一账本 `newExposureAllowed=true`，才提供解除证据。亏损数字恢复、内部一致或读取成功不能替代审批。
- 本模块尚未接入 `risk-workbench-runtime.js`、`risk-workbench.js` 和通知发送前复核；电脑和手机当前均不能依赖它。原执行门禁已经阻止的动作，不会因该模块存在就自动显示正确。
- `V6_BO/tests/risk-workbench-account-safety-integration.test.js` 保存了隔离原服务反例和后续验收草稿。亏损拒单触发原防御锁存，但 workbench 缺少对应风险行的反例已经失败复现。完整文件尚未通过；暂停时只完成其中三项投影测试，不宣称整个文件通过。
- 尚待验证的接口链包括：同一次账本读取绑定、亏损恢复后仍阻断、明确审批后解除、重启与缺失时保留原风险、原卖出/T+1 不被一刀切封禁，以及排队提醒发送前重新核验原防御回执。

## 暂停前实际验证

这些是隔离输入或静态验证，均不构成生产运行认证。命令输出保留在交接证据目录 `audit-inputs/integration-v2/`，巨大日志不并入仓库。

| 验证 | 已取得的实际结果 | 适用限制 |
| --- | --- | --- |
| 初轮 `npm run check` | 退出 0，73 个原生模块；14 项 required checks 与当时 14 个浏览器脚本实接 | 早于最新 #356/#357/#364/#365，不能证明暂停快照通过 |
| 初轮 7 文件关键回归 | 60/60 通过、0 失败/跳过 | 包含原自动提交、账户对账、防御、warmup、缓存与门禁 |
| 最新 9 文件关键回归 | 86/86 通过、0 失败/跳过，退出 0 | 在 `e35163a6` 组合后执行；尚未包含风险/质量补丁或新防御接线 |
| 防御缺行反例 | 1 项失败，实际 `undefined`，期望 `active` | 原服务已锁存，workbench 未接入；失败按事实保留 |
| 新投影三项测试 | 3/3 通过、0 失败，退出 0 | 仅同账本预算限制、缺失/无审批/损坏回执、审批后仍受对账限制；不是 runtime 验收 |
| 暂停时已启动的 `npm run check` | 结果未确认；只取得启动日志，进程会话随后不可查询，没有最终退出回执 | 不记为成功；按暂停要求未重跑 |
| 最终完整回归、完整服务、最终双端浏览器 | 未执行 | 原计划等待风险/质量补丁齐备后统一执行，现已暂停 |

最新 86 项命令：

```sh
node --test V6_BO/tests/automatic-paper-commit-quote-time.test.js V6_BO/tests/account-safety-state.test.js V6_BO/tests/pending-buy-budget-consistency.test.js V6_BO/tests/automatic-entry-preview.test.js V6_BO/tests/private-risk-escalation-identity.test.js V6_BO/tests/private-risk-journal-monitor.test.js V6_BO/tests/fayo-integration-gates.test.js V6_BO/tests/commit-check-triggers.test.js V6_BO/tests/fayo-intelligence-evolution.test.js
```

新投影三项命令：

```sh
node --test --test-name-pattern='same-snapshot|missing controls|previously approved' V6_BO/tests/risk-workbench-account-safety-integration.test.js
```

## 交付与恢复边界

本次只保存源码和本地 Git 历史；源码快照不是现场私有卷备份。未操作生产节点、权限、主副角色或真实通知。四策略、原账户及权威账本仍由原链路负责。122 条来源登记中候选保持未接通、授权未知、无持续观察证明。

5、20、60 个交易日观察、真实部署、冷备恢复、真实送达、最终版本双端一致性及预测效果均未认证。恢复开发时应先复核本文件、最新总管安排和精确输入 SHA，再处理已登记半成品；不得把此次 WIP 保存或 PR 创建当成集成完成。

## 隔离续接候选：原01/02/03/04/05/14/30/49（非最终集成）

在不可变暂停树 `e2eb4130f423a85162939328f3b85beecb659ea6` 上复用 #366 `0dbd214a21ec60c1d8d1062ab66d034ec0ef00e5` 的后端四级状态合同及关联测试；五个依赖文件的原基线 blob 与暂停树一致。新增接线从一次原账户快照计算安全风险，核对权威快照和内部账本指纹、账户及权益版本；同一风险工作台展示防御和对账根因，原提醒队列发送前复验当前原防御回执及对账指纹。新增坏指纹、迟到投递及断连反例。原账本、执行门禁、权限和通知发送者不改变。

当前为隔离代码候选。当前环境无法直接 clone 私有仓库，未执行本地完整 Node 回归。以原 GitHub CI 核对实际结果；专项命令 `node --test V6_BO/tests/risk-workbench-account-safety-integration.test.js V6_BO/tests/risk-state-contract.test.js V6_BO/tests/risk-alert-lifecycle.test.js V6_BO/tests/risk-workbench-runtime-notifications.test.js`。#359 最新 `ed3c3da` 与 #366 前端及其他差异仍须按段合并；#356/#353/#358 等最新交接未全纳入。不得作为最终集成或生产版本。原执行锁不改、不占用原分支；不合并dev或发布。回退为不采用此隔离候选，旧 refs 全保留。

### 组合浏览器首轮失败后的修复

#368 初始提交 `32ba45a2f150795b10f698e934cead5629c122f4` 的 push/PR visual-geometry 均失败；PR job 139426990736 在 `scripts/fayo-browser-check.js:455` 实际只见“大盘一眼看”“今日机会”两个直接区域。合并风险优先摘要时旧 `home.risk` 被放入折叠的更多研究，改变原三分区布局。本次恢复风险与持仓为首页直接区域，保留独立的优先风险摘要，并使该摘要通栏，避免挤占电脑双列。保留原几何断言及全部既有测试，不降低验收标准。当前修复候选须由精确新 head 的 CI 重新核验；尚未运行本地浏览器，不宣称通过。仍未部署、不修改交易/账本或发布机制。
