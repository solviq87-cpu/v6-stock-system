# 天枢智策 V6：历史权益生效日与研究日历来源时点加固（2026-11-15）

## 背景与基线
基于 `dev@76ebeb921dab12c031362acda0a8d4ddeb330cdc`，保留上一轮停牌证据、交易日缺口、原始成交额以及报价十五秒门禁。只修离线研究的数据时点边界，不更改锁定 PC/手机主页、四策略、账户存储或国内 WorkBuddy 唯一发布。

## 发现的边界漏洞
1. `historical-validation.validateDataset` 以前主要确认公司行为结算记录的时间不是“当前服务器的未来”，却不能保证其 `publishedAt` 在该 `effectiveDate` **09:30 北京时间**前可知。历史回测可能先看到后来才公布的权益结算，尤其在部分窗口未实际应用该事件时。
2. 导入 `settlements` 若落在历史日K日期列表之外，即使 `effectiveDate` 早于 `asOf`，也可能被每日循环静默忽略。
3. `readResearchCalendar` 原先独立验证“观察时间 <= 当前”和“发布时间 <= 当前”，但没有验证**同一来源的发布时间 <= 首次观察**，也没有阻止总日历 `firstObservedAt` 早于引用证据的首次观察。

## 实施范围
- 历史数据验证只允许 `publishedAt <= effectiveDate 09:30+08:00` 的研究结算，且 imported 数据的结算生效日必须真实出现在该历史的日期数组中。迟到的合法更正可由既有账户途径另行处理，但**不能倒填为旧交易日当时已知的权益证据**。未以现在的接收时刻替代源发布时间，也不推算复权因子或结算股数。
- 研究日历核验来源先发布后观察的时间顺序。日期精度的沪深日历仅拒绝“来源发表日期晚于首次观察所在北京时间日期”的明显矛盾；时间精度必须不晚于首次观察。全部引用证据首次观察不能晚于总日历声称的可知时刻。证据缺失/矛盾时返回 `unavailable`，不以工作日猜测交易日。
- 增加 `historical-corporate-pit.test.js` 与扩充 `research-calendar-source.test.js`，显式挂入 `a-share-session-data-quality` CI，其他既有完整回归仍执行。

## 尚未证明
研究日历的来源和字段为操作者保存的原始取证，不等于持续交易所官方认证；结算记录本身的币种、公司行为原公告、股权登记与具体可流通日仍需外部逐事件验证。全部研究输出保持 `canTrade:false` / `releaseEligible:false`，未添加实盘下单、未采购数据服务、未部署云端 Node 服务。

## 复现 / 回滚
```bash
cd V6_BO
node --test tests/historical-corporate-pit.test.js tests/research-calendar-source.test.js tests/corporate-settlements.test.js tests/a-share-session-coverage.test.js
npm run check
npm test
```
本地没有联网仓库副本，最终验收以本PR **当前 head SHA** 的 CI 结果为准。未合并时关闭PR即可；合并后用 `git revert`，禁止用旧 ZIP 覆盖现有完整工程。
