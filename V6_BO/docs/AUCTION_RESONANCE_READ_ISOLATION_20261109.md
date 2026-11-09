# 竞价观察池读写隔离与旧快照审计 · 2026-11-09

## 发现的实际问题
1. 原 `GET /api/auction-resonance` 虽不携带 `force=1`，缓存过期后的普通读取仍会执行 `pushAuctionResonanceTop3` 和 `logSignal('aucres')`。手机、电脑分别刷新会导致飞书行为和学习样本取决于有多少人打开页面，破坏去重与样本完整性。
2. 该 GET 会调用 `scoreSmoothOf` 改写共享 EMA 观察历史，还可能调用 `klineRows` 触发历史行情回源和缓存写盘。
3. 冷启动会恢复旧的 `S.auction`；原共振扫描使用其 `strong` 而没有验证竞价归属日、阶段与股票行情快照是否同日。周一开盘前有机会把周五的竞价指标拼进新的候选榜。
4. 共振缓存按板块存储，但不记本轮 `max`，先请求 Top1 再请求 Top40 会在 TTL 内错误裁剪第二位用户的候选。

## 代码修复
- `src/core/auction-resonance-basis.js`：独立只读审计，必须同时匹配**北京时间自然日**、行情快照归属交易日、竞价记录归属交易日、竞价阶段 1/2/3 与时间窗口。缺证据时拒绝使用竞价得分；不伪造 `providerQuoteAt`，`verifiedLive=false`、`executedAmountCertified=false`。
- `server.js`：每次共振扫描统一携带 `auctionEvidence`，逐股区分 `auction-snapshot-unverified` / `sector-only`，不给板块候选冒充竞价策略；时段外 `isSnapshot` 标注保留历史研究，不认实时。
- **外部 GET 与开发者手动查询均无飞书及学习登记副作用**。自动共振通知与样本记录迁到服务器独立的 `guard('auction-resonance-internal')` 60秒任务；仅单主实例、交易日 9:20–9:30、同日真实归属、全A接收不超过120秒且竞价记录存在时调用。原推送冷却/私密通道保护不改；不新增其他发送通道。
- 页面计算只使用内存历史K线；`scoreSmoothOf` 使用 `dryRun` 只生成预览，不写入共享 EMA。原其他策略和内部服务器观测继续用已有更新行为。
- 每板块缓存增加 `max` 字段，小查询不影响另一个设备随后需要的更大结果数。
- `public/assets/auction-picks-page.js` 逐票标记“板块观察 · 没有有效竞价证据”或“当日竞价快照 · 未验原始时间”，并显示旧快照不能拼接的原因；页面依旧 GET，不保存任何本地账户数据。

## 测试与局限
- `tests/auction-resonance-basis.test.js`：隔夜、周一盘前、阶段与时间一致性、缺时戳拒绝。
- `tests/auction-resonance-read-isolation.test.js`：**动态运行实际扫描函数**，检查 GET不推送、不学习入库、不K线回源、不写平滑历史；内部定时流程仍可记录；Top1→Top2缓存互不干扰。
- `tests/auction-picks-ui.test.js`：UI标明旧竞价证据、授权失效清屏。
- 保持 `node --test tests/*.test.js`、网页构建与真实服务器HTTP启动测试通过后才合并。

**没有认证的内容**：原 `S.auction.date/time` 仍是系统记录的快照归属时间，而非供应商逐股票真实报价时点。服务器上的真实行情可用率、竞价成交数据来源授权、手机 Safari 与桌面参考图对照、WorkBuddy部署、飞书终端实际送达和样本外策略有效性仍需单独现场验收。不能把本次离线 CI 当成上述验收。部署前必须保证现存依赖本地时区的交易日历与定时任务使用 `TZ=Asia/Shanghai` 并实测。
