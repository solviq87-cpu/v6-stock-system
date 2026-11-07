# V3 实际重构内容

## 新增策略接入层
- `src/strategy/snapshot-normalizer.js`：统一旧系统不同字段命名，并补齐可计算的策略输入。
- `src/strategy/risk-filter.js`：ST、停牌、不可交易、流动性、综合风险过滤。
- `src/strategy/strategy-service.js`：策略统一入口，可批量评分和排名。
- `src/strategy/README.md`：接入说明。
- `tests/strategy-service.smoke.js`：基础冒烟测试。

## 修复
- 修复多策略引擎忽略 `strategyWeight` 的问题。

## 当前状态
策略层已经可以独立运行并完成候选评分，但为了避免直接影响现有线上信号，尚未强行替换 `server.js` 中旧选股主流程。下一阶段建议做“双轨评分”：旧系统继续产生候选，新策略同步打分并记录差异，完成历史回测后再切换。
