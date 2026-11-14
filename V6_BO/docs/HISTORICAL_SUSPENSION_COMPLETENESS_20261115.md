# V6 双源历史日K停牌证据完整度门禁（2026-11-15）

## 问题复现
旧 `compareMarketFeeds()` 只在任一家来源给出 `suspended` 字段时检查停牌差异。**双方都不提供该字段**，但OHLC、成交额、成交量均一致时，仍会被标记 `consensus=true`、`evidenceQuality.status=consistent-research-only`，在 `createMarketDataCenter({secondaryFile})` 的严格写入链路里可能被当成完整证据。

## 增量修复
- 保留 `consensus` 旧语义：它描述数值/已声明字段一致，不能证明两家供应商真实独立或股票没有停牌。所有研究输出仍 `canTrade=false`。
- 增加 `suspensionCoverage`：统计全量日K中**两边都有明确布尔停牌标记**的行数，以及单边/双边缺失行数；按股票保留 `matchedBars/missingBars`。两边都缺失不会自动写入 `suspended=false`，而会保留未知证据。
- `evidenceQuality.findings` 新增 `SUSPENSION_EVIDENCE_INCOMPLETE`；评分采用实际加权的最高85分刻度（非准确率，非交易所认证），缺停牌覆盖时必然降分、状态为 `incomplete-evidence`。带 `secondaryFile` 的严格历史导入只接受证据完整的研究一致结果；缺失不能覆盖历史。
- BaoStock简化日线适配器只从原始行 `tradestatus='1'` 明确映射 `suspended:false`；没有上游停牌标记就拒绝，不会因为成交量>0而猜测状态。东财未提供来源停牌证据时不造假，严格导入会继续拒绝，直到获得可核验的逐日状态。
- 本轮不修改四套策略、账户、价格缓存、锁定的 PC/手机主页、唯一发布者，不购买服务或启用实盘下单。

## 对既有消费者的影响
纯研究比对与 `research-cross-source-history` 仍可查看数值是否一致；但“数值相同”不应被描述为已核实停牌日或授予交易权限。新 `suspensionCoverage` 与 `evidenceQuality` 仅补充审计信息；只有 `secondaryFile` 的严格写入更加保守。历史档案保持不可因缺证而覆写。

## 验收
`node --test tests/market-evidence-enforcement.test.js tests/market-feed-consensus.test.js tests/baostock-historical-normalizer.test.js`，以及原 `multi-source-data-lineage` 独立 CI 和 `npm test` 完整回归。CI未完成或失败时不合并。

仍需按官方交易日历、公司行为公告及真实许可获取独立证据。局部布尔标记来自供应商声明，**不是交易所核验**。回滚用正常 `git revert`，禁止从旧压缩包覆盖完整工程。
