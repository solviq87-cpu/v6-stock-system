# 天枢智策 V6 — 原始分红行结算角色与重复引用门禁（2026-11-15）

## 基线与发现
基于 `dev@f3c885071af5e218aeb86b71f7b981ded4f40be5` 的已有 `corporate-source-linkage.js` 离线审计。历史原始报告会保存供应商 JSON 行哈希和逐页原始字节哈希，已有代码阻止**相同 eventId** 重复，但两个不同 `eventId` 可以指向同一条分红源行、同一种权益结算并各自获得 `matched-row-only-not-certified`；此外分红类报告可能被错误当作配股、退市清算、零碎股现金结算的行级佐证。

本轮**只加固离线只读关联审计**，不修改供应商原始行情、历史账户、结算服务、四套策略、锁定首页或 WorkBuddy 唯一云发布者。

## 约束
- `RPT_SHAREBONUS_DET` 报告的行级关联只允许 `cash-dividend`、`share-distribution` 两个**可能相关**的结算类别；配股认购、退市现金结算与零碎股现金事件一律显示 `DIVIDEND_REPORT_DOES_NOT_SUPPORT_SETTLEMENT_KIND`、`not-point-in-time-supported`。同一分红记录可以分别关联现金和转增两种事件，但仍须实际结算凭据和可流通证据才能执行。
- 单份审计里同一个 `sourceRecordId` 与同一 `kind` 被两个不同结算事件引用时，**所有相关事件**均标记 `SAME_SOURCE_ROW_REUSED_FOR_SAME_ENTITLEMENT_KIND`；不能用改 `eventId` 制造多笔独立分红。旧同 `eventId` 重复拒绝依然保留。
- 结算记录自称的 `publishedAt` 如果**晚于已封存原始源行的 `knownAt`**，或来源自身日期精度的 `PUBLISH_DATE` 晚于采集的北京时间日期，均标记时间矛盾。真实修订必须有相应新的源证据，不能把后发结算声明挂到旧归档。
- 逐笔输出 `sourceRoleClaims` 计数和 `sourceEconomicTermsVerified:false`、`cashPaymentDateVerified:false`、`sharesAvailableDateVerified:false`；绝不推断每股金额、股权登记、股份可卖日期或供应商真实性。顶层一直 `canApplySettlement:false`、`canTrade:false`、`pointInTimeBacktestReady:false`。

## 验收
`tests/corporate-source-linkage.test.js` 新增重复角色、跨类型关联、源公告时间矛盾等离线负例，已经由既有 `a-share-session-data-quality` GitHub Actions Job 显式调用。还需原 `V6 CI` 全量及网页/账户隔离回归全部通过后才可合并。

```bash
cd V6_BO
node --test tests/corporate-source-linkage.test.js tests/public-stock-status-evidence.test.js tests/historical-corporate-pit.test.js
npm run check
V6_MODEL_PYTHON=python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

本轮不自行联网查询并宣称真实商用许可。合并前关闭PR或合并后用正常 Git revert 回滚，不能从旧ZIP覆盖新工程。
