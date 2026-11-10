# V6 自主学习第五阶段：已接受研究因子的效果衰减监控

## 目标

此前研究沙盒已有实时信号冻结、5日成熟观察、样本按时间分段、训练/验证/新鲜保留集、5日分块方向门禁和同股重叠窗口剔除。但已被接受的影子研究权重如果在**其接受后才新增**的成熟样本上持续变差，仍需要独立的主动监测，不能只靠下一次候选权重验证结果判断。

本批仅对研究版 shadow 模型建立**新增保留样本下的相对衰减预警**，不接生产策略、不更改15因子基础包、账户、四套选股规则、行情接口和两张锁定主页。

## 判断方法（保守的可证伪假设，阈值未做真实历史校准）

1. 仅当存在历史上已接受的 `shadow-updated` 模型，且有至少5个**晚于该模型 `lastObservationDay` 的成熟日**，执行衰减审计；否则 `not-applicable-first-version` 或 `insufficient-fresh-evidence`。禁止拿旧保留集循环为旧模型创造新独立表现。
2. 在最多最近10个上述新日，对同一横截面分别计算原始基础权重和上一接受的影子权重的 Spearman IC，按日配对。保留缺失为缺失，不以0填充；基准与影子必须有相同覆盖。
3. 同时满足以下条件才发预警：旧影子模型平均IC低于 -0.02；相比基础权重平均低至少0.02；至少80%的配对日表现低于基础权重；前、后半段相对差值都 ≤ -0.01。
4. 触发则新研究报告显示 `status=paused-shadow-decay`、`shadowDecay.status=decay-alert-unverified`、`rollbackReviewSuggested=true`，**禁止当前候选模型升版**。历史已接受模型仍保留原样，研究权重仅保留，不触发自动回滚到生产，也不改模拟盘。
5. 不触发返回 `no-decay-detected`；这不是已证明模型可持续盈利。对尚未产生上一接受版的首次研究模型只记 `not-applicable-first-version`。

## 可审计字段

`shadowDecay` 包含审计窗口、有效成熟日数、原始基准平均IC、影子平均IC、差异、相对下跌日比例、前后半段IC差异、风险状态与人工回退审查建议。`pausedForShadowDecay` 和 `rollbackReviewSuggested` 同时放在研究报告顶层，便于独立研究调度器检索。

本批自动能力是 **发现持续失效并暂停错误的后续学习**，不是无监督自动替换正式策略，亦不是正式策略已经自行回滚。

## 局限

使用5日未复权毛收益的截面秩相关，不含费用滑点、不代表真实可成交收益。连续市场状态、行业风格、跨股票同涨跌和样本量小可能误触发；5个成熟日不意味着5个统计独立的市场环境。基础权重本身也可能退化，故要求影子权重相对基础权重显著变差才预警。阈值是冻结的研究决策规则而非已证明最优。禁止用未授权、事后补填或虚构数据驱动研究晋级。

## 验证

```sh
cd V6_BO
node --check src/core/factor-learning-reliability.js
node --check src/core/factor-shadow-evolution.js
node --test tests/factor-learning-reliability.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

新测试覆盖：旧模型在新5日收益方向反转、依然优秀时不误报、两模型同时变坏不误判差额、样本不足不报警、只看最新10个成熟日以及配对覆盖不一致拒绝。合并前必须有CI通过证据；即使CI通过也不等于已在 WorkBuddy 云实例启用研究进程。
