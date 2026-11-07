# 费率和共同风控配置

主接口：开发者权限POST /api/research/order-account；只读用户不能修改。CLI：node scripts/paper-account.js <账户JSON路径> <请求JSON路径>。首次读取账户取得revision，再配置。以下费率仅说明字段，不代表当前券商或税务标准：

```json
{"accountId":"pool","action":"configure","configuration":{"expectedRevision":2,"feeSchedules":[{"version":"research-example-1","effectiveFrom":"2020-01-01","feeBps":2.5,"minFee":5,"sellTaxBps":5,"transferBps":0.1}],"riskPolicy":{"version":"research-risk-1","maxPositionPct":20,"maxGrossExposurePct":80}}}
```

费率日期必须有效、严格递增且版本唯一；日期覆盖不足拒绝，不静默回退。null禁用生效表/可选风控，未传字段保持现状。同一版本不允许改变内容，即使曾禁用。配置更新不改历史事件，需给未成交委托及后续成交日期提供费率覆盖。默认每次部分成交单独计最低佣金；不同券商按整笔订单汇总补差结算尚未实现。费用总额只统一舍入一次，组件显示到分后用roundingAdjustment与总额勾稽。

submit请求可附riskContext：observedAt（毫秒）、marks（代码到价格），以及previousClose（前收盘指标，字段见common-entry-risk.js与portfolio-risk-gate.js）。fill通过quote.riskContext传入。估值时间必须不晚于当前且在180秒内；前收盘证据observedThrough必须早于委托交易日。持仓、现金与待成交委托由服务端权威快照计算，不能由请求覆盖。

可选亏损开仓门禁为maxDrawdownPausePct/maxDailyLossPausePct；配置后缺少previousClose证据会拒绝开仓。旧自动路由可提供现价，但默认没有可信前收盘证据，不会伪造指标来放行。请求中的研究估值尚未经过供应商签名认证。风险配置是研究参数，非四套原策略规则的修改。独立旧回测保留自身原行为，只有持仓账本研究回测接入此可选费用/风控适配。
