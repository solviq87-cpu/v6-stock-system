# 独立历史与全市场研究客户端的供应商请求预算

基线 `b434769fde9301ed91c1cd46777b9af4b7e002e2`。本次将 `public-stock-history.js` 的默认 curl 与 `eastmoney-market-snapshot.js` 的每页默认 fetch 接入同一个 `market-request-governor.js` 单进程实例。东财历史与快照所有子域共用预算，腾讯历史与现有报价家族共用预算；不通过更换主机或传输方式绕过限制。

共享模块负责至少 1 秒的请求启动间隔、同供应商最多 1 个在途请求、有界队列和等待、429 至少 60 秒及 403 至少 15 分钟冷却，并采用更长的 `Retry-After` 秒数或 HTTP 日期。研究历史沿用东财到独立腾讯供应商的一次 fallback；同一供应商没有新增重试或备用主机。限制错误保留 `MARKET_RESTRICTED`、`status` 和 `resumeAt`。

curl 的头与体分离：头经 stdout 独立限制 64 KiB，响应体写入私有临时目录并以 curl 最大文件大小及读取前检查限制 2 MiB。最终 HTTP 状态与 `Retry-After` 只取最后响应头块，代理 CONNECT 和 100 响应不会混入原始体或哈希。临时体在成功、HTTP 限制、子进程失败和超限后清理；即使体读取失败，已收到的 429/403 仍先设置冷却。清理失败不能覆盖限制错误。保留可取得的有界原始错误体，状态仍为 unknown，不收录为日K。

全市场分页的在途槽覆盖 `response.json()`，HTTP 限制立即终止后续页面并 abort 响应。排队时间计入原有采样跨度，wire 启动时再次检查市场日期及原有最长 120 秒采样跨度；每页 Abort 超时从真正派发请求开始。`f124`、逐票 `vendorQuoteAt`、`startedAt/retrievedAt`、日K `knownAt`、原始字节 SHA256、单位、未复权和 `schemaVersion:1` 合同保持。

纯本地 `requestJson`/`fetchImpl` 测试或回放适配器默认不承担真实 1 秒等待，但仍审查返回的 HTTP 限制。适配器若执行真实外采，应显式传入共享 `requestGovernor: marketRequests`；默认 curl/default fetch 和显式传入 `globalThis.fetch` 始终经过门禁。测试可注入 `createMarketRequestGovernor` 的假时钟，不使用环境变量跳过生产门禁。

验证命令（在 `V6_BO`）：

```sh
node --check src/core/public-stock-history.js
node --check src/core/eastmoney-market-snapshot.js
NODE_OPTIONS='--require /workspace/rate-output/em-deny-egress.cjs --require /workspace/rate-output/clients-deny-egress.cjs' node --test --test-isolation=none tests/research-client-request-budget.test.js tests/public-stock-history.test.js tests/eastmoney-market-snapshot.test.js tests/eastmoney-clist-source-fields.test.js tests/market-snapshot-quote-time.test.js tests/market-temporal-integrity.test.js tests/a-share-calendar-boundary.test.js tests/sector-market-capture.test.js tests/live-market-research.test.js tests/stock-observation-research.test.js
```

`/workspace/rate-output/clients-*` 保存本地基线、两个修前失败/修后通过的反例及专项日志。新增测试完整替换 `execFile` 依赖，只模拟临时文件与响应字节；不创建子进程或访问供应商。额外扩展到旧跨进程归档测试时，强门禁拒绝了 7 个本地 Node 子进程：这次扩展不能称为全通过，需要整合阶段使用允许隔离 Node fixture 的门禁另测。没有部署、供应商实测或账户修改。

回滚时撤销本次客户端提交，并与共享模块及其他客户端调用方一起审查依赖；原始归档无需改写。单进程预算不等于跨服务实例协调，也不证明供应商授权或实时认证。
