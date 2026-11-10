# V6 板块1/5/20交易日研究：样本外时间切分与泄漏审计

> 2026-11-10：独立、只读研究审核门禁。**不会把原始未复权毛价格变化标记成真正的样本外净收益，也不会自动送入四套策略、正式因子训练、模拟盘或通知。**

## 为什么需要它

已有 `sector-frozen-forward-prices` 根据当时冻结成分股和已取得的后续行情快照，给出1/5/20交易日的原始报价毛价格变化，但没有把多批次冻结事件分成严格的训练、禁穿越与未来验证期。直接把全部事件按日期计算平均后，再选一个看起来最好的板块或因子，会产生**标签时间泄漏**及重复窗口问题；同时，供应商报价不是交易所认证的复权价格、基准或可成交成本。

新增纯函数 `auditSectorWalkForward(episodes, {tradeDates, trainEnd, validationStart, validationEnd, asOf})` 及完全离线 CLI `scripts/sector-walkforward-audit.js`。审计只读输入，不训练、不优化、不生成任何交易信号。

## 必需输入

`episodes.json`：显式 `source: "imported"`、`schemaVersion:1`，包含每次冻结 `frozen` 与原观察 `observation` 完整对象（上游 `freezeSectorPriceCohort`、`evaluateSectorForwardPrices` 的真实协议格式，而非随意加工的行表）。该文件应由用户/操作者从私有不可变归档取出，每份 `frozen` 必须保留最初的价格、成分股、报价原时点、行业版本和哈希。所有对象仍未经独立真实性/商用许可认证。

`split.json`：显式导入严格递增的**真实交易日**标签（最多2500个），提前指定训练期最后一天、验证开始和结束日期，例如：

```json
{
  "schemaVersion": 1,
  "source": "imported",
  "tradeDates": ["2026-09-01", "2026-09-02", "2026-09-03"],
  "trainEnd": "2026-09-02",
  "validationStart": "2026-09-03",
  "validationEnd": "2026-09-03"
}
```

这是**字段示意，长度不足22日，故实际运行必然拒绝**，不能拿自然日填充休市日。生产研究必须另行验证交易所真实假日安排，并在观察发生前冻结拆分方案（代码不能认证历史拆分是否真的事先决定）。

## 审计规则

- 逐批确认 `frozen.fingerprint` 和原始成员/价格/报价时间未被篡改；确认观察报告只来自该冻结指纹、同源、同类版本、同一报价基础；任何重复信号日、手工改写未来目标日期、带伪造净收益字段或声称已可训练的结果都会使整次审核 `blocked`。
- 最长观察窗口为**20个明确交易日**。所有训练期信号只有在它的第20日目标交易日 **严格早于验证开始日**，且该批20日观察完成于验证开始前时，才纳入训练期的描述统计。跨越切分边界的批次计入 `purgedTwentyDayOverlap`；验证期开始之后才整理出的训练标签记 `trainObservedTooLate`，不许回填。
- 训练的20日观察若缺价、停牌、公司行为不明或未成熟，会被排除并计入 `pendingOrIncompleteTrainTwentyDay`。验证期仍保留不成熟批次，分别计入未完成20日观察，不把它们当零，也不从分母中偷偷删去。
- `trainEnd` 与 `validationStart` 间可留出隔离段；按冻结日期统计，`embargoGap` 和拆分窗口外样本均单列。信号日同日多批次的相互依赖尚未支持，因此本版对重复信号日拒绝，而不是当作独立样本夸大置信度。
- 报告按1/5/20日分别输出完整样本数、已观察行业数、待成熟、未知及**原始未复权毛价格变化平均值**；它不是官方板块指数、复权总收益、超额净收益、统计显著性或可成交回测。
- 即使时间切分检查成功，`outOfSampleValidated=false`、`canTrain=false`、`labelsAvailable=false`、`canTrade=false`、`autoPromotion=false` 永远保留。字段 `readyForIndependentBenchmarkAndAdjustedPriceReview` 只表示两个切分窗口存在完整20日的描述样本，**不是**训练或线上升级许可。

## 用法

在 `V6_BO` 目录：

```sh
node scripts/sector-walkforward-audit.js audit /private/episodes.json /private/split.json /private/reports/walkforward-20261110.json
node --test tests/sector-walkforward-leakage-audit.test.js tests/sector-frozen-forward-prices.test.js
npm run check
npm test
```

输入按受限普通JSON读取，不联网、不改数据。仅将通过协议审核的诊断报告以权限0600写入**私有不可覆盖**的指定文件，SHA-256为本地完整性校验（不是独立签名）；重跑同内容幂等，不同内容不可覆盖。输入不合格不发布任何诊断报告。

## 仍然没有实现的认证与风险

1. 供应商行情源商用/持续采集许可、官方实际交易日和价格可用性；
2. 真实复权价格、公司行为处理、停牌、退市、幸存者偏差、成本、冲击及交易容量；
3. 相对于固定真实市场基准的超额净收益、风险、回撤、统计显著性与多重比较校正；
4. 预注册并独立锁定训练/验证切分、在新日期上线后收集**前瞻**样本、跨行业/时间漂移与市场环境的反负优化复核。

因此本轮审计通过只能证明**协议下的时间隔离检查**，绝不能宣传模型已掌握有效预测或已完成真正样本外收益优势认证。用户锁定的 `public/index.html`、`public/mobile.html`、现有四套战法、模拟盘账户、服务器配置和生产学习权重不变。
