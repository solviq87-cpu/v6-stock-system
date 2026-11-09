# V6 股票批量行情逐票来源时点与字段补全（2026-11-10）

## 为什么改

WorkBuddy在私有Issue #62的只读实测反馈指出：2026-11-10北京时间04:06–04:07的东财clist休市样例里，两只股票f124原始报价相差12秒；腾讯与东财时间也不一致。这个休市样例只说明供应商逐票源时点不同，不等于已经认证盘中实时、行情使用许可或数据商SLA。

之前的V6适配层已保存每票f124，但未覆盖成交量、换手率、资金净流入等可解释选股字段。现在仍只使用原东财clist公开端点，不增加调用频率、源认证宣称或任何真实交易权限。

## 新增字段

东财f12/f13保留证券代码/市场，f14是股票名称，f2是供应商最近价，f3是涨跌幅，f5是供应商原生手数volumeLots（不是股数），f6是成交额amount，f8是换手率turnoverPct，f20是总市值totalMarketValue，f62是主力净流入mainNetInflow，f184是净占比mainNetInflowPct，f124仍为独立每股vendorQuoteAt毫秒原始时点。

可选数值若源报告'-'、null、空值、越界、非有限或类型无效，一律不保存，不补0。f124缺失仍记录null，不从请求日期、缓存修改时间或抓取时钟推算。f5供应商原生手数和其他来源可能的股数不可混合；资金字段只供研究解释，不证明交易可成交或正式资金流净额审计。

整个批次仍独立提供startedAt/retrievedAt，并新增sourceCoverage统计有效/缺失的逐票原始时间数、最早最晚供应商报价时点和涉及日期。该字段也透传到市场广度的snapshotMetadata，且vendorTimeCertified=false、verifiedLive=false。

现有报价原时点审计仍区分unknown、stale-source-time、historical-snapshot、future与recent-source-unverified；不能因为请求成功或批次时间很近就说每只股票都是实时的，更不直接给模拟盘下单。

## 验证

    node --test tests/eastmoney-clist-source-fields.test.js tests/eastmoney-market-snapshot.test.js tests/market-snapshot-quote-time.test.js
    npm run check
    npm test

测试含同一批次两票相差12秒、不同原始交易日、缺失成交额不补0、手/股不混用、未认证行情保持不可交易、既有市场广度兼容、四分钟前的供应商原始报价拒绝被误称实时。

V6原两张主页、四正式策略、基础15因子权重、模拟盘账本、server.js保持不变。没有使用付费L2账户、共享任何私有行情凭据、绕限或启动WorkBuddy持续部署；供应商授权及真实部署仍待验收。