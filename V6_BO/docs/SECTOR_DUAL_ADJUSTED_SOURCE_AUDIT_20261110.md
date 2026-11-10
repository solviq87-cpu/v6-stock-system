# V6 板块研究：两家供应商复权收益与指数一致性审计（2026-11-10）

## 目的与边界

上一批已增加 `sector-adjusted-benchmark-reconcile`，将同一批冻结行业成分股的原始报价、供应商声称的盘中复权总收益价格和同期总收益指数逐条核对。但**单一供应商内部一致**不能证明其复权因子、公司行为、总收益口径或源许可正确。本批增加**双来源差异检查**，让不同来源的坏数据不会通过简单求平均而被掩盖。

这是只处理本地明确导入的研究数据的**只读对账**，没有自动网络访问、供应商登录、商用许可认证、证据独立性外部验证、模型训练或真实/模拟盘下单。两家不同名字并不证明商业上完全独立；一致只能叫 `supplier-agreement-unverified`，不是正确性认证。用户没有提供可用的双来源真实总收益盘中价格，因此测试为合成样本，不能宣称已接通真实复权数据。

## 输入结构

`bundle.json`：

```json
{
  "schemaVersion":1,
  "mode":"sector-dual-source-imported-evidence",
  "source":"imported",
  "asOf":1794400000000,
  "policy":{
    "schemaVersion":1,
    "mode":"operator-dual-source-tolerance",
    "declaredAt":1794300000000,
    "maxStockReturnDifferenceBps":20,
    "maxIndexReturnDifferenceBps":10
  },
  "primary":{"...":"从上一批输入协议中导入完整的主源对账对象"},
  "secondary":{"...":"相同冻结原始证据+不同供应商复权及指数数据的完整对象"}
}
```

以上是**协议位置示例**，不是有效可运行数据。实际 `primary`、`secondary` 均采用 `reconcileSectorAdjusted` 输入结构：
`cohort`、`observation`、`rawSnapshots`、`tradeDates`、`corporateActions`、可选 `costAssumptions`、`asOf`、`adjustedFeed`、`benchmarkFeed`。

两份数据的**原始冻结成分、原始价格、报价时点、公司行为、显式交易日历、研究时钟和成本假设必须逐字段完全一致**；只能是不同的 `adjustedFeed` 和 `benchmarkFeed`。对报价一致性的前置审核会对两条输入分别完整执行上一批已通过测试的复权与指数对账器，不接受手填最终毛收益数字。两个 `adjustedFeed` 的 `provider` 和 `datasetId` 不得相同；两个 `benchmarkFeed` 也须不同 `provider`、`datasetId`，但同一 `indexCode`。不同的复权基数与指数点位基数可以存在，只比较**相对变化**，不直接比较绝对价格。

比较阈值必须在原信号冻结前声明：
- 股票逐票远期收益差阈值：1–100 bps（1bp = 0.01 个百分点），示例 20bps；
- 同一总收益指数的两个供应商回报差阈值：1–100 bps，示例 10bps。

这两个数是**用于演示的运营者阈值**，不代表某供应商许可或行业正式标准。后续阈值研究应有预注册/反数据窥探门禁；本模块只能检查输入里的时间字段自洽，不能独立证明历史上已预注册。

## 审计规则

1. **逐股，而非均值**：对每一只冻结股票，取各供应商分别报告的 `targetAdjustedLevel/baselineAdjustedLevel-1`，比较两个百分比收益的基点差。任一股票差值超限，整个行业就标 `disagreement`，不通过平均把异常抵消。
2. **指数独立核对**：同一个 `indexCode` 的两个供应商的盘中总收益指数计算相对变化；差异超限会阻断该窗口的所有行业一致性。指数价格指数、日线收盘、不同复权基础不能混为一谈。
3. **缺失证据不填零**：缺某个股票、公司行为、原报价时点、复权价、基准或供应商验证时，该行业 `unknown`；完整档案未成熟为 `pending`，不自动换用第六个交易日替代第五个。
4. **上游先审后比**：每份输入先调用已有 `reconcileSectorAdjusted` 的冻结指纹/逐股票报价/时间戳/分类版本/公司行为核对。若报告被篡改、来源与冻结证据冲突或日历不一致，直接 `blocked`。
5. **不可晋级**：即使全部一致，报告永远保留 `canTrain=false`、`canTrade=false`、`outOfSampleValidated=false`、`providersIndependentlyVerified=false`、`sourceLicenseIndependentlyVerified=false`。报告不包含所谓“最终可交易价格”，不向正式选股、模拟盘或多源行情共识引擎写入任何价格。

## 命令与归档

```sh
cd V6_BO
node scripts/sector-dual-source-audit.js preview /private/research/sector-dual-source-bundle.json
node scripts/sector-dual-source-audit.js publish /private/research/sector-dual-source-bundle.json /private/research/reports/dual-source-20261110.json
node --test tests/sector-dual-adjusted-source-audit.test.js tests/sector-adjusted-benchmark-reconcile.test.js
npm run check
npm test
```

`preview` 不写数据、不联网；`publish` 只保存私有、不可覆盖且权限0600的本地研究报告，文件以 SHA-256 做本地内容一致性检查（不是电子签名）。同一路径重复相同发布幂等，不同内容拒绝覆盖；被阻断或全部不完整的数据不保存可误导的完整报告。

## 下一步的真实世界验收

需要核验公开/付费合法来源是否提供**同交易时段盘中总收益级别**与完整公司行为记录，并取得授权、实际接口质量、指数相同口径、足够日期与市场环境的真实数据，再进行时间隔离的 walk-forward 和反负优化检查。不能用网页同时返回 HTTP 200、两家报价接近或单次测试成功，替代真实复权与持续质量验收。不得因此改变历史行业成员、四套正式策略、账户、模拟盘或锁定的 `public/index.html`/`public/mobile.html`。

此批独立文件完全回滚即可撤销该研究审计，不损坏既有不可变快照。
