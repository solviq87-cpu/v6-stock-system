# 后台互斥、模拟盘报价消费与断线恢复增量

基线：`dev@e986fccf4282c3f5ccefa22c9f98372eadf74e68`（已含 #208、#209）。
执行分支：`integration/runtime-quote-recovery-20261114`；任务 V6-001 / V6-002 / V6-006。

## 实际缺口及修复

1. `server.js / guard` 原来在 15 分钟后放行第二个同名任务，原任务并未取消；旧任务结束还会释放第二个任务的锁。现在直到原 Promise 完成或拒绝才释放，超时首次告警。不同任务仍可并行，手动与定时同名调用仍共用互斥。持续不返回的任务不会自行复制执行，需检查上游超时或安全重启。
2. `paperPxFresh`、`paperAuthorityQuotes` 原来允许部分缺接收时间/明确使用权限的全 A 行，价格专用缓存也能参与收益峰值与风险 marks。现在两处消费统一调用现有 `quoteUseEligibility`，复核同一原始行的来源、权限、原报价时刻、接收时刻、15 秒及中国自然日；只读/模拟/导入/停牌等不合格行不能参与自动决策和权威风险 marks。
3. 桌面应用 SSE 重连原来只更新连接徽章，不补读断线期间的共享状态；过期连接的错误和旧重试计时器还能干扰新连接。现在每次连接成功读取现有共享快照，旧连接/旧重试回调不能替换新连接，联网恢复即时刷新。

`paperPrices()` 仍保留历史价格用于显示估值，不是交易授权接口。只有通过统一门禁的原始报价行才能提高收益峰值、参与实时决策或权威风控 marks。没有完整成交字段的行仍不能借用另一行情行的量、昨收或状态。现有历史账本的读取、指纹和旧证据格式兼容保留；本批没有回写账户历史。

## 复现与验证

- 基线新增反例：报价/任务 10 项中 8 失败，SSE 5 项中 4 失败。修复后包含既有报价、账本字段、双端刷新等专项 66 项全部通过。
- 本机 Node 24.22.1、6000 行合成报价，运行原 `ingestPx + paperAuthorityQuotes`，预热 2 次后 7 次中位：基线 101.35ms、候选 93.06ms。各轮均产生 6000 条报价；仅作无明显退化的本机检查，非生产性能认证。
- 第一轮完整回归 3370 项：3359 通过、8 失败、3 跳过。8 项集中在两个旧测试文件，仍把缺接收时点/权限的报价视为可以新成交。已将正常夹具补成完整证据，把缺失证据改为原子拒绝，并保留历史格式可读、未知逐字段时点、账户指纹和不借用字段的原断言。
- 最终完整回归：3370 项，3367 通过、0 失败、0 取消、3 跳过；TAP 完整性验证成功。3 个可选 LightGBM/XGBoost 依赖本地缺失，不冒称通过。
- `npm run check`、66 项专项、网页构建与 40 项测试、`dist` 一致性、独立完整服务 HTTP 启动通过；服务冒烟没有读取私有配置或对外发请求。
- 20 项归档工具、运行时依赖禁入、工作流检查、14 数据源登记、发布结构预检通过。结构预检不是生产批准。
- 旧 `_test_timer_guard.js` 17/17；旧 `_test_logic_audit.js` 为 101/102，其 `sectors` 正则断言失败在精确基线独立 worktree 同样复现，本批未降低该断言。
- 本机 Chromium 启动因 `socket() failed: Operation not permitted` 被环境限制，未完成本地浏览器验收。CI 增加真实 HTTP/SSE 双独立浏览器上下文 1440/390 检查，覆盖断网、另一端持续更新、恢复后补读、重复 online、关闭一端；同时保留现有 9 视口及其他浏览器检查，须以精确 PR head 的结果为准。

复现命令（仓库根）：

```bash
npm run check
RUNNER_TEMP=/tmp V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node --test V6_BO/tests/paper-use-consistency.test.js V6_BO/tests/runtime-task-guard.test.js V6_BO/tests/stream-recovery.test.js V6_BO/tests/paper-field-provenance.test.js V6_BO/tests/market-consumer-contract.test.js V6_BO/tests/paper-authority-quote-time.test.js V6_BO/tests/paper-coherent-row.test.js V6_BO/tests/paper-original-quote-time.test.js V6_BO/tests/cloud-dual-device-refresh.test.js
npm --prefix V6_WEB run build
npm --prefix V6_WEB test
node V6_BO/tests/full-server-isolated-smoke.js
V6_UI_BROWSER=/path/to/chromium node V6_BO/scripts/ui-stream-recovery-browser-check.js
```

## PR #210 续接验收（2026-11-14）

接续 `f182ae6d1fbe8da1626d52e57b90f79bb7973d0a`，业务代码不再修改；
`23c13b980edbc7328a1251edb32cd4c4c69c1bb4` 仅为新闻浏览器失败补充候选、待核/排除理由、
行情版本和时钟诊断，不放宽任何断言或安全门禁。未重复实现其他活动分支的证据卡/来源映射。

- 原 head 的完整 CI `43556832593` 为 3370/3370、0失败/跳过；浏览器 `43556832594` 的9视口、研究36、双端HTTP/SSE通过，但新闻用例390px在撤稿后得到空候选，1440px通过。保留该失败，不宣称已定位或修复根因。
- 诊断 head `23c13b9` 的完整 CI `43557848164` 成功；浏览器 `43557848131` 两次执行均成功，静态交互10/10，仍需保留间歇失败的诊断以便再次发生时定位。复测成功不是生产行情或iOS真机认证。
- 本轮隔离检出重新运行66项报价/账本/SSE专项、131项新闻/新鲜度/静态构建专项、网页40项、网页构建与dist一致性、完整服务隔离HTTP启动，均通过。
- 本轮首次本地全量：3370项，3363通过、4失败、3跳过。4项是测试私有发布目录放在Git祖先路径下，被既有运行时防篡改门禁拒绝；使用已记录命令的 `RUNNER_TEMP=/tmp` 后，该组13/13，完整重跑3367通过、0失败、3跳过，TAP完整性通过。没有降低发布器路径/权限校验。
- 本机Node24.22.1；可选LightGBM/XGBoost依赖缺失的3项保持跳过。Chromium仍被本机socket权限限制，浏览器结论仅来自上述GitHub运行。
- 两张锁定主页blob仍为下述原值。未部署、未改变发布owner、未发送消息、未回写账本。最终合并提交与合并后CI以PR #210最新回执为准。

## 浏览器时钟缺陷复现与修复

`9e3e4c1` 完整CI `43558365551` 成功，但浏览器 `43558365549` 再次失败：同源请求间隔与新闻直接/间接风险状态断言未通过，已暂停合并。此前两次成功不作为消除间歇问题的证据。

定位到固定测试驱动Playwright 1.56.1的上游模拟时钟倒退缺陷（[官方问题 #37700](https://github.com/microsoft/playwright/issues/37700)、[官方修复 #37820](https://github.com/microsoft/playwright/pull/37820)）。新增 `scripts/verify-browser-clock.js` 直接加载实际安装驱动的时钟实现，以可控native计时跨越fake timer边界复现，无需浏览器或行情请求：

- 1.56.1：先观察1000510，再观察1000100，确定性倒退，脚本退出1。
- 1.57.0：先观察1000010，再观察1000100，单调前进，脚本退出0。

工作流固定驱动改为1.57.0，并在所有浏览器检查之前执行该离线门禁。保留同源1050ms最低间隔、15秒报价门禁、新闻排除/撤稿恢复断言和所有视口；增加失败上下文，没有修改业务源码来适配测试。此证据证明旧驱动时钟缺陷，浏览器症状是否全部消除仍须修复后精确head运行确认。

```bash
# 分别指向隔离安装的 playwright@1.56.1 / playwright@1.57.0
NODE_PATH=/path/to/driver/node_modules node V6_BO/scripts/verify-browser-clock.js
bash scripts/check-github-workflows.sh
```

本脚本有意依赖已固定Playwright内部生成时钟模块：将来升级若路径/API变化应明确失败并评审，不能静默跳过。GitHub工作流精确head结果及合并回执见PR #210；未执行生产发布。

## 保留范围与交付边界

- 锁定主页 Git blob：电脑 `9e2fad468cb3e192df0ca2b9184babb2add8c4de`、手机 `084e36d950f9bf4c3508aa1a5cb8986799b6079e`，均未变。未重构科技风 UI、删除原策略、移植旧草稿页面或重复开发接口。
- 最新开放 UI 草稿 #4、#166、#169 仍待逐项评审，不直接合入其旧代码。此次没有找到可直接恢复的上轮未推送补丁；按当前 dev 真实缺口复现后增量修复，不把聊天历史测试数当本批证据。
- 未部署完整后端、未发送真实消息、未开启实盘/购买服务；未改变唯一 managed-task 发布者。WorkBuddy 单 HTML 静态托管不能执行本批 Node 后台，仓库合并不表示后台已上线。
- 持久化后台快照的整体恢复、策略成绩单的真实前向样本、目标 Windows/手机真机、长期盘中行情与跨机灾备仍需继续验收，未关闭原 24 项现场台账。
- 回滚：标准 revert 本批修复/合并提交，保留私有账户、历史证据、发布事务与配置。无需迁移或回写账本。
