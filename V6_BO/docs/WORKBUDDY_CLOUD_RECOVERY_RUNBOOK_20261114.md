# 天枢智策 V6：云端数据、登录与飞书恢复执行清单（2026-11-14）

## 本次实际代码状态

当前静态 WorkBuddy 站点不等于 V6 完整后端。既有 GitHub 单文件发布流程由 \`managed-task\` 唯一拥有，**不要建立第二个 WorkBuddy 发布者**。在获得线上读回、数据备份与身份凭据的真实证据之前，数据恢复、登录与飞书消息均不能标记为成功。

2026-11-14 云端账本修复已通过 PR #235 引入：
- \`records\` 为空、没有 \`v6.app.state\` 且无服务端明确许可时，客户端禁止自动开新模拟账户；
- 云端 POST 之后必须 GET 读回且账本内容一致才显示“已同步”，不是仅凭 HTTP 200；
- 没有后端或没有会话时始终只读，既有账户及双端功能不删除。
- 仍需服务端原子 CAS、重试幂等和权威账本真实备份；浏览器 GET-then-POST **无法**保证多设备同时修改的原子性。

## 第一阶段：真实线上接口只读审计

使用\`V6_BO/scripts/workbuddy-readonly-audit.js\`，只允许当前固定 WorkBuddy 目标的四个 GET：
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

工具仅输出 HTTP 状态、响应大小、SHA-256、JSON 可解析性、同一站点 `/` 与 `/api/site.site.html` 原始 HTML 哈希的一致性，以及记录条目数/账本语法状态/是否出现 \`v6.app.state\`。这些信息**只能验证接口和读回结构**；空记录、未知账号、不含交易流水的状态不能称“历史已恢复”。遇到 403/404/500 或 HTML 响应必须照实记录；没有凭据就标明 “credential-unavailable”，不探测公共群、旧主机或泄露凭据。

### 单一审计器验收语义

最新版本保留一个 `workbuddy-readonly-audit.js`，**不**额外维护第二套云端探测脚本。四条固定 GET 的第四条是站点根路径（只读）；`pageIntegrity=matching-bytes` 说明本轮根页面与 site API 的 HTML 内容字节哈希一致，`different-bytes` 说明存在发布/取回不一致，`unverified` 表示无法证明一致。三者都不证明后端上线或账户恢复。

`ledgerStatus` 可为 `not-returned`、`duplicate-ambiguous`、`invalid-account-json`、`invalid-account-format` 或 `parseable-not-validated`。最后一种只表示 JSON 可解析，不是余额、订单、流水或 schema 已验收。返回值的 `accountRecoveryVerified`、`serverLoginVerified` 始终为 false，不因 GET 200 自动变成 true。

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


### 审计结果负面门禁（2026-11-14 复核修正）

- 原审计器在 HTTP 200 且 records 为数组时，即使没有 v6.app.state、账户损坏或站点 HTML 内容不同，仍可能输出 ok=true。本次修正为：四路只读核验中，账户仅通过最低形态预检且根页与 /api/site 的 HTML 原始哈希一致时，才输出 ok=true。
- 账户最低形态只检查非负整数 revision、有限数值 cash、positions 和 orders 数组。即使这些全部通过也仅是 parseable-not-validated；绝不因此声称资金流水、历史交易、跨设备一致性、登录鉴权已经真实验收。
- 新增 code 明确区分 records-access-denied（401/403）、records-endpoint-not-found（404）、records-unverified、ledger-missing、ledger-unverified、site-api-unverified、site-html-mismatch、site-html-unverified 和 read-only-evidence-collected。
- 若 ok=true 也始终保留 accountRecoveryVerified=false、serverLoginVerified=false、productionDeploymentVerified=false。严禁将这轮 GET-only 代码回归冒充生产上线或账户恢复成功；仍须授权环境进行现场核验。
