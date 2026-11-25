# 绯曜 FAYO 补充增强（一）：原账户、组合风险与数据治理接线

> **最新状态：2026-11-26用户要求保存后暂停，本聊天已停止后续开发并待命。** 封存分支、精确提交、测试与半成品问题以 [暂停交接](FAYO_ADVANCED_SAFETY_PAUSED_20261126.md) 为准。下文保留实现合同与阶段记录，继续开发安排均被暂停指令覆盖。任务48/54独立草稿未合入主交付，不能计作已运行能力。

## 范围与状态

本组负责 37、38、39、40、41、42、48、49、50、51、52、53、54、55、56、57、58 共 17 项。开发基线与本轮再次 fetch 的 `dev` 均为 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；工作分支 `feat/fayo-advanced-safety-20261126`，交付 [PR #356](https://github.com/solviq87-cpu/v6-stock-system/pull/356)。本次续接前远端 HEAD 为 `fd3caeeef55b1cad63be14764a47e11a695c0b2e`。续接使用独立工作分支 `fix/fayo-advanced-safety-continuation-20261126`，验证后向原交付分支及同一 PR #356 追加提交；不覆盖其他组分支。

用户已于 2026-11-26 将最终集成职责转交新聊天 **“绯曜 FAYO｜总管与最终交付”**。本组继续开发、修复、测试和交接；任务总表、最终代码集成、合并安排、验收和交付跟踪由新总管统一协调。本组不独立合并主线、不部署、不改发布版本及 SW 缓存号。保留原 `public/nova`、四策略、行情中心、原账户/订单/成交/资金、风险门禁、权限设备和唯一通知路径。此前阶段说明保存在 [阶段一至三](FAYO_ADVANCED_SAFETY_PHASE1_20261126.md)；其环境限制及尚未接线描述是当时记录，下文记录本次实际增量。

## 本次续接与新总管交接

- 原任务编号保持 **37、38、39、40、41、42、48、49、50、51、52、53、54、55、56、57、58**，不增加任务编号。
- 交付入口仍为 [PR #356](https://github.com/solviq87-cpu/v6-stock-system/pull/356)，目标 `dev`；准确提交及检查结果以该 PR 当前 HEAD 为准。此前有效代码、测试和历史交接全部保留。
- 本轮已复现并修复跨日费率和部分成交佣金引起的冻结预算分叉、同股不同策略的预演归属、原政策拒绝但预演显示未受阻，以及追加新 K 线时静默改写历史证券/费用/公司行动证据。拒绝路径保全原账户和历史字节，正常撤单与合法新日期追加继续工作。
- 任务 38 已补齐已启用统一风险政策账户的原服务只读预检；任务 54/56 已补齐固定输入的磁盘预算与 RPO/RTO 目标判定。任务 48 的完整关联追踪、54 的跨 worker 共享额度继续在独立隔离分支实现，合入本 PR 后另行验证，不将阶段专项当作完整验收。
- 当前没有本聊天发起的主线合并或生产发布在途。生产发布沿用仓库现有唯一发布者、发布审批、版本与完整读回机制；本次职责调整没有建立新发布入口或新调度器。
- 新总管需协调共享服务入口、原 observer 的唯一调用、原账户防御和风险工作台的同一状态，以及最终版本/缓存。下方接口合同与 PR 矩阵是依赖证据，最终合并顺序由总管刷新各 HEAD 后确定。

## 17 项实现与真实边界

| 任务 | 已进入原运行链路的能力 | 数据条件与不能据此确认的事实 |
| --- | --- | --- |
| 37 资金容量 | 原账户权益倍数、前日原始成交量和金额双约束、原日期费率、明确版本的平方根冲击压力；原风险页展示 | 历史参与率不是未来成交保证；缺量额、原报价或原权益时未知；未接真实盘口 |
| 38 仓位预演 | 仅消费原后台计划及 observer 回执；校验计划/决策 ID、原账户修订/指纹、原报价价格/时点/来源，最多 5 秒；原统一风险政策与有效计划额度、同样本增量风险 | 原回执不构成执行授权；不接受客户端计划或门禁自报，不发单或冻结资金；未分类持仓仍显式保留 |
| 39 退出能力 | 原账户逐批 T+1、待卖冻结、停牌/跌停、原报价及前日量额；估计当日费用与冲击；送转同日可卖批次沿原合同 | 多交易日的完整价格及费用未知；市场容量不保证退出；不以日线替代实时价 |
| 40 防御审批 | 原账户同一快照中持久 `defensiveControl`；限制新增买入/待买成交/认购支出，保留原合规卖出与撤单；原亏损拒绝在同一写锁内锁存；双端预览后明确确认、CAS、审批解除 | 不自动解除；解除必须重新检查原风控、对账及待买委托；不替代原亏损、报价、时钟及仓位门禁 |
| 41 机会成本 | 同资本、同日历史、相同非重叠持有期；原持仓可卖部分对比原计划，包含当前卖出/买入/期末退出费用与冲击、余留现金；报价差最多 1 秒 | 不自动换仓，冻结/T+1 部分不能当作已退出；不足 12 个可比区间保持未知 |
| 42 现金流绩效 | TWR、有唯一有界解的 XIRR、同区间基准、连续权益下 Sharpe/Sortino 及现金流调整回撤；绑定原账户/收益期/修订/指纹 | 当前主服务未取得完整历史权益及每次外部流前后边界，生产默认未知；不从本金、reset、已结算收益或零散采样猜造历史净值 |
| 48 时延观察 | 本组显式风险读取的本进程有界 128 样本 P50/P95；原计划/账户/数据版本引用贯通 | 不代表全系统链路追踪、全站 SLA 或生产五秒时延；全局追踪接线需新总管协调原运行监测组与各阶段负责人 |
| 49 对账与恢复 | 原 read/mutate 校验原订单/成交 ID、金额、批次、费用、公司行为、买卖冻结；新 init/adopt/reset 封存期初，可验证期初至当前数量流；冻结预算异常限制新增、保留可行撤单；结构或流水不一致拒绝读写 | 旧无期初凭据账户保留缺项；不宣称券商/外部银行对账或所有历史现金流水齐备；损坏原账本不自动修写 |
| 50 安全加固 | 原编辑身份、异步撤权复核、主副角色、GET/no-store、只读服务零写入；受限 worker 输入先校验再克隆；审批理由/CAS/服务器 actor；备份路径/权限/加密校验 | `npm audit` 只覆盖声明的 npm 生产依赖，不是全面渗透、OWASP 或第三方认证 |
| 51 时点与修订 | 原历史捕获的原始字节、版本、收到/首次获知/可用/发现修订分别记录；原 `auditCenterInputs` 按 availableAt 截止；后来复核不回填过去可用时点 | 供应商原发布/修订时钟缺失就保留 null；首个已准入值冻结，后续修订保留审计，不静默替换历史 |
| 52 历史证券范围 | 原历史 universe 可携带当时 listing/delisting/ST/停牌/板块状态，历史公司行为和费率按 knownAt/as-of 约束；严格声明 PIT 时不完整则拒绝 | 旧证券主表继续可读但覆盖不认证；没有真实历史退市/ST资料不会补造，不能据此声称消除全市场幸存者偏差 |
| 53 隔离与重放 | 原行情中心在发布前封存原始字节及原门禁决定；失败数据隔离；默认只读预检、审核人/理由/请求 ID/配置与范围哈希绑定后重新跑原门禁 | 重放不能绕过原独立来源要求、完整性或晚到时点，不能修改账户/发通知；源修订冲突只审计不替换首值 |
| 54 资源预算 | 单 worker、不排队、128 MiB V8 老生代、8 秒截止和克隆前输入限额；演练增加磁盘余量预检，捕获尺寸与哈希绑定预检清单，增长或换内容在加密前拒绝 | 本组预算不替代最终系统全部 worker/调度治理；磁盘余量是当时观察值，不是独占预留 |
| 55 迁移发布 | 原格式只读预检、同一账本新增可选证据字段、旧账户兼容；发布与回滚手册明确停写、锁协议及新防御状态兼容 | 本轮没有生产迁移、发布或回切；最终完整包与统一版本由新总管安排生成/验收 |
| 56 备份演练 | 原账户+审计备份、灾备清单和加密模块；原服务验账；显式 RPO/RTO 目标与单调时钟实测分别记录，未达标 CLI 返回 2；固定预检清单防止捕获范围漂移 | 演练只证明列出的隔离输入；未配置目标为未知，没有生产冷备/生产 RPO/RTO，未提供类别仍为缺项 |
| 57 唯一写者 | 原账户与离线事务共用稳定 Linux flock guard；真实多进程死亡恢复、旧或重复释放句柄不能删除新锁，损坏旧标记拒绝自动清理；防御锁存与并发买入在同锁序列化 | 仅同一支持 flock 的卷；不证明跨主机租约栅栏，不允许旧/新锁协议混跑或运行中删除 `.guard` |
| 58 组合尾部风险 | 同日对齐后复权价格场景，日波动/下行/VaR/ES、两段 30 期相关性；逐股/行业/主题的波动、下行、VaR 场景和 ES 贡献可加总 | 后复权价格不是认证总收益或真实账户净值；至少 60 个对齐回报，尾部至少 10 个观测；VaR 是边界场景归因，非连续分布边际 VaR |

## 原接口与存储合同

`GET /api/research/risk-center?advanced=1` 在原 `result` 增加 `advancedAccounts`，不带参数的原返回保留。模式 `advanced-account-risk-readonly`，固定 `canTrade:false`、`writesAccount:false`。`pool/pre` 只读原权威账户；没有账户或历史不创建目录。请求等待期间再验证原编辑权限和实例角色，旧私有结果不回传。

原 `centerEvidenceRuntime.readContext` 缓存本次原计划及实际 `inspectPaperPlanEntry` 结果。请求只取同交易日、连续交易时段、5 秒内回执；worker 从服务器固定 historyRoot 读取相关代码档案，不接受浏览器上传历史或报价。原档案 → 原 `auditCenterInputs` → 原账户 service → worker → 同一个原风险页面。`governance.pool/pre` 分账户呈现，重叠记录不得加总。

配置统一风险政策的账户现在调用原 `previewAutomaticEntry`，复用同一 `checkRisk`、导入行业/前收盘证据、费用与待买冻结预算。回执绑定原账户版本/指纹、完整报价、政策、数量、费用及逐股估值；结束前重读的耗时也计入 5 秒预算。只有服务实际签发的进程内原对象可进入计划观察，跨 worker 后再核对全部绑定。预检不经过 `mutate/guarded`，不写账本、拒单审计或防御事件。正式自动成交本身没有策略 ID，预检不会借计划展示标签补造归属；原策略集中度因此无法确认时继续未知。正式执行仍重新经过原写入门禁。

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
  "recoveryObjectives": {"rpoMs": null, "rtoMs": null},
  "accounts": [{"id": "pool", "file": "/private/source/original-pool.json"}],
  "files": [{"id": "config", "category": "configuration", "file": "/private/source/config.json"}]
}
```

原账户和拒绝审计自动识别，其余类别包括 `configuration/access-control/model-artifact/market-source-evidence/research/cache`。未提供的类别标记 `not-supplied`，不是完整整站备份。单源文件至多 32 MiB，每个账户及审计明文包至多 32 MiB，输入文件合计至多 128 MiB；原账户另受原服务 20 MiB 上限，128 MiB 不是加密输出及恢复临时文件的总磁盘上限。输出必须是所有源目录之外、尚不存在且父目录已存在的独立目录，拒绝符号链接和覆盖。原账户+审计在原锁内一致复制；恢复到隔离目录后由原账户服务检验，核对源文件前后哈希，移除明文临时副本，只留加密包与报告。

`recoveryObjectives.rpoMs/rtoMs` 是运维方明确指定的非负整数毫秒目标；未给出保持 `null/not-configured`，不猜填生产目标。恢复完整性与目标达成分别报告；恢复成功但任一已配置目标未达标时 CLI 退出码为 2，操作失败为 1，已配置目标达成或未配置时为 0。RPO 的本地备份年龄和 RTO 都使用单调时钟，系统时钟回拨不能产生负数并被算作达标；壁钟时点仍保留用于审计。`productionValidated` 始终为 false，隔离结果不批准生产 SLA。

复制前按固定输入估算临时峰值 `6 × 原输入字节 + 每包 1 MiB`，另要求至少 16 MiB 余量；不足或不能取得磁盘信息时不创建演练目录。每包以同一文件描述符核对预检尺寸及 SHA-256，账户和审计在原双锁内检查；源文件增长、内容变化、清单漂移或 FIFO 替换都会拒绝，合法未变输入才进入原加密和恢复工具。新备份选项是原工具的向后兼容参数，不建立另一套备份系统。空间没有被预留，其他进程仍可能消耗磁盘；操作失败保全已有加密产物并清理本次明文临时副本。

上轮两个人工输入账户、轮转审计和配置的隔离演练产生三个加密包：备份 185.030 ms、恢复验证 RTO 145.873 ms、保守备份年龄 RPO 185 ms，总计 330.990 ms。报告 `measurements.productionRpoMs/productionRtoMs` 为 null。此数据不能外推到实际数据量、主机损坏、异地恢复或生产节点。

## 前次接线验证记录（续接前）

本节保留续接前的实际记录，不代表本次新增源码已经通过完整验收。测试输入隔离、明确标注，生产数据不填示例；本次续接结果另列，不沿用其他提交或其他 PR 的绿色记录。

- `npm run check`：69 个原生前端模块语法校验通过。
- 组合链路 26/26；账户/权限/真实 HTTP/worker/锁/备份相关 80/80。全量会再次包含这些测试，不能将专项数字与全量相加。
- 数据治理最终专项 16/16，最后合并相关回归 92/92；原始文件损坏后增长和移除独立来源要求的两项攻击已由独立审查再次复现并确认修复。
- `scripts/fayo-advanced-safety-browser-check.js`：实际 Chromium、1366×900 `/` 和 390×844 `/m` 均通过；报告由原账户、原计划检查器及真实 core 生成。展开、取消无写、审批确认、版本冲突不重试、只读身份零私有读取、终止旧响应、无页面横向溢出均验证；现金/持仓/订单/成交保持原值。
- 真实 server+worker HTTP：原编辑身份/查看角色/匿名、GET 限定、no-store、主副角色、reconcile/set-defense 行为已验证；初次设备登记之后的受保护读取无文件写入和网络外发，缺失目录不被创建。
- `npm audit --omit=dev --audit-level=high --json`：0 个已报告 npm 生产依赖漏洞；限本次声明依赖范围。
- 本地 `V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 V6_MODEL_PYTHON=<本机模型Python> npm test` 完整执行 5070 项，首次结果为 5061 通过、5 失败、0 取消、4 跳过，耗时 584.760 秒。失败来自两类已修复问题：原冻结资金保护提示的兼容差异1项，以及本环境 `/var/tmp` 是符号链接导致的原发布器fixture失败4项。保留原冻结资金中文语义后专项21/21通过；复用 #359 已有的规范化临时父目录补丁后发布器13/13通过，生产路径/权限/完整性拒绝逻辑和负向断言未放宽。
- 本地4项原可选环境跳过分别为 PowerShell wrapper、五类模型比较、LightGBM及XGBoost；没有把跳过记为通过。环境 Node24.22.3，原生Python3.13.5、模型Python3.12.14。最终源码已提交后，由精确 HEAD 的原 GitHub 全量 CI 继续验证；最终是否通过以 [PR #356 Checks](https://github.com/solviq87-cpu/v6-stock-system/pull/356/checks) 对应提交为准，首次本地数字不能当作最终绿色结果。

## 本次续接第一检查点：资金、历史证据与恢复预算

以下对应在原 `fd3caeee` 上追加的第一批续接源码；任务 48/54 的进一步接线另行验证。

- 原账户、政策预演、冻结资金及原相关链路：23 个测试文件，169/169 通过，0 失败、0 跳过。新增预演专项 10 项，验证政策允许/拒绝/未知、导入证据、原对象签发、版本变化、最终重读超时，以及预检零写入；待买预算专项先复现 4 个失败，再修复跨日费率与部分成交佣金分叉。
- 历史冻结、追加、公司行为及 PIT 相关两轮专项合计 64 项通过。新测试先复现旧时点事实被替换，修复后隔离重放也不能改写首值；合法未来追加继续成功。
- 加密备份、拒单审计轮转、原灾备与操作演练相关 38/38 通过；覆盖目标未达标退出 2、单调时钟、磁盘不足、源尺寸/哈希/清单变化及 FIFO 替换。
- `npm run check`：69 个原生模块校验通过；`git diff --check` 通过；npm 生产依赖审计 0 个已报告漏洞。
- 实际 Chromium：原产品 8 个场景 × 6 个视口宽度通过；原决策页电脑/手机通过，隔离首个计划可见实测 1115 ms / 596 ms（本地并行测试条件，不是生产 SLA）。新增已配置原政策的高级风险页，1366×900 `/` 与 390×844 `/m` 均通过：原政策额度、取消无写、版本冲突不重试、viewer 零私有读取、撤权旧响应丢弃、无横向页面溢出；原现金、持仓、订单、成交保持不变。
- 本批首次本地全量完整执行 5103 项：5095 通过、4 失败、0 取消、4 跳过，362.488 秒。4 项失败均是发布器隔离夹具放在含 Git 工作区祖先的临时目录，触发原“部署目录不得处于工作区”门禁；没有放宽该生产门禁或修改测试断言。将 `RUNNER_TEMP` 指向工作区之外真实私有临时目录后，发布器原专项 13/13 通过。该次全量不是绿色结果，后续最终源码必须用正确隔离目录重跑，并以精确 HEAD CI 为准。
- 4 项原可选环境跳过为 PowerShell wrapper、五类模型比较、LightGBM、XGBoost；未将跳过记为通过。专项与全量有重叠，不把数字相加当作独立覆盖。

本检查点修改文件（路径前缀均为 `V6_BO/`，文档除外）：

| 范围 | 文件 |
| --- | --- |
| 原资金/政策预演 | `src/core/account-safety-state.js`、`paper-application-service.js`、`paper-plan-entry-check.js`、`advanced-portfolio-evidence.js`、`advanced-portfolio-runtime.js`；`server.js` 原 observer 回调 |
| 历史冻结 | `src/core/paper-session.js` |
| 原恢复工具与预算 | `scripts/advanced-safety-operations.js`、`scripts/disaster-recovery.js`、`src/core/authority-audit-backup.js` |
| 专项与浏览器 | 新增 `tests/automatic-entry-preview.test.js`、`pending-buy-budget-consistency.test.js`、`historical-evidence-append.test.js`；更新 `tests/advanced-portfolio-evidence.test.js`、`advanced-safety-operations.test.js`、`disaster-recovery.test.js`、`scripts/fayo-advanced-safety-browser-check.js` |
| 交接 | 根 `HANDOFF.md`、`DEPLOYMENT.md`、本文 |

## 与其他组的最小合并合同

再次读取的远端 `dev` 未变。活动 PR 的审阅快照如下；新总管最终集成前必须再次刷新 HEAD。

| PR | 本次已读 HEAD | 合并关注 |
| --- | --- | --- |
| #353 研究治理 | `c3c26519b005db219265c5b9b5718d8d053d8928` | 共用 `intelligence-research.js`；保留本组 `recordView.availableAt`、audit availability 检查、consensusKnownAt，与该组概率/独立验证并存，不能改写原 observed/source 时钟 |
| #357 智能增强 | `03d314dcec9c528d7fc46fe21c5a11939dc015d8` | 历史纸面研究与实际账户绩效分别保留，不能用相似样本收益替代权益净值 |
| #358 研究证据工作台 | `1c5675e70fc48c1666894b5e17c6d6961660ba16` | 共用 `server.js` 及交接文件；本组 UI 在独立 `advanced-risk-view.js`，原 `research-extensions.js` 只导入并渲染；保留其工作台/日报全部增量 |
| #359 风险中心开发组 | `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f` | 共用 `server.js` 原 observer 周边及 UI workflow。保留其唯一提醒发送和 riskWorkbenchRuntime，不新增第二个调度或通知方；原 observer 的 readContext 缓存只是只读证据投影 |

#359 的 `account-equity-evidence` 与本组报告均来自原权威账户；集成时以 accountId/收益期/revision/snapshotFingerprint/asOf 校验后复用单一权益证据，不覆盖原统一风险工作台。其已观察权益历史同样没有完整外部流前后边界，不能据此把本组 TWR/XIRR 从未知改成已认证。单标签历史贡献不能替换该组多题材压力去重；不同情景保留各自范围、版本和假设。本组防御状态属于原账户实际约束，新总管集成时应在有效规则/动作展示中消费 `defensiveStatus`，解除仍调用原 `setDefensiveControl`，不另建状态存储。

具体适配还须保留以下区别：

- #359 封存权益先经 `validateEquityEvidence`；同 revision/快照指纹不能证明同一批报价，仍需核对逐股价格、quoteAt、来源与冲突标记。其显示 `positions[].quote` 固定 `canTrade:false`，不能转换成本组执行压力计算的原始合规报价。
- #359 `accountEpoch` 与本组 `original-period-<archives.length>` 不是同一标识，须从同一原 book 验证映射。`status/gaps/truncated` 随已观察回撤一起消费，不能只取非空数值。
- 原 observer 只执行一次；保留本组 `readContext` 回执缓存、原执行清单投影和 #359 `observePlans`。`sendPrivate` 仅保留风险中心组 `sendPlanAlert` 唯一路由，不能同时保留旧直接发送。本组5秒回执不能用该组一分钟 `plansAt` 或旧观察记录刷新。
- 原回执必须保留 planId/decisionId/maxPositionPct、checkedAt/quoteAt/quotePrice/quoteSource、accountRevision/accountFingerprint、quantity/fee 和原 allowed/reason/scope。高级 GET 不采样权益、不触发 tick 或通知。
- #359 多题材 `themes[]` 和 sourceRefs 保留；本组单标签贡献不取首个题材冒充全分类。其多数 Pct 为0—100，本组权重/回报/尾部风险多为0—1；两个压力版本不得混成已校准阈值。

## 新总管需要协调的实际冲突与依赖

以下以表内精确提交及本组续接工作树作三方文本核验，未合并任何工作分支。自动文本合并只表示没有文本冲突，不能代替业务联测。最终顺序由总管根据最终 HEAD 决定，本组不自行安排主线合并。

| 相关 PR | 已核对的共享文件或冲突 | 必须保留的合同 |
| --- | --- | --- |
| #353 `c3c26519…` | 本组与其 `server.js`、`HANDOFF.md` 存在文本冲突；同时共享 `intelligence-research.js`、`DEPLOYMENT.md` | `governance` 缓存、概率研究结果及成功研究结果登记，与本组 `availableAt/consensusKnownAt`、advanced 异步读取与返回前撤权复核同时保留；#359 的 `readResearch` 也应使用同一缓存 |
| #357 `03d314dc…` | workflow、两份交接文档有文本冲突；共享 `server.js` | evolution/preferences/diagnostics 与 #358 workspace action、EVENT_KINDS、锁内及发布前授权取兼容并集；不能以纸面样本净收益代替原账户权益 |
| #358 `1c5675e7…` | workflow、两份交接文档有文本冲突；共享 `server.js` | 保留原新闻否决、工作台授权和截止时点检查，本组原 observer 与只读风险读取仍使用原权限；其 `20261126ab/evidence-workbench-2` 不得覆盖其他组模块 |
| #359 `86a5bf47…` | workflow、两份交接文档有文本冲突；共享 `server.js`、发布器测试 | `observePaperPlans` 仍只运行一次；同一 `readContext` 保留本组原账户预检及 receipt 缓存、executionChecklist、riskWorkbench 投影；私密通知仅走 `sendPlanAlert` |
| #361 `5ea32ac7…` | `paper-application-service.js`、workflow、`HANDOFF.md` 有文本冲突；共享 `DEPLOYMENT.md` | `validateBeforeWrite` 需由 `mutate` 传到本组新 `publish`，紧邻 `atomicWrite` 复核同交易日与原始报价 15 秒门禁；本组对账、防御锁存、统一冻结预算及零写入预检都要保留；workflow 去除 paths 过滤与各组新增浏览器步骤兼容 |
| #360 `aecebd19…` | 依赖 #357 的旧头 `9a113226…`，预热测试同一断言块已在 #357 后续调整 | 不机械重复 cherry-pick；协调保留一次有效不稳定夹具和相同 EMA/KDJ 初值反例覆盖，不能修改生产算法或放宽门禁 |

跨组 #357/#358/#359 还存在首页、个股模块、SW 与版本断言冲突。最终统一 server appVer、双端资源查询版本、SW 名称和 PRECACHE 时，保留 evolution-view、evidence-workbench、risk-workbench 及本组 advanced-risk-view。`accountEpoch` 与 `original-period-N`、只读展示报价与原执行资格报价不是可以直接重命名互换的字段。

本轮新增历史守门复用 `paper-session.assertAppend`；上述已核对 PR 没有改写其文件或原 `market-data-center`/证据模块，不存在已发现的直接文本冲突。集成时仍须保留这道守门，旧完整文件覆盖或绕开原 sync/replay 都会重新引入历史改写风险。

### 仍需总管统筹或真实环境提供的条件

- 40：本组完成原账户防御状态、原亏损拒绝锁存和明确审批；大盘/题材/系统事故触发的最终统一状态、动作与解除证据还须与风险工作台整合，不能仅凭统计信号自动清仓。
- 48：当前是原研究诊断与高级风险读取的局部关联和 P50/P95。所有采集、因子、策略、候选、风险、模拟执行、通知阶段使用同一追踪上下文仍待总管协调各原模块接线，不能把局部指标当作全链完成。
- 54：本组 worker、输入及恢复磁盘预算已落实；全系统采集/训练/研究资源的统一调度和生产双端时延还需最终运行版本验证。
- 42/58：连续原账户权益、每次外部现金流前后边界和足够同口径成熟行情没有取得时，真实收益率与尾部估计保持未知；不从充值、reset、稀疏采样或后复权价格猜造净值。
- 51/52/53：合法来源的完整历史证券/ST/退市/公司行为/供应商时钟仍需真实资料；通用 importer 的审阅重放是内部 API，现 CLI 面向原中心历史，不能声称全源人工审核入口已统一。
- 55/56/57：生产私有卷、真实冷备、目标设备恢复时长和跨主机写者栅栏未认证。当前实际锁验证仅覆盖同一支持 flock 的卷；源码恢复点、单机测试及本地 RPO/RTO 不替代生产验收。

## 发布与恢复

本轮只提交源码、必要测试和本文等精简交接；不向 PR 上传安装 ZIP、截图、原始日志或私有回执。新增浏览器脚本接入原 `v6-ui-browser.yml`；权限和既有检查均保留。新总管安排统一 appVer/frontend-revision/SW 缓存并在整合后的精确 SHA 重跑原全量、隔离服务及双端验证。

本次续接前完整 Git bundle 已通过 `git bundle verify`，SHA-256 为 `9c2e3515fb08ba7fdba014b13f426b0efb24396c5f3d193bd0b62a30b67bfa55`，覆盖原 PR 的 `fd3caeeef55b1cad63be14764a47e11a695c0b2e` 及历史。前阶段 bundle 的 `f414f20f1d5936495ef0069b628e4e8df37f5e60d58de788de62fa221124281f` 记录保留。它们只恢复源码，不是生产数据冷备。本工作区未取得生产私有卷，生产节点、实盘、真实消息、跨主机切换未执行。

未来升级或回滚先停本节点及同卷全部旧/新写者，保全程序、原账户/订单/成交/资金、拒绝审计、设备权限、配置、历史原始字节/隔离/复核、模型研究与外部私有卷，验证哈希和原服务可读。稳定 `.guard` 不得在运行中删除，旧 PID 锁程序不能与新 flock 程序混跑。

**旧程序不理解新增 `defensiveControl`，直接回切并开放写入会丢失新增风险限制。** 回滚须保留控制事件及升级后流水，先在隔离副本核对旧格式兼容，维持停写或等效的既有入口禁用状态，人工核对限制与原门禁后再决定恢复写入。不能删除限制字段、用旧账本覆盖新流水或自动重放历史成交。派生证据损坏保全后单独处理；不以改现金/持仓迎合报告。
