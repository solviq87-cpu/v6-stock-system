# 拒单审计轮换与账户一致备份

版本20261106am。新读写器兼容旧schemaVersion=1活动文件；第一次轮换后使用schemaVersion=2索引，引用同目录 `<账户文件>.audit.json.segments/` 下不可变分段。原事件序号和指纹不变，活动段通过baseSequence/baseHash连接已归档历史。旧733程序不识别新索引，回滚需整体恢复升级前备份，不单独替换旧程序或paper.json。

## 自动和手动轮换

默认活动事件段上限8MiB，追加会先归档旧活动段再写入新事件；不以清空文件代替保留历史。归档先发布并fsync，随后原子替换活动索引。中断前后只会看到旧索引或新索引；未引用的临时文件/已发布孤段保留，不参与当前链，也不自动删除。重试复用相同内容归档，不覆盖冲突文件。

所有追加与轮换共用审计文件的flock内核锁，异常退出会释放；账户成功交易不因轮换改变资金快照。索引丢失而段目录仍有内容、段丢失、篡改、顺序或锚点错误均拒绝后续写入。哈希不是外部签名，也不能抵抗有权限者删除整套审计及所有副本。单条记录超过活动阈值时仍拒绝，不丢弃证据。

活动索引最大8MiB、段数最多4096、归档历史在线核验最大128MiB；分页最多500条，验证分段顺序读取，不把全部历史事件同时展开到内存。超限需离线迁移，不能宣称无限审计留存。当前每次仍校验历史链，大规模长期性能待现场核验。

```bash
node scripts/rejection-audit.js verify /opt/v6/data/order-accounts/pool.json
node scripts/rejection-audit.js rotate /opt/v6/data/order-accounts/pool.json
node scripts/rejection-audit.js backup /opt/v6/data/order-accounts/pool.json /safe/new-pool-backup
node scripts/rejection-audit.js restore /safe/new-pool-backup /safe/new-pool-restore
node scripts/rejection-audit.js restore /safe/new-pool-backup /safe/new-pool-restore --apply
```

## 一致备份与恢复

backup同时持有账户与审计锁，校验权威快照并捕获当前索引、所有已引用不可变段及链锚点。正在写入时允许明确拒绝，不强抢锁。备份是带逐文件指纹的独立目录，256MiB工具上限；不含活动.guard和未提交临时文件。它是单账户和拒单证据的一致快照，不是全站灾备；access、设备、行情、模型配置等仍需原部署备份流程。

restore默认预演：校验所有文件和重建后的账户/审计，成功才报告verified。--apply只向空目录原子发布完整目录；损坏或缺段不发布目标。先离线演练，再停全部账户写进程后由运维切换恢复目录。工具不会覆盖正在运行的账户，也不会自动把新目录切进生产。

部署依赖Linux util-linux flock和支持fsync/hard-link/rename的本地文件系统。本机进程SIGKILL和正常备份往返通过，不等于物理断电、网络文件系统或跨机RPO/RTO验收。
