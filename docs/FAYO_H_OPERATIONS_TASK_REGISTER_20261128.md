# FAYO H组智能运维独立专项｜176项任务台账

固定已合并 dev 基线：`b936ebdddb8c11948dd0e63f95332898dd5c1cf5`，tree `e2bf753356244f11a3f6a2d22a0414ed48f15944`。F组 #612 仍由总管审查；H组不合并其他PR、不部署、不增加外部API，不修改UI、权威账本、权限或原15秒门禁。

## 总表（第一批继续核查）

| 范围 | 数量 | 本轮局部证据 | 待专项核查 | 完整验收 |
|---|---:|---:|---:|---:|
| H01 | 16 | 12 | 4 | 0 |
| H02 | 16 | 6 | 10 | 0 |
| H03 | 14 | 5 | 9 | 0 |
| H04 | 16 | 3 | 13 | 0 |
| H05 | 16 | 0 | 16 | 0 |
| H06 | 16 | 0 | 16 | 0 |
| H07 | 16 | 0 | 16 | 0 |
| H08 | 16 | 0 | 16 | 0 |
| H09 | 10 | 0 | 10 | 0 |
| H10 | 16 | 0 | 16 | 0 |
| H11 | 8 | 0 | 8 | 0 |
| H12 | 16 | 0 | 16 | 0 |
| 合计 | 176 | 26 | 150 | 0 |

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

## 第一批继续：H01/H03 主机健康证据修复
基于 `e27089f02906a65f013cab5ee5474aca3f246d2a`，原 Windows/WSL host-runtime.js 在异步健康探测前判断进程身份，返回时未复核；同时可能用当前安装 SHA 冒充已运行版本、把同次启动中的外部 PID 当作已经停止。修复原 start/check 控制器：核对进程原版本、探测结束复查身份、检查期间安装 SHA/manifest 或进程记录改变时拒绝成功；同一 boot 的不匹配存活 PID 只报 stale-process-record，不停止、不删除记录。保留正常运行但 HTTP 不健康的状态，保留跨 boot/已退出停止判定。仅修控制层，不改变现有安全配置、账户、发布机制或启动脚本入口。
- H01.10、H01.13：局部进程退出/版本不一致诊断；真实机器、全部配置及缓存一致性未签收。
- H03.1、H03.3、H03.4、H03.8：局部启动与状态检查证据，原 CLI 仍使用固定脱敏错误码；不自动重启、不引入新 UI。
- 新测试 V6_BO/tests/fayo-h03-host-health-evidence.test.js（原 start/checkHost 函数原样抽取、隔离 V8、模拟进程/HTTP/元数据、未执行真实系统调用）。修前 2/10、修后10/10；首次启动的后置身份检查经语法解析，真实首次启动及完整原生 Node 与实际启动尚待 CI。历史原有 8+9 与 7 项隔离证据不重复计任务数。
第一批局部 20/62，待 42；全组 20/176，待 156，完整签收 0。此处仅局部源码证据，不能代表运行环境、全量回归或已部署。原 H01/H02/H04 记录保留；原任务编号不变。


## 第一批并行证据整合与原基线逐项定位
保留 e27089f、822cf95 的恢复发布和主机身份/版本校验及其测试，不用并行生成的 host 补丁覆盖其较完整实现。此次仅纳入已测试树 1f5a0c5 中未冲突的 runtime-trace、market-failover 与对应测试，共四个原样 blob；原 system-readiness 和 quote-observation-view blob 与隔离验证基线完全一致。已测试源提交 7e0f268 未曾成功更新专项分支，不是已合并记录。
- H01：原始 hook 数、结果合计和诊断分组相互复核；未分类失败/未知结果不能被业务代号吞掉；畸形或缺失组证据拒绝，旧版无诊断字段仍明确未观测。重复分组不当作根因认证。
- H02.1、H02.2 局部新增：失败后备用、原始成功回执与持久化投影的核验及异常分类；H02.14 补强原尝试起止时点、回退时钟未知、进行中与上次结果隔离。保留原源、调用次数、重试、权限、15秒门禁与研究只读边界。
- 实际隔离验证：新增诊断修前0/2、修后合计10/10；原就绪度9/9；原 failover 定向修前0/4、修后4/4。运行实际源代码，使用同步 ALS、内存文件系统/模拟摘要和注入时钟；不是实际磁盘、真实行情或完整 Node CI。并行 host 的10项与恢复发布7项按其原记录单列，不重复累加任务数。
- 本专项本轮局部源码/定向测试对应任务：H01 10、H02 6、H03 4、H04 2，共22/62（全组22/176）；第一批尚有40项未取得本轮专项局部验证。完整验收0/176。以下原基线定位表用于复用与追查，不作为本轮任务验收计数。
- 原已合并 dev b936ebdd 与 ABCD 候选6a684568 同树；原[CI verify](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46047944026/job/140671804563)8029/8029。表中括号为原主回归 TAP 序号，P仅表示原有相关源码、原测试或新增局部依据，U为未建立充分专项依据，不代表已解决完整需求。

| 编号 | 原依据及待验边界 | 状态 |
|---|---|---|
| H01.1 | 原 endpoint health、trace 源失败分类 | P |
| H01.2 | 原报价时点、缺失、冲突及新增反例 | P |
| H01.3 | 原 DNS 脱敏与解析失败区别（5290/5292） | P |
| H01.4 | 原 runtime-task-guard、队列保护 | P |
| H01.5 | 原策略失败 trace，异常结果全链待核 | P |
| H01.6 | 原模型 preflight、心跳（3642/2140），推理和资源原因待核 | P |
| H01.7 | 原档案/账本完整性（948/1330/1037），真实数据库统一待核 | P |
| H01.8 | 原备份空间前置（229/230），长期增长待核 | P |
| H01.9 | 真实 CPU、GPU、显存及RSS异常专项待核 | U |
| H01.10 | 原心跳（2140），本轮 host 原身份复核 | P |
| H01.11 | 原队列和通知 trace，真实送达未认证 | P |
| H01.12 | 原两账户检查与撤权（6474/7444/2582） | P |
| H01.13 | 原版本、缓存（234/5936/4237），新增 host 版本核验 | P |
| H01.14 | 固定等级及影响阶段，完整下游待核 | P |
| H01.15 | 同阶段同结果同代号分组，非根因证书 | P |
| H01.16 | 原时点、未分类失败、脱敏建议 | P |
| H02.1 | 原主备（2498/406），授权现场待验 | P |
| H02.2 | 原文件和证据绑定（2496/5098） | P |
| H02.3 | 原 worker 超时释放（171/1135/8013），自动重启范围待验 | P |
| H02.4 | 原缺失证券补价（1659），真实断网补采待验 | P |
| H02.5 | 原缓存过期与字节检查（1384/2356），清理范围待核 | P |
| H02.6 | 原共享线程预算/风险独立槽，负载调度待 H06 | P |
| H02.7 | 原过期结果拒绝（2356/750/2276） | P |
| H02.8 | 原档案/心跳（1330/2140），数据库真实状态待核 | P |
| H02.9 | 原有界重试（1664/1105/1106/5886） | P |
| H02.10 | 原不重复恢复（406/407）、task guard | P |
| H02.11 | 原真实双进程幂等（303/5162） | P |
| H02.12 | 原账户与回执绑定恢复（740/830），全链待验 | P |
| H02.13 | 原历史缓存只读降级（982）、failover | P |
| H02.14 | 本轮原 failover 时点与结果诊断 | P |
| H02.15 | 原禁止覆盖目标（105/1555/1558） | P |
| H02.16 | 原人工晋级/不改权重（1397/4059） | P |
| H03.1 | 原 windows-host 启动入口 | P |
| H03.2 | 原有界停止和身份校验 | P |
| H03.3 | 原 check，新增版本和身份复查 | P |
| H03.4 | 原诊断及新增固定 reason | P |
| H03.5 | 原 paper/transaction recovery 与备份恢复 | P |
| H03.6 | 原备份恢复测试（1552—1561） | P |
| H03.7 | 原 audit CLI（1011/1012/1311） | P |
| H03.8 | 原版本检查（234/5936）与新增 host 版本 | P |
| H03.9 | 原依赖和端口前置 | P |
| H03.10 | 原 SIGKILL 恢复（120—123），实际用户电脑重启待验 | P |
| H03.11 | 原异常退出/锁释放（4481/8013） | P |
| H03.12 | 原心跳、runtime-acceptance，长期实运待验 | P |
| H03.13 | 原一键安装与现有启动/停止/检查入口 | P |
| H03.14 | 原 --apply/禁止覆盖（1552/1555） | P |
| H04.1 | 原 as-of 回放（1265/1268） | P |
| H04.2 | 原政策/新闻事件时点（1654），完整市场历史待核 | P |
| H04.3 | 原市场冲击风险门禁（2112/2248/4059），真实跳水过程待核 | P |
| H04.4 | ETF异常成交与联动完整历史重演待核 | U |
| H04.5 | 新旧主线转换完整历史重演待核 | U |
| H04.6 | 原 crowding-risk-replay-audit，真实全过程待核 | P |
| H04.7 | 原新闻修订撤稿回放，提前兑现与反向行情待核 | P |
| H04.8 | 原 close-risk 风险路径，真实全过程待核 | P |
| H04.9 | 原受限成交/T+1/涨跌停（1211/1475/1477） | P |
| H04.10 | 原旧价/冲突/错源（1273/3219）及本轮反例 | P |
| H04.11 | 原断点与异常退出（120—123/1146），联合真机待验 | P |
| H04.12 | 原回放和策略时点（1265/1475/6937），完整调度待核 | P |
| H04.13 | 原候选过期门禁（920/2276），重排防追高完整重演待核 | P |
| H04.14 | 原冻结交易、费用与风险通知回放（1475/3011） | P |
| H04.15 | 原成熟标签及未来隔离（1925/1973/2086） | P |
| H04.16 | 原 replay boundaries、新专项反例 | P |


原基线相关依据映射59项（P），3项（U）需专项补足；本轮实际局部任务证据仍按22项统计。需完整执行原36端到端场景、真实运行、原生 Node、5/20/60日观察等门禁。未部署、不自行合并、不改UI、账本或交易权限。

## H01.8/H01.9：原主机审计入口的一次性真实资源采样
原 host-audit 仅列依赖和 systemd 服务。本次复用原 Windows/WSL host-audit.js 与原 shell/PowerShell 入口，无新常驻服务、网络请求、调度权限或自动清理。两次 OS CPU 累计计数的单调时间差，窗口不足100ms、计数回退、核心变化或无增量时输出未知；一次性 OS free/total memory 与用户 home 所在文件系统的 unprivileged available/total bytes，零与未知独立，拒绝溢出及不合法分母。CPU 100%仅指本采样窗口，不是持续故障；OS free memory 不是应用预算；home 盘不能证明全部数据盘。GPU/显存无可靠本地探针，保持 null；不启动或停止任何进程，不变更权威账户与发布。
实际 Node v22.16.0 在隔离容器执行 node --check 及 node --test V6_BO/tests/fayo-h01-host-resources.test.js：6/6、0失败、0跳过，其中1项调用真实本机 OS/文件系统接口，5项为注入边界夹具。原 host-runtime 依赖在容器以未调用的占位模块装载，未执行完整 CLI/原安装链。容器实际示例 CPU 5个OS可见逻辑核心、151ms、0%忙碌，OS内存及home盘容量有原读数；仅证明测试环境，不是用户电脑/WSL或生产数据，不作性能提升结论。精确测试源码 blob a49b591c5b72afa9e9a21a70e49a0e59a9437585，测试 blob 3d6ca6ef58fbc6ef15cecb19f05e694d65607b87。原生完整CI及GPU、资源长期增长、真机验证仍待。第一批新增2项局部代码/测试，24/62，38待核；全组24/176，152待核，完整签收0。

## H04.5 原板块轮动历史链补强（不另建评分器）
原 sector-breadth-market-bridge.js 保留真实冻结成员集合 SHA256（非当天有效报价子集）；原 sector-rotation-history.js 在原3/5日研究之上拒绝已知同数量换成员，旧档案缺完整身份仅保留历史描述，不认证新主线交接。新增只读 leadingSectorReplay：原明确交易日相邻、同分钟/分类、同行业或同概念完整可比排名分母、全成分覆盖与同冻结身份、唯一普涨领先者才给出观察领先板块交接，保留原两时点与分值；缺日/同分/身份变化均未知。无真实主线、交易、推送或权重授权，不写历史或修改排名。新文件 V6_BO/tests/fayo-h04-sector-transition.test.js 使用合成冻结市场快照和原 bridge、daily-sector-strength、rotation、quote-time、calendar 实际源码的隔离同步 V8 回调，修前0/6、修后6/6；原 rotation 5个纯计算用例全部通过，原2个真实文件CLI用例未执行。Node assert/require和SHA256（abc与空串标准向量校验）适配，不计为完整原生CI。原始历史市场数据和36联合场景未实测，H04.4 ETF异常交易及市场联动：F组未合并#612有月报适配器，月度数据不冒充盘中ETF异动；未重复建设，待真实授权同窗数据及总管集成。第一批本专项局部25/62，待37，全组25/176，待151，完整签收0。

## H04.5 / H04.16 并行轮动增量兼容补强
新 memberSetHash 进入原板块归档投影后，原关系回放对完整旧归档做严格对象相等会拒绝正确的历史数据；原同名不可变文件重跑亦会误报冲突。本次沿原 bridge 导出只去除新字段的 legacySectorProjection；原回放仍核验全部原始快照重算、独立 memberIdentity 全等、整份归档投影，只有全部旧字段完全一致的旧形态才兼容，并记录 exact-current/legacy-without-member-set-hash；拒绝新旧混合、伪造指纹或任何其他字段变动。原 sector-strength-research 的幂等写入只允许精确旧字节，不替换旧档案；不同内容仍拒绝。原轮动 leadingSectorReplay 增同评分组件覆盖检查，避免缺涨停标记导致不同评分口径的主线切换。保留此前25/62、25/176局部计数，非独立任务新增，不改交易/权重/推送/账户/UI/发布权限。
本轮直接执行原严格相等条件和补丁实际抽取的投影匹配条件+helper，6个隔离JSON夹具修前5/6、修后6/6；精确整文件语法解析通过。新增原生回归4项（原 capture bridge 的旧档案、篡改、真实临时目录幂等及轮动评分口径），未在完整Node执行，需CI。原轮动历史报告同名不同内容仍保留拒绝覆盖；需要新研究输出目录查看新版报告，不能改写旧报告。原始历史归档时间和ETF真实盘中数据仍待验。


## H03.12 原长期运行观察证据一致性补强（兼及H01.13/H02.12）
固定父提交 c0096cbaeca9e869de9d98a30c979c0247936358 的四条正式工作流均已成功：[主CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46135616430)（12/12作业成功）、[Windows](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46135616568)、[双端](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46135616414)、[逐提交覆盖](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46135616462)。本次仅复用原 runtime-acceptance，不另建服务；冻结内部验收标准，返回独立副本，避免调用方修改阈值却保留原hash。观测到主副写权限撤销/异常时清除原版本证明缓存，重新取得权限必须重新认证；刷新失败不复用旧证明。版本证明只保留合法SHA字符串与已安装布尔值快照，避免引用对象被外部修改。正常五分钟缓存不变。保留原写入锁、回放、账本、15秒行情门禁及5/20/60日独立复核门禁。上一轮实际执行抽取原 createRuntimeAcceptance 的隔离V8 6场景修前1/6、修后6/6（内存文件系统、模拟指标/时钟/锁/摘要，非完整Node），本提交额外严格限定SHA字符串类型。新增5项原生测试及原五分钟缓存用例待新HEAD正式CI。真实主机、持久化、长期持续观察、角色瞬时切换又恢复（无上游单调epoch）仍待验，不宣称持续运行已认证。第一批专项局部26/62，全组26/176；完整签收0。原证据记录不删除、不覆盖历史数据，不合并不部署。


## 用户最新要求两批收口：第一批 H01—H08（126项）
固定已通过父提交 `d79082f00ffcd48c83c1744cf5c24cac96932735`，原[主回归8081/8081](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46138287392/job/140958387048)，0失败、0取消、0跳过；另20/20、40/40、24/24；四条正式工作流全部成功。以下为本次逐项复核**局部证据**，不将同一测试反复算作新增开发，不把测试通过当实盘、全市场或长期运行完整验收。原26项专项证据与25项非重叠基线证据保留（H01 16，H02 13，H03 14，H04 8，共51）；本轮从精确父提交完整主回归逐项补充61项不同编号局部关联依据，并新增H05.9隔离修复1项，共113/126；其中专项新增或定向复核27项、原有能力复用依据86项。**待补强13/126，完整验收0/126；全组113/176局部有据，63/176未取得同等局部证据，完整验收0/176。** 未修改原任务编号，第二批仍为H09—H12 50项并复核第一批遗留。表中TAP是父提交原生主回归的真实测试名和序号，非当前新增测试通过数。

| 模块 | 任务数 | 局部有据（含复用） | 暂缺同等证据 | 完整验收 |
|---|---:|---:|---:|---:|
| H01 | 16 | 16 | 0 | 0 |
| H02 | 16 | 16 | 0 | 0 |
| H03 | 14 | 14 | 0 | 0 |
| H04 | 16 | 14 | 2 | 0 |
| H05 | 16 | 11 | 5 | 0 |
| H06 | 16 | 13 | 3 | 0 |
| H07 | 16 | 16 | 0 | 0 |
| H08 | 16 | 13 | 3 | 0 |
| 第一批合计 | 126 | 113 | 13 | 0 |

### 新增精确原生测试证据映射（61项）
| 原任务 | 固定父提交TAP证据 | 真实适用边界 |
|---|---|---|
| H02.3 | 1135 `complete worker terminates on timeout and allows subsequent requests`；8065 `constructor failure, worker error, exit and original timeout release every existing wrapper` | 异常退出、超时释放后允许再次执行；自动重启策略与实际长期故障待验 |
| H02.5 | 1406 `capacity pins pending work, limits input and allows later cache eviction without expanding workers`；2617 `old session labels do not evict an already valid current-day index cache` | 失效缓存容量回收与日期保护；全盘缓存清理不认证 |
| H02.6 | 8058 `two background declarations cannot consume the independent risk reservation`；8061 `simultaneous child admissions use atomic shared slots, not a budget per worker` | 统一并发准入和独立风险槽；动态负载重调度仍待 |
| H04.3 | 888 `C6.5 lunch, premarket or after-session sequences cannot claim continuous trading plunges`；889 `C6.5 identical duplicates deduplicate; real continuous morning and afternoon plunges stay visible` | 连续盘中急跌反例及正常对照；真实历史全市场联合回放待 |
| H04.6 | 655 `C9.1 two comparable deteriorations after observed crowding identify a shadow collapse candidate only` | 同口径拥挤恶化及影子崩解候选；真实全过程待 |
| H04.7 | 2777 `late correction and retraction change only later visible evidence, not earlier decision snapshots`；1510 `missing and late benchmarks stay null; corporate actions cannot become false event returns` | 修订/撤回的可知时间及事件收益反例；提前兑现、反向行情真实重演待 |
| H04.8 | 436 `C8.2 three successive equal hypothetical shocks compound, not add or claim actual limit rates`；437 `C8.2 unknown sellable amount keeps total no-exit shock but no fictitious locked split`；910 `C21.4 duplicate market reports deduplicate, same-day conflict cannot count as a consecutive market decline` | 合成连续冲击、未知可卖仓位和连续市场下跌；真实个股连续下跌待 |
| H04.12 | 1811 `stage cutoffs retain late arrivals only where they were actually known and preserve rejected candidates`；1347 `actual background collection and incomplete receipts use one bounded parent trace without extra dispatch` | 原工作流时点与原任务父链；联合调度全场景待 |
| H04.13 | 6783 `candidate re-ranking or changed frozen stock quote invalidates historical provenance`；4907 `decision chase risk: a move toward the same target triggers a new chase-risk veto` | 候选重排后证据失效及追高否决；真实市场重排待 |
| H05.3 | 6652 `actual workspace worker correlates a coalesced read with one real execution receipt`；1347 `actual background collection and incomplete receipts use one bounded parent trace without extra dispatch` | 原任务及工作线程阶段耗时；异常发现至研究完成的真实全链待 |
| H05.5 | 1360 `plan trace measures committed observation, not delivery; read-only and duplicate alerts do not dispatch`；317 `elapsed preview budget and monotonic clock failure stop further synchronous validation without changing the account` | 风险观察提交与保护预算边界；实际风险触发至生效时间待 |
| H05.6 | 6664 `48 queue eviction and rejection are not attempts, and guard/late callbacks stay unknown`；1360 `plan trace measures committed observation, not delivery; read-only and duplicate alerts do not dispatch` | 排队、尝试和送达语义分离；真实送达时间待 |
| H05.7 | 2447 `batch38-08 independent deadline covers uncooperative headers and body, late data not projected`；2453 `batch37-06 hard timeout even if fetch ignores AbortSignal; late headers never read`；2454 `batch37-07 deadline covers incomplete response body even with ignored abort; late body cannot finish successfully` | 行情接口头/体硬超时；真实接口延迟基准待 |
| H05.8 | 317 `elapsed preview budget and monotonic clock failure stop further synchronous validation without changing the account`；180 `timeouts and worker errors release the single slot without exposing private paths or errors`；181 `advanced risk runs a real HTTP server and worker with original accounts, editor permission and no writes or egress` | 账户预览预算与真实隔离HTTP风险工作线程；生产响应时间待 |
| H05.10 | 5376 `resource budget: summary does not repeatedly filter the full retained span ring` | 原汇总单次遍历的操作量反例；真实瓶颈基准待 |
| H05.11 | 1401 `page reads return immediately, coalesce codes and expose only completed independent evidence`；210 `account and exit evidence survives absent or over-budget optional context; paused sessions keep cost unknown` | 原同步页面快速返回和可选上下文缺失保留账户证据；真实研究速度待 |
| H05.12 | 1811 `stage cutoffs retain late arrivals only where they were actually known and preserve rejected candidates`；6652 `actual workspace worker correlates a coalesced read with one real execution receipt` | 阶段可知时点及后续工作线程；深度研究真实时限待 |
| H05.13 | 1408 `timeout aborts work, ignores late success and never overlaps an uncooperative injected reader`；8005 `43-playbook cache and held-stock exception cannot resurrect expired signals` | 超时和失效结果不得恢复 |
| H05.14 | 1409 `close cancels queued and active work and does not publish any late result`；989 `mobile concurrent requests are coalesced and never overwrite a newer shared snapshot` | 取消后的迟到结果及旧共享快照不得覆盖 |
| H06.1 | 229 `insufficient or unknown disk capacity rejects before creating plaintext or changing original inputs`；230 `source growth after the disk preflight stops capture before encryption exceeds the original budget` | 原磁盘容量检查；本组此前host-audit还验证OS CPU/内存/home盘；GPU/显存真实探针待 |
| H06.2 | 8060 `real nested workers share the same admission and parent termination reclaims orphaned child leases`；8061 `simultaneous child admissions use atomic shared slots, not a budget per worker` | 原嵌套线程共享原子并发限制；进程/OS总预算待 |
| H06.3 | 8058 `two background declarations cannot consume the independent risk reservation`；8063 `release provenance shares the original bounded background slots and cannot borrow the risk slot` | 共享后台声明预算及独立风险槽 |
| H06.4 | 337 `automatic research coalesces reads, follows the next session and never re-dates late history`；7657 `strong markets, non-excluded sectors and unknown data never lower research priority` | 原交易日推进和研究优先级保护；动态组合调度待 |
| H06.5 | 1406 `capacity pins pending work, limits input and allows later cache eviction without expanding workers`；8058 `two background declarations cannot consume the independent risk reservation` | 容量拒绝和保留风险槽；实际非关键计算动态延迟待 |
| H06.6 | 1409 `close cancels queued and active work and does not publish any late result`；8065 `constructor failure, worker error, exit and original timeout release every existing wrapper` | 取消、退出释放和原任务收尾；分批、暂停完整联动待 |
| H06.7 | 8058 `two background declarations cannot consume the independent risk reservation`；8065 `constructor failure, worker error, exit and original timeout release every existing wrapper` | 后台工作线程准入独立风险槽；真实大模型训练负载待 |
| H06.8 | 8058 `two background declarations cannot consume the independent risk reservation`；58 `account cache accepts the exact 15 second boundary, rejects the next millisecond and preserves provider ordering` | 风险独立预算、原15秒报价门禁 |
| H06.9 | 8061 `simultaneous child admissions use atomic shared slots, not a budget per worker`；8063 `release provenance shares the original bounded background slots and cannot borrow the risk slot` | 统一后台任务原子准入；全模型及策略真实负载待 |
| H06.10 | 8058 `two background declarations cannot consume the independent risk reservation`；8063 `release provenance shares the original bounded background slots and cannot borrow the risk slot` | 同时最多两后台声明；全策略运行模式待 |
| H06.11 | 1193 `source requests are coalesced across breadth, historical ladder and structured review readers`；1719 `strict original settlement maturity invalidates cache while unchanged effective inputs remain reusable` | 原共享请求及可复用有效输入缓存；批量推理实际效率待 |
| H06.15 | 8058 `two background declarations cannot consume the independent risk reservation`；8063 `release provenance shares the original bounded background slots and cannot borrow the risk slot` | 风险独立预留准入；实际持仓连续监控待 |
| H06.16 | 58 `account cache accepts the exact 15 second boundary, rejects the next millisecond and preserves provider ordering`；1336 `fill rechecks current risk policy; rejection leaves cash and order events unchanged` | 现存独立报价及成交风险门禁；新运行模式不存在完整验收 |
| H07.1 | 1193 `source requests are coalesced across breadth, historical ladder and structured review readers`；1271 `the original market importer persists exact raw bytes and historical as-of reads never substitute a later snapshot` | 原数据请求合并与原始归档 |
| H07.2 | 989 `mobile concurrent requests are coalesced and never overwrite a newer shared snapshot`；1217 `same persisted account serves both responsive dashboard and authenticated research ranking` | 移动端并发共享快照与原账户 |
| H07.3 | 1768 `EMA/MACD batch, incremental and serialized restart are independent paths; cold history actually changes the answer` | EMA/MACD完整、增量及冷历史对照 |
| H07.4 | 1719 `strict original settlement maturity invalidates cache while unchanged effective inputs remain reusable`；4281 `current raw content must match the classified cache even when the version hash remains intact` | 有效输入缓存复用及内容一致性 |
| H07.5 | 1768 `EMA/MACD batch, incremental and serialized restart are independent paths; cold history actually changes the answer`；5156 `identical market retries are harmless but contradictory same-batch observations are not chosen by array order` | 批次算法及重复/矛盾输入一致性 |
| H07.6 | 989 `mobile concurrent requests are coalesced and never overwrite a newer shared snapshot`；8061 `simultaneous child admissions use atomic shared slots, not a budget per worker` | 原并发共享与原子预算；所有算法并发一致性待 |
| H07.7 | 1768 `EMA/MACD batch, incremental and serialized restart are independent paths; cold history actually changes the answer`；6110 `identical evidence deduplicates across clock changes and restarts, preserving the original recorded time` | 序列化重启及原证据去重 |
| H07.8 | 1768 `EMA/MACD batch, incremental and serialized restart are independent paths; cold history actually changes the answer`；3131 `Tencent raw day response cannot impersonate adjusted stock history` | EMA/MACD与复权来源隔离；所有K线周期待 |
| H07.9 | 1984 `original, accepted and proposed variants share the same fresh daily scorecard`；8002 `all four strategies invalidate cached candidates without requiring a new source version` | 统一因子分数与四策略缓存失效 |
| H07.10 | 2962 `H04.5 same frozen category population replays old and new broad leader without changing original ranks`；5382 `same-day current repetition cannot conceal changed calculation or membership metadata` | 冻结行业强度口径及成分/计算信息一致性；资金完整验证待 |
| H07.11 | 523 `C38.1 original recognition, auto validation and historical replay return the same full path evidence`；1338 `research ledger uses the same dated fee engine and entry risk reasons` | 原风险回放与研究账本复用；全组合计算待 |
| H07.12 | 1133 `performance recomputes known equity and Wilson interval; zero volatility has no Sharpe`；3456 `cost stress recalculates actual ledger fees and additive slippage without using adjusted-price labels` | 真实已知权益、原费用与绩效复算 |
| H07.13 | 1510 `missing and late benchmarks stay null; corporate actions cannot become false event returns`；3343 `re-sealing a stored replay with newly declared adjusted history cannot bypass restore checks` | 公司行动与复权历史不得造成错误回放 |
| H07.14 | 1719 `strict original settlement maturity invalidates cache while unchanged effective inputs remain reusable`；8002 `all four strategies invalidate cached candidates without requiring a new source version`；5544 `retained holdout windows cannot be reused across target or model versions and calendar revisions cannot hide history` | 输入、策略缓存及模型版本隔离；完整算法依赖待 |
| H07.15 | 275 `auction cache never stamps Friday supplier data as Monday and retains old good evidence`；4281 `current raw content must match the classified cache even when the version hash remains intact`；4397 `a newer cache queried for a past trigger cannot lend future versions or a future journal head` | 原始日/时间与内容、历史缓存用途；全缓存契约待 |
| H07.16 | 275 `auction cache never stamps Friday supplier data as Monday and retains old good evidence`；7949 `serializing and hydrating an old cache preserves observation dates but cannot grant wire freshness` | 缓存读取和更新不产生新行情时点 |
| H08.3 | 6873 `immutable archive runner creates idempotent private daily output, conflict blocks rewrite`；5972 `account and all referenced audit segments backup and restore as one verified snapshot` | 已有日归档和账本分段备份；数据库规模/分区基准待 |
| H08.4 | 6984 `CSV import deduplicates identical records and rejects a conflicting batch atomically`；2667 `native archive survives process restart and exact retry keeps one original receipt and blob` | 原内容去重与冲突拒绝 |
| H08.5 | 103 `full history archive preserves exact source/index/report bytes and optional matching input`；124 `1000-entry snapshot archives/restores all versions and does not reset the append boundary` | 完整原档案及版本历史恢复 |
| H08.6 | 1406 `capacity pins pending work, limits input and allows later cache eviction without expanding workers`；8026 `artifact cache is bounded and never caches branch or deployed target evidence` | 现有缓存容量上限；实际存储预算和生命周期覆盖待 |
| H08.7 | 2930 `H01 ring eviction never turns absent issue evidence into a healthy runtime certificate`；5966 `automatic threshold rotation retains all records and immutable archive contents` | 原诊断内存环及审计轮转；普通磁盘运行日志限额待 |
| H08.8 | 229 `insufficient or unknown disk capacity rejects before creating plaintext or changing original inputs`；230 `source growth after the disk preflight stops capture before encryption exceeds the original budget` | 磁盘容量及采集时增长前置保护；长期预警待 |
| H08.9 | 948 `hash corruption and symlink archives fail closed instead of silently returning empty research`；5971 `missing index, changed or missing archives refuse financial mutation instead of resetting history` | 原档案与账本完整性、损坏拒绝 |
| H08.10 | 3845 `encrypted backup restores verified data; wrong key and corruption never publish destination`；1552 `backup verifies hashes and restores identical state only after explicit apply` | 加密备份和哈希核验 |
| H08.11 | 103 `full history archive preserves exact source/index/report bytes and optional matching input`；3054 `bounded original report snapshots retain every version and never modify or recreate the archive` | 原始历史与报告版本保留；全数据保留政策待 |
| H08.12 | 224 `isolated drill consumes the real encrypted backup and original restore tools with measured local RPO/RTO`；128 `real CLI archive/verify/restore and JSON results use the same complete history` | 隔离环境真实加密备份、恢复CLI；用户主机演练待 |
| H08.13 | 5972 `account and all referenced audit segments backup and restore as one verified snapshot`；1552 `backup verifies hashes and restores identical state only after explicit apply` | 账户、审计段及状态恢复一致；真实用户账本待 |
| H08.15 | 5966 `automatic threshold rotation retains all records and immutable archive contents`；5299 `an unreadable current snapshot is an I/O failure, not permission to restore an older account` | 保留审计档案，不以旧档案覆盖异常当前账户 |
| H08.16 | 1558 `backup rejects symlink parent and restore rejects backup overlap`；5299 `an unreadable current snapshot is an I/O failure, not permission to restore an older account` | 原恢复目标隔离、当前账本损坏拒绝旧回退 |

### H05.9 实际代码补强（另1项）
复用原 runtime-trace：修复工作线程回执丢失 `calls/timing` 导致批量总耗时与单次跨度混淆，校验完整批量标识及正整数次数，非法回执不污染原dispatch；旧回执兼容。保留原汇总统计、环及权限不变，新增内部 `timingBreakdown` 分别记录单次跨度和同步调用总量的样本、有效时长、P50/P95，未知仍null；不将批量总耗时当单次响应，旧汇总兼容值仍混合，不改UI/现有诊断接口。实际抽取原完整模块隔离V8同步用例（模拟ALS、随机标识、时钟）：修前1/5、修后5/5。新增5项原生回归已语法检查，须新提交正式CI。不宣称生产延迟降低，无实际设备对比。

### 第一批尚缺同等局部证据（13项）
- H04.2 真实重大政策发布与实施变化重演
- H04.4 ETF同窗盘中实际异动
- H05.1 政策发现延迟
- H05.2 行情异动检测延迟
- H05.4 市场变化到候选重排延迟
- H05.15 实际用户硬件目标
- H05.16 同条件优化前后测量
- H06.12 模型压缩量化效果验证
- H06.13 基于真实测量的模式调整
- H06.14 模式切换间隔
- H08.1 真实长期增长
- H08.2 实际高频查询数据库索引
- H08.14 盘中维护负载不阻塞证据

真实行情、授权数据、实机、36联合场景、5/20/60交易日及未建立的动态模式、数据库索引/性能能力仍须专项后续，不能用原测试名称替代实现。没有新增API、运行服务、UI、采集或生产权限；不合并、不部署、不删除旧资料。
