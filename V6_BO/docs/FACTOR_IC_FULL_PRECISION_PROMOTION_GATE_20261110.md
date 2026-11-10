# V6 自动学习：原始 IC 精度门禁（2026-11-10）

## 发现

三版本对照 `compareShadowVersions` 原先先把每日 IC 和差值四舍五入到 6 位，再将已四舍五入的均值、前后半段均值用于 `originalGatePassed`。因此，真实前半段 IC 增量为 `-0.0010004` 的候选，在显示为 `-0.001` 后可能越过 `>= -0.001` 门禁；反过来，真实平均增量为 `0.0020004` 的候选可能因显示为 `0.002` 而被错误拒绝。

该问题只涉及**影子研究模型晋级判定**；它不是正式因子权重的上线通路。

## 修复

- 将候选与固定原始权重的逐日 IC 差保留全精度，用作 `originalGatePassed` 的平均增量、正向天数占比和前后半段门禁。
- `perDay`、`proposedVsOriginal`、描述性脆弱性诊断等既有展示字段继续保留原有小数精度、结构与语义，避免不必要的接口变动。
- 维持现有门槛 `meanDeltaIC > .002`、`betterDayPct >= 60`、`firstHalfDeltaIC >= -.001`、`recentHalfDeltaIC >= -.001`，不放宽策略、风险或样本外约束。

## 回归与限制

新增两个合成临界样本，分别覆盖显示取整导致的假放行和假拒绝。要求在 PR commit 上检查：

```sh
cd V6_BO
node --check src/core/factor-model-comparison.js
node --test tests/factor-model-comparison.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

本变更只修改三版本比较器、专项测试及文档。实际验证结果以对应提交的 GitHub Actions `verify` 和 `verify-web` 为准。**不**更改正式四套选股策略、正式因子包、模拟盘、账户账本、行情接口、电脑版或手机版锁定主页；不部署、不宣传真实收益、不允许自动交易。

## 回滚

使用 Git revert 撤销本 PR 合并提交；已存在的私有不可变影子研究归档保持只读，不能用旧包覆盖。
