# FAYO `20261125ac` 整合验证记录

基线：`7427debbcda37cbf6183af6e2627fc5fad02e301`。本轮同时整合 PR #349（`8657c7983bf032e74bec2402491353cc2ad7c5ee`，已合入 dev 的 `e20f6577440106585a9e56ac5ed69809909916ed`）与 PR #350。目标前端：`center-20261125-2`。

所有服务、账本、报价与浏览器验收均在临时隔离副本中运行；没有生产交易、生产卷写入或外发消息。以下是整合后冻结工作树的实际结果；仓库检查以最终同树提交的 CI 回执为准。

## 最终整合结果

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 服务及 64 个原生前端模块语法通过 |
| 完整 `npm test` | **4918 项：4914 通过，0 失败、0 取消，4 项既有可选环境测试跳过**；221.522 秒；进程退出 0，TAP 完整性检查通过 |
| 执行链整合专项 | **63/63 通过**；包括两份真实 HTTP 测试、部分卖出、完整原批次退出、单一通知方、稀疏证据不能补采样缺口 |
| 数据与反馈专项 | 104 项通过，随后增加 1 个永久历史/实时报价边界回归，受影响文件 18/18 通过；这些新增用例均纳入最终 4918 项整库运行 |
| 前端专项 / 独立接线复核 | 各 43 项通过；包括真实 worker 提交点撤权、同一提案、原新闻闸与私密队列、PR #347 日期兜底 |
| 完整服务隔离启动 | 双端入口、版本、业务路由、鉴权和登录通过；无出站、生产私有配置读取或源码运行数据写入 |
| 双端作战台 | `/` 首个完整计划 **520 ms**；`/m` **303 ms**。原五秒阈值内，执行清单首项可见；联动与返回状态、明确创建/撤销、原账本不变通过 |
| 研究图谱与反馈 | 双端均通过；只读身份私密读取 0、意外写入 0；反馈仅提交引用，未知条数、真实零和 delegated 不混淆；21 次输入投影不变 |
| 业务工作区 | 19 个原生视图、6 个状态投影、38 个窄屏布局通过；导航零写入、只读隔离和四类冻结确认计划保持 |
| 通用原生产品 | 8 类场景 × 320/390/402/768/1366/1920 六种宽度通过，包含真实研究工作区导航和身份撤销 |
| 源码与依赖 | `git diff --check`、运行时 OpenAI/ChatGPT API 依赖禁用审计通过；测试前后的 40 个变更运行文件 SHA-256 一致 |

首屏时延来自隔离数据及本地 HTTP，不能代替生产网络或手机真机时延。两种拒绝（篡改计划、过期包）各双端共四条记录；旧股票迟到请求竞态各双端共两条检查。点击联动未写模拟账户，明确创建及撤销条件意图也没有改动原账户账本。

## 可复现命令与原始证据

```sh
RUNNER_TEMP=/tmp/fayo-private-regression-6b9ec285f52b \
V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

`RUNNER_TEMP` 必须为原安全规则允许的非软链私有目录。浏览器使用已验证的 Chromium 158，`V6_UI_BROWSER` 指向实际可执行文件，驱动沿用原 Playwright。四套脚本分别为 `fayo-decision-browser-check.js`、`fayo-intelligence-browser-check.js`、`fayo-operations-browser-check.js`、`fayo-browser-check.js`，未放宽原五秒或几何阈值。

- `final-results.json`：整合后的总数、时延、环境及证据哈希。
- `full-regression.tap.gz`：本次完整回归日志；解压后 SHA-256 为 `5ebb5c4050e5e795ac6c932b783c81597bb2243f49e670b47c995f06728ac102`。
- `browser-summary.json` 及同目录三份浏览器 JSON、operations 日志：最终四套浏览器回执。
- `execution-integration.tap`：执行合并专项 63 项原始记录。
- `changed-source-sha256.json`：通过整合验收的 40 个运行代码/脚本指纹。
- `protected-functions.json`：原函数、旧恢复资产、日期兜底和配置的逐字节核对。

`completion-focused.tap` 与 `final-results.json.preIntegration` 保留之前 `2aff80b8419d7732e665dd5c8eb5e3a5f66305d5` 的 122 项专项和 4848 项整库记录，属于整合之前的历史证据，不作为本次最终计数。

## 研究特型与原实时门禁

PR #349 原核对的 18 个函数中，17 个仍逐字节相同。`auditCenterInputs` 新增了有严格类型的 HFQ 历史回执路径：必须具备支持的协议、原回执哈希、正确日线区间和实际取得时刻，不能把日线结束时刻或补采时刻伪装为实时源端报价。

原 Q 权重、双源数量、价格/量额容忍及源时间差配置全文件与基线一致。新增永久回归证明：真实适配器产生的 HFQ 历史凭证以 `liveExecution` 核对时拒绝；只改标签为 none 仍拒绝。独立原 none 报价在 15,000 ms 边界通过原核对，15,001 ms 和跨日拒绝；中心输出仍为 `canTrade:false`。原买入、卖出及账户权限不由历史研究供给授予。

## 首次整库结果与恢复证据

首次`npm test`在Node24.22.3、并发2、轻量Python与ML Python分离环境运行：4825项，4816通过、5失败、4跳过，217秒。没有把这次执行记为全绿。

其中4项既有managed-publisher-runtime测试拒绝`/var/tmp`，原因是当前环境的`/var/tmp`为符号链接。改用`RUNNER_TEMP=/tmp/fayo-private-regression-6b9ec285f52b`，保持原安全规则后该文件13/13通过。第5项为本轮新增跨日HTTP用例继续使用已过期短会话；按原登录API次日重新登录后整个HTTP文件6/6通过，权限没有放宽。

4项跳过是当前测试环境未安装PowerShell、LightGBM、XGBoost对应的旧可选专项。代码没有删除或跳过这些原测试。正式CI使用仓库指定的Node22及其完整依赖环境，需核对最终提交结果。

## 原函数与回滚边界

`paperBuy`（8985字节）、`paperCheck`（3957）、`paperSell`（3477）、`savePaper`（1323）、`followSystemPicks`（1068）与基线函数体逐字节相同。原`terminal-workbench.js`日期兜底未改；账户权限、设备授权、角色与账本语义仍由原模块负责。

源码备份bundle经verify，SHA-256：`c1dfd38016e3b71e177abdf3a1bcbf12d8ca5cdb2dafed2c09c219068fc59120`。生产完整冷备、线上时延、真实候选/成交和私密飞书送达没有在本环境认证，按[五步部署交接](../../FAYO_COMPLETION_HANDOFF_20261125.md)现场记录。
