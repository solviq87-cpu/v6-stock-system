# V6 回测命令行默认账本口径防误用（2026-11-10）

## 问题与原始基线

以 GitHub `dev` 提交 `cc4e3707eae6b9d4ca44d4f15e699600101b6a85` 为本次开发起点。
`tools/strategy-cli.js backtest` 此前直接使用 `src/strategy/walk-forward-backtest.js`。
这一旧版研究工具在目标卖出日停牌/一字跌停时会跳过交易结果，不持续保留和估值受阻仓位，且费用/整手与逐日持仓账本不可直接比较。
主历史验证 `src/core/historical-validation.js` 已经使用完整账本；不改其行为。

## 修正范围

- `node tools/strategy-cli.js backtest sample.json`：默认复用已有 `walk-forward-policy-adapter` → `position-ledger-backtest`。保持旧版 `scanUniverse` 选股规则，执行结果按逐日持仓账本处理买卖受阻、持仓重估、整手、T+1 与费用。
- `node tools/strategy-cli.js backtest-legacy sample.json`：仅供历史对比，仍明确调用原简化回测，并加 `executionModel=legacy-simplified` 和不可忽略的偏差提示。不会把历史输出假称为逐日账本。
- `scan` 保持原行为。所有回测输出均标记 `researchOnly=true`、`canTrade=false`。
- 默认 `backtestPolicy` 明示 `lotSize=100`、`sellTaxBps=5`、`feeBps=8`、`slippageBps=10`。自定义参数显示实际输入；若有日期费率表，则 `feeMode=dated-fee-schedules`，不冒称固定费率已经使用。
- 不修改正式四套策略、因子包、自动学习、行情接入、模拟盘账户、主页或资金写入。

## 兼容性和风险

**CLI 的 `backtest` 报告结构与历史数值会改变**：原简化周期净值改为账本报告，额外包含 `orders`、`openPositions`、`executionModel` 等。依赖原格式的脚本应显式选择 `backtest-legacy`，但旧版报告不得用于正式效果排名。默认行为改变属于有意的防负优化修复，而非收益保证。

即使账本考虑了卖出受阻持仓，仍不包含真实订单簿、排队与冲击成本；所用涨跌停制度、公司行为与外部数据来源需要额外核实。合成测试不能证明真实 A 股收益。

## 验证与回滚

在 `V6_BO` 目录运行：

```sh
node --check tools/strategy-cli.js
node --test tests/strategy-cli-ledger-default.test.js
node --test tests/research-integration.test.js tests/ashare-t1-backtest.test.js tests/parallel-market-risk.test.js
npm run check
npm test
```

新增自动回归包括：旧版须显式选择、默认账本标识及受阻持仓语义、费用/整手输出口径、参数覆盖、无效 CLI 模式拒绝以及扫描入口不受影响。完整 GitHub Actions 验证结果应由 CI 记录，未跑过不报告通过。

回滚方式：在未合并前关闭 PR 即可；已合并后对相关提交 `git revert`，保留原历史数据、测试记录及已保存结果，不得用旧压缩包覆盖新的 `dev`。
