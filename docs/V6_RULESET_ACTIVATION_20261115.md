# V6 开启真正的 dev 合并保护（仅准备，不宣称已启用）

本任务目标：所有 PR 的每一个新增提交都有真实、可追踪的 `v6/per-commit-smoke`，而整个 PR 必须通过完整 V6 CI、受影响 UI 检查及云账本/数据质量独立门禁，才能进 `dev`。

## 现场核验

- 唯一工程：`solviq87-cpu/v6-stock-system`，默认分支 `dev`。
- GitHub API `GET /repos/solviq87-cpu/v6-stock-system/rulesets` 返回空数组。传统 protection 端点在当前 GitHub App 上返回 403（读取被限制）；因此未取得真正已生效的保护回执。
- `.github/rulesets/v6-dev-required-checks.json` 是**禁用状态**的人工审核/导入候选，不是现行规则。不得把提交 JSON、绿勾或本次 CI 当作已开启防绕过保护。

## 推荐由有 GitHub Rules 管理权限的维护者操作

1. 打开 https://github.com/solviq87-cpu/v6-stock-system/settings/rules ，进入 Rulesets → New ruleset → Import a ruleset。选择上述 JSON，检查作用目标**仅**为 `refs/heads/dev`。
2. 确认启用 PR 要求、拒绝删除和强制推送，设置必需状态检查。候选列出了本次实际运行的 `verify`、`verify-web`、`multi-source-data-lineage`、云记录及账本门禁和新增 `commit-status-coverage`，共 11 项。检查来源建议绑定 GitHub Actions App ID 15368（当前实际 GitHub check-run 的 app.id，需在 UI 再核对）。
3. **先观察新 PR 是否能全部产生这 11 个检查结果**，尤其 `commit-status-coverage`；该检查只对 PR 触发，且会只读核对每一个 PR commit 的**最近一次** `v6/per-commit-smoke` 状态、GitHub Actions 原始运行和精确 SHA 对应的独立测试作业，失败不放行。
4. 检查严格更新选项：候选启用 `strict_required_status_checks_policy=true`，并行开发的 PR 需要先同步最新 `dev` 并重新测试；GitHub 当前仓库使用 merge commit，不要启用“Require linear history”。当前是单人可合并流程，审批数预置为 0，若改多人维护再要求独立审批。
5. 实际确认所选检查的来源、PR 页面对“未通过/未运行”的拦截效果、不能直接写入 `dev` 后，才能把 Ruleset enforcement 从 `disabled` 切成 `active`。如有历史 PR 缺状态，需要在安全分支按原 SHA 重跑，不能造绿。保留管理员审核恢复路径并核实配置变更的审计记录。

## 设计限制与风险

- Rulesets 与旧分支保护叠加，最终要查**实际生效**的规则；当前工具只有 GitHub 代码写权限，没有 Rules Administration 权限，不能代为激活。
- 新 `commit-status-coverage` 工作流在 `pull_request` 上执行，独立于快速状态写入流程；GitHub 因测试合并提交和 PR 头 SHA 取不同检查时可能要求重新同步。不要把单独的 `v6/per-commit-smoke` 直接设成必需检查，否则测试合并 SHA 可能没有同名状态而永久 pending。
- PR 最多允许 32 个提交接受此次 PR 覆盖测试；较大 PR 应拆分。外部 fork 无法在当前同仓 push 任务中获得状态，需要另行安全接入，不得绕过证明。
- 该规则只保护 `dev`。归档 ZIP 有独立校验，静态网站仍由单一 `managed-task` 发布者负责，不把 Actions 的绿色误当生产上线。

查询文档：GitHub 官方 Rulesets 规则与导入说明、required status checks troubleshooting。

## 2026-11-26 独立集成复核补充

上文“disabled / 11项”是历史检查点，不能当作当前配置状态。本轮以 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9` 和活动 PR 的精确 head 重新核对：候选 JSON 已是 `active`、原有13项检查；本补丁加入真实浏览器 job `visual-geometry`，成为14项。JSON 的期望配置不代表已经在 GitHub 上启用。

本轮读取 `GET /repos/solviq87-cpu/v6-stock-system/rulesets?includes_parents=true&per_page=100` 成功返回空数组；传统分支保护端点返回403读取权限限制。有效分支规则汇总端点被当前连接器拒绝，未取得该入口回执。没有取得强制门禁生效证据；不因本地文件写了 `active` 就宣称已生效。远端启用和最终合并仍由原第一组通过具备管理权限的入口统一执行。

必需浏览器检查不能保留 workflow 的文件路径过滤，否则仅后端或文档 PR 可能从不产生该检查而一直等待。本补丁移除浏览器 workflow 的 push/PR 路径过滤，保留非归档开发分支及原 PR 目标范围，运行真实浏览器套件；后端合同修改同样需要双端验证。代价是后端和文档提交也运行完整浏览器检查，增加 CI 时间，不用空的成功状态代替验证。

`npm run check` 已接入 `V6_BO/scripts/audit-fayo-integration-gates.js`：检查候选必需状态是否对应现存 job、dev 触发范围是否可能被过滤、真实 FAYO 浏览器脚本是否接入，以及失败是否会被忽略。新风险浏览器脚本随其他组整合后自动纳入此静态清单。该审计只检查仓库配置，完整 YAML/表达式语法仍由原 actionlint 检查，真实测试结果及远端 enforcement 分别核验。

激活前必须用包含本补丁的最终提交重新运行完整 CI 和双端浏览器，并验证普通后端、文档及 UI PR 都能产生14项必需结果。保存远端规则、目标分支、检查来源、禁止直接推送和失败拦截的真实回执，再更新现场状态。生产部署、设备真实送达和长期观察仍不在此静态审计证明范围内。
