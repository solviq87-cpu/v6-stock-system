# V6 板块连续强度与轮动证据（2026-11-10）

## 接在现有板块行情桥之后
输入来自已有 `scripts/sector-strength-research.js watch` 生成的不可覆盖原始板块研究档案；本模块**不追加任何行情网络请求**，也不写模拟盘、现有正式选股排序或四套策略。
新增 `src/strategy/sector-rotation-history.js` 的 `evaluateSectorRotation(records,{tradeDates,asOf})` 和 `scripts/sector-rotation-history.js` 的 once/watch 私有研究归档。结果只可用于研究、解释和未来样本外验证。

## 输入与运行
须提供操作方明确导入、按升序排列的 A 股实际交易日期文件（不从自然日猜交易日）；示例：
```json
{"source":"imported","tradeDates":["2026-11-04","2026-11-05","2026-11-06","2026-11-09","2026-11-10"]}
```
该列表是协议示例，来源未经过交易所日历认证；补充数据和修订交易日历前，不能声称全市场完整。
原始档案目录应包含每个交易日的 `YYYY-MM-DD/<行情结束时间Unix毫秒>.json`，由现有 watch 生成。每天只选**观测时间最新且不晚于当前时钟**的一份记录，并让前几日选择不晚于最新一天北京时间日内分钟、且相差最多30分钟的记录。没有对齐的日子保留缺失，不补零，不用晚于研究时点的数据补过去。
在 `V6_BO` 执行：
```sh
npm run research:sector:rotation -- /absolute/private/sector-archive /absolute/private/trading-calendar.json /absolute/private/rotation-archive
npm run research:sector:rotation:watch -- /absolute/private/sector-archive /absolute/private/trading-calendar.json /absolute/private/rotation-archive --interval 60000
npm run test:sector:rotation
npm run check
npm test
```
watch 只轮询本地文件，**不会自动拉取数据、发送推送或自动启用服务器常驻**。最后交易日不是当前中国市场日期时，不制造新的实时轮动报告；once 可重放历史。
输出路径为 `rotation-archive/YYYY-MM-DD/<最新快照时间戳>.json`，新文件私有权限0600；同内容幂等，冲突拒绝覆盖并需人工核查。SHA-256 为本地完整性检测，**不是第三方签名或来源认证**。

## 研究标签
按明确交易日序列对同一个行业/概念板块的3日、5日快照作比较，不跨类别排名，不将概念重复成员算作独立股票。
- `three-session-broad-strength`：连续3个观察日研究分≥65、上涨广度≥60%，且当前标签均为广泛强势。
- `three-session-warming`：3次快照期间分数提高≥10、上涨广度提高≥10个百分点、最后研究分≥60且不是龙头集中。
- `three-session-cooling`：3次快照期间分数减少≥12、上涨广度下降≥15个百分点。
- `five-session-broad-strength`：5个观察日均达到宽度和分数要求。
- 其他为 mixed 或 unknown；以上阈值**未经样本外验证**，不代表收益、资金净流入或上涨原因，也不据此自动调整权重。

如果缺交易日、已冻结行业分类版本改变、成分股数量变化、来源不一致、行情覆盖不足80%、同日观测时段不接近、缺失/未来/损坏输入、单日评分不合法，则3日/5日结论为 `unknown`，必要时整个报告拒绝生成。
研究记录仅描述系统读取到的历史快照，其 `verifiedLive=false`、`canTrade=false`、`rankingModified=false`、`weightsChanged=false`；不会改变原四套策略的规则和候选股票，不能向真实券商发送订单。

## 尚待运营验收
1. 明确行业成员来源的授权与版本冻结机制、持续归档输入的采集任务，及中国大陆节点下同日原报价时间覆盖。
2. 交易所交易日历来源及异常休市、跨年度、行业分类换版时的可靠性；本批只用操作方给的日期。
3. 历史样本外、1/5/20交易日收益/回撤及交易成本检验，确认是否真有统计优势后才考虑因子进化。
4. 正式云端定时调度、页面展示和手机提醒尚未部署；不存在自动实盘委托。

本轮不会改 `public/index.html` 和 `public/mobile.html` 两份用户锁定主页。CI 回归通过不意味着实际数据实时性或部署验收。
