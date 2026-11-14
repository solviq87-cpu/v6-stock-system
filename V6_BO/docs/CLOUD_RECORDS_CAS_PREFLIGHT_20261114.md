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

- 这不是一个常驻进程，且**尚未挂载在 `V6_BO/server.js`**。真实调用仍须现有身份机制 `roleOf`、CORS/CSRF、反向代理配置、持久卷运行和现场版本门禁；不能简单 `http.createServer` 对公网开放此模块。
- **尚未**迁移 WorkBuddy 静态页面、原账户以及前端 CAS 客户端；双端同步仍属于生产阻塞。必须先独立保存授权备份并确认实际云端账本来源。

隔离回归：`node --test V6_BO/tests/cloud-records-http.test.js`，覆盖未登录/只读/失效令牌、跨站、无权威账本、两端并发 409、重复请求和非法方法。CI 专项结果不构成真实登录或部署认证。
