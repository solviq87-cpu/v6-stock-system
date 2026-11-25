# FAYO `20261125ad` 验收摘要

基线：PR #350 合并提交 `d3585ff2e03300d303f502e3126d029650b0cdc6`。应用版本 `20261125ad`，双端前端修订 `center-20261125-3`，SW 后缀 `decision-center-3`。

按用户最新要求，本 PR 提交修改的源码、必要测试及精简交接说明。完整工程 ZIP、安装 ZIP、截图和原始日志附件不随 PR 入库；既有历史文件不改动。原始本地验收材料已经单独保留，远端结果查看 [PR #351 当前提交检查](https://github.com/solviq87-cpu/v6-stock-system/pull/351/checks)。

## 已执行的本地验证

| 检查 | 实际结果 |
| --- | --- |
| 完整 `npm test` | 4,995 项：4,991 通过、0 失败、0 取消、4 项原可选环境测试跳过；227.920 秒；退出 0，TAP 完整性通过 |
| 语法检查 | 服务及 68 个独立原生前端模块通过；新增数值与计划引用模块另行检查通过 |
| 最终真实隔离 HTTP | 13/13 通过，包含原计划准备、交易路径、报价/权限拒绝和观察接线 |
| 冻结引用与数值证据专项 | 41/41 通过，并全部纳入上述全量；覆盖跨股票/合成来源拒绝、事前截止、固定检查身份、同 ID 改写拒训及真实 worker 提交点撤权 |
| 原函数 | 19 个完整 AST 函数文本与基线逐字节一致，包括原 `paperBuy`、账本保存、角色/权限门禁、原交叉校验/Q 权重与 PR #347 日期兜底 |
| 完整服务启动 | 原生双端、版本、路由、恢复资产和真实鉴权通过；隔离进程已清理，源码私有数据读取/变化及出站均为 0 |
| 双端作战台 | 本地隔离首个完整计划：电脑 458 ms、手机 344 ms；联动、完整板块选择、返回状态、过期/篡改拒绝与旧请求竞态通过，原账本不变 |
| 执行日报 | 双端七态、未知保留、迟到证据追加 v2、来源/哈希/历史、错日拒绝和查看身份隔离通过 |
| 原业务与研究视图 | 原 19 视图/38 窄屏路由布局、四类冻结确认、研究图谱和反馈引用通过；只读身份私密读取及意外写入为 0 |
| 通用原生浏览器最终复测 | 修正测试版本期望及旧板块样例后，8 场景 × 6 宽度（320/390/402/768/1366/1920）通过，另含只读账号和首次登录；保留原几何与权限断言 |

这些结果来自隔离源码与测试材料，不代表生产数据或真机时延。数字、环境、跳过项及完整 TAP 的校验值见 [results.json](results.json)；保护函数指纹见 [protected-functions.json](protected-functions.json)。本地全量对应最初验收提交 `be738c221f0220ffb31626a3f47415e2b4344c71`，后续浏览器测试修正另行验收，最终远端必须核对当前 PR head。

## 复现与环境

在 `V6_BO` 下执行；私有临时目录应满足原非软链安全规则，模型解释器需具备原研究依赖。

```sh
RUNNER_TEMP=/tmp/fayo-private-regression-6b9ec285f52b \
V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
npm run check
node tests/full-server-isolated-smoke.js
V6_UI_BROWSER=/tmp/chromium node scripts/fayo-browser-check.js
V6_UI_BROWSER=/tmp/chromium node scripts/fayo-decision-browser-check.js
V6_UI_BROWSER=/tmp/chromium node scripts/fayo-execution-browser-check.js
V6_UI_BROWSER=/tmp/chromium node scripts/fayo-intelligence-browser-check.js
V6_UI_BROWSER=/tmp/chromium node scripts/fayo-operations-browser-check.js
```

本机为 Node 24.22.3，原生桥使用 `/usr/bin/python3`，模型使用已安装 scikit-learn 的独立解释器；四项跳过涉及原 PowerShell、LightGBM/XGBoost 可选环境。正式 CI 使用仓库指定的 Node 22 及其完整依赖，不删除这些测试。

## 已定位并处理的测试问题

首次本地全量为 4,995 项，4,972 通过、19 失败、4 跳过。1 项旧静态断言仍要求直接读取资金旧字段，现按正式共享证据适配器核对；4 项由本机软链 `/var/tmp` 导致，使用原规则允许的私有目录后通过；14 项缺模型 Python 选择，使用已安装的独立解释器后恢复。相关复测无失败，随后才取得上方完整回归结果，生产安全校验保持。

首次远端浏览器运行在 `388f7a860bd83e002da93a28295c60128c001556` 发现通用脚本仍期望 `center-20261125-2`，实际页面为 `center-20261125-3`。已同步严格版本断言；随后通用样例按原真实板块资金合同补充来源、单位和原取得时点，保留缺来源/错日拒绝与所有几何、交互检查，并完成本地全宽度复测。不能使用首次失败运行代替修复后的当前提交检查。

## 可恢复性与现场边界

改前完整源码 Git bundle 已验证，SHA-256 为 `54f6585fcb344e8ee4c45f3c911a6065828e0ab4a42d2d5d4fa3be7e5dca9d7b`。工作区没有生产 `data`、`durable` 或账本；源码备份不等于生产冷备。

此前本地安装包的 1,251 个运行文件与完整源码包的 3,785 个 Git 文件均按最初验收提交逐项核验，两个 ZIP 没有上传 GitHub，也不作为后续提交的安装凭证。最终部署依据合并后的精确源码提交及 [HANDOFF](../../../HANDOFF.md)，保留原卷、权限和账本，先冷备再升级；回退保全新增流水、模型及日报，不用旧账本覆盖新事件。
