# V6 不复权日K成交额/股数内生核验（2026-11-15）

原多源比较只检查供应商之间价格、股数、成交额是否相同；如果两家同时错误地把人民币成交额放大100倍，原先仍可能 `consensus=true`。

新增 `src/core/daily-turnover-sanity.js` 纯函数：在 **不复权**、金额为 **CNY**、成交量为 **shares** 的日K里，计算 `amount / volume` 隐含的成交均价，检查是否落在日内 `[low × 0.99, high × 1.01]`。固定±1%容差用于基础口径检测，非准确率统计、官方市场价背书或全交易场所覆盖。仅显示异常、拒绝错误导入，不自动改价、补零、变更倍数或替供应商选择正确结果。

`market-feed-consensus.js` 对每家来源分别核验，即使双方都错仍标记 `primary-vwap-outside-range`、`secondary-vwap-outside-range`；输出 `vwapSanity` 数量/是否适用；冲突保持 `consensus=false`，不覆盖已有历史。**qfq/hfq 与实际未复权成交额不能直接相除进行价格核验**，必须跳过并报告此限制。

BaoStock 两条日线标准化路径和东方财富明确请求 `unadjusted` 的路径也新增相同核验；更新了原离线虚构成交额不自洽的夹具，不影响原默认 qfq 入口。全部研究产物继续 `canTrade=false`，不连接真实下单；不动锁定电脑/手机主页、策略参数、账户或唯一云发布者。

特殊边界：若供应商OHLC不包含盘后大宗交易等完整成交范围，合法数据也可能触发隔离；需人工核对原始成交口径，不应放宽门禁或推断供应商造假。真实来源、商用许可、交易所原始时钟、公司行为仍待独立验证。

专项 CI：`V6_BO/tests/daily-turnover-sanity.test.js` 与 `market-evidence-enforcement.test.js`、BaoStock/Eastmoney/因子链专项测试；同时运行完整 `npm test`。CI 全部通过后才合并；回滚应使用 Git revert。
