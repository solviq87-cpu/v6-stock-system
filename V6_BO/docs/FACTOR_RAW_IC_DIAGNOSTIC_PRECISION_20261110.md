# V6 影子学习：原始 IC 诊断与报告取整分离（2026-11-10）

## 问题
三版本评分卡的晋级门禁已使用原始精度。但其解释性诊断仍从四舍五入到六位小数的 `perDay` 反推「改善天数比例」「留一日后是否转负」「完整五观察日组是否均正」。
例如十个观察日中一天改善 0.004、其余九天各改善 0.0000004，后九天显示为 0；旧版错误报告改善天数仅 10%、模型依赖单日、第二组没有正改善。真实原始 IC 差实际上十天都为正。这会误导对影子模型稳健性的解释。

## 改动
- 所有逐日原始三版本 IC 及配对差先作为内存临时数组保留全精度。
- `positiveDayPct`、`betterDayPct`、`worseDayPct`、`singleDayDependent`、`allCompleteBlocksPositive` 等判断依赖全精度。
- 对外 `perDay`、均值、留一日和五观察日组仍按既有小数位呈现；显示 0 的极小正值可以被统计为「正向观察」，因此必须结合精度说明解释。
- **原有 `originalGatePassed` 判定逻辑及阈值完全不变**，不引入新的调优、晋级机会或收益宣称。

## 核验
```sh
cd V6_BO
node --check src/core/factor-model-comparison.js
node --test tests/factor-model-comparison.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```
测试增加真实小幅正相关却被显示取整误判的合成场景和极小 IC 被记成零正日的场景，最终以 PR 对应 SHA 的 GitHub CI 为准。

## 边界与回滚
仅研究统计报告，不影响正式四策略、生产因子、模拟盘/账本、行情、手机/电脑锁定主页，且不接入交易与部署。本变更不能证明行业和交易日样本独立，也不能证明真实收益。回滚以 Git revert 本 PR 的合并提交实现，保留历史研究归档。
