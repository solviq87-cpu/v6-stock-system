# 绯曜 FAYO 补充增强（一）：原账户、组合风险与数据治理接线

## 范围与状态

本组负责 37、38、39、40、41、42、48、49、50、51、52、53、54、55、56、57、58 共 17 项。开发基线与本轮再次 fetch 的 `dev` 均为 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；工作分支 `feat/fayo-advanced-safety-20261126`，交付 [PR #356](https://github.com/solviq87-cpu/v6-stock-system/pull/356)。本次续接前 HEAD 为 `d50395972e9ae693a37e934dab785234c654e250`。

原第一组负责最终集成。本组不合并、不部署、不改发布版本及 SW 缓存号。保留原 `public/nova`、四策略、行情中心、原账户/订单/成交/资金、风险门禁、权限设备和唯一通知路径。此前阶段说明保存在 [阶段一至三](FAYO_ADVANCED_SAFETY_PHASE1_20261126.md)；其环境限制及尚未接线描述是当时记录，下文记录本次实际增量。

## 17 项实现与真实边界

| 任务 | 已进入原运行链路的能力 | 数据条件与不能据此确认的事实 |
| --- | --- | --- |
| 37 资金容量 | 原账户权益倍数、前日原始成交量和金额双约束、原日期费率、明确版本的平方根冲击压力；原风险页展示 | 历史参与率不是未来成交保证；缺量额、原报价或原权益时未知；未接真实盘口 |
| 38 仓位预演 | 仅消费原后台计划及 observer 回执；校验计划/决策 ID、原账户修订/指纹、原报价价格/时点/来源，最多 5 秒；原统一风险政策与有效计划额度、同样本增量风险 | 原回执不构成执行授权；不接受客户端计划或门禁自报，不发单或冻结资金；未分类持仓仍显式保留 |
| 39 退出能力 | 原账户逐批 T+1、待卖冻结、停牌/跌停、原报价及前日量额；估计当日费用与冲击；送转同日可卖批次沿原合同 | 多交易日的完整价格及费用未知；市场容量不保证退出；不以日线替代实时价 |
| 40 防御审批 | 原账户同一快照中持久 `defensiveControl`；限制新增买入/待买成交/认购支出，保留原合规卖出与撤单；原亏损拒绝在同一写锁内锁存；双端预览后明确确认、CAS、审批解除 | 不自动解除；解除必须重新检查原风控、对账及待买委托；不替代原亏损、报价、时钟及仓位门禁 |
| 41 机会成本 | 同资本、同日历史、相同非重叠持有期；原持仓可卖部分对比原计划，包含当前卖出/买入/期末退出费用与冲击、余留现金；报价差最多 1 秒 | 不自动换仓，冻结/T+1 部分不能当作已退出；不足 12 个可比区间保持未知 |
| 42 现金流绩效 | TWR、有唯一有界解的 XIRR、同区间基准、连续权益下 Sharpe/Sortino 及现金流调整回撤；绑定原账户/收益期/修订/指纹 | 当前主服务未取得完整历史权益及每次外部流前后边界，生产默认未知；不从本金、reset、已结算收益或零散采样猜造历史净值 |
| 48 时延观察 | 本组显式风险读取的本进程有界 128 样本 P50/P95；原计划/账户/数据版本引用贯通 | 不代表全系统链路追踪、全站 SLA 或生产五秒时延；全局追踪由第一组统筹 |
| 49 对账与恢复 | 原 read/mutate 校验原订单/成交 ID、金额、批次、费用、公司行为、买卖冻结；新 init/adopt/reset 封存期初，可验证期初至当前数量流；冻结预算异常限制新增、保留可行撤单；结构或流水不一致拒绝读写 | 旧无期初凭据账户保留缺项；不宣称券商/外部银行对账或所有历史现金流水齐备；损坏原账本不自动修写 |
| 50 安全加固 | 原编辑身份、异步撤权复核、主副角色、GET/no-store、只读服务零写入；受限 worker 输入先校验再克隆；审批理由/CAS/服务器 actor；备份路径/权限/加密校验 | `npm audit` 只覆盖声明的 npm 生产依赖，不是全面渗透、OWASP 或第三方认证 |
| 51 时点与修订 | 原历史捕获的原始字节、版本、收到/首次获知/可用/发现修订分别记录；原 `auditCenterInputs` 按 availableAt 截止；后来复核不回填过去可用时点 | 供应商原发布/修订时钟缺失就保留 null；首个已准入值冻结，后续修订保留审计，不静默替换历史 |
| 52 历史证券范围 | 原历史 universe 可携带当时 listing/delisting/ST/停牌/板块状态，历史公司行为和费率按 knownAt/as-of 约束；严格声明 PIT 时不完整则拒绝 | 旧证券主表继续可读但覆盖不认证；没有真实历史退市/ST资料不会补造，不能据此声称消除全市场幸存者偏差 |
| 53 隔离与重放 | 原行情中心在发布前封存原始字节及原门禁决定；失败数据隔离；默认只读预检、审核人/理由/请求 ID/配置与范围哈希绑定后重新跑原门禁 | 重放不能绕过原独立来源要求、完整性或晚到时点，不能修改账户/发通知；源修订冲突只审计不替换首值 |
| 54 资源预算 | 单 worker、不排队、Node Worker `maxOldGenerationSizeMb:128`（仅 V8 老生代）、8 秒截止；限定代码/历史/上下文深度与体积；输入在主线程结构化克隆前检查 | 是本组预算，不替代现有全局 worker/调度治理；超限/超时保留明确未知 |
| 55 迁移发布 | 原格式只读预检、同一账本新增可选证据字段、旧账户兼容；发布与回滚手册明确停写、锁协议及新防御状态兼容 | 本轮没有生产迁移、发布或回切；最终完整包与统一版本由第一组生成/验收 |
| 56 备份演练 | 实际 CLI 复用原账户+审计备份、灾备清单和加密模块；隔离恢复后原服务验账、前后源哈希及实际时长 | 演练只证明列出的隔离输入；没有生产冷备/生产 RPO/RTO，未提供的配置/权限/模型/源证据类别显式缺项 |
| 57 唯一写者 | 原账户与离线事务共用稳定 Linux flock guard；真实多进程死亡恢复、旧或重复释放句柄不能删除新锁，损坏旧标记拒绝自动清理；防御锁存与并发买入在同锁序列化 | 仅同一支持 flock 的卷；不证明跨主机租约栅栏，不允许旧/新锁协议混跑或运行中删除 `.guard` |
| 58 组合尾部风险 | 同日对齐后复权价格场景，日波动/下行/VaR/ES、两段 30 期相关性；逐股/行业/主题的波动、下行、VaR 场景和 ES 贡献可加总 | 后复权价格不是认证总收益或真实账户净值；至少 60 个对齐回报，尾部至少 10 个观测；VaR 是边界场景归因，非连续分布边际 VaR |

## 原接口与存储合同

`GET /api/research/risk-center?advanced=1` 在原 `result` 增加 `advancedAccounts`，不带参数的原返回保留。模式 `advanced-account-risk-readonly`，固定 `canTrade:false`、`writesAccount:false`。`pool/pre` 只读原权威账户；没有账户或历史不创建目录。请求等待期间再验证原编辑权限和实例角色，旧私有结果不回传。

原 `centerEvidenceRuntime.readContext` 缓存本次原计划及实际 `inspectPaperPlanEntry` 结果。请求只取同交易日、连续交易时段、5 秒内回执；worker 从服务器固定 historyRoot 读取相关代码档案，不接受浏览器上传历史或报价。原档案 → 原 `auditCenterInputs` → 原账户 service → worker → 同一个原风险页面。`governance.pool/pre` 分账户呈现，重叠记录不得加总。

原 `POST /api/research/order-account` 增加 `reconcile` 和 `set-defense`，沿用原账户选择和主实例编辑者授权。`set-defense` 必须带 `expectedRevision/state/reason`；解除还需固定 `acknowledge=RELEASE_DEFENSIVE_RESTRICTION`。actor 从原服务端会话派生，客户端不能指定。版本冲突不自动重试，页面要求重读后核对。错误使用实际 HTTP 400，方法错误 405。防御事件只改变同一原快照的控制元数据，不生成订单、成交或通知。

`reconciliationOpening`、`defensiveControl` 是原账户 schema 1 的可选增量，没有第二份现金/持仓状态。新账户/采用原旧账户/重置时封存合法期初；原有未封存账户可以读取，并明确缺少期初数量流凭据。原结构、成交、批次或控制链损坏时拒绝读取及写入；买卖冻结预算异常时限制新增，合法撤单可恢复预算。原亏损拒绝的限制事件在原账户锁内从磁盘重读未提交快照后写入，不会把失败的批量金融操作一起提交。

数据治理沿原中心目录保存捕获/原始证据/复核，不平行建立行情库。历史首值冻结与多版本审计分开；归档可用时间与事件发生时间独立，晚到资料不能穿越到旧信号日。原始来源不提供的发布时间、修订时间及因子版本不得用本次读取时间或今天的词典补齐。通用 `market-data-center` 的原 sync/failover 已使用新原始证据归档，其 `.asOf/.governance/.replay` 仍为内部 API；下述操作 CLI 只覆盖原中心历史隔离档案，不能描述为覆盖所有通用导入器的操作入口。

## 运维入口（在 V6_BO 下执行）

### 原隔离数据复核

默认命令只读原始字节并重跑原 normalizer/audit，无网络和写入：

```bash
node scripts/review-data-quarantine.js 600000 ORIGINAL_CAPTURE_SHA256
```

真实代码及归档 SHA 取自原隔离记录；示例值不是已存在的资料。原根目录为 `data/intelligence-center-history`，沿用 `V6_CENTER_HISTORY_DIR`。返回 `archiveScopeHash` 和 `instanceConfigHash` 后，在已有运维授权下以真实审核身份、理由和唯一请求 ID 执行：

```bash
node scripts/review-data-quarantine.js 600000 ORIGINAL_CAPTURE_SHA256 \
  --apply-reviewed-replay --reviewer-id REVIEWER_ID \
  --reason '核对原始来源和隔离原因后的具体审核依据' \
  --request-id UNIQUE_REVIEW_REQUEST_ID \
  --expected-scope-hash PREFLIGHT_SCOPE_SHA256 \
  --expected-config-hash PREFLIGHT_CONFIG_SHA256
```

原 `config.json` 的角色必须仍是 primary，原配置与归档范围哈希必须匹配；配置未知/变动、副本或完整性失败会阻断操作。原门禁不通过的数据继续隔离，复核仍可写入 `reviewed-still-quarantined` 回执；部分记录通过时可能为 `partially-admitted`。`ok/applied:true` 只表示复核操作完成，不能当成全部数据准入。不得将 CLI 包成客户端任意目录/审核自报 HTTP。复核不授予交易或通知权限，不替换已冻结首值。

### 私有备份、迁移预检与隔离恢复

```bash
node scripts/advanced-safety-operations.js preflight /private/spec.json
# 由既有私有运行环境注入 V6_BACKUP_PASSWORD 后执行：
node scripts/advanced-safety-operations.js drill /private/spec.json /private/drills/new-isolated-drill
```

口令只从环境读取，至少 16 字符，不能放入仓库、命令回显或报告。spec 使用真实绝对路径：

```json
{
  "schemaVersion": 1,
  "accounts": [{"id": "pool", "file": "/private/source/original-pool.json"}],
  "files": [{"id": "config", "category": "configuration", "file": "/private/source/config.json"}]
}
```

原账户和拒绝审计自动识别，其余类别包括 `configuration/access-control/model-artifact/market-source-evidence/research/cache`。未提供的类别标记 `not-supplied`，不是完整整站备份。单源文件至多 32 MiB，每个账户及审计明文包至多 32 MiB，输入文件合计至多 128 MiB；原账户另受原服务 20 MiB 上限，128 MiB 不是加密输出及恢复临时文件的总磁盘上限。输出必须是所有源目录之外、尚不存在且父目录已存在的独立目录，拒绝符号链接和覆盖。原账户+审计在原锁内一致复制；恢复到隔离目录后由原账户服务检验，核对源文件前后哈希，移除明文临时副本，只留加密包与报告。

本次两个人工输入账户、轮转审计和配置的隔离演练产生三个加密包：备份 185.030 ms、恢复验证 RTO 145.873 ms、保守备份年龄 RPO 185 ms，总计 330.990 ms。报告 `measurements.productionRpoMs/productionRtoMs` 为 null。此数据不能外推到实际数据量、主机损坏、异地恢复或生产节点。

## 验证记录

本节由本轮最终执行结果更新；不沿用阶段一至三或其他 PR 的绿色记录。测试输入隔离、明确标注，生产数据不填示例。

- `npm run check`：69 个原生前端模块语法校验通过。
- 组合链路 26/26；账户/权限/真实 HTTP/worker/锁/备份相关 80/80。全量会再次包含这些测试，不能将专项数字与全量相加。
- 数据治理最终专项 16/16，最后合并相关回归 92/92；原始文件损坏后增长和移除独立来源要求的两项攻击已由独立审查再次复现并确认修复。
- `scripts/fayo-advanced-safety-browser-check.js`：实际 Chromium、1366×900 `/` 和 390×844 `/m` 均通过；报告由原账户、原计划检查器及真实 core 生成。展开、取消无写、审批确认、版本冲突不重试、只读身份零私有读取、终止旧响应、无页面横向溢出均验证；现金/持仓/订单/成交保持原值。
- 真实 server+worker HTTP：原编辑身份/查看角色/匿名、GET 限定、no-store、主副角色、reconcile/set-defense 行为已验证；初次设备登记之后的受保护读取无文件写入和网络外发，缺失目录不被创建。
- `npm audit --omit=dev --audit-level=high --json`：0 个已报告 npm 生产依赖漏洞；限本次声明依赖范围。
- 本地 `V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 V6_MODEL_PYTHON=<本机模型Python> npm test` 完整执行 5070 项，首次结果为 5061 通过、5 失败、0 取消、4 跳过，耗时 584.760 秒。失败来自两类已修复问题：原冻结资金保护提示的兼容差异1项，以及本环境 `/var/tmp` 是符号链接导致的原发布器fixture失败4项。保留原冻结资金中文语义后专项21/21通过；复用 #359 已有的规范化临时父目录补丁后发布器13/13通过，生产路径/权限/完整性拒绝逻辑和负向断言未放宽。
- 本地4项原可选环境跳过分别为 PowerShell wrapper、五类模型比较、LightGBM及XGBoost；没有把跳过记为通过。环境 Node24.22.3，原生Python3.13.5、模型Python3.12.14。最终源码已提交后，由精确 HEAD 的原 GitHub 全量 CI 继续验证；最终是否通过以 [PR #356 Checks](https://github.com/solviq87-cpu/v6-stock-system/pull/356/checks) 对应提交为准，首次本地数字不能当作最终绿色结果。

## 与其他组的最小合并合同

再次读取的远端 `dev` 未变。活动 PR 的审阅快照如下；第一组最终合并前必须再次刷新 HEAD。

| PR | 本次已读 HEAD | 合并关注 |
| --- | --- | --- |
| #353 研究治理 | `301641650c0246d29142b8c9e16165064cfa1f2c` | 共用 `intelligence-research.js`；保留本组 `recordView.availableAt`、audit availability 检查、consensusKnownAt，与该组概率/独立验证并存，不能改写原 observed/source 时钟 |
| #357 智能增强 | `9a1132264a191091ea526cba698177f2b5d0c703` | 历史纸面研究与实际账户绩效分别保留，不能用相似样本收益替代权益净值 |
| #358 研究证据工作台 | `70be46b5d5e05c02f9d2fe353df072c62f065ef4` | 共用 `server.js` 及交接文件；本组 UI 在独立 `advanced-risk-view.js`，原 `research-extensions.js` 只导入并渲染；保留其工作台/日报全部增量 |
| #359 原第一组风险中心 | `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f` | 共用 `server.js` 原 observer 周边及 UI workflow。保留其唯一提醒发送和 riskWorkbenchRuntime，不新增第二个调度或通知方；原 observer 的 readContext 缓存只是只读证据投影 |

#359 的 `account-equity-evidence` 与本组报告均来自原权威账户；集成时以 accountId/收益期/revision/snapshotFingerprint/asOf 校验后复用单一权益证据，不覆盖原统一风险工作台。其已观察权益历史同样没有完整外部流前后边界，不能据此把本组 TWR/XIRR 从未知改成已认证。单标签历史贡献不能替换该组多题材压力去重；不同情景保留各自范围、版本和假设。本组防御状态属于原账户实际约束，第一组应在有效规则/动作展示中消费 `defensiveStatus`，解除仍调用原 `setDefensiveControl`，不另建状态存储。

具体适配还须保留以下区别：

- #359 封存权益先经 `validateEquityEvidence`；同 revision/快照指纹不能证明同一批报价，仍需核对逐股价格、quoteAt、来源与冲突标记。其显示 `positions[].quote` 固定 `canTrade:false`，不能转换成本组执行压力计算的原始合规报价。
- #359 `accountEpoch` 与本组 `original-period-<archives.length>` 不是同一标识，须从同一原 book 验证映射。`status/gaps/truncated` 随已观察回撤一起消费，不能只取非空数值。
- 原 observer 只执行一次；保留本组 `readContext` 回执缓存、原执行清单投影和 #359 `observePlans`。`sendPrivate` 仅保留第一组 `sendPlanAlert` 唯一路由，不能同时保留旧直接发送。本组5秒回执不能用该组一分钟 `plansAt` 或旧观察记录刷新。
- 原回执必须保留 planId/decisionId/maxPositionPct、checkedAt/quoteAt/quotePrice/quoteSource、accountRevision/accountFingerprint、quantity/fee 和原 allowed/reason/scope。高级 GET 不采样权益、不触发 tick 或通知。
- #359 多题材 `themes[]` 和 sourceRefs 保留；本组单标签贡献不取首个题材冒充全分类。其多数 Pct 为0—100，本组权重/回报/尾部风险多为0—1；两个压力版本不得混成已校准阈值。

## 发布与恢复

本轮只提交源码、必要测试和本文等精简交接；不向 PR 上传安装 ZIP、截图、原始日志或私有回执。新增浏览器脚本接入原 `v6-ui-browser.yml`；权限和既有检查均保留。第一组统一 appVer/frontend-revision/SW 缓存并在整合后的精确 SHA 重跑原全量、隔离服务及双端验证。

改前完整 Git bundle 已通过 `git bundle verify`，SHA-256 为 `f414f20f1d5936495ef0069b628e4e8df37f5e60d58de788de62fa221124281f`。它只恢复源码，不是生产数据冷备。本工作区未取得生产私有卷，生产节点、实盘、真实消息、跨主机切换未执行。

未来升级或回滚先停本节点及同卷全部旧/新写者，保全程序、原账户/订单/成交/资金、拒绝审计、设备权限、配置、历史原始字节/隔离/复核、模型研究与外部私有卷，验证哈希和原服务可读。稳定 `.guard` 不得在运行中删除，旧 PID 锁程序不能与新 flock 程序混跑。

**旧程序不理解新增 `defensiveControl`，直接回切并开放写入会丢失新增风险限制。** 回滚须保留控制事件及升级后流水，先在隔离副本核对旧格式兼容，维持停写或等效的既有入口禁用状态，人工核对限制与原门禁后再决定恢复写入。不能删除限制字段、用旧账本覆盖新流水或自动重放历史成交。派生证据损坏保全后单独处理；不以改现金/持仓迎合报告。
