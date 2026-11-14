# 天枢智策 V6 · 公司行为原始公告行与历史结算证据关联（2026-11-15）

## 问题与修复范围

上一轮已在 `historical-validation.js` 拦截公司行为结算的盘后公告前视和缺少对应日期的事件。**但单独的 `sourceRecordId` 字符串仍然不足以证明历史结算来自哪份供应商报告的哪一行。**

本轮基线是 `dev@d6eb690ccb01589587014e8133e6beb68e3b2b76`，复用现有 `public-stock-status-evidence` 的东方财富分红报告分页、原始 HTTP 字节、SHA256、逐行供应商日期、真实采集时间。不购买新数据源、不调用未授权接口，不更改任何账户/策略/订单/双端首页。

## 新的只读审计链路

- `public-stock-status-evidence.js` 新增每条供应商 JSON 行的 `sourceRecordId`（SHA256 of parsed vendor JSON row）和 `recordHashBasis`。**行内容哈希不是来源签名**；`rawEvidence.sha256` 单独保存未经重新序列化的原始响应字节哈希。
- 新增 `corporate-source-linkage.js`：仅消费已有归档，核对指定股票、分页完整度、固定源地址/请求报告类型、每页 SHA256、原始记录ID、规范化 `vendorDates` 日期原文与日期精度、记录真实 `knownAt`。少一页、历史记录被改、跨证券或原始字节被替换都拒绝输出“证据匹配”。
- 可选读取历史 `settlements` 清单：仅当 `sourceRecordId` 指向归档中的确切供应商行、`provider=eastmoney`、证券一致、股权登记日早于除权日、实际采集在该事件 `effectiveDate` 09:30 前、声称的发布时间与日期关系没有矛盾时，输出 `matched-row-only-not-certified`。未命中、同一事件重复、晚到才采集、账本到账日与除权日不同、来源公告精度不足等情况明确标注并阻止提升为点时证据。
- **分红到账日期可能不同于除权除息日**，不能因为供应商有除权日期就证明现金到账或转增股份已可流通。即使显示 `matched-row-only-not-certified`，仍保持 `originalPublicationInstantVerified:false`、`pointInTimeBacktestReady:false`、`canApplySettlement:false`、`canTrade:false`。
- 所有原始 bytes 只读，不把供应商原文复制到审计报告。没有官方逐事件公告正文/股权登记和到账记录的独立核准，不能升级任何生产建议。旧 `validateDataset`、模拟盘账户、企业行为资金流水原逻辑不变。

## 独立离线入口

```bash
cd V6_BO
node scripts/audit-corporate-source-linkage.js \
  /private/public-stock-status-capture.json \
  /private/corporate-settlements.json \
  /private/new-audit-result.json \
  1794556800000
```

第四参数是**实际核验毫秒时间戳**，上例仅为用法示例，不应直接作为生产时钟。输入均须是非公共目录下的本地普通文件，输出只允许已有私有目录的新路径，拒绝覆盖；不会联网、调账户或触发推送。

## 自动验收

`a-share-session-data-quality` GitHub CI Job 增补实际语法和 `corporate-source-linkage.test.js`、`public-stock-status-evidence.test.js`，验证：真实原始行匹配、改写来源哈希/日期/时间失败、晚到档案不得回填旧日期、现金到账日与除权日不混淆、重复 ID 拒绝、输出文件 0600 且不能覆盖。同时执行完整 V6 回归。

未跑通本 PR 最新 HEAD 全套 CI 之前不合并。外部数据许可、交易所原始公告真实性、实际实盘可用性仍未验收；不可用模拟数据代替实测。若回滚，合并前关闭 PR，合并后用 `git revert` 恢复，不覆盖历史账号和研究档案。
