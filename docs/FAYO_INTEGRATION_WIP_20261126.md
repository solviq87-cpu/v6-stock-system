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

### 原48/54及共享研究边界续接（验证候选）

初版 #368 完整 CI job 139426991835：5497 项，5491 通过、6 失败、0 跳过；4 项原高级账户 HTTP VM 夹具缺 #353 已存在的治理缓存依赖，2 项研究写入授权错误码/多阶段检查合同不一致。本次保留原生产鉴权并统一映射 WORKSPACE_AUTHORIZATION 与 WORKSPACE_AUTH_REVOKED 为 403，旧锁/权限/最终 fsync 后复验保留；更新夹具明确覆盖早期拒绝、锁内拒绝、fsync 后拒绝及 CAS 冲突，未删除原断言的安全要求。不得将尚未重跑的修复算作通过。

原54：复用封存 2257c9e4b4d4291904a4b5efec7a2cd23b97f9e3。9个原worker文件已核对原基线 blob 与当前 WIP 一致；研究工作区 worker 单独逐段移植预算，保留 evolution/evidence/短线等动作、队列、原授权检查及撤权结果。同步原 helper、专项与封存文档。仍需接入运行状态摘要、后续最新组别代码、最终精确提交CI；不把声明内存额度当RSS、跨主机或CPU硬限额。原48追踪半成品未在本批完成。

### 原06运行就绪与54诊断接线（隔离候选）

依原四组接口合同补 `/api/system/readiness` 编辑者只读、现有 state/mobile 共用私有 `systemReadiness`，双端“更多研究”复用原状态回调。读取原内存行情/原任务实际回执/已存在的风险、计划、历史、反馈、模型状态与共享worker声明预算，固定状态和缺项、原始时点/最近尝试/最后正常回执分列，不将GET记成成功，不泄露原异常、私有路径或账户。未知和停用保留；接收时间不冒充quoteAt；交易权限、全市场覆盖、真实供数授权、外部对账、模型审批、真实送达和生产观察不由本摘要认证。新增专项及既有真实HTTP隔离夹具。复用#356最后20次/200ms协作预演预算，原出入场逻辑不变。原18事件归档、22/23全消费者、20/29其他跨组边界以及48/54剩余现场条件仍待；本次未运行本地完整测试，精确提交CI单独核对。

### 收尾：原布局/研究授权与共享预算争用

上一精确候选 985118ebc12851e38044415a83c065583aab00e7 的 push 完整测试 job 139430301301 实报5507项、5505通过、2失败、0跳过。剩余断言为早期撤权正确阻止目录创建但旧测试仍读取目录，以及旧首页测试仍要求把原风险与持仓藏入研究折叠区，和原真实浏览器三分区验收冲突。本轮改为同时核对三分区、唯一优先风险摘要、无重复持仓区，以及真实worker入队/锁内/磁盘同步后的全部撤权路径，不削减安全边界。另一个实际浏览器 job 139430339499 在真实执行清单首次出现超时，已确认共享worker繁忙可能导致原缓存整分钟不重试；增加固定3次、后台调度内、单调时钟限频的显式繁忙重试和专项。保留未知及原线程预算，不新增定时器、行情请求或交易。浏览器断言不延时、不预热伪造，新增失败诊断；K线零写断言保留并输出意外方法/路径用于定位。上述是精确候选源码更新，尚须新SHA的真实CI回执，不能将旧测试通过数当本批成功数。

### 七维质量与第四份细则的代码/证据整合

将 #367 `2ee7297c62ef043ee29677a33df4e7b544993b89` 相对父补丁的22个新增blob逐项核对，当前组合原路径均不存在，按源blob及文件模式保留；两级package只新增 `quality:audit`、`test:critical-mutations`，原命令未覆盖。保留该组原30指标、显式预登记/分母/关键安全失败合同和四项固定错误注入测试；四个原变异匹配片段在组合代码均唯一。第四清单、67—78增量、官方来源与上游许可、历史验证回执均作为固定输入保留。修改原任务总表及78项审查附表引用，未建立第二份任务总表。当前未实际执行新候选的全量、CLI或四项变异，不继承 #367 结果。质量评价真实输入及原78采样适配、#363/其余最新增量和生产验收仍需完成。

### 原48阶段追踪第一批实接（非全链验收）

恢复 `44f731cd1a2e4fcec38af4cf086a0abdc17654d5` 的原追踪辅助及封存记录；未以旧server/账户文件覆盖当前组合。补 ALREADY_RUNNING 白名单、全局容量拒绝时保留原独立研究 stages、掉落跨度不误标外围、链接不可变、无效时钟不造耗时。接入既有研究工作区阶段和原账户 checkRisk/mutate/publish 观察，新增待买预算、原 validateBeforeWrite、最终原子落盘、权限与原事务不变。新增同步/异步、并发、容量、错误/脱敏、原阶段兼容专项。当前为源码候选，未执行新SHA的专项/全量，不宣称通过或任务48完成。后续仍须接原tick/pool根、真实因子/策略阶段、worker跨线程汇合、原通知排队/合并/回执与编辑身份诊断展示；不能由本进程只读trace推断未观察环节、真实送达或端到端延迟。

### CI 回读：运行就绪度 HTTP 夹具修复

此前 ee418db856ba900f4013da3bbb5a93f526c8f7b4 的 PR verify job 139432007473 报5513项、5510通过、3失败、0跳过，其中两项为此前已处理的首页/撤权测试，新增一项是高级账户真实HTTP测试文件的转义拼接语法错误（第76行）；按同文件已有的正确私有目录转义断言修复，仅修测试语法，不修改鉴权、账户行为或隐私断言。最新组合CI须另核，未将历史通过数认定为最终验收。

### 学习页签的真实浏览器零写边界修复

f40fd081 的真实 Chromium job 139433630084、139433579905 实际记录切换学习验证页签时自动 POST `/api/research/public-factors`（原 auto:true）。本轮将被动展示改为自动读取现有原始观察（已有GET/缓存），保留用户主动“计算公开因子”按钮及完整原研究 POST 逻辑，不自动提交导入数据或占用计算worker。真实浏览器原零POST断言完整保留，额外确认原计算按钮仍可用；尚需当前精确SHA复验。此前 bcf90ff8 全量实报5537项，5536通过、1失败、0跳过，唯一失败为已修的 HTTP 测试语法错误，不认定为最终通过。

### 原67—78组合接线（第一批）

从 #363 `d2b9b428f35e07bbe7cc6d6f5411d3a79e385d49` 纳入经树差异核对的无冲突源码、测试和证据，原head独立33项检查通过，但当前组合结果待验证。现有server、研究worker、研究档案、原风险页、账户及SW按原有接口合并；锁内上下文校验（含幂等重试）与原提交前、锁内、fsync后权限检查共同保留。运行采样读取pool/pre的实际原对账结果，不以读取成功冒充对账。下一批继续修复失败样本的原窗口、release worker共享预算与相关专项；本候选不得部署，最终验证未完成。

### 原77/78运行与预算后续接线

原主实例安装和日历合格时，失败采集尝试固定进入真实验收窗口；不计入有效行情日，不能以随后成功日覆盖或删去失败。隔离、回放、未认证安装、无运行日历仍不开始真实窗口。原账户对账使用pool/pre的原对账结果。release-provenance使用既有共享后台worker准入（96MiB V8老生代声明），保留独立风险槽，不增线程/发布入口。新增失败首日、隔离失败和共享预算专项，尚须精确head验证。外部对账、授权、实盘收益、双端真实终端、生产部署、5/20/60交易日均不认证。


### 2026-11-26 统一接续：#353 实际封存时点门禁（原07/08/09/10/12/13/21/24/25/26/28组内增量）

- 组合基线 `ffd80165d28a5ae3716f62dca6c913d2e6111531` 的 33 项现有检查均成功，7 个工作流成功，包括 [V6 CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45680827310)、[UI geometry](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45680827233)、[Windows](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45680827147)。这些属于旧组合精确SHA，不是78项真实验收。
- #353 已明确暂停交接，最新 `e6b411bca1ff605a159cdbc8b86c1a65b9f269fa` 29项检查成功。三个文件在当前组合与其父 `c3c26519b005db219265c5b9b5718d8d053d8928` 的原blob及文件模式完全一致；直接纳入原组的精确源码、边界测试、完整交接记录，不覆盖共享文件的其他组成果。实际风险评审及回执不得早于候选实际封存 closedAt，而不是仅早于计划标签截止；保留原五关、人工审批、未来时点拒绝及原模型版本。新测试覆盖延迟封存、相等边界、未来时间及无状态改写。独立CI: [#353 verify](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45674249280)。
- 现有自动执行环境有 Git 2.47.3、Node v22.16.0、Python 3.13.5，但未挂载继承的仓库，`git ls-remote https://github.com/solviq87-cpu/v6-stock-system.git refs/heads/dev` 实际失败：Could not resolve host: github.com。仅通过 GitHub 对象接口恢复精确增量，未执行本地专项或全量；当前新组合必须核查独立CI。专项命令：`node --test V6_BO/tests/fayo-model-governance-integration.test.js`。恢复继承工作区后以新组合SHA checkout，运行原 npm check、全量及双端浏览器。
- #356 最新预演 helper/专项测试已与组合blob完全一致，勿重复移植。#357/#358/#359/#361 的最新差异仍须逐文件核对、不能整文件覆盖共享风险/行情/权限。#364已关闭，原beforeRename与#365保护保留并复核；18/20/22/23/29/48及78真实采样等剩余按原编号继续。当前dev仍为 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，无主线合并或生产发布；外部数据、真实运行、账户及设备验收未知，保持原唯一发布者。回退本批只需在候选上反向应用这三个文件及交接增量，不删除任何业务数据或改旧组分支。

## 2026-11-26 · 原27及11新闻证据接续（隔离候选，非整组完成）
- 父提交 `0f6aa4b4377b09314a601068e3700b2373d3e425`；输入 #358 `0d9ce25d1cc1927fccbac01ad7c384cb77d41c38`，原已接入版本 `1c5675e70fc48c1666894b5e17c6d6961660ba16`。只移植本批对应改动，不把#358其余增量标记已集成。保留原78编号及四份补充要求。
- 原工作区缺失、直接Git下载DNS失败；从精确父提交成功的Windows CI run 45684089130下载artifact 15055901133，内层ZIP SHA256 `92b1dc87f3ca3dbab63a9fda3d9a299db3bc181523b26fe046a0cc4e606e5386`，manifest sourceSha等于父提交，CRC及1340条SHA256SUMS核对通过，隔离提取1312个payload文件。无原完整测试目录或私人凭据，不执行安装器或生产服务。
- 原server blob `7da971c94d279e8d07a3b0feb748485dbf4d8ebb`；按#358共享server四个实际业务hunk合并（保留隔离版本），本地实测及提交的组合blob均为 `f6c0a81d4706545ef7d3045a8d44ac21d4ce3ca2`。holdings及0929原夹具按输入blob直接采用。自动跟随用原新闻证据权威复核，不以缓存标题、未知或失效新闻授权推荐；撤稿/修订不再错误使用旧证据，持仓风险保留原价格门禁、T+1及权限；不改原账户提交服务或发布者。
- 实际在隔离V6_BO目录执行：`node --check server.js`、`node --check holdings.js` 均退出0；`TZ=Asia/Shanghai node --test tests/fayo-evidence-continuation-authority.test.js` 7通过/0失败/0跳过；`TZ=Asia/Shanghai node _test_fix0929.js` 18断言通过/0失败。后两者不是25个node测试用例，不折算78项完成率。测试原样使用临时目录、合成输入与模拟发送器，无真实消息、账户或生产写入。
- 同步#358两个原测试夹具 fayo-news-action-boundary 和 paper-coherent-row 的精确blob，尚未在本地执行这两个文件；由新提交CI验证，不能沿用源分支绿灯。其余#358回放、模型、后续计划、双端及#357/#359/#361和#366前端等增量继续逐文件接线；原18/20/22/23/29/48和78采样等缺口保留。尚未运行本地全量和双端；最终dev精确SHA、真实5/20/60日及外部授权/数据/生产验收待核，不声称完成或部署。
- 恢复：使用上述原CI包和精确Git blobs重建隔离测试，完整clone恢复后在统一候选精确SHA执行原check、全量与浏览器。需要回退时只反向应用本批候选增量，保留新业务数据及全部原组分支；不新增任务、发布入口或执行锁。

## 2026-11-26 · #358剩余业务与双端增量（原11/15/16/17/19/27）
- 父提交 `66cd8768d75ae7a6667d8df7bfdcb552c1700e7e`，源 `0d9ce25d1cc1927fccbac01ad7c384cb77d41c38`，相对旧已接入 `1c5675e70fc48c1666894b5e17c6d6961660ba16`。本批所有直接采用文件在候选父树与旧输入树blob一致（新文件此前不存在），因此不会覆盖其他组改动。保留原组交接与两份机器证据原字节。
- 原新闻版本/证券关联、回放身份和恢复、中文条件单字“或”拒绝、模型五问/引用/缺证据/晚到保护、原纪律后续新计划核对与独立档案降级全部采用原实现；market.js只移植唯一匹配的回放memory参数，保留其他组个股风险入口；server四个业务hunk已在父提交接入。
- 直接纳入的原文件blob：
  - `V6_BO/public/nova/command-selection.mjs` `b3b7924daec943eac3ee31d02d27b53d25c08ac9`
  - `V6_BO/public/nova/evidence-workbench.mjs` `7855a4a0144342e86ff573fd2e43a64000668f0c`
  - `V6_BO/public/nova/research-review.mjs` `5408bf36fd0541b4223af46d1ebe0fad63c33c5d`
  - `V6_BO/scripts/fayo-command-evidence-browser-check.js` `bbac22a044c8fe1cc55cf4a5868658822bc55a5e`
  - `V6_BO/scripts/fayo-replay-boundaries-browser-check.js` `8c31bb1432dc428ae56c291cda5b90736215078b`
  - `V6_BO/scripts/fayo-research-discipline-browser-check.js` `26c5548dc382a766908d13dea12b781b75e067b8`
  - `V6_BO/src/core/research-interaction-workbench.js` `ab59b24be86fbab2913c543fb06064771228d4d4`
  - `V6_BO/tests/fayo-evidence-continuation-backend.test.js` `a104837adce56373fca113c2287d24470f73262f`
  - `V6_BO/tests/fayo-evidence-continuation-client.test.mjs` `edf49426fdee4036395cc17b207ec187d405a597`
  - `V6_BO/tests/fayo-nextplan-checks.test.js` `e036ad532c7adae298d5d17b5defbb0beebd8ad7`
  - `docs/FAYO_66_INTEGRATION_STATUS_20261126.md` `d61921435312134a1f53ca0c32d5f3a97ad32e19`
  - `docs/FAYO_EVIDENCE_WORKBENCH_20261126.md` `313c975ac72ca3e79a34e192a486c33c8db0e608`
  - `docs/validation/fayo-evidence-20261126/cross-pr-audit.json` `e517f437ff7feee6a8ff9ecd6c8c54ca401f2deb`
  - `docs/validation/fayo-evidence-20261126/handoff-validation.json` `873ccfdebea0fdc10f7090f19ec0ebdc7be7f5d8`
  - `V6_BO/public/nova/market.js` `348fab038f9e1a52b8e3c070eeb4817533fbcdf2`
- 只保留原隔离组合版本标识、SW缓存和对应版本断言（源分支的独立版本号变更不移植），发布版本待最终统一；所有新增实际浏览器断言保留，不改CI workflow。前一批本地7项和18断言证据仅适用该批，不声称本批本地测试或全量已跑。源分支精确head原CI/UI均成功，源独立证据不认证组合。新组合必须按新精确SHA运行CI、全量、浏览器及后续真实验收。
- 五维相似样本仍须与#357同标的同信号同档案版本绑定，#353结算证据、#356/#359风险合同、#361/#364/#365报价与通知保护及#363/#366增量继续保留；原18/20/22/23/29/48/78等缺口不因此关闭。真实运行、权限、源数据、物理设备及连续交易日验收未知。回退仅反向本批候选文件，保留原组分支、已有数据与原发布入口。
