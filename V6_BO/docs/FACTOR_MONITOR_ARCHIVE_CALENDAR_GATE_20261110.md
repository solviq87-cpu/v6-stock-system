# V6 研究自动学习：冷却/恢复档案时间一致性（2026-11-10）

## 背景

全局研究试验预算会读取一个私有模型目录中的所有封存报告：已检验候选（`shadow-updated`、`shadow-retained`、`paused-market-shock`）占用预算；`paused-shadow-decay`、`paused-shadow-cooldown`、`shadow-recovered` 属于监测/恢复记录，不占预算。先前的时间回退门禁只检查占用额度的候选档案。

如果研究 manifest 被意外回滚，冷却及恢复监测档案的 `lastObservationDay` 可能**晚于**本轮冻结研究清单中的最后信号日。此前预算函数直接忽略这类报告的日期，可能正常返回 `budget-exhausted` 或 `budget-available`，将历史状态回退掩盖为普通运行结果。

## 修复

- 每份合法模式和状态的封存研究报告，都必须有有效的 `lastObservationDay`，且不得超过当前清单最后冻结信号日。这一要求同时覆盖“候选已评估”和“仅监控”，包括没有 `trialAudit` 的老版本监控档案。
- 监测档案的日期无效或晚于当前清单时，明确抛错，**不提前返回普通的预算额度/正常跳过结果**。
- 监测档案仅校验历史时间，不因此变成一个已消费候选试验；最近90研究信号日最多6次的试验上限、跨版本保留日去重、不可覆盖报告和冷却恢复流程均保持原状。
- 仅允许操作者核对 manifest、研究模型私有卷、归档备份及时间来源。禁止删档、重设时钟或换目录来“修复”错误。

## 验证

```sh
cd V6_BO
node --check src/core/factor-global-trial-budget.js
node --test tests/factor-global-trial-budget.test.js
npm run check
npm test
```

合成专项测试含三类仅监控报告（衰减冷却、持续冷却、已恢复）在“新档案+旧清单”场景的拒绝，非法日历日期拒绝，符合日期时仍为零次预算消费，以及旧格式不带 `trialAudit` 时的同等时间检查。以PR GitHub Actions实际结果为准。

本次不是给市场效果加分：不联网、不启用新接口、不改变四套正式策略、正式因子/模拟盘权重，不改两张锁定主页，不部署，也不自动清理历史证据。私有 SHA 无法取代独立可信时间戳和异地备份。回滚仅 Git revert 本 PR 的合并提交；备份保持不可删除。
