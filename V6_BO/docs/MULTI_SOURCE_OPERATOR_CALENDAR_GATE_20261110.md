# V6 多源参考价：操作者交易日历门禁（2026-11-10）

## 修复范围

工作日 09:30–11:30、13:00–15:00 的时钟条件不等于 A 股交易所实际开市日。原有研究报价融合只按星期、时间、来源独立性和原始报价时点做安全筛选；如果操作者已经取得合法交易所交易日列表，应能显式禁止在该列表未覆盖的日期采集和发布统一研究参考价。

在既有 `fuseMultiSourcePrices` / `checkMultiPublicPrices` 的选项中可选择提供 `tradingDates`，类型是按日期递增、不重复的 ISO `YYYY-MM-DD` 数组（1–4096项）。例如：

```js
const {checkMultiPublicPrices}=require('./src/core/multi-source-price-consensus');
const result=await checkMultiPublicPrices({
 code:'600519',tradingDates:['2026-11-09','2026-11-10']
});
```

此列表**必须来自操作者已经合法核实的真实交易日历**，程序不抓取官方日历、不把自然工作日冒充交易日，也不自动填补缺失的未来日期。作为可选研究门禁，未提供时仍使用原有“工作日时钟，但节假日未认证”的兼容行为。

## 规则

- 传入无效日期、重复/倒序日期或超过上限的列表，直接抛出协议错误，不能放行。
- 已导入日期列表且当前北京时间日期**未列入**时，`checkMultiPublicPrices` 在发起任何公开或付费可选源请求之前拒绝联网；纯融合 `fuseMultiSourcePrices` 返回 `outside-provided-trading-calendar` 与 `referencePrice:null`，即使输入带有看似新鲜、完全一致的报价也不例外。
- 有日期覆盖仍继续执行原有工作日交易时段、逐源时间戳、报价价差、前收一致性、同上游去重、报价状态等门禁。跨午休或交易结束后仍不发布。
- 保持 `exchangeCalendarVerified:false`、`providerLicensed:false`、`certifiedLive:false`、`canTrade:false`、`canNotify:false`。新增加的 `operatorCalendarProvided` / `operatorCalendarMatch` 只表示**操作者列表的声明和匹配情况**，不是交易所日历独立认证。
- 如果操作者的日历不完整，只能得出“当前日期不在已提供列表里”，不能武断宣称法定休市。要恢复参考价需先核查并更新私有日历来源，禁止通过删除日期门禁冒充认证完成。

此项只改变一次性只读报价研究的可选输入，不购买云服务、不部署或开启持续采集，不改变已锁定电脑/手机首页、正式四套策略、因子权重、模拟盘订单/持仓/权益和账户资金。

## 验收

```sh
cd V6_BO
node --check src/core/multi-source-price-consensus.js
node --test tests/multi-source-calendar-gate.test.js tests/multi-source-price-consensus.test.js
npm run check
npm test
```

新增专项覆盖：有可靠列表但未列入的工作日拒绝同源一致报价、日期列表覆盖保持原有行为、未知休市日零联网、非法/重复/倒序日期不能访问外部接口。GitHub CI 成功只能证明离线协议和回归测试，不是数据源协议许可或真实交易日可用性。若需回退，用 Git revert 本 PR，不覆盖历史数据或新版本。
