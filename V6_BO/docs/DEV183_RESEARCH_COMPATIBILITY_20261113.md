# dev PR #183 与待交付研究门禁相容修复

开发基线为保留全部并行变更后合入PR #183的 `e961cb2f838705e47dad2444c6abd8854ca58384`；没有从旧dev覆盖当前实现。只修复两处新增协议与既有工具的真实相容问题。

1. **观察队列ID贯穿证据包**：整合版push observer已将实际不可变`signalId`映射为队列协议`id`。PR #183的monitor将signalRefs带入`observeStock.origin`，但证据包原校验只允许code/type/ts，使合法新队列在冻结阶段失败。现在显式接受、验证并原样保留64位小写hex字符串`id`；legacy没有ID仍没有ID，无效ID、别名signalId和额外字段继续拒绝，不丢字段绕过。
2. **归档验收识别严格固定种子**：合法`SEED_MODE`登记原先被只认普通预登记的归档工具拒绝。现在调用真实`verifySeedRegistrationMetadata`校验固定权重、配置、pack、前缀、血缘和真实封存元信息；其余旧档逐字节/哈希/文件名核验保持。自重封hash但种子权重非法仍拒绝，不改写任何既有登记或试验。

实际新增对照：相关32项在修复前29通过/3失败；修复后包含种子、普通预登记、active/recovered、候选日期、队列和研究闭环的8文件定向 **111通过、0失败、0跳过**。覆盖实际monitor→observeStock→证据包落盘、重启只读恢复、信号ID改变产生不同hash、改ID不重封会发现篡改、legacy缺ID不补造、未知字段拒绝、合法种子备份及旧字节不变。日志：`dev183-compat-tests-before.tap`、`dev183-compat-tests-after.tap`。

交叉审查确认：worker和evolution保留`cooldown.phase=active`豁免，仅旧版完全缺cooldown对象的decay警报兼容。recovered等待继续要求新预登记；空前缀种子没有替代普通登记的36批门槛，也不豁免首次研究训练/验证/至少5个新成熟保留日、试验预算或代码指纹。register-seed只允许空初始血缘、固定±2%规则，既有shadow/prereg文件名本身就阻止重置；登记前不读取H5选候选。升级研究源代码仍须按新指纹登记新候选，不能修改旧指纹。

PR #183的股票观察、证据包、研究假设、复访和日终观察继续写独立私有研究目录；未见向S.stocks、lastPx、正式权重或账户写入的桥接，认证和交易标志保持false。本批没有真实行情请求、通知、部署或账户操作；本地hash不是外部真实时间或独立来源认证。最终全量由主集成执行。回滚仅revert本批代码，保留全部历史档案。
