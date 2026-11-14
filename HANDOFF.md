# 天枢智策 V6｜多智能体交接入口

<!-- CURRENT_CHECKPOINT_START -->
## 当前断点 · 2026-11-14（冻结模型预测与前向评测交付）

- #224已合入`dev@aca2657fe713b7996f14e18f00545e3ecb242a7a`，精确head双CI及合并后CI43582404384均成功；八类研究闭环与24公开来源对照不重复开发。
- 交付[PR#225](https://github.com/solviq87-cpu/v6-stock-system/pull/225)，分支`feat/frozen-model-evaluation-20261114`，工作树`/workspace/v6-model-evaluation`。已接通研究页“固定输入→明确导入预测→下一开盘前封存→后续原行情评价”，含前值/趋势基线、分位数损失/区间宽度、同输入配对及待成熟/缺数/修订；不执行模型/交易/通知或新增付费API。不要重复领取已实现部分。
- 代码`b7e0814582052b0f0d80bcc606c1a1114bedec0e`最终全量3524项：3521通过/0失败/3可选ML跳过，关联74项、真实HTTP、三组各四视口浏览器、网页40项/构建/dist、12项Windows打包、依赖审计及完整服务隔离启动均通过。精确代码head CI43586673971及浏览器43586673991成功；最终文档head/合并与合并后CI以PR机器回执为准。
- [实现合同、验证命令与限制](V6_BO/docs/FROZEN_MODEL_FORECAST_20261114.md)。基线完整归档`/workspace/artifacts/v6-model-evaluation-20261114/base-aca2657.tar` SHA256 `0c6e4fb1ecec2763cebb0c9d646e8e8f9725e219fa65142874fcc5f4e413e748`；回退revert本批提交且保留原研究、预测同级档案与账户。两张锁定主页SHA未变。
- 自动发布任务只读核实仍启用；本环境缺任务指定的固定Node和受信launcher文件，按既有规则不重装/替换/新建发布者。没有新发布回执；只托管单HTML的目标不能运行完整后台。
<!-- CURRENT_CHECKPOINT_END -->

## #224交付历史（下列为上一批证据）

- 用户明确要求“做完不要让我重复提交”；继续实现、验证并合并，不停在核验文档或待办。
- 基线：已合并#223的 `dev@a3071443f277ed8118419b17892125ef54b6b8c1`；实现分支 `feat/research-closure-20261114`，工作树 `/workspace/v6-research-complete`。
- 基线独立备份 `/workspace/artifacts/v6-research-complete-20261114/base-a307144.tar`，SHA256 `184f336ea77ac8b1b460bc8a9429a496dec5a61ef62b27aaabfd81efc0501724`；回退使用最终功能提交的git revert，不覆盖研究/账户档案。
- 正在补 `research-workspace-{store,decision,analytics}.js` 与 `research-workspace.js`，增量接 `/research.html` 和编辑权限API；逐条件证据、不可变run/数值差异、四体系、完整筛选、题材相对位置、1/5/20/60日成绩、原账本持仓、约束版本/诊断/回放导出。
- 本地最终定向44通过；真实HTTP覆盖权限、CAS/幂等、重启、扫描封存、GET/export无写/外联及计算暂停时健康响应；新页四视口与原研究/清单浏览器均成功。最终完整3498项：3495通过/0失败/3可选ML跳过，TAP完整性通过；网页40与构建/dist、12项Windows打包、运行依赖审计与完整服务隔离启动通过。
- 研究缺数据保留未知；不生成Python原生策略或收益样本。保存/回放隔离于原账户与正式权重；两张主页字节、原策略、15秒门禁、唯一发布者保持约束。
- 上游整合：#222经精确head CI43578342431成功合入`f742809`；#221经精确head CI43578794549及浏览器43578794647成功合入`8fe273a`。本分支已整合这两项与原审查记录；原16来源/24项REF和三仓库报告保留。
- 用户追加模型对照：新增Chronos/TimesFM/Moirai/Kronos/RD-Agent/TradingAgents/FinGPT/Qwen，固定源码/许可与未测范围写入文档、配置目录和研究页，共24个独立来源；模型/权重/API未接入，TimesFM3权重非生产限制单列。
- 交付入口PR#224，功能首提交`1d89356`，已整合dev@8fe273a；代码head `8d630c82841e765f5453b1edc25c6f27ce5ced89`的V6 CI43580991708及浏览器43580991700已成功，最终记录提交再核验双CI后合并。代码实施与公开模型对照无需重新领取；最后合并/生产状态以GitHub与可信运行时回执为准。静态单HTML不作为完整后台上线证明。

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
