# V6 云端账本 CAS 存储核心（隔离研究模块，未启用）

## 范围与安全声明

本批只新增一个服务器端存储核心 `src/core/cloud-records-cas-store.js` 及自动回归。它**没有接入**现有 WorkBuddy 静态站、`V6_BO/server.js` 的 HTTP 路由、身份认证、真实账户和任何发布进程。其用途是为后续带权限的 `/api/records` 服务准备可验证的原子记录存储，避免手机/电脑同时更新时丢单。

这不是新的 UI、账户、发布者或交易接口；不得将它称为已部署后台。当前唯一静态发布者仍是 `managed-task`。

## 合约

- `createCloudRecordsCasStore(privateAbsoluteDirectory)`：服务器内部 API，**不接受未鉴权的网络请求**。存储目录必须为绝对私有目录，权限 0700，禁止符号链接、`public`、`www`、`dist` 等对外路径。
- `read()`：目录不存在时返回 `status:uninitialized, records:null`，绝不自动生成空模拟账户；存在时逐条核验追加历史、事件哈希、顺序及权限。结果包含 `productionDeployed:false` / `authenticatedSessionVerified:false`。
- `bootstrap({records,expectedSourceHash,operatorApproved:true,requestId})`：仅能在初次空存储调用。必须由获授权人员独立确认旧账户与备份的权威来源、内容及其 SHA-256，模块的 `expectedSourceHash` **只是完整性相等检查，不能自行证明来源可信**；必须保留原 `v6.app.state`。不许把默认状态当恢复，也不许覆盖已有版本。
- `upsert({expectedRevision,requestId,record})`：读取、比较、追加均由仓库已有 Linux `flock` 内核锁保护。版本不一致返回 `REVISION_CONFLICT`（未来 HTTP 层应映射 409）；相同 requestId/相同内容可幂等重试，内容不同返回 `IDEMPOTENCY_CONTENT_CONFLICT`。每次变更追加不可覆盖的 `000001.json` 等事件文件，fsync 文件和目录，SHA-256 链校验。单次故障不会回写旧版本或自动抹除历史。
- 账户记录采用最低结构保护：合法 revision/cash/positions/orders。它不负责资金闭环及真实行情认证；这部分仍须复用现有主账户、风控、回放与权限测试。

## 当前测试

```sh
node --check V6_BO/src/core/cloud-records-cas-store.js
node --test V6_BO/tests/cloud-records-cas-store.test.js
```

专项 12 个离线测试，包含首次初始化拒绝、重复/未知来源、两个设备陈旧版本拒绝、幂等请求、内容冲突、写入中断、提交后丢失回执、跨进程竞争、中文及压缩记录格式、历史损坏拒绝恢复、锁遗留、权限及符号链接。现有 `npm test` 同时拾取此文件，CI 有明确的专项状态。

## 生产接入仍阻塞

1. 本模块**没有 HTTP 适配器**，不能暴露到公网、不能直接由前端调用。正式路由必须使用现有登录鉴权（身份、设备、令牌撤销/过期）、CSRF/CORS、速率限制、严格请求大小上限。分享码不是账户身份认证。
2. 真正的权威数据源尚未获取、原始账本没有备份验证；操作员批准与 hash 比对不得替代来源核验。必须先只读存档并独立做资金、持仓、委托、流水对账。
3. 后续 API 需要扩展前端 `expectedRevision`、`requestId` 和失败重试处理，并修订浏览器模拟接口测试；不能把原来的 GET 然后 POST 当成原子 CAS。
4. 目前每次读取都会从头验证所有不可变事件，最多 10,000 条；适用于隔离验收，不应未经容量压测用于长期生产。磁盘满、上限或故障直接拒绝写，不静默剪枝。哈希链没有数字签名，抵御不了已获得存储写权限者对整条历史重写；上线须配合脱机不可篡改备份和独立签名/锚定。
5. 还需目标机器真实盘中/周末、双端真机、持久卷重启、失权/并发、私密飞书真实到达等独立验收；不得标记 `productionDeployed:true`。

**回滚方法：** 撤销本新增模块和测试的提交即可，当前生产账户和静态站不会被触及。不可删除任何未来使用的历史事件目录。

## 第二阶段：强制鉴权的 HTTP CAS 适配器（隔离待接入）

新增 `src/server/cloud-records-http.js`，不创建第二份存储也不写任何真实账户。

- 创建处理器必须显式注入 `store`、`authenticate(token,req)` 和 `sameOrigin(req)`。缺少实际会话认证/同源策略即拒绝构造，**未登录 401，只读 403，跨站 403**；不会把 URL 内的 `sharecode` 当登录证明。
- `GET /api/records` 仅供有有效编辑令牌的设备读取，返回 `records`、`revision` 和 `writeContract:cas-v1`；没有经验证的权威快照返回 503，不新建账户。
- `POST /api/records` 强制 `expectedRevision` 与 `requestId`，在 CAS 核心上执行。两个设备提交相同旧版本时只有一个成功，另一个 **409**；同 ID 同内容重试复用、内容不同 **409**。请求 JSON 上限 4MiB，多余字段或无效格式拒绝。
- 明确不支持通过 PUT/DELETE 绕过门禁。HTTP 层只向客户端返回脱敏机器码，不泄露持仓日志、私密令牌或异常堆栈。
- 安全追加：本适配器明确拒绝 URL 查询里的 `sharecode` / `token`（即使同时有 Bearer 令牌，也返回 400），POST 只接受 `application/json`，否则返回 415；成功响应带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer` 和 `X-Content-Type-Options: nosniff`。这些门禁只在独立处理器内实施，**不代表已接通 WorkBuddy 静态站**。

- 这不是一个常驻进程，且**只有显式启用后才由 `V6_BO/server.js` 挂载**。真实调用仍须现有身份机制 `roleOf`、CORS/CSRF、反向代理配置、持久卷运行和现场版本门禁；不能简单 `http.createServer` 对公网开放此模块。
- **尚未**迁移 WorkBuddy 静态页面、原账户以及前端 CAS 客户端；双端同步仍属于生产阻塞。必须先独立保存授权备份并确认实际云端账本来源。

隔离回归：`node --test V6_BO/tests/cloud-records-http.test.js`，覆盖未登录/只读/失效令牌、跨站、无权威账本、两端并发 409、重复请求和非法方法。CI 专项结果不构成真实登录或部署认证。

## 第三阶段：接入 V6 原后台（显式开关、默认关闭）

当前增量在原 `V6_BO/server.js` 内预留一条 **默认完全不启动** 的 `/api/records` 路由。只有同时满足以下环境条件才启用：

1. `QD_CLOUD=1`（云端模式，禁止本机回环免密）；
2. `V6_ENABLE_CLOUD_RECORDS_HTTP=1`（明确启用开关）；
3. `V6_CLOUD_RECORDS_ROOT` 是仓库目录之外的绝对私有目录，且已经通过获授权的旧账本备份核对和离线初始化。

真实路由复用现有 `roleOf(token, clientIp(request))` 开发者设备令牌体系，**只从 Authorization: Bearer 请求头读取会话**。链接分享码和 URL token 不能代替身份；仅 `edit` 权限允许读取或修改私有模拟账本，观看权限拒绝。原 `sameOriginOk`、JSON 请求类型门禁以及 CAS 原子版本/幂等门禁一起生效。禁用或存储未准备好时，不进行账户自动初始化，也不写历史。

隔离启动测试：

```sh
node --test V6_BO/tests/cloud-records-server-integration.test.js
```

该测试启动**真正的原有 V6 server.js**，仅在临时目录生成合成密码和合成账本，不带任何真实环境密钥，不访问外部网络；验证原登录令牌、未登录拒绝、跨域拒绝、版本冲突 409、相同请求幂等、请求格式拒绝和实际文件回读，并在退出时清理临时副本。

**尚未生产启用：** 此开关不在仓库配置中默认打开，未修改 WorkBuddy 静态发布器、未关联真实云端账本；没有购买部署服务、没有修改服务器凭据、没有用模拟测试替代真实数据迁移及真机验收。当前静态 WorkBuddy 页面仍按旧 `sharecode` 请求模式工作，无法自动变成 Bearer/CAS 客户端；迁移前还需要改造专用授权前端、备份/恢复、真实持久卷和多设备测试。禁止将本阶段称为“云端连接已经恢复”。


## 第四阶段：独立浏览器 CAS 客户端（默认只读，未接入线上 UI）

新增 `public/assets/v6-cloud-cas-client.js`，通过 Node 的 CommonJS 或浏览器 `window.V6CloudCasClient` 显式创建实例。本文件不会自动调用任何接口，不修改锁定的电脑/手机首页，也不会读取或写入 `localStorage`、cookie 或分享码；**不会自动接管现有 WorkBuddy 单文件静态页面**。

- `createClient({getToken, fetchImpl, allowMutations, requestIdFactory})`：必须由宿主提供真实会话令牌获取函数。只允许同源固定路径 `/api/records`，令牌仅置于 `Authorization: Bearer`，从不拼接到 URL，禁用跨站请求和缓存。缺/换令牌即清除已载入的私有账户数据。
- `allowMutations` **默认 false**；必须由未来已经通过真实备份、权限和部署审批的宿主显式启用，不能由接口响应的 HTTP 200 自动启用。
- `load()` 只接受 `writeContract:cas-v1`、明确的**服务端全局 revision**、唯一 `v6.app.state`、可识别账户最低结构。缺失、同名重复、损坏时拒绝；不会创建默认账户。
- `commit(record)` 只能更新之前已确认存在的记录；提交携带服务端全局 `expectedRevision` 和高熵 `requestId`。遇到 HTTP 409 会冻结写入，不自行合并两端资金、持仓或流水。
- `retryPending()` 专门处理单次会话内“POST 可能已经落盘但回执丢失”：**只重发同一 requestId 与同一正文**，而不是新建订单。首次 POST、重试及读回都使用相同身份；读回不一致则停止继续修改。
- `clear()` 和凭据变化将增加操作世代，防止较晚返回的旧网络响应重新填回敏感账户状态。

**限制不能隐瞒：** 待确认请求 ID 仅保存在内存，关闭网页或浏览器进程重启后无法自动重试；跨重启恢复仍需独立服务端回执查询与安全迁移方案。客户端只检查 CAS 协议和最小结构，不执行完整资金/持仓风控与业务对账；不得把它作为真实交易入口。现有 WorkBuddy 页面仍走旧 sharecode 数据接口，不会因为新资产文件存在就自动连接 CAS。

专项回归：`node --test V6_BO/tests/cloud-records-cas-client.test.js`，测试使用**真实 localhost HTTP CAS 处理器与临时合成账本**，覆盖两客户端版本冲突、同 ID 网络重试、令牌撤销清缓存、页面手动清理后的竞态、写入回读、无权威记录拒绝、响应损坏，以及默认只读策略。GitHub 独立状态 `cloud-records-cas-client` 和原 `verify` 全量回归必须通过才可以合并。


## 第五阶段：原始备份只读预检（不导入、不迁移）

在接入任何真实数据之前，新增 `scripts/cloud-records-backup-preflight.js`。只能读取由授权维护者**独立取得**的 WorkBuddy `{ok:true,records:[...]}` 私有 JSON 备份文件，不使用分享码，不访问网络，不新建数据库，不写入账户，也不触发发布。

- 输入文件必须为仓库/公开目录之外的**绝对路径、单链接普通文件、权限 0600**，禁止符号链接，最大 32 MiB；任何不符合条件的备份拒绝读取。命令不打印完整文件路径、明文持仓、现金或任何账户内容。
- 默认仅做结构检查，输出 `structure-only`；如果由用户在受控环境另行提供原文件 SHA-256，核对一致才输出 `file-hash-matched-structure-only`。哈希相等**不能证明历史权威来源**，`backupAuthorityVerified=false` 始终不变。
- 使用现有 CAS 记录验证逻辑做只读检查：记录名重复、没有 `v6.app.state`、账户 JSON 损坏、缺最低结构字段、无效存储编码均拒绝。输出独立的原始文件 SHA-256 和规范化 `snapshotHash`，后者仅是将来 `bootstrap(expectedSourceHash)` 的技术输入；不代表已批准初始化。
- 原平台附带的记录 `id` 等元数据不会作为 CAS 记录业务字段迁移；报告会用 `ignoredPlatformMetadata=true` 显示，提醒迁移前单独核对其实际用途。
- `accountHistoryReconciled=false`、`sourceProvenanceVerified=false`、`fullAccountReconciliationVerified=false`、`importAuthorized=false`、`restorePerformed=false` 始终保持。真实资金、持仓、冻结、成交、撤单必须用独立授权备份与账户回放核对，不能靠本脚本宣称已恢复。

运行示例（不要在命令行历史、Git、CI、聊天中放入真实账户或分享码）：

```sh
V6_CLOUD_RECORDS_BACKUP_FILE=/private/path/workbuddy-records.json \
V6_CLOUD_RECORDS_BACKUP_SHA256=<经独立留存的64位原文件哈希> \
node V6_BO/scripts/cloud-records-backup-preflight.js
```

只读脚本由 `node --test V6_BO/tests/cloud-records-backup-preflight.test.js` 验证，GitHub 独立检查名 `cloud-records-backup-preflight`。这份工具**不自动扫描用户文件、资料库或云端地址**；没有真实备份时继续维持生产迁移阻塞，不创建空账户。
