# FAYO 风险中心组验证 · 2026-11-26

## 基线和范围

开工及提交前复核 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；GitHub 工作分支 `feat/fayo-risk-center-20261126`，目标 `dev`，交付 [PR #359](https://github.com/solviq87-cpu/v6-stock-system/pull/359)。本次续接保留原 PR HEAD `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f`，在独立工作区增量快进。

覆盖01/02/03/04/05/14/30；逐项代码、测试与尚未接通的跨组接口见 [合同](../../FAYO_RISK_INTEGRATION_CONTRACT_20261126.md)。最终提交的40位 SHA 与远端 CI 链接写入 PR 回执；本页的源码清单摘要、实测日志 hash 和 [机器摘要](results.json) 用于核对本地证据。不得引用前轮4996项、旧 HEAD 绿色或其他组结果作为本次精确提交验收。

## 本次续接最终验证 · `20261126ab`

本轮恢复 `7f8515dd9746d4d5d3289d1edb671b84c38c7275` 的有效成果，追加修复同股代码类型差异造成的原门禁/派生证据漏算，以及断网后的旧风险保留和晚到回包。冻结实现提交为 **`d1dabdb763d6348f8e1633db4a535f6f2327ce9f`**；其后仅补验证与交接记录。最终PR提交及远端CI以 [#359](https://github.com/solviq87-cpu/v6-stock-system/pull/359) 精确HEAD回执为准。

| 本次验证 | 实际结果 |
| --- | --- |
| 原完整 `npm test` | **5141总项、5137通过、0失败、4原环境跳过**；296.513秒，退出码0，原TAP完整性检查通过 |
| 新增原门禁复现 | 新8项修前全部失败、修后8/8；连同原交易关联67/67，原订单/成交/报价证据类型与幂等指纹保持 |
| 权益、实际规则、动作和压力专项 | 62/62；含实际权威服务数值订单、部分成交、冻结、取消、重启和账本不变 |
| 通知独立专项 | 42/42；生命周期、回执显示、持久预留和通知runtime，无真实外发 |
| 完整服务隔离HTTP与双账户重启 | 11/11；在途撤权、只读/副本、epoch、CAS、损坏档案及账户间隔离 |
| 完整服务启动与静态检查 | 隔离启动成功；`npm run check`通过，69个原生前端模块 |
| 原完整浏览器流程 | **34/34条命令、36个脚本，首次运行全部exit0，无复跑**；包含时钟、research36及原WorkBuddy组合10/10 |
| 本组双端风险 | 1366px `/`、390px `/m`；真实离线/重连、页面离开/恢复、旧请求失效、撤权、静音、原账本不变和真实外发0均通过；已目视核对本轮截图 |
| 冻结来源 | 2333个源/测试/配置文件前后hash不变；清单SHA-256 `133f60a74d8402db0491c5e8d2dd306ba10ab79b1d5bd915b00dbc2371cb85cf` |

本次完整机器摘要为 [resume-results.json](resume-results.json)，上一检查点机器摘要 `results.json` 保持原状。专项有交叉，不将各行通过数相加。浏览器本地总耗时718.819秒；远端原工作流的真实时限和结果仍须读精确HEAD，不用本地成功代替。运行环境Node24.22.3、固定Playwright1.57.0、Chromium158.0.8127.0及Noto Sans CJK SC；本地缺PowerShell、可选LightGBM/XGBoost造成原4项跳过，没有关闭或豁免测试。

本次首轮完整5141项为5133通过、4失败、4跳过：测试临时目录位于工作树内，原私有发布验证器按既有规则拒绝有效夹具。将 `RUNNER_TEMP` 改为工作树外的真实私有临时目录后，原专项13/13，再用同一源码完整重跑得到上述0失败。没有修改生产验证器、测试断言或安全门禁。首轮日志SHA-256 `831550b4be29c3f461def085a4f26befb7467702c716c0ce543e7f4428ceb870`，其他日志hash保留于本次机器摘要。

原19个具名函数的历史保护记录只覆盖其列出的函数。本轮明确修改 `paper-application-service`、`common-entry-risk` 和 `paper-plan-observer` 的同股身份比较，保留原持久协议、锁、提交路径与阈值；不能再泛称全部原权威账户和风控模块未改。跨组只读预检、数值对账兼容和预提交回调作用域问题见 [merge-preflight.json](merge-preflight.json) 及合同9.6节；这不是最终合并验收。

## 上一检查点实际验证（34e0c18 / 7f8515d）

| 验证 | 当前实际证据 |
| --- | --- |
| 风险聚合与通知闭环专项 | 40通过，0失败，0跳过；含跨账户/期次/指纹拒绝绑定、旧证据、真实解除、45仓缺价摘要及发送前复核 |
| 原通知、计划、动作及队列关联回归 | 13个文件、165通过，0失败，0跳过；含观察持久化、部分退出、数值股票代码订单、来源/题材解除复核及不确定传输不重发 |
| 真实完整服务器隔离 HTTP / 双账户重启隔离 | 11通过，0失败，0跳过；含GET/POST在途设备撤权、原只读/副本、账户重置epoch、未成交敞口、CAS、损坏档案与另一账户独立恢复 |
| 完整服务器隔离启动 | `node V6_BO/tests/full-server-isolated-smoke.js` 通过；阻断外网、临时私有目录 |
| 原 UI / 缓存 / 布局契约 | 24通过，0失败，0跳过；保留原功能、排序、不遮挡、同源与恢复页字节断言 |
| 语法与原生模块 | `npm run check` 成功，69个独立原生前端模块 |
| 原完整 `npm test` 最终轮 | 5129总项，5125通过、0失败、4原环境跳过；265.276秒，退出码0，原 TAP 完整性检查通过；冻结2254个源/测试文件 hash 未变 |
| 原交易与权限保护比对 | [protected-functions.json](protected-functions.json)：对 dev 的19个完整 AST 函数源片段逐字一致；原权威账户/账本/事务/费用/风控模块及旧两主页无差异 |
| 最终风险双端浏览器 | 1366px `/`、390px `/m` 通过；同一风险 ID、旧价未知、类别静音恢复、撤权/逆序响应、未配置/未知区分、原账本字节不变、真实消息0 |
| 原通用与业务浏览器 | 通用8场景×6宽度（320/390/402/768/1366/1920）通过；最终 operations 19视图/38窄屏路由通过 |
| 原完整浏览器工作流 | 原34条命令/36个脚本均实跑并有成功回执；首轮33条通过，最后 WorkBuddy 组合失败，原样复跑10/10通过；间歇原因未证实，详见下节 |
| 最终提交 CI | 必须在 PR 读取最终40位 HEAD 的 V6 CI、UI Browser Geometry 和 Commit Coverage 回执；提交前本地通过不能代表远端已完成 |

各专项有交叉，不把通过数相加作为独立用例总量。本地运行环境 Node 24.22.3、Playwright 1.57.0、Chromium 158.0.8127.0、Noto Sans CJK SC；GitHub 原工作流使用 Node 22 和同一固定驱动。

## 首轮失败与处理记录

初轮全量5089项：5074通过、11失败、4可选跳过。4个失败来自旧通知factory VM夹具未注入新runtime，3个来自原首页/版本断言需按保留全部功能的新显示同步。另4个为测试环境问题：`/var/tmp -> /tmp`，生产验证器正确拒绝符号链接祖先。以基线文件在临时副本复现相同4失败，再用 `RUNNER_TEMP=/tmp` 对照13/13通过；仅将测试fixture父目录 `realpathSync`，生产权限/哈希/符号链接拒绝保持，默认及规范路径各13/13通过。

续接全量5129项：5123通过、2失败、4跳过；两失败均为 `fayo-vivid-style.test.js` 仍引用旧浏览器几何断言。本次按实际“决策→统一风险→市场→机会→更多研究”修正契约，保留原持仓、研究卡与顺序/不遮挡检查，专项24/24后冻结源码并再次完整运行。该有失败日志单独保留，SHA-256 `82df5ab9efb5b8b9dff7c5ed0757e2b8ba2249d8b35ccf5e8fdc9ce7731712cf`。

冻结源码的六路并发全量5129项：5124通过、1失败、4跳过（186.610秒）。唯一失败为原 `windows-local-host.test.js` 的启动超时后立即健康检查，返回 false；该测试与 `deploy/windows-host/host-runtime.js` 对 dev 均无差异，原文件单独运行25/25通过。保留失败日志 hash `d1bd2f92f75b148708fb52f9cd60ca564951cc092815f78cef94ab8b92d28875`，没有改变宿主代码、测试、超时或健康断言；最终本地全量按两路并发完整重跑。此现象不能凭复跑成功被称为原间歇性已修复。

原风险 PR 的初始远端 UI 检查曾因版本仍预期 `center-20261125-3` 而失败；现对齐实际 `risk-20261126-1`，仍严格断言版本。最初环境缺少Chromium的阻塞现已消除；使用原固定驱动1.57.0保留时钟倒退检查，没有降低门禁。

固定驱动完整浏览器首轮的最后 WorkBuddy 组合，在1440px选股模块折叠后观察到仍展开，报告包含子测试与父suite两项失败。旧应用和对应原测试相对 dev 字节一致；原单脚本复跑5/5、临时只加诊断副本10/10、最后原样三脚本组合10/10（0跳过）通过。没有证实根因，不能声称间歇性已修复，也未修改旧应用或放宽断言。最终精确 HEAD 的远端检查仍须独立核验。

## 可复现命令

```bash
npm run context:resume
npm run check
RUNNER_TEMP=/path/outside-any-worktree/private-real-temp V6_MODEL_PYTHON=/path/to/python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node --test V6_BO/tests/risk-workbench-http.test.js V6_BO/tests/risk-workbench-runtime-isolation.test.js
node V6_BO/tests/full-server-isolated-smoke.js
# 原工作流固定 Playwright 1.57.0；保持全部原脚本和时钟检查：
NODE_PATH=/path/to/playwright/node_modules node V6_BO/scripts/verify-browser-clock.js
NODE_PATH=/path/to/playwright/node_modules V6_UI_BROWSER=/path/to/chrome node V6_BO/scripts/fayo-risk-browser-check.js
```

原全量脚本必须完成TAP完整性校验；新`tests/*.test.js`自动纳入，未删除/新增豁免原用例。完整浏览器命令以 `.github/workflows/v6-ui-browser.yml` 为准，单风险脚本不能替代原全套。双端脚本从原账户服务创建隔离持仓及未成交买单，读取真实统一runtime和派生文件；网络拦截禁止站外请求，末尾断言原权威账户字节不变、无交易写入/真实外发。截图/原始日志不提交Git，仅保留精简结果与校验摘要。

## 未测和真实性边界

本地原环境缺 PowerShell 与可选 LightGBM / XGBoost，共4项按原guard跳过：实际 PowerShell wrapper、五类模型比较、LightGBM 确定性回归、XGBoost 确定性回归；未把跳过视为通过。远端原 CI 安装可选模型依赖，其真实结果另从最终 HEAD 日志核对。

未取得生产程序/私有卷，未进行生产冷备、部署、真实行情时延、真实私密网关和接收端确认；未测 iOS Safari / Android 真机触摸。当前原权威账户没有独立外部出入金事件接口，无法解释的现金差异使收益计算未知；原reset/初始资金改变独立epoch。常规一分钟权益采样可计算观察区间回撤，无法证明采样间极值或连续全账户历史最大回撤。固定压力是假设、未作真实概率校准；题材重叠不是统计相关系数。策略衰减、模型校准等依赖策略组专用adapter，缺回执保持未知。总管必须在最终六组合并 SHA 重做全量、HTTP、双端、安全及账户/账本一致性验证。

## 恢复

初轮源码bundle SHA-256 `9ff7ccc75186fbd27ebe660ad6bd4fdf07e956b0106c0e0936f0aff310a1a232` 与检查点 `checkpoint/fayo-risk-base-20261126` 保留。续接建立 `checkpoint/risk-start-20261126`，指向原 PR HEAD `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f`；完整 `risk-start-20261126.bundle` 已 `git bundle verify`，SHA-256 `0884590518afde995ce321b6a9edce5bae2b0044e0517a51c1fae747d7db800d`。外置源码bundle不入Git；远端原基线/PR历史也可按精确SHA检出到独立恢复分支，不强推、不reset dev。

本次恢复前还建立完整源码 `risk-resume-20261126.bundle`，检查点为 `7f8515dd9746d4d5d3289d1edb671b84c38c7275`，`git bundle verify`通过，SHA-256 `d86240c39938ae277175157a6b1d7cacce7c2278d635395a71c003deee0a72a4`。

上述均不代表生产冷备。按HANDOFF停全部写者、保全新流水、保留完整程序和全部私有卷，再切回经过验证的旧程序；保留新 `risk-evidence` 派生档，不重放通知，不用旧账户文件覆盖新增成交。其他组提交逐块保留，不整文件回灌旧版。
