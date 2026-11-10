# V6 股票多源参考价（研究级，只读）

> 截至 2026-11-10：本功能是诊断/选股研究接口，不是已认证实时行情、生产数据服务或模拟成交价格授权；绝不接实盘。

## 来源与授权状态

| 来源 | 接入方式 | 状态 |
| --- | --- | --- |
| 腾讯 `qt.gtimg.cn` | 已有 V6 公开单股适配器 | 运行时一次性检查；公开网页接口的商业许可未核实 |
| 东方财富 `push2` 单股 | 已有 V6 公开单股适配器 | 运行时一次性检查；报价单位与上游时间须逐源核对 |
| 新浪 `hq.sinajs.cn` | 已有 V6 公开单股适配器 | 运行时一次性检查；可能 403，失败不强行绕过 |
| iTick `/stock/quote` | 新增官方 REST 适配器 | **仅当运营者通过私有环境变量 `V6_ITICK_TOKEN` 提供有效授权令牌才调用**，默认 `unconfigured`；许可范围、A股覆盖与实际数据未认证 |
| 同花顺 iFinD | 官方 SDK/API 候选 | **本批不擅自调用未经授权的网页内部 API**；只有拿到正规授权接口文档、字段与调用权限后才新增专用适配器 |
| 其他正式授权来源 | `extraSources` 归一化输入 | 预留扩展接口；必须显式识别源、价格、时点、币种、调整方式和交易状态；不得把同一底层上游冒充多个独立证据 |

## 一次性诊断

在 `V6_BO/` 目录执行：

```bash
node scripts/multi-source-quote.js 600519
```

若已自行取得 iTick 正式权限，可在**私有运行环境**配置 `V6_ITICK_TOKEN`；不把 Token 传给聊天、日志、Git、Issue 或网页。未配置不调用 iTick，也无需购买服务。

脚本只在北京时间周一至周五 **09:30–11:30、13:00–15:00** 的常规连续竞价时间窗口调用外部服务，最多查询已注册的一轮三家公开源与可选第四家 iTick；现有公开诊断器可能对传输/格式错误进行一次有界重试。**时间窗口不是交易所权威休市日历，法定假日仍不保证开市**。其他时间仅给 `outside-weekday-session-window`，绝不拿昨日价格冒充实时参考价。 **开始时与完成时双重时段门禁**：若三家公开报价采集结束已跨入 11:30 午休/15:00 收盘，则跳过可选授权源查询并拒绝发布参考价；若可选源查询期间跨入休市，最终结果仍为 `referencePrice:null`。日期/时段判断不替代正式交易所日历。

## 合并而不乱平均

1. 对每家来源保留单独的状态及逐票原始 `quoteAt`，校验股票代码、市场、CNY、未复权、正常交易、价格/昨收 > 0、报出时间不在未来、不跨北京时间日期。来源审计同时保留 `observedPrice` 和 `observedPreviousClose`，不猜测因公司行为或单位差异而需要的调整。
2. 同一个来源超过 15 秒视为过期；可比来源间时点跨度默认不超过 5 秒，**现价和昨收价分别**必须满足最大差值 30 bps（0.30%）。任意一项冲突都不能进入一致性组，返回冲突或歧义状态，绝不把不一致的昨收合成涨跌幅。成功匹配时记录 `maxMatchedPriceGapBps` 和 `maxMatchedPreviousCloseGapBps` 供复核。以上阈值仅为保守研究规则，**并非准确价格的统计证明**。
3. 对于 2–3 个可比来源，至少 2 家形成价格/时间一致子集；对于 4 家及以上，必须取得严格多数。若出现多个同样规模、互相冲突的子集，结果 `ambiguous-price-groups`，不挑一个硬凑。
4. 有明确一致子集时，`referencePrice` **取该组中原始时间最新的一家实际报价**，不造算术平均的虚构成交价格；同时提供 `representativeProvider`、`supportingProviders`、`disagreeingProviders`、差异与时间证据。`sourceStatuses` 逐源记录 `observedPrice`、`quoteAt`、`quoteAgeMs`、`status` 与 `inConsensus`，可审计哪个接口有效、哪家被排除。若某来源报出约 100 倍价格，**保留原值并排除异常来源，不根据推测自动除以 100**，避免价格单位误判。
5. 只有一个有效来源、时点不一致、价格冲突、缺价、停牌、越权/未配置、休市时：**`referencePrice:null`**，并显示具体拒绝原因。其他源不能偷偷继承旧源时间戳；数据源不能通过改写统一时间混为一个独立来源。**隔离故障：** iTick 授权/断线/格式错误或单次公开行情诊断异常，单独标为 `unavailable`，其他正常来源继续完成一致性比对；iTick 对响应正文进行读取前的 64 KiB 字节限制，拒绝异常超长响应。
6. 即使多家一致，返回值始终 `providerLicensed:false`、`certifiedLive:false`、`exchangeCalendarVerified:false`、`canTrade:false`、`canNotify:false`，不得直接接模拟撮合、自动买卖、正式实时宣称或对外商业分发。

## 验收与后续

- `node --test tests/multi-source-price-consensus.test.js tests/itick-stock-quote.test.js`
- 现有 `npm run check`、`npm test` 和 GitHub Actions 全量回归均须通过。
- 交易日正式联网评估：逐源原始时间、成交状态、价格单位、相互价格偏差；对延迟、断线、午休、法定节假日、换手和复权混用进行真实验收。未经证据不得宣称多源已经生产可用。
- 同花顺正规接口：https://quantapi.51ifind.com/gwstatic/static/ds_web/quantapi-web/ ；iTick 正式文档：https://docs.itick.org/zh-cn/rest-api/stocks/stock-quote ，免费档限额和具体数据权限请以账户内条款为准。

本研究组件只新增文件，不改变 V6 两张锁定首页、`/picks.html`、四套策略、模拟盘和账本、已有公开行情模块的生产行为。
