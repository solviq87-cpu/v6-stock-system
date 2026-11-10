# V6 板块 H5：信号当日市场环境分层压力审计

2026-11-10。对已合并的 `sector-h5-walkforward-cost-audit` 结果增加**市场上涨／下跌／持平**的只读分层审计。它不更改原有市场行情取数方式，不引入第二次在线采集，不触碰双端 UI、原四套策略、十五因子、模拟盘与真实账户。

## 输入和用法

纯函数：

```js
const {auditSectorH5MarketRegime}=require('./src/core/sector-h5-market-regime-stress');
const result=auditSectorH5MarketRegime(frozenEpisodes,indexEvidence,{
  tradeDates, asOf, roundTripCostBps:30
});
```

- `frozenEpisodes` 是此前 PR #108 的 24～80 个完整 `{preflight, labels}` H5 冻结批次，每批全行业、全成员必须有合格 H5 价格标签。先调用已存在的全量一致性校验，若异常、日期重复、未来收益未成熟、跨来源、H5 窗口重叠或数据不足，**不输出分层结果**。
- `indexEvidence` 每个信号交易日 **恰好一条**市场指数历史证据对象，不得缺项、重号或对某些收益表现好的日子才追加。协议：
```json
{
  "schemaVersion":1,
  "source":"imported",
  "indexCode":"000001.SH",
  "provider":"operator-index-source-unverified",
  "tradeDate":"2026-11-10",
  "quoteAt":1794274740000,
  "observedAt":1794274800000,
  "previousClose":3000,
  "close":3015
}
```
  这些时间和价格是**协议示意**而不是已检验的真实行情；部署必须使用实际取得、被授权使用的指数逐日价格及供应商原始时点。
- `indexCode` 支持 **上证（000001.SH）、深证（399001.SZ）、创业板（399006.SZ）** 的单指数研究；每批必须为同一指数和同一来源，不能在一份报告里拼不同指数。A50 的具体授权、符号、时区和交易时段仍需另行核实，不随意当作 A 股同一交易时段指数。
- 指数观察时刻、原始报价时刻必须为信号同日，并且**不能晚于当时已冻结的板块排名观察时点**；原始报价年龄不得超过5分钟。指数价的上日收盘价字段必须大于0，日涨跌绝对值必须在25%以内（异常拒绝）。
- 研究环境固定分类：`close > previousClose` 为 `up`，小于为 `down`，相等为 `flat`。**不根据未来 H5 表现调整阈值，也不用未来价格决定当天市场环境。**

## 输出的含义

沿用原 PR #108 的时间切分和假设往返成本，每个 train / validation / holdout 分组再拆成 up / down / flat。每组至少3个彼此H5不重叠的信号日，才公布：

- 领先行业减当天所有行业平均的 H5 **未复权毛价格差**；
- 扣掉固定基点费用压力后的**差额**（不是交易可成交净收益）；
- 成本压力下的正值次数与比例、单期最差差额。

少于3个信号日，`status=insufficient-regime-samples`，各平均值均为 `null`，不以0填充，不选择性丢掉亏损样本。即使上涨市场有收益，也不能推断下跌市场同样有效。两种环境下的差异不表示某个行业因市场涨跌而发生可验证因果关系。

## 风险边界

所有结果均保持：

```json
{
 "priceSourceAuthorized":false,
 "prospectiveCertified":false,
 "outOfSampleValidated":false,
 "eligibleForResearchPromotion":false,
 "canTrain":false,
 "canTrade":false,
 "canNotify":false,
 "autoPromotion":false,
 "weightsChanged":false,
 "productionWeightsChanged":false
}
```

输入的供应商、收盘价、时间戳均是自报原始证据，不是交易所认证。研究分组并未进行风险暴露中性化、流动性/股价涨跌停可成交性、真实佣金/印花税测算，不允许直接转入因子训练器或正式选股。

## 验证

在 `V6_BO`：

```sh
node --check src/core/sector-h5-market-regime-stress.js
node --test tests/sector-h5-market-regime-stress.test.js tests/sector-h5-walkforward-cost-audit.test.js
npm run check
npm test
```

合成测试覆盖上涨/下跌分组差异、缺某种环境为 `unknown`、同源同指数、原报价时间超时/晚于信号、修改假设成本、完整H5标签被篡改或重复、无效指数价格等；它只验证接口和拒绝规则，不证明现实收益或实际接通了指数行情。文件只在新增研究代码、测试和文档，不触及任何生产交易入口。