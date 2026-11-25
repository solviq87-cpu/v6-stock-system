# 绯曜 FAYO 研究进化（二）验收记录

验收日期：2026-11-26（北京时间）。范围为任务 31–36、43–47、59–66，共 19 项；逐项合同、原生入口、数据边界和回滚见 [实现说明](../../FAYO_INTELLIGENCE_EVOLUTION_20261126.md)。

仓库基线为 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；在原分组提交 `9a1132264a191091ea526cba698177f2b5d0c703` 上完成增量。交付分支 `feat/fayo-intelligence-evolution-20261126`，沿用 [PR #357](https://github.com/solviq87-cpu/v6-stock-system/pull/357)。本提交的精确 SHA、后续 CI 结论和运行链接以该 PR 最终说明及 Checks 为准，避免在提交自身写入自引用 SHA。

## 已实际完成的验证

|验证|实际结果|验证范围|
|---|---|---|
|完整 `npm test`|**5099 项：5095 通过，0 失败，4 跳过**；退出 0，106.591 秒|全部 `tests/*.test.js` / `*.test.mjs`；原 TAP 完整性检查通过，无强制退出截断|
|进化专项及原专项|**103/103 通过，0 跳过**|市场证据、相似样本、统计、工作流、版本绑定、HTTP、worker、真实服务器与原增量|
|原托管发布器环境复核|**13/13 通过**|保留原防符号链接、锁、发布约束，使用真实临时目录|
|静态检查|**通过**|`npm run check`，包含 69 个原生前端模块；`git diff --check` 无错误|
|真实 HTTP 与撤权集成|**9/9 通过**；最终版本与 HTTP 合同另验 **5/5 通过**|原角色/同源、CAS、幂等、诊断重试、历史回放、双入口、实现变更使旧诊断失效、排队及锁内撤权|
|新工作台实际 Chromium|**桌面 1440×1000、移动 390×844 均通过**|6 个区块，逐字符筛选焦点、XSS 文本、分组/模板/密度、服务端双端恢复、冲突保留草稿、路由返回、真实诊断保存及私有导出、观看者拒绝；无 JS 错误或横向溢出|
|原 FAYO 浏览器回归|**8 个场景通过，6 种宽度**|320 / 390 / 402 / 768 / 1366 / 1920；原工作区、证据日期、图表、筛选、返回与权限|
|原决策及条件单浏览器|**桌面 1366×900、移动 390×844 均通过**|4 个篡改/过期拒绝、2 个陈旧响应竞争、原条件单创建/取消、隐私角色；原账户账本字节不变|

上表计数是各命令自己的结果，存在覆盖交集，不能相加充当独立测试数量。浏览器均使用实际原生页面与隔离夹具；新工作台使用真实临时服务器、私有存储和 worker。移动视口不是物理手机或生产认证。收益与研究增益的真实数据不足时继续显示 `unknown` / `not-evaluated`。

全量的四项既有条件跳过为：实际 PowerShell 包装器、一项五模型比较、可选 LightGBM、可选 XGBoost；环境缺 PowerShell 及对应可选模型依赖。它们未被改为无条件跳过。新进化专项无跳过。

首次完整运行中的四个失败均属于未改动的 `managed-publisher-runtime.test.js`：当前宿主 `/var/tmp` 是符号链接，原路径保护正确拒绝。改用权限 0700 的真实 `RUNNER_TEMP` 后，该文件 13/13 通过，随后重新完成上述全量回归。没有放宽生产路径保护或测试断言。

原预热专项的旧夹具在第 125 根才切换价格，恰与末 26 根的初值相同，无法制造预期的 EMA 历史差异；本次改为第 120 根切换，保留原严格误差门限和失败断言。真实服务器夹具增加原脚本、依赖锁和公开模型配置复制，使实现指纹在隔离副本中也可核验，不复制私人配置。

最终交叉复审补齐统计入口的测试/演示样本隔离：祖先与子证据分别过滤并披露排除计数；原生诊断不被测试首收占位；全局预算仅使用有同日真实收盘回执的原交易日期。新增两项回归，原生产模拟结算与人工对账导入仍按原合同通过。

## 复现入口与产物

运行环境：Node `v24.22.3`、Chromium 158；原生 Python `/usr/bin/python3`，模型 Python 使用环境提供的主运行时（scikit-learn 1.8、NumPy 2.3.5、pandas 2.2.3）。以下命令从 `V6_BO/` 执行，运行时位置按目标环境设置。

```sh
node --test tests/evolution-*.test.js tests/fayo-intelligence-evolution.test.js
npm run check
RUNNER_TEMP=/tmp/fayo-evolution-runner \
  V6_MODEL_PYTHON="$CODEX_PRIMARY_RUNTIME_PYTHON" \
  V6_TEST_CONCURRENCY=6 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
  npm test
NODE_PATH="$CODEX_PRIMARY_RUNTIME_NODE_MODULES" V6_UI_BROWSER=/tmp/chromium \
  FAYO_EVOLUTION_QA_DIR=/tmp/fayo-evolution-final-ui \
  node scripts/fayo-evolution-browser-check.js
```

复现全量前先创建无符号链接祖先的 `RUNNER_TEMP` 并设为 0700。本轮临时结果为 `fayo-evolution-complete.tap`、`fayo-evolution-complete-targeted.tap`、`fayo-evolution-complete-static.log`，浏览器目录 `fayo-evolution-final-ui` 包含 `summary.json`、双端 PNG 及测试夹具导出；原浏览器结果位于 `fayo-evolution-existing-ui`。这些均在隔离临时目录中，未将截图、原始日志或测试导出加入仓库。

本地单独静态产物测试曾因未安装锁定的 esbuild 0.25.12 / jsdom 27.0.0 而在依赖加载阶段停止（9 项）；actionlint 也未在本地安装。它们不计入上述通过项，最终由安装锁定依赖的 CI `verify-web` 与 `verify` 复核，包括 2 MiB 静态产物门槛和 Actions 语法。

既有 `.github/workflows/v6-ui-browser.yml` 已接入新浏览器脚本；CI 成功运行时，原 `v6-ui-report` 产物包含 `evolution/` 子目录。最终必须在 PR Checks 核对交付的精确头 SHA，不能将旧头或另一 PR 的绿色检查代作本提交结果。

## 集成与发布边界

原应用主版本保留 `20261125ad`，本组资源修订 `20261125ad-evolution1`、SW 后缀 `evolution-1`。第一组负责全部 66 项最终集成、冲突解决、统一版本、全量及发布门禁。本轮未合并其他组 PR，未合并到 `dev` 或发布生产，也未创建真实交易、通知、外部模型调用或第二套私有账本。

新研究事件继续使用原私有追加链；旧 reader 不认识新增类型，不能直接覆盖上线回退。回滚须保全完整新链与账户，验证兼容 reader 或隔离旧程序；不得删事件、重写 hash 或以旧账本覆盖新流水。
