# FAYO H组智能运维独立专项｜176项任务台账

固定已合并 dev 基线：`b936ebdddb8c11948dd0e63f95332898dd5c1cf5`，tree `e2bf753356244f11a3f6a2d22a0414ed48f15944`。F组 #612 仍由总管审查；H组不合并其他PR、不部署、不增加外部API，不修改UI、权威账本、权限或原15秒门禁。

## 总表（第一批继续核查）

| 范围 | 数量 | 本轮局部证据 | 待专项核查 | 完整验收 |
|---|---:|---:|---:|---:|
| H01 | 16 | 8 | 8 | 0 |
| H02 | 16 | 4 | 12 | 0 |
| H03 | 14 | 0 | 14 | 0 |
| H04 | 16 | 2 | 14 | 0 |
| H05 | 16 | 0 | 16 | 0 |
| H06 | 16 | 0 | 16 | 0 |
| H07 | 16 | 0 | 16 | 0 |
| H08 | 16 | 0 | 16 | 0 |
| H09 | 10 | 0 | 10 | 0 |
| H10 | 16 | 0 | 16 | 0 |
| H11 | 8 | 0 | 8 | 0 |
| H12 | 16 | 0 | 16 | 0 |
| 合计 | 176 | 14 | 162 | 0 |

## H01 实际缺口与证据
原 runtime-trace 的有界原始 span 包含故障原因代号与实际时间，但 summary 丢弃该信息；system-readiness 原报价覆盖无法区分多类缺项。本轮在原单次 ring 聚合中保留 stage/outcome/reasonCode 重复观察组，在原只读 readiness 验证计数和时间并提供固定建议；禁止把分组当作已证实根因，把当前读取当作发生时间，或者把通知受理、重试、未知结果当作真实送达。行情只统计原检查行，15秒门禁不改。无新采集、服务、后台循环或生产恢复权限。

| 编号 | 状态/边界 |
|---|---|
| H01.1 | 局部：原 SOURCE_UNAVAILABLE 证据；供应商真实线路与采集原因待核 |
| H01.2 | 局部：原时点、缺项、冲突、只读分类；现场待核 |
| H01.3 | 待核：网络中断、超时与访问异常需原传输回执 |
| H01.4 | 局部：原 QUEUE_FULL、ALREADY_RUNNING；不等于实际重复执行或积压时长 |
| H01.5 | 局部：原策略失败回执；异常数值及真实链路待核 |
| H01.6 | 待核：复用 learning-runtime-preflight、factor-shadow-runtime-health，不能以线程失败代替模型原因 |
| H01.7—H01.10 | 待核：数据库、磁盘、硬件及进程实际观测 |
| H01.11 | 局部：原通知失败/重试/未知独立，真实送达未证实 |
| H01.12—H01.13 | 待核：权限、账户风险、版本配置和缓存一致性 |
| H01.14 | 局部：固定严重度、受影响原阶段，完整下游影响待核 |
| H01.15 | 局部：同阶段、结果、代号去重，未知根因不跨阶段合并 |
| H01.16 | 局部：原始完成时点及建议，无法证实原因明确未核 |

## 验证
修前新专项 0/8，修后 8/8；原 system-readiness 同步回归 9/9。实际使用固定源码的隔离 V8 同步测试回调，Node test/assert、AsyncLocalStorage、随机ID及未使用摘要适配，非完整原生 Node、HTTP 或现场。容器 Node v22.16.0 可用但 git ls-remote DNS 失败，完整仓库未拉取。新增原生测试文件待正式 CI，完整仓库检查、原 36 场景、真实运行及 5/20/60 日观察未完成。原 ring 仍有界，不发起请求、不改变原决策和交易逻辑。回滚仅回退本专项代码，绝不使用旧数据覆盖新账户。

下一轮沿原系统诊断及已存在的运行采样、worker-admission-budget、advanced-safety-operations、disaster-recovery、runtime-acceptance 等原模块核查 H01 剩余项目；不为原任务再建一套服务。完整签收仍为 0/176。


## 按用户最新三批分工（2026-11-28）
第一批 H01—H04 62项；第二批 H05—H08 64项；第三批 H09—H12 50项。原编号不变。下列源路径为已定位的复用入口或测试定义，不当作本轮已执行的测试。

### 第一批 H02/H04 定向修复
- H02.4：原补采在收件、归档前后复核目标日；未在有效目标日的结果不进入当前状态。
- H02.12：仅补主/副实例角色及日期检查，账户、权限与风险完整恢复验收仍待。
- H02.13：归档失败保留先前有效缓存及原成功时点，独立详情同步异常不拖累另一适用证据；不启动新恢复服务。
- H02.14：原成功时点与归档确认分离；本地投影成功前不公布新状态。尚未验证所有实际存储故障和进程重启。
- H04.10、H04.16：合成断连、失败、跨日/角色切换反例，新增7项修前1/7、修后7/7。未覆盖全市场真实历史重演。

证据：`V6_BO/src/research/market-recovery.js`、`V6_BO/tests/fayo-h02-recovery-publication.test.js`。隔离V8执行实际源码及实际 emotion 函数（未使用的 ESM import 移除，fs/atomicWrite 未调用且为哨兵替代，Node test/assert 适配，动态 import 改为同源同步模块的 Promise）。原生 Node、磁盘、真实 HTTP 和全量回归需正式 CI 复验。归档已经开始后无法在本层撤销上游写入，只能阻断迟到结果的当前投影；同日角色先变化又恢复需要原角色 epoch，当前接口未提供。未模拟/修改权威资金账本。

### 第一批已有能力定位（未计入本轮14项局部验证）
| 原任务 | 原实现/原测试 | 剩余核验 |
|---|---|---|
| H01.3、H01.4 | market-request-governor、runtime-task-guard、runtime-trace | 网络错误原分类、实际积压、持续等待 |
| H01.6 | learning-runtime-preflight、factor-shadow-runtime-health 及相应测试 | 模型加载/推理/资源真实证据，不能由健康心跳推导 |
| H01.7—10 | runtime-acceptance、advanced-safety-operations、worker-admission-budget、v6.service | 实际数据库、磁盘、CPU/GPU、进程健康 |
| H01.12—13 | system-readiness、release-provenance、原账户/风险健康回执 | 权限撤销与版本/缓存不一致联动 |
| H02.1—2、H02.9—10 | market-failover、market-request-governor、phase4-market-failover-recovery.test.js | 许可、实际线路与重试终止，不能由研究备用价取得交易权限 |
| H02.3、H02.5—8、H02.11、H02.15—16 | 原任务guard、独立worker预算、paper-transaction-recover、disaster-recovery | 安全重启、清缓存许可、真实持久账本、恢复权限边界 |
| H03.1—2、H03.9 | deploy/windows-host/START.cmd、start.sh、stop.sh、v6.service | 原启动前置条件、实机安全停止及无重复实例 |
| H03.3—8、H03.14 | system-readiness、learning-runtime-preflight、paper-recover、advanced-safety-operations、secure-backup、v6-release-preflight | 统一入口复用与真实授权维护演练 |
| H03.10—13 | boot-snapshot-recovery.test.js、paper-crash-recovery.test.js、windows-host-stop.test.js | 真机重启、异常退出、连续服务与普通用户操作 |
| H04.1—9、H04.12—15 | strategy-evidence-replay、paper-replay、fayo-replay-boundaries.test.js、runtime-acceptance | 原36场景固定ID与真实历史输入、策略风险通知及成熟反馈逐项证据 |
| H04.11 | boot-snapshot-recovery、paper-crash-recovery、原断连测试 | 真实关机恢复及隔离故障演练 |

本阶段14/176局部证据（H01 8、H02 4、H04 2），第一批14/62局部、48待核；完整验收仍0/176。未完成不得标绿。不关闭其他组PR，不自行合并。
