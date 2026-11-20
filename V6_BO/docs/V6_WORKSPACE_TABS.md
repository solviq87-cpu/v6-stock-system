# 天枢智策 V6 页面与代码归类

正式界面统一使用 `V6_BO/public/nova/` 的顶栏。电脑和手机使用同一组主标签，展开子功能后主标签保持选中。授权后显示可访问的功能，原来的链接和书签仍能打开对应页面。路由归类、子功能导航和功能搜索共用 `public/nova/app.js` 中的 `WORKSPACE_ROUTES`。

| 标签 | 功能与入口 | 前端入口 | 相关后端 |
| --- | --- | --- | --- |
| 首页 | 盘面总览、策略信号、精选预览、资讯和模拟盘概览，`/pulse/overview` | `terminal-workbench.js`、`market-evidence.js` | `server.js` 的共享状态投影 |
| 行情 | 市场概览、全球行情、行情来源，`/pulse/market-overview`、`/pulse/global`、`/lab/sources` | `market.js`、`research.js`、`research-extensions.js` | `src/core/market-display-snapshot.js`、`src/core/quote-observation-view.js` |
| 选股 | 全部候选、竞价、盘中动量、一进二、二进三、趋势、预选等股票池，`/opportunities/*` | `market.js` 的 `POOLS`、`market-evidence.js`、股票研究抽屉 | `server.js` 的候选池路由、`strategies/` |
| 策略 | 策略与因子、模型、研究档案、决策、市场记忆、明日计划，`/lab/strategies` 等及 `/pulse/plans` | `research.js`、`research-records.js`、`research-extensions.js`、`tactics-view.js` | `src/core/research-workspace*.js` |
| 回测 | 历史回放、验证、成本与表现，`/lab/backtest` | `research.js`、`research-extensions.js` | `server.js` 的回测与研究接口、`src/core/eastmoney-historical-feed.js` |
| 复盘 | 盘后总览、完整来源池、竞价复盘、历史学习和人工执行，`/pulse/review`、`/pulse/review-details`、`/pulse/auction-review`、`/lab/learning`、`/assets/closure` | `terminal-workbench.js`、`market.js`、`review-pool.js`、`manual-loop.js` | `src/core/limit-review-pool.js`、`src/core/manual-decision-loop.js` |
| 资讯 | 新闻公告、风险线索、策略信号、新闻证据、消息与投递，`/inbox/*`、`/lab/evidence` | `operations.js`、`market-evidence.js`、`research.js` | `src/core/news-evidence-journal.js`、`server.js` 的新闻和发送前审核 |
| 资金流 | 板块强度、行业题材、资金排行与联动，`/pulse/sectors` | `market.js`、首页资金预览 | `src/core/quote-observation-view.js`、`server.js` 的板块状态 |
| 风控 | 持仓风险和主账户规则，`/assets/risk`、`/assets/authority` | `operations.js` | `src/core/risk-evidence-view.js`、`server.js` 的风险权限和执行检查 |
| 模拟盘 | 模拟跟踪和账务证据，`/assets/paper`、`/assets/ledger` | `operations.js` | `src/core/paper-account-ledger.js`、`src/core/paper-account-reconciliation.js` |
| 我的 | 持仓、资产历史、系统偏好、安全、设备、通知配置、诊断和发布，其他 `/assets/*` 与 `/settings/*` | `operations.js`、`app.js` 的身份入口、`client.js` | `server.js` 的鉴权与配置、`src/server/session-header-token.js` |

代码路径以 `V6_BO/` 为根，表中前端文件位于 `public/nova/`。搜索命中直接打开对应页面。增加子功能时在路由表登记一次，并注明访问角色。行情日期、账户、交易和推送由各模块原有业务契约处理。

共享样式在 `public/nova/fayo.css`，盘面和复盘的图表布局由 `terminal-workbench.js` 控制。运行 `scripts/fayo-browser-check.js` 可在隔离浏览器中核对 11 个主标签、子功能、视口布局及登录角色。
