# 天枢智策 V6：云端数据、登录与飞书恢复执行清单（2026-11-14）

## 本次实际代码状态

当前静态 WorkBuddy 站点不等于 V6 完整后端。既有 GitHub 单文件发布流程由 \`managed-task\` 唯一拥有，**不要建立第二个 WorkBuddy 发布者**。在获得线上读回、数据备份与身份凭据的真实证据之前，数据恢复、登录与飞书消息均不能标记为成功。

2026-11-14 云端账本修复已通过 PR #235 引入：
- \`records\` 为空、没有 \`v6.app.state\` 且无服务端明确许可时，客户端禁止自动开新模拟账户；
- 云端 POST 之后必须 GET 读回且账本内容一致才显示“已同步”，不是仅凭 HTTP 200；
- 没有后端或没有会话时始终只读，既有账户及双端功能不删除。
- 仍需服务端原子 CAS、重试幂等和权威账本真实备份；浏览器 GET-then-POST **无法**保证多设备同时修改的原子性。

## 第一阶段：真实线上接口只读审计

使用\`V6_BO/scripts/workbuddy-readonly-audit.js\`，只允许当前固定 WorkBuddy 目标的三个 GET：
\`/api/site\`、\`/api/health\`、\`/api/records\`。工具默认不发任何 POST/PUT/DELETE、不会发布、不会发送飞书、不会改变持仓，也不会把分享码或私密记录写到日志里。

在**已有授权的私有运行环境**执行：
\`\`\`sh
# 分享码保存在工作树之外的私人文件中，文件必须是常规文件，chmod 600
V6_WORKBUDDY_SHARECODE_FILE=/private/workbuddy-sharecode \
  node V6_BO/scripts/workbuddy-readonly-audit.js
\`\`\`
不能把分享码写入命令行参数、GitHub Actions Secret 输出、Git、Issues 或用户截图。CI 只运行纯模拟测试：
\`\`\`sh
node --test V6_BO/tests/workbuddy-readonly-audit.test.js
\`\`\`

工具仅输出 HTTP 状态、响应大小、SHA-256、JSON 可解析性以及记录条目数/是否出现 \`v6.app.state\`。这些信息**只能验证接口和读回结构**；空记录、未知账号、不含交易流水的状态不能称“历史已恢复”。遇到 403/404/500 或 HTML 响应必须照实记录；没有凭据就标明 “credential-unavailable”，不探测公共群、旧主机或泄露凭据。

## 第二阶段：历史账户保护与恢复

1. 冻结旧数据写入和全部模拟盘操作，列出被授权的权威存储、运行时账本与备份、各端只读缓存。
2. 保存只读私有备份：记录 schemaVersion、revision、最后事务号、记录条数、SHA-256 和加密校验凭证；**不得打印真实持仓/密码**。
3. 对比存储中的资金、冻结、持仓、成交、撤单与流水；损坏账本拒绝恢复。
4. 没有可验证备份时只能保持只读，不得创建空记录作为“恢复”；不得把浏览器缓存当作权威源。
5. 新后端必须提供真正的多设备 CAS（如数据库事务/行锁 + expectedRevision）和幂等 requestId；冲突须返回 409，不能靠浏览器先 GET 再 POST 冒充原子写。
6. 在隔离环境中以合成数据测试，断线、超时、崩溃重启、重复提交及两端并发全通过后，再授权迁移真实数据。

## 第三阶段：部署完整后端与登录

优先复用完整的 \`V6_BO/server.js\`、现有账户安全和完整策略模块，在**支持 Node 22.6+、持久化卷和 HTTPS 的独立后端环境**测试，而非把 WorkBuddy HTML 服务器当 Node 运行时。

- 预发布环境与生产环境分离持久化目录、密钥、服务标识和飞书推送角色；预发布使用 \`pushRole=replica\`，不发送真实消息或扣真账；
- 按 \`V6_BO/docs/WEB_PREVIEW_DEPLOY.md\` 配置 \`QD_CLOUD=1\`，使用服务端身份认证、过期与撤销、登录限流、Cookie/Token 防泄露、CSRF/CORS、设备权限。真实密码只能存服务端加盐哈希；
- 浏览器访问必须测试实际登录/退出/未登录越权，绝不展示“前端密码弹窗就是已登录”；
- 若原 WorkBuddy 静态域名不能反向代理真实 API，采用同源完整站点的独立 HTTPS 地址。旧 WorkBuddy 发布目标和 \`managed-task\` 不变；连接方案明确并经真机测试后才切换入口；
- \`productionDeployed\` 只能依据实际运行实例 ID、健康/权限检查、持久卷重启恢复、版本 SHA 和真实读回证据改为 true。

## 第四阶段：飞书与权限处理

真实 \`V6_FEISHU_PRIVATE_WEBHOOK\`、签名密钥由有权限的运行时私有存储提供，旧的泄露 webhook/token 必须轮换、撤销和复核。无可信私密通道时**绝不试发**，不改发公共群。凭据齐全后先进行脱敏、隔离探针，再发一条标记“连接测试”的私密消息，校验网关成功与用户手机实际收到两层证据。回执未知不自动重发。

## 第五阶段：发布与双端验收

现有 \`managed-task\` 是唯一 WorkBuddy 静态发布者，不改变 owner。GitHub V6 CI / \`verify\`、\`verify-web\`、\`cloud-ledger-failclosed\` 和 \`workbuddy-readonly-audit\` 提供每次 push/PR 的显式检查。UI 文件变动须检查 V6 UI Browser Geometry，通过并不等于 iOS Safari 实机测试。

每次交接应附：精确 40 位 Git SHA、CI run URL、私有运行环境名称、HTTP 状态/响应 hash、账本备份证据、登录/会话/权限日志、双端实机截图（脱敏）、飞书实际送达、不可回退 SHA 和未完成项。缺项标“阻塞/未执行”，不标已修复。

> 保留原始策略/账户/界面/测试；只有满足完整证据才允许从“代码已合并”升级为“线上已恢复”。


## 云端只读审计加固补充（2026-11-14）

本轮沿用已有的 V6_BO/scripts/workbuddy-readonly-audit.js，不创建第二套入口。
新增固定的站点主页 GET /，合计执行四个 GET：/、/api/site、/api/health、/api/records。只在原授权运行环境使用 0600 私有分享码文件，不记录敏感内容。

- htmlMatch=true：表示本次只读 GET 的主页 UTF-8 内容哈希与 /api/site 中 site.html 哈希相同；不代表发布受信、真实后台或账户已恢复。
- htmlMatch=false：哈希不同，需核对发布状态；禁止绕过唯一 managed-task 的 SHA/CI/owner/加密快照门禁。
- /api/records 的 ledgerStatus：missing、duplicate-ambiguous、invalid-json、unrecognized-shape、shape-readable-unverified。最后一种也只是最小形态预检，不是历史账户、权限、账本流水或 CAS 认证。
- records-endpoint-not-found 对应本次授权请求获得 404；records-access-denied 对应 401/403，不能误称接口不存在。
- ok=true 仅表示接口只读结构、最小账本形态与两个页面哈希一致。报告仍有 accountRecoveryVerified=false、authenticatedSessionVerified=false、productionDeploymentVerified=false。
- 缺失或损坏记录时 ok=false，严禁使用默认空账户代替原历史。

既有 CI 的 workbuddy-readonly-audit 及 verify 仍会执行。测试含损坏账本、重复记录、空记录、403/404、哈希不匹配、超大响应和凭据脱敏。只有真实授权运行和独立账户恢复证据，才能标记现场验收通过。
