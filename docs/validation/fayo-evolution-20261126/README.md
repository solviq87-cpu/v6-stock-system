# 绯曜 FAYO 研究进化（二）验收记录

## 本次续接验收 · 2026-11-26（北京时间）

本次继续原 **31–36、43–47、59–66，共 19 项**，独立分支 `feat/fayo-intelligence-evolution-20261126`，目标仍为 `dev`，沿用 [PR #357](https://github.com/solviq87-cpu/v6-stock-system/pull/357)。准确 `dev` 基线为 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；续接前远端恢复点为 `03d314dcec9c528d7fc46fe21c5a11939dc015d8`。本轮最终源码与文档提交的完整 SHA、推送状态及对应 CI 链接写在 PR 正文，避免将旧头检查当作新提交证据。

源码恢复 bundle 已通过 `git bundle verify`，SHA-256 为 `d73c836ecd8e115662158c826305049e556f77e212c567af612c0bd5e5225937`。它只用于源码恢复，不能代替生产私有卷冷备。

### 当前实际验证

|验证|本次结果|范围与限制|
|---|---|---|
|进化专项|**156/156 通过，0 失败/跳过，5.781 秒**|市场时点、相似检索、统计、数值模型/Python 子进程机制、缓存成熟边界、六阶段、反证与 AI 输出合同、真实 HTTP、worker、撤权及原账本不变|
|完整 `npm test`|**5153 项：5149 通过、0 失败、4 跳过；退出 0，153.306 秒**|原 TAP 完整性校验通过，无强制退出截断；下面历史 5099 项仅为前次证据|
|静态|`npm run check` **通过**；新增/改动 **26 个 JavaScript 文件逐个语法检查通过**；`git diff --check` 通过|原 69 个独立原生前端模块保留；不修改语法检查或完整性门槛|
|研究进化双端浏览器|桌面 **1440×1000**、手机视口 **390×844** 通过；最终缓存修复后已复跑通过|真实隔离服务器、原权限、私有 worker、六区块、实际诊断保存/报告下载、财务栏目、查询失效、CAS 冲突草稿及跨端恢复；无 JS 错误、横向溢出|
|原 FAYO 浏览器|**8 场景、6 种宽度通过**|320 / 390 / 402 / 768 / 1366 / 1920，原工作区与业务导航保留|
|原决策与条件单浏览器|桌面 **1366×900**、手机视口 **390×844** 通过|原篡改/过期拒绝、晚到响应竞争、创建/取消及隐私角色，`ledgerUnchanged:true`|

各命令覆盖有交集，不能相加充当独立用例总数。所有浏览器和子进程模型样本均来自隔离夹具，不能认定真实市场收益、原 Python 三轮规则、物理手机或生产部署已获验证。真实成熟样本不足保持 `unknown` / `not-evaluated`。

全量四项条件跳过分别为实际 PowerShell 包装器、依赖可选模型包的五类模型统一比较、LightGBM、XGBoost。本环境缺少这些可选依赖；原 ridge/extraTrees/histBoost 的实际 CLI 回归已在全量中执行。没有删除测试或将其改为无条件跳过。

### 本轮修复的已复现边界

- 当前报价不得污染过去查询，也不得遮蔽合法原计划观察；缺 tick 不借日 K 或接收时间伪装。冻结区间、原 15 秒时效、原观察门禁和 14:57 原计划政策独立检查。
- 财务子披露不能早于父包/父财报版本可知时点。审计、股权、减值及重大风险分别列证据与未知；未接通的结构化估值/审计来源不填示意值。
- 未来、教学及无效结算先隔离，再检查重复/冲突；拒绝信号保留同分母现金暴露。事件路径回撤不是权威账户净值；混合来源不虚构统一收益分母。
- AI 合同检查覆盖所有文本字段、任意私密字段和撤稿/冲突来源；只报告确定性合同检查，不冒充外部 LLM 效果验证。
- 原数值诊断与缓存共用实际 `readLearningRows` / `readNumericCheck` 的时间投影。严格成熟边界从 505 到 510 条样本时旧诊断失效，同一有效输入区间不因查询毫秒变化失效；未来嵌套因子值不能无故改变过去缓存身份。源对象和冻结校验和保持原样。
- Python 原脚本只能由操作者服务端配置，脚本/解释器指纹、总预算及完整预热前缀核验；任意脚本理由原文不透传。损坏 JSON、符号链接等实际 worker 错误不返回私有路径或内容，原记录不改写。
- 125/25 旧预热夹具保留为“相同递归初值可以一致”的正例；120/30 保留为实际预热不足反例，未放宽 EMA/MACD 误差门槛。

### 复现、证据与未验证事项

从 `V6_BO/` 执行；临时目录须为真实、无符号链接、权限 0700 的隔离目录：

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

本机运行环境为 Node `v24.22.3`；模型 Python 沿用环境提供的主运行时，原生桥另用轻量 Python。实际可用 Chromium 为 `/tmp/chromium`；首次 `/usr/bin/chromium` 包装器缺底层二进制，改为实际可执行文件后通过，没有放宽浏览器断言。以上路径是复现示例，不是新增生产发布入口。

隔离日志为 `evolution-targeted-final.log`、`evolution-full-final.tap`、`evolution-static-final.log`，双端 `qa-evolution-final/summary.json`、PNG 与下载 JSON、原浏览器 `qa-native-final/`、原决策 `qa-decision-final/`。按已有交付约束，不将原始日志、截图或工程包入库。既有 CI `V6 UI Browser Geometry` 运行时将双端证据保存在 `v6-ui-report/evolution/`；可由 PR 对应精确头运行下载。可复现研究报告由原授权用户调用同一 `GET /api/research/evolution?export=1` 生成，包含当时输入、来源指纹、成本/样本/状态和全部不足项。

尚需真实资料的项目包括：结构化审计及行业估值来源、历史行业/题材成员和完整多周期证据、各策略共同成熟样本、全部试验的净收益矩阵、操作者认可的原 Python 三轮源码。已有真实读取接口不等于这些资料已经齐备。Python 机制测试使用教学脚本；原 ridge/extraTrees/histBoost 的实际训练继续由既有独立回归覆盖。没有外部 LLM 质量或策略增益的生产认证。

### 总管交接与生产边界

“**绯曜 FAYO｜总管与最终交付**”负责统一任务表、共享文件冲突、最终集成、合并安排和最终验收。本组负责开发、修复、验证和交接。共享文件/依赖详见 [HANDOFF 当前交接](../../../HANDOFF.md#fayo-evolution-current-handoff)；不得整文件覆盖 #358 的历史权限门禁或以 #360 旧分支覆盖本组预热修复。最终组合仍须重新跑全量、接口、双端、安全及权威账户一致性检查。

本组主版本保持 `20261125ad`，资源为 `20261125ad-evolution2`，SW 后缀 `evolution-2`。未合并 `dev`、未生产部署、未采购服务、未开实盘、未外发消息，也没有创建第二账本或发布器。原生产发布机制保持。新增研究事件必须完整保留，回退前核验 reader 兼容；不得删事件重写 hash chain 或用旧账本覆盖新流水。

## 前次检查点（历史证据，不代表本轮）

<details><summary>远端 03d314dcec9c528d7fc46fe21c5a11939dc015d8 的历史验收原文</summary>

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

</details>
