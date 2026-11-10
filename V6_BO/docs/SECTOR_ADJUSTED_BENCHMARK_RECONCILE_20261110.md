# V6 板块复权价格、指数基准与成本假设证据对账

**2026-11-10。** 本批新增只读研究模块 `src/core/sector-adjusted-benchmark-reconcile.js`、离线入口 `scripts/sector-adjusted-benchmark-audit.js`，目标是将已冻结的 1/5/20 个交易日板块观察与**操作者独立合法取得**的复权供应商级别、同期指数总收益级别、公司行为覆盖资料及事前费用假设逐项核对。没有联网采集、券商交易、模拟盘成交或正式因子权重变化。

## 数据基础及重要限制

已合并的 `sector-frozen-forward-prices` 在信号当天冻结逐股原始价格和供应商逐股原时点，并在第1/5/20个实际交易日计算未复权原价变化。由于分红、转增、拆股、退市、盘中对齐和基准费用等不可忽略，这些结果不能当作盈利凭证。本模块**先复算并逐字段核对上游整个冻结观察报告**，再读另一份供应商声称复权后的盘中总收益价格；一旦上游被篡改，全部拒绝。

为避免把盘中价格和日线收盘价混算，只接受供应商明确声明 `provider-total-return-adjusted-intraday-level`，且每一条复权记录必须有与原始归档一致的 **rawQuoteAt + rawPrice**；独立指数也必须声明 `provider-total-return-index-intraday-level` 且指数的基准日和目标日报价时点与相应股票快照相差不超过5分钟。**普通前复权/后复权日K线不得冒充这种同时间段盘中总收益级别**。当前系统并未证明存在可合法获得的第三方源满足以上严苛协议。

独立导入来源的 `provider`、`datasetId`、`basisId`、`observedAt`、`completed`、`upstreamLicenseIndependentlyVerified:false` 均为**使用方陈述**，代码只检查其自洽性，并不能认证供应商真的算对了股息再投资、历史复权、指数成分及数据许可。所有计算结果标记为 `supplier-adjusted-reconciliation-unverified`；既非可实现净收益，也非样本外盈利优势。

## 输入协议

`input.json` 是一个私有 JSON，顶层字段：

```json
{
  "schemaVersion":1,
  "mode":"imported-sector-adjusted-benchmark-bundle",
  "source":"imported",
  "asOf":1794400000000,
  "cohort":{"...":"来自冻结价格样本完整 frozen 对象"},
  "observation":{"...":"来自对应后续价格观察完整 report 对象"},
  "rawSnapshots":[{"...":"信号后的明确 1/5/20 日全市场原始快照"}],
  "tradeDates":["2026-11-10","2026-11-11"],
  "corporateActions":{"...":"原始价格观察使用的完整公司行为审计对象"},
  "adjustedFeed":{"...":"下述供应商复权记录"},
  "benchmarkFeed":{"...":"下述同期总收益指数"},
  "costAssumptions":{"...":"信号时点之前登记的交易成本假设"}
}
```

上述是**字段位置示意**，不是有效样本；`tradeDates` 需要显式真实交易日，`rawSnapshots` 和 `observation` 必须来自上游同一批不可变归档。不允许把一份后来重新生成的股票池假扮历史冻结池。

供应商复权记录示意（须完整覆盖每个行业原始成分股的信号与目标日）：

```json
{
  "schemaVersion":1,
  "source":"imported",
  "provider":"licensed-adjustment-source",
  "datasetId":"adj-episode-202612",
  "basisId":"total-return-v1",
  "priceBasis":"provider-total-return-adjusted-intraday-level",
  "observedAt":1794400000000,
  "completed":true,
  "upstreamLicenseIndependentlyVerified":false,
  "rows":[
    {"symbol":"600001","date":"2026-11-10","rawQuoteAt":1794280000000,
     "rawPrice":12.34,"adjustedLevel":24.68,"basisId":"total-return-v1","currency":"CNY"}
  ]
}
```

指数 `benchmarkFeed` 含 `indexCode`、`basisId`、`currency:"CNY"`、`priceBasis:"provider-total-return-index-intraday-level"`、`source:"imported"`、`provider`、`datasetId`、`observedAt`、`completed:true`、`upstreamLicenseIndependentlyVerified:false`，以及 `rows:[{date,quoteAt,level,basisId}]`。不得把普通上证综指价格指数当作现金红利再投资的总收益指数。不同指数/不同口径不自动拼接。

`costAssumptions` 为可选但必须在冻结时或之前登记：`schemaVersion:1`、`source:"operator-assumed"`、`scheme:"fixed-round-trip-bps-no-rebalance"`、`assumptionId`、`observedAt`、`roundTripBps` (0–300)。其作用是列示**假设性费用后的描述性超额价格差**；不是成交撮合回测、实际券商收费、冲击成本或仓位风控。费用缺失时该列为 `null`，绝不补0。

## 计算和拒绝路径

1. 上游 `cohort` 和 `observation` 必须由已有研究函数重新核算得出；如冻结指纹、成分股、历史报告、交易日、公司行为状态发生变化则直接 `blocked`。
2. 每个目标日快照须保持同源、同日、盘中时间差≤30分钟、全市场逐票原报价时间有效覆盖率≥80%；目标日未到、快照缺失为 `pending`。
3. 第三方声明复权级别与归档的原始报价逐票 `symbol|date|rawQuoteAt|rawPrice` 精确匹配。全体冻结成员缺一只则该行业 `unknown`，避免只对幸存股票算平均涨幅。
4. 公司行为审计必须对所有相关股票完整覆盖至目标日，且审计时点不早于目标快照。公司行为发生后可以尝试读取供应商复权级别，但**不能通过代码证明其因子计算正确**，此时仍标为未独立验证。
5. 指数基准价格/总收益级别缺失或不同时间段则返回 `unknown` 而非0。
6. 输出 `providerAdjustedGrossPct`（原成分股均值）、`benchmarkTotalReturnPct`、`providerAdjustedExcessPct`（前两者之差）和可选的 `illustrativeAfterAssumedCostExcessPct`。都只是供应商与运营者数据下的*描述性研究数字*；不宣称能按盘中报价买齐股票、不推送交易提醒或自动更新正式模型。

输出中始终 `canTrain:false`、`canTrade:false`、`outOfSampleValidated:false`、`labelsAvailable:false`、`netReturnsAvailable:false`、`independentlyAudited:false`。必须等真实复权源/公司行为/指数许可核验、价格一致性、费用成交与滚动长期样本外证据后，才可能研究权重变更。

## 离线命令（不会发外部行情请求）

```sh
cd V6_BO
node scripts/sector-adjusted-benchmark-audit.js preview /srv/v6-private/adjusted-input.json
node scripts/sector-adjusted-benchmark-audit.js publish /srv/v6-private/adjusted-input.json /srv/v6-private/research-adjusted/20261110.json
node --test tests/sector-adjusted-benchmark-reconcile.test.js tests/sector-frozen-forward-prices.test.js
npm run check
npm test
```

`preview` 零写入；`publish` 只对至少一个窗口经过自洽对账的输入创建 0600 权限的**私有不可覆盖**报告和 SHA-256 本地完整性校验。出现同一路径不同内容即拒绝，不改写历史。测试全部使用构造数据；CI全绿不等于真实股票、指数和供应商许可已被验收。

代码不修改原四套选股战法、模拟盘、账户、服务端、两张锁定主页 `public/index.html`/`public/mobile.html`、真实资金或生产因子。
