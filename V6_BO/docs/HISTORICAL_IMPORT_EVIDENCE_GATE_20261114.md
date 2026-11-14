# 天枢智策 V6 · 严格历史双源导入与数据证据完整性门禁（2026-11-14）

## 在最新 dev 上增量补强，不重复造源登记

此修复在已合入 `data-source-lineage.js`、89 路来源目录、`multi-source-price-consensus.js`、`research-cross-source-history.js` 等既有模块之上工作，不替换它们，保留新的数据源清单、UI、云端账本与测试。

### 主要变更

- 历史 `compareMarketFeeds` 支持 `requireKnownIndependentUpstreams:true`。严格模式拒绝来源目录尚未登记、底层上游模糊、同一上游的包装接口。原无时间/无金额 fixture 仍可走**研究形态比较**，不能升格为已验证独立。
- 新增七项 `evidenceChecks` 与 `evidenceCoverageScore`、`researchComparisonReady`。这是**证据覆盖度**，不是行情准确率、行情授权、供应商认证或交易可用性；即使 100 分，`canTrade` 和 `releaseReady` 永远为 false。
- 设置 `secondaryFile` 的 `market-data-center` 现在按严格模式收数，要求真正不同的已登记上游家族、同日期/复权口径、双方股/人民币元完整金额、双方采集时点（最多相差五分钟）与价格成交数据一致；有差异或证据缺失时不覆盖前一份成功记录。无副源的原有导入路径保持向后兼容，但**不宣称已做双源验证**。
- BaoStock 原有完整 EOD 原始适配包增加 `upstreamGroup:'baostock'`、`priceAdjustment.mode:'unadjusted'`、`volumeUnit:'shares'`、`amountUnit:'CNY'`、`amountBasis:'actual-unadjusted-turnover'`，保留停牌、公司行为和原始采集时钟门禁；额外字段会改变归档字节，请新建研究输出文件，禁止覆写已存在的旧归档。
- 东方财富旧默认前复权 `em-qfq-v2` 恢复之前的不可变身份算法；新的 fqt=0 不复权数据仍用独立 `em-unadjusted-v2` 身份。采集完成时间只在本地元数据中报告，绝不冒充供应商原始 `quoteAt`，避免破坏已存在跨源研究的时间字段含义。
- 在现有 `multi-source-data-lineage` GitHub CI 检查中补 BaoStock EOD 和导入落盘端到端测试，不创建一个同名重复任务。

### 实证边界

这些改动通过离线测试可验收数据类型与安全拒绝逻辑，但尚未拿到交易所签发的真实价格证明，历史数据**数值一致不等于真实准确**。本次不修改生产实时订阅、旧价 15 秒风控、实盘授权或部署发布者。

```bash
cd V6_BO
node --test tests/market-feed-consensus.test.js tests/market-data-center-e2e.test.js tests/baostock-eod-research-bridge.test.js tests/eastmoney-historical-feed.test.js tests/data-source-lineage.test.js tests/research-cross-source-history.test.js
npm run check
V6_MODEL_PYTHON=python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

实际通过情况以 GitHub PR 最新 HEAD 的 CI 记录为准。无 CI 绿灯不合入 `dev`。回滚请使用 Git revert，不覆盖历史压缩包或账户。
