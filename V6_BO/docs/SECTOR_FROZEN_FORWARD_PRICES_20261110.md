# V6 板块冻结成分股的 1/5/20 交易日价格观察（2026-11-10）

## 本轮新增与以前的观察有什么区别

原有 `sector-shadow-forward-observer` 只是观察之后3/5个交易日**板块强度分数和上涨广度是否延续**，明确 `returnsAvailable=false`。新模块 `src/core/sector-frozen-forward-prices.js` 需要**当时冻结的行业成员与逐股票原始报价价格**，随后用已归档的、日期确定的快照计算后续1/5/20个实际交易日的同一批成分股*未复权原始报价毛价格变化*。不会用后续才加入的股票换掉信号时的成员，不会把缺价、退市或停牌默认为0，也不会将当前行业分类回填过去。

这仍然不是真实行业指数回报，也没有计算可成交性、分红、现金流、复权、滑点、成本、资金容量及市场比较基准。单个冻结信号的历史观察**不是时间隔离样本外回测**，不能解释为验证了真实选股优势。

## 操作方式：只处理已经合法取得的本地文件

在 `V6_BO` 目录。行情采集已由独立受控脚本输出到私有目录，BaoStock行业成员必须是在**该次行情批次开始前**冻结的原始成员文件。

在产生合格板块研究信号后的10分钟内，显式冻结基准价与成分股：

```sh
node scripts/sector-forward-price-research.js freeze /private/sector-research/snapshots/2026-11-10/<当日采集结束毫秒>.json /private/sector-research/members/2026-11-10/<当日采集结束毫秒>.json /private/sector-price-cohorts/frozen-20261110.json
```

该 `freeze` 操作重新复用原有 `inspectSectorShadowEligibility` 行业影子预检、全市场原始报价时间与行业版本，存储带 SHA-256 本地完整性指纹的不可覆盖快照，权限0600。原信号的真实时点来自报价归档；如果过去才补建冻结记录，不认作已认证的前瞻信号。

准备明确升序交易日历，至少包含信号日及目标后续日期，最多120天；不得拿自然日代替真实交易日。另提供**操作方独立导入的完整公司行为审计JSON**，例如：

```json
{
  "schemaVersion":1,
  "source":"imported",
  "provider":"operator-corporate-action-audit",
  "datasetId":"evidence-20261110-01",
  "completed":true,
  "observedAt":1794348000000,
  "completeThrough":"2026-11-20",
  "coveredSymbols":["600001","600002"],
  "events":[{"symbol":"600001","date":"2026-11-18","type":"cash-dividend"}]
}
```

这是字段示例，**不是已经验证的真实公司行为记录**。其中 `coveredSymbols` 需要包含所有实际冻结成员，`observedAt` 和 `completeThrough` 不能超过评价时钟；缺少独立审计或某股票有拆股、分红、增发、退市等公司行为时，本模块不对受影响行业计算未复权跨期毛价格收益。空 `events` 只有在数据来源确实完整核验后才能声称为“无公司行为”，代码上的 `completed=true` 不等于外部独立认证。

用 `sector-market-capture` 保存的 `snapshots/YYYY-MM-DD/<unix毫秒>.json` 日期档案执行纯离线观察：

```sh
node scripts/sector-forward-price-research.js evaluate /private/sector-price-cohorts/frozen-20261110.json /private/sector-research/snapshots /private/trading-calendar.json /private/actions-evidence.json /private/sector-price-observations --raw-intraday-only
```

`evaluate` 不联网、不读取正式策略权重，不访问账户，输出 `<私有研究输出>/<信号日>/<冻结指纹>/<评价时钟毫秒>.json`；同身份结果只能幂等写入，出现不同记录拒绝覆盖。

## 计算规则与防止“幸存者偏差”

- 只采用冻结时已存在的 `industry|code` 板块及成分股票 ID。后续不按当前行业名单重新筛股票；不改变信号当天的基准价格。
- 未来观察仅在**明确的第1、5、20个A股交易日**对应日期成熟，不用第6个交易日填缺失的第5个日期；未来时间/缺档标 `pending`。
- 只选用日期一致、源一致、日内观测分钟与基准相差≤30分钟的全市场快照。每份快照原始有效报价覆盖≥80%，每一个被评价板块需冻结成员的**100%基准价和目标日有效报价**（逐票供应商 f124、未停牌、成交量不为0）；任何缺失使整个板块结果保持 `unknown`，不只统计留下的股票。
- `grossRawPriceReturnPct = mean((目标报价 / 冻结时报价 - 1) × 100)`，对冻结成分股等权平均。价格异常巨幅跳变直接 `unknown`；公司行为区间标 `corporate-action-requires-adjusted-price`，不假装做了复权。
- 从 `frozenAt` 以后才能读取之后日期的已取得资料，未来数据缺失不能制造成熟结果；冻结快照被篡改或来源变化拒绝比较。
- 输出永远含 `canTrain=false`、`outOfSampleValidated=false`、`labelsAvailable=false`、`canTrade=false`、`canNotify=false`、`weightsChanged=false`；这批未形成模型训练标签，也不自动修改正式四套战法或模拟盘。

## 尚待正式验证

1. 数据来源使用许可、中国大陆真实可达性、连续日期的完整交易所交易日历；
2. 所有冻结行业成分股的原始价格有效率和变更、退市、停牌、公司行为的独立证据；
3. 使用**可验证复权/现金分红调整**后的净收益、已认证基准、成本与回撤；
4. 多批次冻结信号的训练/验证时间隔离、样本量和重叠窗口清除，做真正 walk-forward 样本外检验，排除过拟合和数据泄漏。

```sh
cd V6_BO
node --test tests/sector-frozen-forward-prices.test.js tests/sector-shadow-forward-observer.test.js
npm run check
npm test
```

合成单元测试验证代码路径，不能证明真实价格、供应商、分红或样本外优势。两张用户锁定主页和四套正式策略不改。
