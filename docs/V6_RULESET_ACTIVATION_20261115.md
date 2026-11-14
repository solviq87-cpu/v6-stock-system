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
