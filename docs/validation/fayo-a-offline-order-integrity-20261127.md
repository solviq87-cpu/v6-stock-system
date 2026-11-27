# A组离线订单日志完整性验证 · 2026-11-27

基线 dev 0c45291d7156be8a1206f0bb272f3c719d5d2336。组合 #427 查阅点 ea04adfcd45429bfc74196ac3dbc4d630ada7743；145个变更路径不与本次四个JS文件交叉。对应任务12、A-EX23、A-EX27、A-EX36；原49对账恢复仅关联，整项不宣告完成。

## 复现与变更

原还原文件的Git blob分别为：

- V6_BO/src/core/paper-order-state-machine.js: 1f6b30469dc0b6fa663f3ba54ee88164fe943352
- V6_BO/src/core/paper-order-store.js: 34796d41034d39f0b1bb2b00145590e0c3544c82
- V6_BO/tests/paper-order-state-machine.test.js: da5dd439dc2ea1e0e3df76faaf236854ac49d663
- V6_BO/tests/paper-order-store.test.js: 9bd618efa5e0999e96abc29e57dae9510f868594

相同ID异价格/数量/序号/类型/日期在原回放中被忽略；追加操作未验证原日志哈希和派生状态；读取只比较快照内的指纹而非全部状态；另订单的合法日志可被复制到当前文件。复用原散列、原写锁及原回放，不新增账户、schema或持久记录字段。严格拒绝冲突、错身份与损坏日志，保留原字节；完全相同的事件仍可幂等重试，正常成交/撤单和旧测试不变。散列属于一致性校验，不是签名，不能保证抵御能同时篡改全部原始证据的攻击者。现有单写者锁、fsync和原子替换边界没有扩大。

## 实际运行

Node v22.16.0，隔离目录，原始四文件从精确dev读取后按Git blob逐字验证。执行：

    node --test V6_BO/tests/paper-order-state-machine.test.js V6_BO/tests/paper-order-store.test.js
    node --check <各修改JS文件>
    git diff --check

| 阶段 | 总数 | 通过 | 失败 | 跳过 | TAP SHA256 |
|---|---:|---:|---:|---:|---|
| 原19项 |19|19|0|0|2fcbb36448807dfbb0ac41b634d7c560a7ab6015de08c8c733f824c7133ec44a|
| 加17项，修复前 |36|22|14|0|a5638eda3a83b5bf707776a3cd0a04b3e8c07fcae9c581da50349ed7196ddfbb|
| 修复后 |36|36|0|0|7144dd3fe4d6e385039b0ff945606d3cf8a3061566736d9d66bd71f5a22ec447|

修后实测Git blob按上述顺序为 c1762eb4d661892b6ca1011f2387265094cb7fba、765fb68b6fb70135ef480c3438c2c27bb38fbf02、a03a0dd8cbfc394ff4f7753ce25fc62a6dadc3b6、4975a133661fabd151395024a80e6c6ecc106381。四文件语法和diff空白检查通过。实际定向使用原模块，非替代模拟实现。新增矩阵覆盖读取、追加、幂等重试三路径，损坏拒绝后原字节和锁释放逐项检查。正常归档重开、原指纹及追加行为保留。

## 边界、依赖、交接

这是原离线事件存储与回放模块，不是原模拟账户权威账本，不证明正式账户或真实订单未知状态完整闭环。未运行完整工程、全量CI、真实服务、授权行情、双端实机、现场恢复；容器直接Git DNS不可用，未取得完整最新工作树，故context:resume和完整check未执行。未改正式账户、策略、交易权限、B/C合同、通知或发布owner；未合并dev或部署。请总管按最新精确HEAD对照其他组增量，保留双方HANDOFF/DEPLOYMENT文本，执行原全量与组合验收。对已有损坏档案不自动修复或回填，隔离保全后独立对账。回退只反向代码及测试，不回滚私有运行文件；旧版本会恢复本缺口，须保持安全隔离。
