# V6 历史价格复权口径与模拟回测隔离门禁（2026-11-15）

## 审查问题
原 `historical-validation.validateDataset()` 检查逐根K线的 `bar.priceBasis`，却未核对数据集顶层的 `priceAdjustment.mode`。东方财富历史适配器默认返回 `qfq`（前复权），其逐日bar没有额外的 `priceBasis` 字段；原 `runValidatedBacktest`、`evaluateResearchSuite` 和 `replayPaperAccount` 只调用通用的形状验证，从而可能把前/后复权的展示价格当成历史真实开盘成交价，污染费用、收益和账本。

## 本轮增量修复
- 新增 `src/core/historical-execution-price-basis.js`：在**模拟撮合/账本回放**边界拒绝任何明确声明的前复权、后复权、未知/无效 `priceAdjustment` 或 `priceBasis`。对于明确标记未复权的原始行情继续允许离线研究，不授予实盘交易许可；在已知东财fqt、BaoStock调整编码与所称口径矛盾时也拒绝。
- 将门禁分别接入 `runValidatedBacktest`、`evaluateResearchSuite`、`replayPaperAccount`、`paper-session.buildSession` 和已持久化快照的 `validateSession`。即使伪造新哈希，也不能将已明确复权的纸面账户按原价继续使用。
- **不修改** `validateDataset()` 通用历史数据形状校验：前复权行情仍可做 K线查看、离线研究和同口径数值比对，但不能成为模拟买卖的执行价格。也不擅自删除已有工程、账户或策略功能。
- 为兼容早期离线历史，完全未声明口径的旧数据仍按原入口读取，但明确标为 `legacy-undeclared-unverified`（该标记来自独立检查函数，不代表已经核实原始价格）。未来可做分阶段迁移，不能把缺失标签推断为真实未复权。

## 验收和限制
- 专项 `tests/historical-execution-price-basis.test.js` 覆盖 qfq/hfq 四路拒绝、错误声明、已明确未复权正例、旧数据兼容与封存快照复核，并加入既有 `a-share-session-data-quality` CI，完整 `npm test` 保持运行。
- 价位口径正确仍不足以认证交易所原始行情、公司行为、停牌、交易日或数据授权。全部输出 `canTrade=false`。
- 未修改锁定 PC/手机主页、生产账本、四策略权重、云端唯一发布器或实盘接口。

复现：
```bash
cd V6_BO
node --test tests/historical-execution-price-basis.test.js tests/research-validation-suite.test.js tests/paper-session.test.js tests/paper-replay.test.js
npm run check
npm test
```
若需要回滚，关闭未合并 PR 或对合并提交执行 `git revert`；不可用旧 ZIP 覆盖主线。
