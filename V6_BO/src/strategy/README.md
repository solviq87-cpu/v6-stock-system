# 策略融合层

入口：`strategy-service.js`

数据流程：

`原始行情字段 → snapshot-normalizer → risk-filter → market-regime → multi-strategy-engine → 排名`

该层保持独立，不会直接覆盖旧的线上选股逻辑。下一阶段可通过适配器把旧系统每个候选股统一送入 `evaluateCandidate()`，再进行双轨对比（旧分数 vs 新分数），确认后逐步切换。
