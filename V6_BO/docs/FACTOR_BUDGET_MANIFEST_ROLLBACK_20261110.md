# V6 因子全局试验预算：历史清单倒退必须拒绝（2026-11-10）

## 问题

研究 Worker 维护全局预算：最近 90 个明确的研究信号交易日最多进行 6 次候选保留集评估，成功或失败都算。预算计算输入由当前 manifest 冻结特征信号日期与私有不可变试验报告构成。

之前，如果研究 manifest 意外恢复到较早的日期，即使私有档案记录了比 manifest **最后一个信号日期更晚**的已消费试验，预算函数仍可能正常返回 `budget-available` 或 `budget-exhausted`。后者会导致 Worker 在读取收益前直接作无害跳过，掩盖运行数据回退。跨已接受模型版本的历史更不应靠单一父血缘侥幸被发现。

## 修复

在全局预算计数时，对于每一份已封存的消费试验（包括旧 `shadow-updated`/`shadow-retained`/`paused-market-shock` 报告），验证该试验的 `lastHoldoutDay` **及** `lastObservationDay` 均不晚于本次 manifest 最后一个研究信号日期。如果更晚，则抛 `全局试验档案晚于当前研究清单，历史交易日倒退`，不可因额度已满而返回普通 `skipped-global-trial-budget-exhausted`。

只检查封存试验之后的时间倒退，不要求历史老试验的日期仍留在当前最多 400 批次 manifest 中：保留早于当前观察窗的不可变历史档案是合法的。预算原有 90 日滑动、6 次上限、跨版本重叠拒绝与旧版归档兼容不变。

## 测试与操作

```sh
cd V6_BO
node --check src/core/factor-global-trial-budget.js
node --test tests/factor-global-trial-budget.test.js
npm run check
npm test
```

离线合成测试覆盖：新归档晚于旧清单末日，立即拒绝；即使已有六次旧试验也不得把回退误报为预算耗尽；历史档案落在清单最后日期以内仍合法；已有滑动窗口测试继续有效。实际测试/CI结果以PR检查为准。

遇到该错误时检查操作员选用的 manifest、冻结特征、归档卷和备份，不得删除报告、改变日期、清空预算或更换目录规避。仅研究沙盒的安全拒绝逻辑，不启动研究、联网、部署、付费接口、实盘，也不改正式四策略及模拟盘。

回滚仅通过 Git revert 本PR合并提交，保留已有研究账本及原独占锁的人工审计约束。历史文件 SHA 并非可信外部时间公证。
