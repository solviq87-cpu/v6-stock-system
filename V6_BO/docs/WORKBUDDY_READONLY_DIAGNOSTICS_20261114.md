# WorkBuddy 云端只读诊断（2026-11-14）

## 目标和边界

本工具用于核实 https://af3c7822e6aafc135.app.workbuddy.host 的 **实际** /、/api/site、/api/health、/api/records 接口状态，纠正“以本地 mock HTTP 404 推断线上接口不存在”的证据缺口。

- 固定目标主机与四条请求路径，每次最多四个 **GET**；禁止 POST、重定向、写账本、发布、私密通知、自动初始化账户。
- 缺分享码 **零请求**；分享码只从受控环境变量或权限 0600 私有文件读取，**不能作为 CLI 参数**。
- 报告仅显示 HTTP 状态、分类、非敏感哈希和大小。**不输出**完整请求 URL、分享码、账户内容、持仓、密码、响应体或错误消息。
- 响应最多读取 8 MiB，单请求超时 12 秒；网络失败只标未验证。
- 即使取得 records 中一个可解析的 V6 账本，也**不等于**已验证账本历史完整性、服务端登录、持久化、读写授权或已部署后端。
- 当前 WorkBuddy 发布权仍为 managed-task；此诊断不触发发布，不创建第二发布者。

## 运行方法

在已获授权、持有本目标有效私密凭据的受控环境内，使用已有凭据文件的**路径**注入（文件所属权限必须保护）：

~~~sh
V6_WORKBUDDY_SHARECODE_FILE=/private/path/to/existing-0600-sharecode \
  node V6_BO/scripts/workbuddy-cloud-readonly-diagnostic.js
~~~

或者使用现有服务的 V6_WORKBUDDY_SHARECODE 环境变量；**不要**把实际值直接写进终端历史、命令行、截图、仓库、CI。缺凭据时返回 credential-required 且不发请求。

不在 CI 中配置真实分享码；CI 只运行离线的 10 个合成响应测试：

~~~sh
node --test V6_BO/tests/workbuddy-cloud-readonly-diagnostic.test.js
~~~

## 结果解释（不能扩大为生产验收）

| code | 含义 | 安全处理 |
| --- | --- | --- |
| credential-required | 未提供凭据，零请求 | 由授权维护者在现有受控环境注入；不要贴聊天 |
| credential-invalid | 私有文件权限不合规或凭据格式错误 | 修复私有存储，严禁打印密钥 |
| records-endpoint-not-found | 有权限请求实际收到 /api/records HTTP 404 | 需规划正确的兼容数据后端；仍不能推断不存在任何其他后端 |
| records-access-denied | HTTP 401/403 | 核查权限/会话；不得归类为“接口不存在” |
| records-contract-unrecognized | HTTP 200，但响应不符合预期结构 | 核查端点身份与数据协议，禁止写账本 |
| ledger-not-returned | 合规响应却没有 v6.app.state | **未发现不代表不存在**；查历史存储、备份，禁止自动重建 |
| ledger-unverified | 账户 JSON 损坏、重复或不可安全识别 | 保持冻结，人工只读备份与恢复对账 |
| site-html-different | / 与 /api/site 的 HTML 哈希不同 | 核验静态发布状态，严禁绕过发布 hash/owner 门禁 |
| readonly-evidence-collected | GET 返回且可解析，获得只读证据 | 不等于认证或持久化验收；仍需登录、恢复与双端验证 |
| records-unverified | 连接错误、超时、响应过大、限流等 | 保留原状，不作“已恢复”结论 |

checkedAt 是执行时的 UTC 时间。四个 endpoints 状态、rootHtml/siteHtml SHA-256（如有）可作为脱敏证据。publishedFlag:true 仅为接口自述，不是已经完成 Git SHA 的发布验收。

## 后续仍需实现

1. 在受控环境执行一次**有权限的真实只读核验**并保存脱敏结果，不向仓库提交真实账户 JSON。
2. 另查 WorkBuddy/私有云原始账本和备份；原数据未核实前不得初始化/迁移。
3. 在独立后端提供带身份认证、幂等写入、版本 CAS/ETag、持久化备份的 /api/records 兼容协议，不能把裸分享码视为充分的账户登录鉴权。
4. 在确认所属的独立部署环境中，使用隔离数据测试现有 V6 服务；静态站不能运行 Node/Python。
5. 取得真实账户读回、登录/权限、两端并发与真机恢复、报价时点等现场证据之后，才能将对应验收状态改成“通过”。

**本工具的 PR/CI 成功只代表诊断能力已就绪，不代表生产阻塞解除。**
