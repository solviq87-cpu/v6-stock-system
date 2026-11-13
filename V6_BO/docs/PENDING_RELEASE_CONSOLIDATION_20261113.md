# 待发布工作集中核对（2026-11-13）

基线 `dev = 004676cbef5be11763ffcbb7de8a4f6db0b24361`（#202 已修复静态选股数据时效）。本批以该版本增量整合；未使用旧ZIP覆盖源码，未修改任何主页/UI或通知凭据。

## 范围与判定

列取209个远端分支、196个PR（19未关闭、177已关闭）及6个未关闭Issue。逐项核对19个未关闭PR的实际差异，以及11个没有关联PR的分支；已关闭PR对应历史分支不自动重开。判定使用真实文件/逻辑差异，不能仅凭标题、merge-base或旧CI颜色。

16个PR的有效差异可由本集中提交补入或已在最新dev被后续实现吸收；3个草稿保留，未将有缺陷或与当前UI/发布协议冲突的旧实现强行合并。关闭旧PR时须记录“被集中整合/后续版本取代”，不能称为19个原PR逐一Git合并。

## 19个开放PR

| PR | 已核对head | 处置 | 依据 |
| --- | --- | --- | --- |
| [#191](https://github.com/solviq87-cpu/v6-stock-system/pull/191) | `affdddc8505b` | 整合/已吸收 | 补入只读策略输入溯源；修复数组/对象数值强转误判，保留派生字段待核验语义。 |
| [#171](https://github.com/solviq87-cpu/v6-stock-system/pull/171) | `18b405c954ba` | 整合/已吸收 | 补入3份历史ZIP/权限审计文档，并明确其日期、输入包和权限结论不代表当前状态。 |
| [#170](https://github.com/solviq87-cpu/v6-stock-system/pull/170) | `5fb8d061ee2b` | 整合/已吸收 | 补入归档字节核对工具及历史报告；加强歧义根/路径拒绝、私有报告不覆盖和仓库内零写入测试。 |
| [#169](https://github.com/solviq87-cpu/v6-stock-system/pull/169) | `b7ba8db45103` | 保留未合并 | 保留草稿：雷达页面已在dev，较旧JS会撤回报价/覆盖率修复；另附本地更新器不进入唯一managed发布链。 |
| [#166](https://github.com/solviq87-cpu/v6-stock-system/pull/166) | `23c59156ed79` | 保留未合并 | 保留草稿：工作室/分页功能已在dev；不恢复旧UI/AGENTS，不引入另一套未经现有发布协议验证的更新器。 |
| [#165](https://github.com/solviq87-cpu/v6-stock-system/pull/165) | `9463161b6ecd` | 整合/已吸收 | 运行健康检查已在dev；补入操作文档，保留后续种子注册/冷却修复。 |
| [#164](https://github.com/solviq87-cpu/v6-stock-system/pull/164) | `43b3a9f71052` | 整合/已吸收 | 核心登记器已在dev；补文档，保留现有O_NOFOLLOW与私有目录加强。 |
| [#163](https://github.com/solviq87-cpu/v6-stock-system/pull/163) | `8a50c901571c` | 整合/已吸收 | 收盘冻结器及测试已在dev（只差末尾换行）；补操作文档。 |
| [#162](https://github.com/solviq87-cpu/v6-stock-system/pull/162) | `73ea536478f7` | 整合/已吸收 | 候选日历门禁与测试字节一致；补文档。 |
| [#161](https://github.com/solviq87-cpu/v6-stock-system/pull/161) | `6e63eca33e0f` | 整合/已吸收 | 隔离/恢复逻辑和测试字节一致；补齐按不同观察日期统计的文档说明。 |
| [#160](https://github.com/solviq87-cpu/v6-stock-system/pull/160) | `e4e6058efd7c` | 整合/已吸收 | 归档审计已在dev；补文档并保留当前seed模式与更严格验证。 |
| [#159](https://github.com/solviq87-cpu/v6-stock-system/pull/159) | `eb0aa727f2a8` | 整合/已吸收 | 恢复后不重复冷却已在dev；补严格预注册与恢复等待说明。 |
| [#157](https://github.com/solviq87-cpu/v6-stock-system/pull/157) | `19aa00d68df3` | 整合/已吸收 | BaoStock消费接口已被后续整合吸收；保留新测试夹具和格式。 |
| [#126](https://github.com/solviq87-cpu/v6-stock-system/pull/126) | `0e269eb27b49` | 整合/已吸收 | 隐藏跳转处理已被共享redirect门禁和最终时钟核对覆盖；现有专项覆盖opaque/opaqueredirect。 |
| [#123](https://github.com/solviq87-cpu/v6-stock-system/pull/123) | `9399170a7551` | 整合/已吸收 | 候选预检/观察已被吸收；保留当前逐板块身份指纹加强。 |
| [#117](https://github.com/solviq87-cpu/v6-stock-system/pull/117) | `67ffadc8225c` | 整合/已吸收 | 早于#123的同链草稿，已被当前更完整的预检/观察实现取代。 |
| [#71](https://github.com/solviq87-cpu/v6-stock-system/pull/71) | `1818ca113e6c` | 整合/已吸收 | 补入时钟窗口提示；14:57起正确标记收盘集合竞价，时间窗永不作为法定日历或交易放行证明。 |
| [#70](https://github.com/solviq87-cpu/v6-stock-system/pull/70) | `4057e553b736` | 整合/已吸收 | 补齐候选报价/量/换手/资金原始观测字段与sourceCoverage；保持未知为null，保留dev新板块桥接。 |
| [#4](https://github.com/solviq87-cpu/v6-stock-system/pull/4) | `5dcbdb5966bf` | 保留未合并 | 保留草稿：旧UI会覆盖现有因子抽屉/空值保护；preview用snapshot.asOfMs自证新鲜且代理任意/api写请求，不作为可发布版本。 |

## 无关联PR的分支

| 分支 | 处置 |
| --- | --- |
| feat/quote-source-window-quality-20261110 | 补入离线多源窗口质量审计/CLI/测试；缺样本计入分母，不自动换源、交易或通知；修复CLI安全读取和50bps四舍五入边界。 |
| research/public-signal-confirmation | 以三方补丁补入两条显式opt-in历史研究规则（SMA+Aroon、MACD+SMA）；保留dev涨跌停成交价格夹紧。补独立入口OHLCV/日期验证，canTrade=false。 |
| feat/v6-quality-rules-forward-audit-20261109 | 规则和测试已在dev；保留新增时间重叠、权重复核、板块/公告归因，不回退旧分支。 |
| feat/visible-stock-picks-and-research-patterns-20261109 | 旧选股UI方案保留在原分支；其页面会覆盖现有日/月/年K布局和跟踪入口，旧K线研究未证明当日已收盘，不上线。 |
| feature/forward-daily-intake-20261110 | 保留未发布：新跨日写入器无相应专项；原输入允许quote时刻超过扫描60秒，汇总截断500条及并发/成熟记录不丢失边界尚未验收。不连接现有权威档案。 |
| feat/v6-reference-ui-20261108 | 旧设计计划保留历史分支，不覆盖用户当前UI要求。 |
| audit/bo-full-reconcile-20261107 | 历史ZIP清单/审计工具保留原分支；本批新增#170只读字节审计工具，不将旧history或离线归档倒灌。 |
| import/v6-1083-bn-review | 单份旧包导入审阅留在历史分支，不能作为当前dev验收。 |
| archive/v6-1090-bo-parts-20261112 | 二进制归档传输分支，不是运行时发布候选。 |
| archive/v6-1090-bo-small-parts-20261112 | 同上，不下载/执行/恢复私有历史。 |
| archive/v6-1090-encrypted-20261112 | 同上，不将加密备份发布为网页或源码。 |

## Issue核对

| Issue | 当前范围 |
| --- | --- |
| #98 | 成员集合指纹、同数量换股与历史缺证据拒绝已在dev；本次补跑sector-member-identity-proof和sector-shadow-forward-observer，待本批精确CI后可收口。 |
| #158 | 历史2026-11-10的0步骤故障不再代表当前CI；以本批合并后verify/verify-web实际运行确认当前阻断解除，不推断历史基础设施根因。 |
| #167 | 保留。分页和扫描覆盖披露已有，但跨所有四策略/所有战法、完整历史统一库还不能称全部验收。 |
| #168 | 保留。总任务包括持久化后端、长期采集、全部命中和完整归档；不因本次合并打勾。 |
| #23 | 保留。8条业务主线的真实生产验收仍缺独立来源/连续运行/OOS/真机等证据。 |
| #62 | 协作历史记录保留。本次不向其他助手发送任务或凭据；旧“私有”称谓不保证仓库当前可见性。 |

## 合并时补强

- 原始评分溯源只接受有限数值或非空数值字符串，数组、对象、布尔值、继承字段不算实际观测。
- 新增时段提示的收盘竞价边界依据[上交所交易时段](https://one.sse.com.cn/onething/gptz/)，节假日未认证仍明确标记；不修改原交易门禁。
- 新增确认规则只进入显式 `includeSignalConfirmation=true` 历史研究；原信号、成本、T+1、次日执行、公司行为和涨跌停价格边界保留。测试验证原规则事件完全相同、未来K线不改变早期信号。
- 归档审计不提取/执行ZIP；拒绝路径歧义、多个源码根、重复路径、错误清单；报告仅新建到仓库外，0600且不覆盖。

## 验证

本地完整回归 `npm test` 实际退出0：3153项，3150通过，0失败，3项可选Python ML测试因本地依赖跳过，耗时248657ms。命令设置 `RUNNER_TEMP=/tmp V6_MODEL_PYTHON=<现有Python3> V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1`；没有降低断言或删除测试。PR CI及合并后push CI必须再核对精确SHA和全部job，实际结果记录在集中PR。

已执行：语法检查、43项专项全部通过；隔离完整服务启动及页面/脚本/404/无凭证拒绝通过。成员身份专项20/20通过。两张锁定主页blob已核对为 `9e2fad468cb3e192df0ca2b9184babb2add8c4de` / `084e36d950f9bf4c3508aa1a5cb8986799b6079e`。静态源SHA-256仍为 `f1773bd287b7a3919417b96bce7315628cc4f9184e84c5ab6a4af1b30ee221b3`。没有页面改动，本批不声称新的手机真机或线上视觉验收。

## 发布边界

唯一目标 `https://af3c7822e6aafc135.app.workbuddy.host`，owner仍为 `managed-task`。静态发布源是 `V6_WEB/workbuddy/index.html`，包含先前#202时效修复，本次BO研究工具和后端功能不可能通过单HTML上传变成常驻后端。

当前会话只读预检：固定Node和受信publisher launcher均缺失；现有任务有配置不等于已执行或已发布。禁止用新工作树脚本、重新拼凭据或第二发布者绕过缺失私有journal/加密快照。合并和push CI后再调用既有任务一次，最终执行/读回结果记录在集中PR；没有完整线上源SHA/releaseId/artifactHash/HTML和健康回执，就保持“尚未发布”。

回滚仅对本集中合并提交做标准Git revert并重走CI；不回退旧包，不删除历史或私有研究档案。若本批没有线上写入，不需要线上回滚。
