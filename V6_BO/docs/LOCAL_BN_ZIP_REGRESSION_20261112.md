> 历史审计记录：以下结果仅属于文中日期、输入包和提交；不代表当前 dev、仓库权限或部署状态。本次整合验收见 PENDING_RELEASE_CONSOLIDATION_20261113.md。

# V6 BN ZIP 本地回归验证（2026-11-12）

## 输入与环境

- 输入：`V6_1083_full_20261106bn(3).zip`（解压目录 `v6/`）
- Node.js：`v22.16.0`；Python：`3.13.5`
- 运行：`npm run check` → 成功
- 运行：`node --test tests/paper-durable-order-service.test.js tests/paper-order-lifecycle.test.js tests/paper-transaction-coordinator.test.js` → 27/27 通过
- 运行：`V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 bash scripts/run-full-regression.sh`（外部超时包装）

## 实际输出

- Node TAP 报告：`1..1083`、`# tests 1083`、`# pass 1083`、`# fail 0`、`# skipped 0`、`# cancelled 0`。
- TAP 报告测试阶段耗时：`38875.077615ms`。
- **限制：** 外层执行调用达到超时，未拿到 `scripts/verify-tap-completeness.js` 完成的明确退出码；因此只能确认 TAP 测试阶段 1083 项通过，不能宣称整条回归脚本完整成功退出。
- 本轮是在上传 ZIP 的本地副本执行，**不是** GitHub `dev` 的最新源码，也不是 GitHub Actions 的 CI 结果。

## 合并要求

1. 不得用 ZIP 旧文件覆盖 GitHub 较新的研究模型、CI、部署或协作规则。
2. 只合并已确认需要的差异；敏感配置、运行态账户与凭据不得提交。
3. 在 GitHub 合并分支实际执行完整测试并取得成功退出码后，才申请合并 `dev`。
