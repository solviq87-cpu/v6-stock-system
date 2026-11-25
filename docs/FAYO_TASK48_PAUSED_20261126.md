# 任务 48 工作草稿封存：已暂停，未验收

2026-11-26，用户要求本聊天保存已完成与做到一半的成果，再暂停全部后续开发，余项由其选定的统一接续聊天承担。本文件仅记录封存状态，不增加开发任务或发布入口。

- 本组原范围：37—42、48—58，共 17 项；主交接 PR 为 [#356](https://github.com/solviq87-cpu/v6-stock-system/pull/356)。本分支仅保全任务 48 的未完成增量。
- 分支：`fix/fayo-trace-continuation-20261126`。
- 开发起点：`fd3caeeef55b1cad63be14764a47e11a695c0b2e`；dev 基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。
- 原交付分支已有后续修复 `ba4f2703715e58e676c62decbbe521731d073703`，本工作草稿未包含这些后续修复，不能用本分支整文件覆盖它。
- 保存状态：**未完成工作草稿，不可视为已通过验收、可合并或可发布版本。** 本分支未合入原交付 PR 或 dev。

## 已写入的四个文件

| 文件 | 当前内容 |
| --- | --- |
| `V6_BO/src/core/runtime-trace.js`（新增） | AsyncLocalStorage 关联、有界内存记录、阶段/错误码白名单、版本/有限指纹、同步/异步包装、因子调用聚合计时、对象关联、阶段汇总；worker 传递接口仍为草稿 |
| `V6_BO/src/core/research-workspace.js` | 将原 `trace()` 委托给共享辅助，意图保持原 `stages/syncStage/asyncStage` 接口 |
| `V6_BO/src/core/paper-application-service.js` | 包装原 `checkRisk/mutate/publish` 的内存观测，不新增持久账户或通知路径 |
| `V6_BO/server.js` | 部分 `rebuildPool/tick` 行情、实际因子/评分筛选/候选发布以及跳过/失败标记接线 |

## 尚未完成，恢复后应先处理

1. `rebuildPool/tick` 的任务根上下文和应用/规则/策略版本注入未接；不能宣称阶段已串成完整 trace。
2. 飞书队列、重试、看门狗、`pushPaperDigest` 与合并通知未接；跨延迟队列和多成交来源关联未实现。
3. 原授权 `/api/state`、`sharedMarketRead(edit)` 和双端 `settings/diagnostics` 尚未输出 trace，没有真实 HTTP 验收。
4. `govTake` 没有独立 `risk.notification` span，`markCurrent` 不能替代它。
5. worker 传播接口没有接入 job wrappers，没有合并 worker 观测记录。
6. 真实失败、并发隔离、敏感值脱敏、延迟传播、行为等价与授权 HTTP 专项尚未编写或执行。

已发现的草稿问题：

- server 使用 `ALREADY_RUNNING`，辅助白名单未纳入，原因码会成为 null。
- 共享活动跨度达到上限时，`createStageTrace()` 可能不再向原独立 stages 数组追加阶段，存在兼容性缺口。
- 行情内部原 catch 吞掉的单项失败尚未转换为可靠的部分缺失状态，集合调用完成不代表行情齐备。
- 没有任务根或独立风控跨度时，`markCurrent` 可能没有作用或标记到外围调用者。

## 真实验证记录

第一批 rebuildPool 接线后曾执行 `node --check V6_BO/server.js`，退出 0；之后又写入了 tick/govTake 增量，**该语法结果不覆盖当前最终草稿**。没有对当前草稿执行专项、全量、HTTP 或浏览器验证，不继承主 PR 的绿色结果。暂停后未启动新测试或修复。

没有活动测试进程、主线合并或生产发布事务。业务代码已原样冻结。下一位接续者应先审阅完整增量和上述已知问题，再决定继续实现与验证；不得因存在文件就标记任务 48 完成。生产保持现有唯一发布机制。
