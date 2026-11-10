# V6 自动学习：三版本同日 IC 对照的稳健性诊断（2026-11-10）

## 目标

已存在的 `factor-model-comparison.js` 把固定原始权重、已接受影子研究权重和候选影子权重放在同一批**新增成熟的五日结果**上做 Spearman IC 对照。现有 `originalGatePassed` 由平均增量、胜出日比例、前后半段方向决定。少量独立成熟日虽然满足代码门槛，但可能被单日异常抬高。

本增补仅为该三版本记分卡追加**只读脆弱性字段**，不修改 `originalGatePassed`、影子模型晋级决定、正式15因子、四套核心规则、模拟盘、账户、行情或电脑/手机首页。

## 新增字段

对 `proposedVsOriginal` 和 `proposedVsAccepted` 分别输出 `fragility`：

- `worstLeaveOneOutMeanDeltaIC` 和 `bestLeaveOneOutMeanDeltaIC`：在相同已封存的最多20个新增成熟观察日期中，每次剔除**一个日期的配对IC差**，再求剩余均值的最小/最大值。不重训模型，不按结果挑选股票或修改候选权重。
- `singleDayDependent`：总平均增量为正，但至少一次剔除单日后剩余均值不再大于0，明确提示本次改善高度依赖某一日。
- `completeFiveObservationBlocks`：每五个**有效观察日**顺序组成一个完整组，统计组内均值与首末日。尾部不足五日的观察仍保留在整体/留一日分析里，但不会伪装成完整分组；`incompleteTailDays` 给出实际尾数。
- `allCompleteBlocksPositive`：需要至少两个完整组才给出布尔结果；不足时为 `null`。不足10个新增观察日时 `status=limited-fresh-observations`。
- `changesPromotionGate=false`、`canTrade=false`：这些数字属于描述性诊断，不构成置信区间、显著性结论或自动升级依据。

特别注意：这里的“五观察日”不一定是五个连续交易日；不保证跨行业/跨股票/相邻日期独立，不应称为正式的分块独立性证明。实际统计显著性还需要校正多次候选试验、市场共同因子、成分股历史、交易费用与样本选择偏差。即使诊断显示稳健，也不证明真实可成交的净利润。

## 验收

```sh
cd V6_BO
node --check src/core/factor-model-comparison.js
node --test tests/factor-model-comparison.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

新增用例包含：持续提升时的留一日和完整分组、单日异常驱动但整体均值为正、5日低证据状态、11日尾数保留、固定原门禁完全不受新诊断影响。完整回归结果以最终 PR SHA 对应的 GitHub CI 为准；未运行的命令不能冒称通过。

本改动由新增可选字段构成，不涉及个人持仓、真实资金、真实订单、未授权数据采集、部署或外网接口。回滚用 Git revert 撤销本 PR，旧影子研究不可变归档应继续保留。
