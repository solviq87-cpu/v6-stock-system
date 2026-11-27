# 绯曜 FAYO D组第九批｜五项涨停池、两融、新闻和财务证据整改 · 2026-11-27

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。五个局部小任务，不代表五个D大项完整验收。涉及D18/D19/D20/D21/D27/D31/D35/D37/D40/D41/D63/D64/D77/D78局部。保持现有唯一数据中心、接口权限、策略、账户、原证据和发布机制。不新增源、服务、调用次数、生产接线或购买。

## 五个小任务
1. 财联社涨停池：明确带时区且真实的接收日期；拒绝未来请求日期和隐式证券代码强转；初始时钟异常不联网。原事件时点仍非逐股报价时点，保留完整池校验、ST、原原因和现有候选覆盖范围。不认证跌停/炸板或真实全市场覆盖。
2. 原 external_data 两融适配器：严格原报表成功声明、单行、真实中国日期及非负数值；RZYE 与 RZYE_SZ 是不同原字段，不以后一字段顶替前一字段；真实0保留，未知null；保留 reportName、接收时点及 sourceQuoteAt=null；不推断字段口径/地域/单位或授权。复用原两个候选报表及原降级路径，不增加请求；原真实接口仍待取得权限和现场样本。
3. 新闻档案：同批同来源事件所有版本先对齐再写入；冲突或不合法同ID整组拒绝并交回 rejectedEventIds，其他事件继续；同一证券集合仅顺序差异不产生假修订。已有档案保持原哈希和内容。若出现旧版本与撤稿冲突，保留档案但本次拒绝，待独立可信版本；不声称可自动确定真伪。原 server 对拒绝ID的消费须集成复核。
4. 财务报告与单季证据：严格验证原报告期、币种、发布日期/修订日期、类别、真实可得时点和同报告期锚点；读取特征再核对每个季度与原报告，而不是仅信任 periodRawHash；无效决策时钟拒绝。真实0保留，不补利润、估值或其他未知指标。
5. 财务采集时钟：发起每个原请求前与完成后严格正整数毫秒时钟及高水位检查，发现无效/回拨停止后续请求，不持久化不可信接收时点；原有效报告期证据保留。原数据请求预算和授权不变。

## 实际离线验证
精确原 blob:
- V6_BO/src/core/cls-limit-up-pool.js: cf87872052467476377fbf11d636c3662553f65a
- V6_BO/external_data.js: ba252ba3da75e0727bc889b54bbedd910afa5823
- V6_BO/src/core/news-evidence-journal.js: 239041d9ced09ef67b7f7fe70cb444a5d3a849b6
- V6_BO/src/core/public-stock-financials.js: 92ab5692963f71a7efcd1667316fb2e4eb7039a3
原财务测试 blob cdf91b2e6e4bf726133d4b57b00b6fba9cc6d0ee。

新增12项正式 node:test 测试代码。本轮实际执行隔离V8最小同步/异步断言器，加载原与修改后四份源文件，注入响应、URL/Buffer/摘要/路径及内存新闻持久化夹具；真实新闻 providerInput/normalize/checkNext/captureProviderBatch 执行，文件系统、实际SHA计算、网络、完整Node和并发锁未执行。不伪称原生Node全量。首次隔离执行模拟Buffer未识别其自身构造实例，10/12；修正测试夹具（非生产代码）后统一重跑原和修改版。两融新增导出归一化函数，原版两项测试因无该函数失败，其他失败为行为反例或异常。
新增专项修前 1/12 通过、11 失败；修后 12/12、0 失败。原财务专项 6/6 通过。组合 18/18。未真实请求供应商。详细修前失败：
- limit pool cannot accept ambiguous or impossible receipt dates or a future requested session: equal: expected false got true
- limit pool security must be an exact provider string, never a coercible array: equal: expected false got true
- future limit pool request or a throwing start clock makes no supplier calls: equal: expected false got true
- margin balance retains true zero, missing and distinct RZYE_SZ field: EXT.normalizeMarginResponse is not a function
- margin rejects invalid report, dates, false success and coercible or negative balances: EXT.normalizeMarginResponse is not a function
- conflicting provider editions quarantine the ID before append, independent of input order: equal: expected 1 got 2
- same news security order permutations do not create new revisions or conflicts: equal: expected 0 got 1
- a repeated original cannot hide a competing retraction in the same provider batch: equal: expected 0 got 1
- quarter parser requires a valid period receipt and rejects conflicting explicit currency or revision fields: expected exception /报告期/ got none
- financial features recheck each quarter anchor and typed decision time, not merely a claimed hash: equal: expected undefined got {"code":"600000","value":20,"unit":"percent","source":"eastmoney-financials","evidenceId":"000000000000000000000000000000000000000000000000000000000000000c:000000000000000000000000000000000000000000000000000000000000000c:2026-06-30:earningsGrowthPct","observedAt":1782835199000,"availableAt":1795680300000,"recordedAt":1795680300000,"reportDate":"2026-06-30","publicationDate":"2026-10-31","updatedDate":"2026-10-31","periodKind":"quarter","verifiedExternal":false}
- financial invalid start clock never calls supplier; receipt rollback cannot publish a later quarter: equal: expected 0 got 2

## 总管协调与限制
已检查 #427 两页及 #430/#451/#450/#448/#446/#407/#421/#405/#422/#423/#418/#419/#441/#443/#447/#449/#404/#410/#435 的相关文件路径；本批四个模块未发现重叠。#427 已修改 em.js 与 deep-research-evidence.js，D15盘口/逐笔授权与龙虎榜主采集仍需总管协调，不改共享模块，不将资金或竞价代理成盘口。完整历史/全部开放PR冲突仍待核验。完整 clone 当前环境无法 DNS 解析 github.com；需原Node专项、原新闻档案与财务测试、全部CI、浏览器、真实数据授权及5/20/60交易日观察。#441远端CI与浏览器成功、Commit Coverage失败；#439新头待验。所有已提交成果保留，不绕过逐SHA冒烟，不合并、不部署、不发布。回退仅撤销本独立补丁，不覆盖原历史或账本。
