# BO 全量包路径级精确核对（2026-11-07）

对照：`V6_BO/integration/PACKAGE_SHA256_20261107bo.json`（4,354 条文件 SHA-256 索引）与 GitHub `dev` 递归 Git tree 文件路径（去掉仓库前缀 `V6_BO/`）。

**结果：索引中有 2,652 个路径在 dev 不存在。** 分类：
- `history/`：2,349（旧版对象、索引和任务包；隔离审核分支已恢复 `history/README.md`）
- `integration/`：292（123 个 .tap、94 个 .exit、75 个 .log）
- `docs/`：10（全为 .tap 或 .log）
- `scripts/`：1（`__pycache__/six-photo-sources.cpython-312.pyc`，Python生成缓存）

缺失 docs 精确列表：
1. `docs/V6_UI权限与键盘导航_436项全量回归_20261105.tap`
2. `docs/V6_本轮完整回归_20261105.log`
3. `docs/V6_本轮并发故障恢复多日对账全量回归.tap`
4. `docs/V6_本轮账户专项回归.tap`
5. `docs/V6_第61批_全量测试原始输出.log`
6. `docs/V6_第68批_完整回归原始日志.log`
7. `docs/V6_集中全量回归_419项_20261105.tap`
8. `docs/merge-full-regression.tap`
9. `docs/merge-source-reports/p2/unified_tests.log`
10. `docs/merge-source-reports/p3/authority_test.log`

**重要限制：** 此次是文件路径集合核对；尚未逐文件验证 SHA-256 内容是否与 BO 相同。文件在仓库存在不等于内容完全一致，仓库中也可能有 BO 之后的新改动。不能据此宣布全量恢复或测试全部通过。

**处理原则：** 保留 dev 现行源码，缺失的 .pyc 不需要恢复；测试日志保留在原始 BO ZIP，避免把大批生成文件纳入源码仓库；history/objects 及任务归档先进行密钥/账户数据筛查后再考虑独立备份存储。缺失文件不涉及 src/、public/、strategies/、config/ 等路径，故目前没有证据表明这些目录缺少 BO 文件，但内容仍待核验。

下一步：逐文件内容比对；对安全且必要的差异建立补丁 PR，不自动覆盖 dev。
