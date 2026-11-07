# V6 统一模拟盘事件与账务接口 — 阶段验收

## 实际代码改动
- `src/core/paper-unified-view.js`: 从主服务权威 PAPER 账户生成只读、不可交易的统一成交流水与账务视图；对不完整流水拒绝伪造订单证据。
- `server.js`: 新增 GET `/api/paper/ledger`，复用既有编辑权限检查，双账户使用同一只读投影；不改变旧 `/api/paper` 和 `/api/state` 响应。
- `tests/paper-unified-view.test.js`: 新增 8 项投影测试。

## 验证
`node --check server.js` 通过。
`node --test tests/paper-unified-view.test.js tests/paper-order-lifecycle.test.js tests/paper-transaction-coordinator.test.js tests/paper-service-http.test.js` 36/36 通过。详见 `unified_tests.log`。

## 尚未完成
- 主服务自动交易仍以旧 PAPER 账户为权威，独立离线订单生命周期/事务协调器尚未成为主服务交易写入链路。
- 历史自动成交流水没有订单提交、冻结资金、部分成交、撤单记录，不能伪造。
- 尚未执行完整服务启动端到端、真实重启、电脑与手机浏览器双端联动测试。
- 原先剩余34处差异未逐项全部解决，不能宣称已清零。
