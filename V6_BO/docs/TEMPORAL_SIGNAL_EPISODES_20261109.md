# V6 连续信号独立性审计（2026-11-09）

## 问题
此前的 `overlapDiagnostics` 已经避免把同一只股票、同一交易日的多项相似策略误计为多份独立家族证据。
但同一股连续多个交易日反复命中同一家族，可能指向同一段上涨；如果把这些历史条目都当独立预测样本，就会虚高统计证据的有效数量。
观察日和模拟持有期不同，不能简单用事件行数代替有效研究样本。

## 本轮只读改进
- 只有用户明确开启 `includeLinkedRules` 或 `includeQualityRules` 的冻结规则历史审计时，返回 `temporalOverlapDiagnostics`；旧两条战法的默认响应与原有盈利记录、事件数组不变。
- 沿用数据集已经验证的共同交易日历，按 `股票 + 预先确定的策略家族` 分组，同一家族**同日**同时命中先合并；同一家族**连续日**在不同假设持有窗口内合并为非重叠分段。
- 逐个观察周期（1、5、20、60日）使用贪心非重叠起点：首次信号产生一段，后续日期距上一次分段开始大于该周期才产生下一段，期间的信号归入重叠组。
- 按周期输出 `rawRuleEvents`、`familyExposureDays`、`sameDayFamilyDuplicates`、`nonoverlapFamilyEpisodes`、`serialRepeatFamilyDays`，以及每条规则的 `signalDays`、`nonoverlapEpisodes`、`serialRepeatDays`。
- 亏损、无法成交、公司行为未验收的已命中信号均保留且计入重叠统计；绝不依据收益过滤信号。输出不修改原有 `events`、胜率、均值、四套正式策略、模拟盘账本或权重。
- 综合研究网页只读展示各周期原始信号、同家族股票日与非重叠分段，用文本说明统计边界。

## 不是统计独立性认证
不同家族依然可能高度相关，距离超过一段假设持有期也不意味着它们统计独立。
`nonoverlapFamilyEpisodes` 是用于提示连续重复信号风险的保守描述数字，**不是有效独立样本量、真实交易笔数或者对未来收益的证明**。
今后升级因子权重还需独立市场阶段、样本外与风险/成本检验，并单独评审；本轮 `weightsChanged:false`、`autoPromotion:false`。

## 自动化验收入口
`node --test tests/research-signal-episodes.test.js tests/quality-rule-forward-audit.test.js tests/linked-rule-audit-ui.test.js`；
全部回归执行 `npm test`，由 PR CI 记录通过/失败，再合并 `dev`。
发布后仍须检查目标部署域名、版本、真实行情时间戳及国内访问，并保留可回滚记录；CI成功不等于线上上线。
