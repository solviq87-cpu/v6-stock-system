# V6 模拟盘订单生命周期账本开发记录

日期：2026-11-05

## 本轮交付

新增 `src/core/paper-order-lifecycle.js`，提供离线、确定性的模拟盘订单生命周期账本。它是独立核心模块，不声称已替换现有所有运行时订单入口，也不连接券商。

覆盖状态与账务行为：
- NEW、PARTIALLY_FILLED、FILLED、CANCELLED 状态迁移。
- 买入委托按限价和费用预冻结现金；部分成交只扣实际成交金额与费用；撤单释放未成交部分冻结资金。
- 卖出委托预留可卖股数；当日新买入持仓不可卖；部分成交与撤单正确释放剩余可卖数量。
- 费用、卖出税、现金和已实现盈亏以分为整数计算。
- 按 FIFO 成本批次重算卖出成本。
- 输出不可变成交流水快照，可直接交给既有只读三方对账器验证。
- 重复订单、重复终态成交、超量成交、非法日期、非法方向、非整手数量和资金不足均被拒绝。

## 验证

- `node --check src/core/paper-order-lifecycle.js`：通过。
- `node --test tests/paper-order-lifecycle.test.js`：8/8 通过。
- 模拟盘专项联测：`node --test tests/paper-order-lifecycle.test.js tests/paper-account-reconciliation.test.js tests/paper-shadow-reconciliation.test.js tests/paper-replay.test.js tests/paper-session.test.js tests/paper-service-http.test.js tests/paper-monitor-e2e.test.js`：58/58 通过，0失败、0跳过。
- 本轮未执行全仓库全量测试；不得将专项58项表述为全工程全量通过。

## 范围说明

该模块目前作为独立可调用账本组件交付。将其接入现有所有 HTTP/策略订单入口仍需单独完成适配与端到端验证。仅用于离线模拟盘，不具备真实券商交易能力。
