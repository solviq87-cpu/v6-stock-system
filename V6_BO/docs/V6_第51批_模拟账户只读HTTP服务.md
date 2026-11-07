# 第51批：模拟账户只读 HTTP 服务

## 已完成
- 新增 `src/core/paper-service.js`：本机回环监听、Bearer 令牌校验、每次请求重新校验持久化账户完整性。
- 新增 `scripts/paper-service.js`：可独立启动服务。
- 新增 `tests/paper-service-http.test.js`：实际 HTTP 请求测试，覆盖授权、只读、报告、篡改及禁止公网监听。
- 完整回归：276/276 通过，0 失败。

## 启动
先使用 `node scripts/paper-session.js init account.json history.json` 创建离线账户，再设置环境变量 `V6_PAPER_VIEW_TOKEN`（至少24字符）并运行 `node scripts/paper-service.js account.json`。默认端口8765，可用 `V6_PAPER_PORT` 调整。

GET /api/paper/health、/api/paper/status、/api/paper/report 均要求 `Authorization: Bearer <token>`。只允许本机访问；跨设备访问需要另行设计认证代理，禁止将令牌直接写入手机网页或前端源代码。

## 明确未完成
- 未接入主站登录权限体系或桌面/手机页面；不能将本地 Bearer 令牌暴露到客户端。
- 未完成自动行情采集、持续调度、交易日校验、数据源公网连通性。
- 未完成真机、浏览器和生产环境验收。
- 模拟账户不提供下单接口，不构成实盘交易系统。
