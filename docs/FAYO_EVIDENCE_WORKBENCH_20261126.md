# FAYO 第四组研究证据工作台（2026-11-26）

## 基线、范围与交付状态

- 唯一主线：`solviq87-cpu/v6-stock-system` 的 `dev`；本轮核验基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，最新合并为 #352。
- 原分工：11、15、16、17、19、27。独立分支 `feat/fayo-evidence-workbench-20261126-complete`，目标 PR [#358](https://github.com/solviq87-cpu/v6-stock-system/pull/358) → `dev`。
- 开发中复核发现 #355 已关闭，由 #358 接续。保留 #358 原提交 `70be46b5d5e05c02f9d2fe353df072c62f065ef4` 的完整有效成果；本轮只补缺陷、边界与验收，没有把旧候选的另一套模板或回放实现移入。
- 本轮版本：`20261126ab`；电脑 `/`、手机 `/m` 同源入口修订 `evidence-20261126-2`，SW 后缀 `evidence-workbench-2`。历史恢复页面保持原字节。
- 本组代码验收与六组合并验收分开记录。最终集成仍由第一组负责；生产冷备、真实数据覆盖、现场性能及最终合并 SHA 的验证尚待完成。

统一任务与跨组依赖见 [66 项集成状态清单](FAYO_66_INTEGRATION_STATUS_20261126.md)。清单逐项指向原组任务文档和 PR；未取得原任务书或实际证据的编号保持待核验，不凭排除法认定完成。

## 六项任务与实际代码证据

以下路径相对 `V6_BO/`；“已接线”表示本候选具备代码与隔离验证，不代表已经生产验收。

| 原编号 | 本候选已接线的行为 | 主要代码 | 主要测试与剩余边界 |
|---|---|---|---|
| 11 | 复用原新闻私有哈希链，按 `asOf/offset` 分页，保留原文、修订、关联变化、来源与首次可知时间；提取原文中的主体、金额、日期和事件线索，并联系同证券研究、计划及持仓证据 | `src/core/news-evidence-journal.js`；`public/nova/event-research.mjs`、`research.js`；`server.js` 原新闻路由 | `news-evidence-http.test.js`、原新闻测试、回放专项；摘要不冒充正文，来源域名不等于独立认证，真实公告覆盖与主体/行业认证待实际档案 |
| 15 | 同日个股、板块、指数与新闻、研究、计划、风险、成交时间轴；股票详情、研究记录和新闻页复用同组件；不同指数或方法版本断开连线；320px 原图保持约220px高 | `src/core/research-interaction-workbench.js` 的 `dailySeries/newsMarkers/readReplay`；`src/core/paper-execution-report-store.js`；`public/nova/evidence-workbench.mjs` | `fayo-replay-boundaries.test.js`、原日报/工作台测试、三尺寸真实浏览器；缺分钟或同窗口证据保持缺失，生产覆盖与延迟待验证 |
| 16 | 原确定性中文语法、条件卡、范围解释及候选池筛选；服务器私有 CAS 模板跨端读回；应用模板不自动查询，版本冲突保留输入；编辑时立即废弃旧结果 | `public/nova/command-selection.mjs`；`research-interaction-workbench.js` 的 `readTemplates/saveTemplate`；原 workspace store/worker | `fayo-evidence-workbench.test.js`、`research-workspace-http.test.js`、共享模板浏览器；全市场范围未接通时明确拒绝，不以候选池冒充全市场 |
| 17 | 支持依据、反证、缺项、失效条件、历史分组五问共用原封存规则；模型只有明确配置及显式操作才调用，检查真实模型 ID、引用与回执后授权，失败保留规则结果 | `public/nova/research-review.mjs`、`research-records.js`、`evidence-workbench.mjs`；`research-interaction-workbench.js` 的 `similarSamples/explain` | `fayo-research-discipline-boundaries.test.js` 与研究浏览器；#357 五维相似样本适配仍为 `pending-integration`，原条件分组不是个股胜率，真实模型质量待验 |
| 19 | 只读原模拟结算、冻结计划、原持久日报及本人日志；核对账户、指纹、版本、事件引用和时点；后续处理只追踪同一计划、同一规则版本 | `research-interaction-workbench.js` 的 `paperBinding/manualBinding/reportDisciplineRows/readDiscipline/followups`；`evidence-workbench.mjs` | 原账户服务→原结算导入→复盘投影的真实模块链测试；原日报与双端浏览器；缺完整权益、盘中可成交窗口或豁免证据时未知，不以亏损归因策略错误 |
| 27 | 删除标题标签对分数、概率估计与正面推送阈值的捷径；正面标题不能把原止损、减仓、回撤、退出降成持有；停牌只读明确报价字段 | `server.js` 原策略与推送函数；`holdings.js` 原持仓判断 | `fayo-news-action-boundary.test.js`、原 `_test_auction.js`、`_test_fix0929.js`；原负面风险、报价质量、锁定、T+1、账户和执行门禁保留 |

## 本轮缺陷修复及原架构复用

### 提交时授权与原持久化

原 workspace POST 在 worker 启动后可能继续完成设置、研究或预测写入。本轮通过原 worker 的 SharedArrayBuffer 授权握手，将 `beforeCommit` 传给原 `appendEvent`：创建私有目录前、原锁内校验后、临时文件 fsync 后发布不可变事件前均重新取得主线程授权。拒绝时删除暂存文件，返回 `WORKSPACE_AUTHORIZATION/403`。成功与失败诊断也经过同一检查；预测封存再次核对实际时间没有跨越冻结截止点。

原接口调用不传 `beforeCommit` 时保持原同步行为。副本 workspace 写入在 HTTP 入口即拒绝；返回私有异步结果前再次检查编辑权限。模板提交复用同一原 append/CAS，未新增账户状态、现金、持仓或交易账本。

最后一次主线程授权与 worker 的原子发布之间仍存在极短的在途提交边界；该授权是当前提交的线性化许可，不能宣称已实现全系统跨进程、跨主机的原子撤权。最终角色切换的全局串行化和跨主机单写者仍由集成组核对。#356 原锁升级的组合实测与部署限制见统一清单。

### 证据身份、时间和计算口径

- 新闻发生时间取原发布或修订时间，首次可知时间取原归档时间；历史读取验证整条链，包括截点以后的链损坏，不能只验证被展示的前缀。
- 回放点保留证券/指数代码、供应商、收益口径、板块分类或指数方法版本与 `seriesIdentity`。不同身份不连线；板块缺自身来源时不借用个股供应商。
- 原日报的只读 `snapshots` 单次验证版本链，保留成交、风险首次出现在日报中的时间；后续版本重复或省略证据不重写首次可知时间。
- 原模拟结算指纹使用导入器原有的 `SHA256(JSON.stringify(payload))`；本人日志和 workspace 仍使用各自原 canonical JSON 合同。不同原合同不能混用同一个摘要函数。
- 规则解释拒绝重复条件/证据 ID、重复引用、缺版本、证据标有 `missingReason`，以及晚于研究截点的原始/覆盖/接收/可用时间；缺少判断理由的文字说明单独显示未知，不冒充已有解释。失效条件的文字说明与“此刻已经失效”分开，后者无证据时未知。
- 纪律行保留 `planVersion/ruleVersion/reportVersion` 和原成交/观察 ID。较新的资料不足或不适用状态不会被更早的“符合”覆盖；不同计划的好结果不能证明旧问题已改善。

## 公共接口合同

### 原研究证据工作台

`/api/research/evidence-workbench` 复用原授权编辑者 Bearer 会话，响应 `private, no-store`；GET 不创建目录或写研究/账户记录。POST 还需原主实例、同源及在途提交/返回前复查。未知或重复字段、超限正文、无效时点均拒绝。

| 方法 | 请求 | 语义与副作用 |
|---|---|---|
| GET | `mode=templates` | 当前原模板、revision 和 recordedAt；只读 |
| GET | `mode=model-status` | 明确配置状态与模型 ID；不调用模型 |
| GET | `mode=replay&symbol=600000&asOf=<Unix毫秒>&window=7|14|30[&runId=<hash>][&board=<code>]` | 截点前原封存证据；不回填今日行情，不交易 |
| GET | `mode=similar&symbol=...&runId=...&asOf=...` | 同版本、条件签名、市场分组和来源的原前向评测描述；原五维相似引擎适配未完成时明确标记 |
| GET | `mode=discipline[&symbol=...][&asOf=...]` | 原结算、本人日志和最近60日内最多20份原执行日报；最多500行及300条跟踪，不生成第二份权威纪律记录 |
| POST | `action=save-template, raw, requestId, expectedRevision` | 原确定性解析，最多160字、50个模板；CAS追加私有研究配置，冲突不覆盖 |
| POST | `action=explain, symbol, runId, asOf, question` | `support/opposition/missing/invalidation/history`；明确调用可选本地模型，只有研究输出 |

统一能力标志保留 `researchOnly:true`、`canTrade:false`、`canNotify:false`、`accountMutated:false`、`productionWeightsChanged:false`。这些是该工作台的能力边界，不改变原系统其他已授权流程。

### 向后兼容的原接口扩展

- 原新闻 GET 增加 `asOf/offset`；未传时仍走原调用。首次和后续分页都核对实际请求截点，未来时间、重复参数和错误类型拒绝。
- `createPaperExecutionReportStore(...).snapshots({day, asOf, limit=20})` 返回 `{day, asOf, total, complete, versions}`，`limit` 为1–128。回放显式读取128版上限，只读复用原 `reports()` 完整校验，不另建目录或报告格式。
- `appendEvent(..., {beforeCommit})`、`saveSettings(..., {beforeCommit})`、`reviewStored(..., {beforeCommit})`、`saveModelForecast(..., {beforeCommit})` 为可选附加合同；现有不传回调的原调用保持兼容。

### #357 相似样本依赖

本组当前条件分组周期为1/5/20/60日；#357 原短线五维相似样本为1/3/5/10日。不能重命名为同一统计。正式消费前须绑定同一证券、原信号时点、workspace runId、短线 target、档案 revision/指纹，并明确将 Unix 毫秒转换为原短线时点。当前响应中 `similarCases.status='pending-integration'`，没有另建相似度算法。

## 私有目录、可选模型与恢复

模板目录沿用 #358：原 `V6_RESEARCH_WORKSPACE_DIR` 同级目录名加 `-interactions`，默认 `data/research-workspace-interactions`。与原 workspace、预测封存、新闻档案、短线档案、执行日报和本人日志一起纳入原私有卷冷备；不复制到公开静态产物。

只有明确设置 `V6_RESEARCH_EXPLAIN_ENABLE_LOCAL=1` 和合法的 `V6_RESEARCH_EXPLAIN_MODEL` 才启用原单模型适配器。地址固定 `127.0.0.1:11434`；12秒、64KiB响应上限、禁止重定向；核对实际返回完整模型 ID。只传类型化状态、数值和序号引用，不传账户、新闻原文或自由文本。未配置、无可用事实、调用失败、引用无效或撤权都保留原规则解释。测试使用隔离适配器，不等于真实模型已部署或效果合格。

切换前按 `DEPLOYMENT.md` 停止原写者，备份完整程序、`data/durable`、外部私有卷、设备授权、原权威账本和上述研究目录，核对 SHA-256 及流水。用同一精确 SHA 完整更新 `V6_BO`，不能只换前端。若集成 #356 锁升级，必须停止全部旧、新写者，禁止混跑锁协议或运行时删除稳定 `.guard`。

失败先停新写者，保全升级后的成交、研究、预测、日报、模板及日志，再核对增量后回切完整旧程序与原卷；不能用旧账本覆盖新增成交或重放通知。保存的 Git bundle 只用于源码恢复，不替代生产数据冷备；已关闭 #355 的本地候选检查点 `a2662404d17742e1c889b3d693d31d2898def20a` 不作为部署版本。

## 验证记录

本地 Node `24.22.3`；原 CI 使用 Node22，最终须读取新提交的实际 CI，不沿用 #358 旧 head 的30项成功。测试数据均为隔离、明确标记的合成档案，不作为行情、收益、概率、生产成交或真实模型效果。

实际完整回归命令（仓库根目录）：

```bash
RUNNER_TEMP=/tmp \
V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
npm test
```

首轮未指定 `RUNNER_TEMP`，5045项中5037通过、4失败、4跳过。4个失败均来自原 `managed-publisher-runtime` 测试的临时目录：本环境 `/var/tmp` 指向 `/tmp`，原发布安全校验正确拒绝符号链接祖先。未修改或放宽该生产校验；使用测试既有 `RUNNER_TEMP=/tmp` 入口后，该专项13/13通过。一次因会话中断未结束的重跑不计作验收；下表只记录最终完整退出、通过TAP完整性检查的一轮。

| 验证 | 本轮实际结果 |
|---|---|
| `npm run check` | 通过；71个原生前端模块语法检查 |
| 最终 `npm test` 与 TAP 完整性 | 5045项：5041通过、0失败、0取消、4跳过，退出0，TAP完整性通过。跳过为原PowerShell实机包装器、五模型可选组合、LightGBM和XGBoost可选依赖；这些环境能力未认证 |
| `tests/full-server-isolated-smoke.js` | 完整服务、原生入口/版本、业务映射、恢复资产、404、真实拒绝/登录、副本启动及出站隔离均通过 |
| workspace撤权与原锁组合 | 本分支授权专项18项通过；临时 #356+#358 合并树叠加本轮4个授权模块与测试，原锁/账户/事务/账本联合45/45通过，0跳过；详见统一清单 |
| 原工作台/日报与回放边界 | 26/26通过，0跳过；包含首次可知、后来省略、截点后损坏、只读不建目录及板块原来源 |
| 原账户导入、纪律版本与模型引用边界 | 新增7/7通过；实际原账户服务、结算导入与只读投影，无测试替换权威结算逻辑 |
| 标题与交易判断边界 | 新增4/4通过；直接运行原函数，验证标题不提分、不放宽风险、不触发写入或推送 |
| 原 `_test_auction.js` / `_test_fix0929.js` | 均退出0；后者18通过、0失败，保留原T+1/停牌场景，新增标题不降级风险断言 |
| 原 FAYO 双端完整浏览器 | 8场景通过：320/390/402/768/1366/1920六视口及390只读、新登录；533次隔离HTTP、504次静态读取、46张截图；0横向溢出、0重复ID/iframe/旧shell、无应用异常或外网请求 |
| 共享模板真实服务浏览器 | 1366/390通过；同服务器跨端revision读回、陈旧CAS拒绝且保留输入、编辑条件后旧结果失效；无交易/通知，0横向溢出或页面错误 |
| 回放真实档案浏览器 | 320/390/1440px通过，图高220px；27次原档案GET；0横向溢出、0页面错误、0外网请求；实读版本20261126ab/evidence-20261126-2 |
| 研究五问/纪律及原业务浏览器 | 五问/纪律1366/390通过；模型显式调用、引用、失败/晚到回退与只读身份覆盖。原decision/execution/operations/source-review四脚本均退出0，决策和执行报告确认原账本未变 |
| `npm run audit:password` | 通过；原密码状态路由与前端无明文回显 |

浏览器入口复用已提交的原 workflow，并增加 `fayo-command-evidence-browser-check.js`、`fayo-replay-boundaries-browser-check.js`、`fayo-research-discipline-browser-check.js`。实际截图、JSON报告及原始日志只作本次验收产物，不随源码 PR 上传大量附件。集成时保留其他组所有浏览器脚本和环境变量。

## 尚未完成的依赖与最终验收门槛

1. #357 五维相似样本与本组研究截点的正式适配；#353 策略治理和 #359 统一风险的同身份消费。缺少绑定证据继续未知。
2. 第一组实际 PR 与剩余原任务编号的证据核验；当前66项清单不是全部完成声明。五组候选顺序、文本冲突及语义冲突见统一清单，最终顺序须加入第一组实际改动后复核。
3. 所有组在最新 `dev` 集成后的全量回归、接口、电脑/手机浏览器、安全、权限、账户及原账本一致性验证。本组单独结果或局部组合45项不能替代这一门槛。
4. 真实公告/分钟/板块/指数与成交档案覆盖、目标设备联通、现场耗时与生产冷备恢复回执；可选真实语言模型的配置、回执和质量验证。

本轮未切换生产、未采购服务、未发送真实通知、未开通实盘或更改账户权限。上述外部依赖不能用合成档案或测试数量替代。
