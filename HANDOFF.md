# 天枢智策 V6｜多智能体交接入口

<!-- CURRENT_CHECKPOINT_START -->
## 当前断点 · 2026-11-14（先核对实际Git与远端CI）

- 本轮基线：`dev@5b4360ac3f29a8128a14101b59c54956d39f0480`，#213/#214/#215/#216已合并；原本机健康检查/重启修复保留。分支 `feat/research-decision-workbench-20261114`。
- 已整合后续主线 `416b124`（#218单调时钟/进程退出竞态修复），原改动全部保留；具体停止/重启历史证据见 `V6_BO/docs/LOCAL_HOST_HEALTH_RESTART_20261114.md`。
- 当前任务：用户要求把daily_stock_analysis中适合的能力写入V6。已接研究详情：证据、冻结判断变化、条件分歧、筛选淘汰过程、板块背景、复访/成绩单、诊断及续接摘要；复用已有档案，未改排名/权重。完整边界见 `V6_BO/docs/RESEARCH_DECISION_REVIEW_20261114.md`。
- 补查：V6已有成长财务、36规则、持仓风险/新闻与回执；不重复实现。自动调权/额外模型未启用，题材阶段/龙头证据不足保留未知，跨市场与OCR未做；飞书和网页登录现场检查继续暂缓。
- 已建PR #219，首个远端head `26b895e` 的全量3415通过/0失败/0跳过、网页40和浏览器全部成功；真实CI截图已查看320与1536。后续补齐中文字段/诊断标签，最终合并仍须核对PR最新精确head。整合主线后本地专项51通过；首轮本地4项发布器错误与基线复现保留在报告。
- 快速入口：`npm run context:resume`；origin/dev为本地缓存，需查询GitHub最新分支/PR。只读取对应模块和失败日志，不重复打印历史。
- 固定约束：完整工程增量、不采购、不把凭据写Git；两张主页、原四体系和账户历史保留；原报价时点15秒门禁不变。新功能为研究展示，不授予交易或通知权限。
- 发布：本轮未部署；唯一owner/私有事务见 `V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md`。静态页面不等于完整后端已上线。
- 剩余现场：Windows开关机/WSL重启、双端HTTPS/真机、盘中连续行情、长期真实样本和跨机灾备；24项现场台账保持。旧UI草稿#4/#166/#169不直接回灌。
- 下一步：核对本分支精确CI和代码/文档PR，绿色后合并，再继续有证据支持的增量；读报告中的功能边界，避免把16项候选都说成已上线。
<!-- CURRENT_CHECKPOINT_END -->

> **先读此文件，但原仓库更高优先级规则仍在根 `AGENTS.md` 与 `V6_BO/AGENTS.md`。** 本文是协作索引，不能替代技术规范、现场验收或用户权限。

## 30 秒接手流程

1. 执行 `npm run context:resume`，阅读 `AGENTS.md`、`V6_BO/AGENTS.md`；稳定要求保存在仓库，不重复粘贴整个聊天历史。
2. 按任务编号查询 `TASK_MASTER.md`、`RELEASE_QUEUE.md`；仅在需要历史证据时检索 `WORK_LOG.md`、`V6_BO/integration/CHAT_HANDOFF.md` 的相关段落。现场总验收查 `V6_BO/integration/TASK_STATUS.md`，不要重复整份读取所有归档。
3. 从 GitHub 实际查询 `dev` 最新 SHA、开放/草稿 PR、Issue、工作流 CI、各任务已有实现；**不要只信本地快照表**。
4. 领取任务前寻找重复 Issue/PR/分支，核实负责人和影响文件，冲突则暂停并协商。不能把 Markdown 当互斥锁。
5. 只补已核实的缺口，小步提交，记录实际运行过的专项和全量测试；测试失败不可掩盖。
6. 更新 `WORK_LOG.md`、任务表与发布队列，并交代精确 commit/PR、验收证据、回滚和剩余事项。

## 用户确认的协作与成本要求

- **小任务当前助手直接做**，例如文档、任务表、代码小补丁；避免不必要地把任务转给 Codex 或要求用户中转，节约额度。
- **不增加费用**：未经用户明确决定，不购买云服务器、iFinD/其他专业实时行情接口、第三方服务或付费模型接口。
- **完整工程优先**：保留四体系、历史记录、已建 UI、数据源、测试和恢复路径。先验收已有成果，UI 不整体重构。
- **Windows 本地部署**：家用电脑每天关机；本地后台开机才运行，手机浏览器即使关闭，后台仍可分析；开机后两端显示同一份数据并刷新。电脑关机期间不能保证新的本地行情、推送或远程访问。
- **行情安全**：逐票供应商原报价时点、15 秒规则、未知/未来/过期数据拒绝作为实时可交易报价；不以 receivedAt 冒充 quoteAt。
- **价值先验证**：先看成本后模拟收益、最大回撤、基准对照、样本外前向表现、全量推荐记录，再决定是否值得买高价接口；不保证盈利。
- **严禁凭据泄露**：密码、机器人 Webhook、sharecode、访问 token 不进 Git/PR/Issue/日志。

## 当前实查事实（2026-11-14 快照）

- 目标仓库：`solviq87-cpu/v6-stock-system`，默认 `dev`；核查时 SHA `13b03fe57c247000429394ffed0fca71d9a4cceb`。
- 已有协作/验收资料：`V6_BO/integration/TASK_STATUS.md`（固定 24 项，均未最终关闭）、`CHAT_HANDOFF.md`、`TEST_REPORT.md` 等。**不要用本文件覆盖它们**。
- UI 相关开放草稿 PR：[#4](https://github.com/solviq87-cpu/v6-stock-system/pull/4)、[#166](https://github.com/solviq87-cpu/v6-stock-system/pull/166)、[#169](https://github.com/solviq87-cpu/v6-stock-system/pull/169)。后两者重叠明显，应先审核再合并。
- 用户锁定的 `V6_BO/public/index.html` 与 `V6_BO/public/mobile.html` 禁止未经授权修改；新 UI 增量应遵守 `AGENTS.md` 的现行入口规范。
- 唯一静态发布目标及门禁见 `V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md`、`AUTO_UPDATE_WORKBUDDY_20261113.md`。静态站不等于量化后台已上线。
- 本次工作只补管理文档，**未在当前会话运行 Node/Python 全量测试，也没有部署站点或修改业务代码**。

## 接手/交付的最小格式

本轮继续入口（2026-11-14）：`integration/runtime-quote-recovery-20261114`，从 #209 合并提交 `e986fcc` 增量修复后台互斥、报价消费和断线恢复。开始后续工作前先核对其 PR/最新 dev，避免重复修补；实际验证、首轮失败与剩余事项见 [本批记录](V6_BO/docs/RUNTIME_QUOTE_RECOVERY_20261114.md)。

续接为 [PR #210](https://github.com/solviq87-cpu/v6-stock-system/pull/210)。`9e3e4c1` 完整CI成功但浏览器再次失败，已阻止合并。随后确定性复现旧Playwright 1.56.1模拟时钟倒退，升级至修复版1.57.0并新增离线时钟门禁；保留原业务断言。本地全量3367通过/3可选依赖跳过。先读取PR最终head、合并状态和CI，再进入剩余快照恢复/现场验收，不重复修补本批三项。生产部署与长期验收尚未完成。

补充核对：#210 已合入 `dev@92db2d2f64d130c21007915568d7292b14d9a0c4`。下列前向观察修复已接到该基线，保留以上历史验收过程。

前向观察借鉴续接（V6-009）：分支 `fix/forward-horizon-sample-audit-20261114`，
起点 `e986fcc`。按周期实际观测股票数修复及 v1/v2 归档兼容见
`V6_BO/docs/FORWARD_HORIZON_SAMPLE_AUDIT_20261114.md`。当前周期结论必须使用 v2；
历史 v1 审核为原样保留的证据，不能当作新门槛已通过。本地 `45c3a3f` 在最新主线集成后
3374项通过、0失败、3可选ML缺失跳过。用户已明确同意上传，现已建立
[PR #211](https://github.com/solviq87-cpu/v6-stock-system/pull/211)，远端代码 tree 与本地逐字节一致。
PR head `1e52cb9` 的 [V6 CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43560732721) 已通过，并合入 `dev@4233950`。后续从该合并提交或更新的 dev 继续。

```text
任务编号及负责人：
起始 dev SHA、工作分支、PR：
已存在实现/尚缺功能（证据链接）：
改动文件与提交 SHA：
实际运行测试及结果 / 未测试范围：
发布状态及真实回读证据：
回滚路径 / 剩余风险 / 下一负责事项：
```

**默认行为**：先读、查重、增量开发、测试、登记、再审核。不要让用户重复为同一任务耗费额度。
