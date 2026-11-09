# 东方财富 A 股 clist 可选指标证据｜2026-11-10

## 范围与基线

- 基线 `dev`：`54f0cc5fe8e6ff854b8139a8fb54282a5ee1a76e`，对应 GitHub Issue #62 WorkBuddy 关于股票接口的证据。
- 仅对已有的**一次性只读**东财 `clist` 研究快照请求增补 `f5/f8/f20/f62/f184`，不启动轮询，不开放真实交易，也不修改任何主页、策略、账本或 K 线。
- 原有 `f12/f13/f3/f6/f124`、分页校验、市场日期校验、120 秒采样跨度、超时限制、来源标签不变。

## 字段（全部为供应商数据，未经交易所认证）

| 原始字段 | 新输出 | 单位/含义 |
| --- | --- | --- |
| f2 | lastPriceYuan | 以 `fltt=2` 请求的厂商自报最近价，元；只作研究参考，不能作为撮合价 |
| f5 | volumeHands | 手，不私自混成股 |
| f6 | amount | 元，保留原字段名 |
| f8 | turnoverPct | 换手率，百分数 |
| f20 | totalMarketCapYuan | 总市值，元 |
| f62 | mainNetInflowYuan | 主力净流入，元；厂商推算口径未核实 |
| f184 | mainNetInflowPct | 主力净占比，百分数；厂商推算口径未核实 |
| f124 | vendorQuoteAt | **该股票行**自报 Unix 秒转换的毫秒值，绝不可用批次采集时间代替 |

对可选数值要求实际 JSON number 且有限值；`null`、`'-'`、空串、字符串数字等都置为 `undefined`（输出 JSON 会省略），不伪装为零。只有明确的供应商数值 `0` 才被保留。

## 时点、许可和使用边界

- `vendorQuoteAt` 与快照 `startedAt/retrievedAt` 继续分离，不能拿批次时钟替代某只股票的报价时点；原有独立 `market-snapshot-quote-time` 模块按逐票原时点识别 stale/异期/未知。
- `verifiedLive:false` 保持不变。北京时间休市或停牌时，获得收盘快照绝不代表盘中实时。
- `f43` 的缩放在各来源和参数配置中有歧义，本 PR **不改动**单股 `public-market.js` 的价格归一化；在实际相同查询参数的返回样本被验证前不执行机械除以 100。
- 网页公开端点的访问、许可、商业使用与长期服务稳定性仍未核实；增宽字段不等于已接通授权实时源，也不自动用于风险或模拟盘成交。
- 不从旧 APP 复制源码、不绕过供应商访问控制或限额。

## 验收

```sh
cd V6_BO
node --check src/core/eastmoney-market-snapshot.js
node --test tests/eastmoney-market-snapshot.test.js tests/eastmoney-clist-stock-metrics.test.js tests/market-snapshot-quote-time.test.js
npm run check
npm test
```

上面是要求执行的命令清单，不代表已经执行通过。以实际 GitHub CI run 结果为准。若 CI 失败，则不合并本 PR。
