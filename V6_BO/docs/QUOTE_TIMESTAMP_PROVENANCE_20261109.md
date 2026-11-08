# V6 国内公开行情原始报价时间与请求时间分离（2026-11-09）

## 修正的误区
东财 `clist/get` 全市场分页请求日期来自采集时服务器的中国市场日期，**不是每只证券的原始成交或报价时间**。此前候选交集里的 `quoteDate=snapshot.date` 会让不含逐股时间的旧收盘数据被误读为“当日报价”。这次把两者分离，禁止靠服务器接收时点伪造来源时间。

## 新的数据边界
- 原接口请求字段增加可选 `f124`，按“供应商返回的Unix秒报价时点”解析。只有 10 位有效秒数才形成 `vendorQuoteAt`；其他情况明确 `null`，绝不使用服务器请求/接收时间补齐。
- `joinObservedCandidates` 的 `requestDate` 只表示本次市场快照请求日期；`quoteDate`、`quoteAt` 来自供应商原字段。没有 `f124` 就是 unknown，前一个交易日的报价标记 historical-snapshot，源端时间过期标记 stale-source-time，未来时间标 future。即使时差在90秒内，状态也只是 `recent-source-unverified`，不认证交易所实时。
- 市场宽度 `breadth` 仍可基于明确来源的涨跌幅计算，候选和原评分保持原顺序；**但用于研究风险判断的 `evidenceReady` 现在要求该证券有近期源端原始时点**，缺失、陈旧、错日都判为证据未知，不会被“总市场覆盖率高”替代。
- 现有 `POST /api/research/live-market`（需开发者权限）返回新的 `quoteTimeAudit`、带原时点字段的 `candidateIntersection` 和更严格的 `riskEvidence`；不增加外网请求接口、不自动拉取新股票。
- 研究页展示“请求日期（非报价日）”、供应商自报的股票时间、时点状态，并显示近期/未知原始时点统计。更新网页脚本版本以防浏览器缓存旧列表。

## 严格限制
- `f124` 的口径是第三方公开接口自报，未核实交易所认证；部分证券可能未返回或不是持续更新字段，系统会展示未知而不是模拟值。
- 90秒是本地研究证据时效阈值，并非延迟行情授权、稳定服务SLA或保证成交条件。休市时不因“今天请求”认定旧价为新价。
- 没有改变上市公司公告、原15因子、原四套策略、研究观察池/模拟账户的权威评分、账本和风控；未建立券商实盘接入。
- 对公网公开网页请求的频率、权限、可用性仍需按数据供应商授权限制验收；GitHub自动测试不能证明国内线上供应商可达，国内可用性必须实际部署后测。

## 自动验证
`node --test tests/market-snapshot-quote-time.test.js tests/eastmoney-market-snapshot.test.js tests/live-candidate-bridge.test.js tests/research-risk-gate.test.js tests/live-market-ui-integration.test.js`。PR CI 跑后端全量 Node 和网页构建测试；只有成功才合并到 dev。
