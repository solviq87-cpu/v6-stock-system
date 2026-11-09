# 智能选股逐票报价证据等级｜2026-11-10

## 本次小步变更

- 仅修改 `public/assets/picks-page.js` 中候选卡片与右侧详情共用的**只读报价证据文字**；保留同一个 `/api/quant-picks` 缓存结果、同一个股票卡片、原四套策略与日/月/年K线；不改两张锁定主页。
- 只接受逐票上游自报的 `vendorQuoteAt`（10位Unix秒、13位毫秒或明确带时区ISO），不再把含义不确定的 `quoteAt`、缓存时点、请求日期、页面刷新时间充当供应商原始报价。
- 显示源端时刻与北京时间、可选的 `quoteSource` 标签（仅自报、未独立认证）。不能解析则显示**未知**，不能当实时价。
- `vendorQuoteAt` 超过本机时间60秒的未来值标异常；与选股响应 `snapshotDay/tradeDate/date` 不同交易日的标**异期**；按本机时间距现在超过90秒标**过期**；其余仅为**来源时间接近本机当前时刻，仍未经实时认证**。时间差依赖设备本机时钟，不构成交易所时间认证。
- 这不是多源一致性核对或新行情采集；不启用任何付费/绕限制接口，不传输任何账户或交易指令，不影响模拟盘。盘后或周末报价自然可能长期保持过期标识。

## 验收

```sh
cd V6_BO
node --check public/assets/picks-page.js
node --test tests/picks-quote-evidence.test.js tests/picks-page-cloud-readonly.test.js tests/picks-detail-live-sync.test.js tests/picks-three-k.test.js
npm run check
npm test
```

测试覆盖：源端接近、过期、跨交易日、未来异常、只有服务器缓存时间、无新增网络请求。未在中国大陆授权行情目标机/真实iPhone/休市与盘中连续行情做外部验收。

## 后续不在本批实现

大盘—板块—股票关联研究、板块逆势证据和因子学习的样本外门禁已有独立模块，不应改动生产风控或用未经认证的数据直接提升策略权重。待旧APP接口实际字段与权限核验后，再决定是否将可核实的联动证据投影到同一股票详情页。
