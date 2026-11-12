# 行情用途与主要消费者证据闭环

基线：`a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47`。本批覆盖审计 Q5–Q8 的主要入口，保留 A1 资金连续性与 A2 最终发布时钟修复。全部验证使用受控时钟、供应商 fixture、临时持仓文件和 mock 推送；没有请求真实行情、发送真实通知、连接真实账户或部署。

## 变更与用途

| 入口 | 行为 |
| --- | --- |
| 全 A 东财分页 | 请求并保留同一价格行的 `f124` 原始时点、实际接收时间、来源与使用许可；缺失、未来、过期值不获得提醒许可。资金原始时点独立保持未知。 |
| 全 A 新浪首源 | 接口只有时分秒、没有原始日期时，`quoteAt/tradeDate:null`，价格继续展示，`canTrade/canNotify:false`；不以收包日期拼出报价时间。 |
| 腾讯价格与东财资金合并 | 价格仍保留腾讯原行证据，资金另保留东财来源、方法、接收时间、原始时点与 CNY 单位，不互相借时钟。 |
| 指数 | 解析腾讯原始时间字段；情绪文案只接受当日 15 秒内且时序正确的逐行报价，显示原时点与未认证。刚收到旧包不会产生“大盘实时”。旧指数仍可在只读视图显示其质量状态。 |
| 板块资金 | 标记供应商订单大小分类估计、CNY 单位、独立接收时间；供应商未给资金原始时间则保持未知，不借价格时点或另一只基准股日期补全。 |
| 日 K | 生产者记录实际接收时间和来源；`/api/kline.dataQuality` 描述本次内存、磁盘、回源、源滞后或失败沿用路径。缓存写入时间、最后回源尝试时间、原接收时间分开。合法历史 K 线继续展示，按日期判断完整性，不套用 15 秒执行价门槛。 |
| 模拟盘估值 | 每个持仓返回 `valuationQuote`；按所选价格同一行追溯来源，匹配不到则未知。上次价格与成本兜底分别标记，不伪装为当前可成交价。未知买入时刻的 `natDays:null`；明确买入日期仍可计算交易日展示。 |
| 持仓巡检 | THS 未提供原始价格时点的备用价、未知或陈旧全 A 兜底继续估值，动作降为“观察”，原规则结果保留在 `observedActs`，自动/手动巡检都不据此发交易动作提醒。资金缺失展示未知，真实零保留为零。 |
| tick 与板块涨速扫描 | 消费同一返回行的用途许可，旧、未来、未知、跨日、模拟及只读研究报价不进入提醒分析；tick 同时清除该票资金连续基线，防止后续跨缺口相减。 |
| 自动账本入口 | `paperAuthorityQuotes` 原有 15 秒判断叠加来源用途屏障，阻止显式模拟、研究、历史、成本/沿用价、只读备用、停牌或禁交易标记绕过自动来源边界。 |

## 共享契约

复用 `src/core/quote-observation-view.js` 和既有 `public-market.timestamp`，没有另建采集或报价框架。

- `quoteObservationView(row, now)`：精确描述这一行，返回 `source/quoteSource`、`quoteAt`、`receivedAt`、`tradeDate`、`mode`、`quoteAgeMs`、`quoteStatus/freshness`、`missingReason`。展示投影的 `canTrade/canNotify/verifiedLive` 始终为 false。
- `quoteUseEligibility(row, now)`：严格消费者门禁。要求有效正价格、来源、原始时间、实际接收时间、原始≤接收≤当前、15 秒内、北京时间同日和允许用途。执行需显式 `canTrade:true`；提醒需显式 `canNotify:true` 或 `canTrade:true`，显式 false 不得被提升。保留池行上的提醒许可不会授予其执行许可。
- `quoteSourceAllowsUse(row)`：仅拒绝显式不允许的来源、模式与标记，本身不证明时间有效或授予权限。自动账本沿用既有原时点门禁兼容旧数据，不强制补出 `receivedAt`；未知接收时刻仍保存 null。
- `fundsObservationView(row, now)`：资金值、来源、单位、原始时点、接收时间独立描述；真实 0 保留，未知不转 0；不借价格时间。
- `klineObservation(snapshot, rows, opts)`：`source/receivedAt/tradeDate/mode/frequency/priceBasis/cacheLayer/cacheAt/lastAttemptAt/targetDate/freshness/missingReason`。`quoteAt:null`，不将日线日期伪造为逐笔报价时间；不授予交易或提醒许可。
- `valuationObservation(...)`：仅描述实际估值价，区分 `observed-price`、`unattributed-mark`、`carried-mark`、`cost-basis`。价格不同的当前快照不能给旧估值行补时间。

允许的 assets 显示可读的历史 K 来源、缓存状态和逐持仓估值状态。锁定主页没有改动：`public/index.html` Git blob 为 `9e2fad468cb3e192df0ca2b9184babb2add8c4de`，`public/mobile.html` 为 `084e36d950f9bf4c3508aa1a5cb8986799b6079e`。

## 验证与基线对照

新增 `tests/market-consumer-contract.test.js` 16 个行为用例，执行实际生产函数或工厂。覆盖旧、未来、未知、跨日、失序接收、模拟/只读来源、缓存失败沿用、合法历史、逐持仓来源、日期未知、真实零、无效资金与 mock 提醒。

16 个定向 node:test 文件合计 **123 通过，0 失败，0 跳过**。包含新契约、报价展示与池复制、原始报价执行、权威账本报价、资金连续性、批量最终发布、板块资金、仪表盘与 K 线分页。另跑旧离线守门：持仓窗口/去重 17、持仓审计 56、推送隐私 62、K 线新鲜度 17 个断言全部通过。语法检查与 `git diff --check` 通过。全量组合回归由主集成执行，本批未重复运行全量。

原始日志位于 `/workspace/remaining-output/data-*`，关键文件：

- `data-final-targeted.tap` / `.exit`：123 个定向测试。
- `data-before-after.cjs` / `.json` / `.log` / `.exit`：直接读取固定基线源码与修改后源码进行相同 fixture 对照。旧指数包不再称实时；全 A `f124` 从丢失变为保留；未知买入时刻原先显示 20770 个自然日，现为 null；旧全 A 持仓仍按 8 元估值，但 mock 止损提醒从 1 条变为 0 条。
- `data-_test_holdings_watch_gate.log`、`data-_test_holdings_audit.log`、`data-_test_holdings_push_privacy.log`、`data-_test_kline_fresh.log`：旧守门结果。
- `data-legacy-baseline.json`：额外探测的两组旧脚本在固定基线也失败。`_test_kline_sync.js` 从锁定主页提取不到旧 APP_VER 字面量；`_test_kline_view.js` 的旧分页断言已漂移，且其 VM 未注入 A1 新增的 `fundsNumber`。这两组不属于当前 npm test 集合；本批没有修改主页或扩改无关旧脚本来掩盖失败。

## 限制与恢复

公开供应商仍未获得实时、授权或交易所认证，`verifiedLive:false`。没有进行真实盘中连续采样、网络限流压力或真机逐图视觉验收。元数据和主要入口测试不等于全部 legacy 策略、推送及研究脚本已逐函数认证。全 A、盘后与历史价格保留原策略研究价值，缺少使用证据时只观察。

资金供应商没有提供原始资金时间时，仍然无法证明该资金行与价格同时；不得用本批接收时间补认证。旧缓存原先缺少来源/接收时间的不会回填。自动账本对旧的有效原时点观察继续兼容 nullable 接收时间，这与严格提醒门禁的要求不同，不能把兼容行为称为全链路证据齐全。

撤销本独立提交即可回滚代码与展示，不覆盖账户、持仓、研究或历史数据。与并行账本修改集成时，需同时保留 `paperAuthorityQuotes` 的本批来源屏障和账本批次输出的 `mode/provider/receivedAt`。
