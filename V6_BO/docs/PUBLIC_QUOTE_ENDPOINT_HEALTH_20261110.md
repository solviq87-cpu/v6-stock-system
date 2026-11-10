# 公开 A 股行情接口：独立健康诊断（一次性、只读）

使用：在 `V6_BO/` 目录运行 `node scripts/public-quote-endpoint-health.js 600519`。

**本功能不会启动服务、自动轮询、回测、模拟撮合或任何实盘指令；不修改生产行情链路。** 它只是帮助定位同一只股票的三家公开网页接口为何成功或失败。仅在北京时间周一至周五常规连续竞价窗口 09:30–11:30、13:00–15:00 发起单轮请求；这是时钟窗口，**不识别法定节假日**。节假日未认证时不能认定真实开市。

每个来源（腾讯、东方财富、新浪）各请求**一次**，三路并行，超时默认 5 秒，整个响应最多读取 64 KiB，格式错误不尝试补零。结果逐源保留 HTTP 状态、耗时、报价原始时点、距采集时的时间差、供应商报出的价格及前收。

| 来源状态 | 解释和处理 |
| --- | --- |
| `fresh-source-unverified` | 供应商时间在 15 秒内且处于工作日常规连续竞价时间窗；**不等于交易所认证实时** |
| `dated-snapshot` | 过期报价或检查结束时跨过午休/收盘；带原报价日期展示，不得充当最新成交价 |
| `redirect-refused` | 返回 HTTP 3xx（例如东财主域跳 delay 域名）或 `opaqueredirect` 不透明跳转；**只报告状态，不跟随或读取 Location、不访问新域名，也不把延迟镜像计为独立数据源**。不透明跳转无法获取真实 HTTP 状态时，`httpStatus:null` |
| `access-denied` / `rate-limited` | HTTP 401/403 / 429；不重试，不绕过 |
| `timeout` / `transport-error` | 超时或网络层失败；不假设服务本身失效 |
| `invalid-quote` / `response-too-large` | 字段、原时点或体积不可信；拒绝使用 |
| `not-requested` | 不在常规时间窗，**无外部请求** |

输出始终 `providerLicensed:false`、`verifiedLive:false`、`exchangeCalendarVerified:false`、`canTrade:false`、`canNotify:false`。这条诊断路径**不提供参考成交价，也不修改** `multi-source-price-consensus.js`。

2026-11-10 的证据分级：早前网页工具调用东财会跳转到 `push2delay.eastmoney.com`；WorkBuddy 云端沙箱约北京时间 14:03 使用 Python urllib 主域直连成功、未重定向，且源时点随交易窗口变化。这是**不同网络环境、不同客户端的观察**，不能证明 V6 目标 Node 服务器正常直连或具有商用数据授权。新浪此前出现过 403 或超时。此命令的作用是**让目标 Node 环境自己提供证据**，未经实际运行不能声称已完成端到端验证。

验收：`node --test tests/public-quote-endpoint-health.test.js`，随后运行仓库既有 `npm run check`、`npm test` 和 GitHub Actions。所有结果不包含 Token、登录信息或 Location URL，不追踪链接，不自动采集第二次。
