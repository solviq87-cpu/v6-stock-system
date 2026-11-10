# 行情来源对：重复差异的离线研究隔离

此模块仅对 `compareMarketFeeds()` 已产生的原始只读核对报告分组分析，不接网络、不改实际供应商优先级、不输出权威成交价、不接模拟/真实资金。

## 研究语义

- 只接受 `schemaVersion:1` / `independent-feed-shape-and-value-consensus` / `releaseReady:false` / `canTrade:false` / `verifiedExternal:false` 的完整报告。
- 同一**无序**供应商对与相同复权口径一组；不同供应商名字不能证明上游独立，历史逐日样本独立性也未认证。
- 每份证据必须保留供应商、数据集 ID 与原 SHA256 指纹。同一对指纹、数据集的重复提交只算一次；若同一证据改写一致性结果或时点信息，整个报告失败。
- 默认至少 **3 组不同指纹证据**、至少 **2 次核对不一致**才输出 `quarantined-pair` 研究标签。证据不足输出 `insufficient-evidence`，其余 `observed-pair`。这些都不是自动停用或偏好供应商的指令。
- 不按接收时间伪造供应商时钟。`timestampedReports` 表示有双源观察时钟证据的报告数，不证明实时或跨日采集。行情上游、授权、复权及交易所真实性仍未验证。

## 验证与边界

```sh
cd V6_BO
node --check src/core/feed-discrepancy-quarantine.js
node --test tests/feed-discrepancy-quarantine.test.js
npm run check
npm test
```

此模块默认无 CLI、网络或后台常驻轮询。不会将坏的研究对自动归罪于东财/腾讯/新浪任一家，更不会取均价冒充最终价。多交易日来源质量另走明确交易日、原始输入冻结及可复算报告的研究流程。合并时必须由当前 PR 最终 head 的 `verify` 与 `verify-web` 全通过，并在 `dev` 合并后重新检查；CI 不是实际盘中供应商稳定性、许可或真实收益验收。
