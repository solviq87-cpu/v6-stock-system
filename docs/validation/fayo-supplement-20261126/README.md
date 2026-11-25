# 2026-11-26 主补丁验证（本地隔离，无生产操作）

本页原记录对应主补丁#361；当前增量的结果见下方「续接#361：只读报价与通知回滚保护」小节。两个代码版本的数字独立保留，不混算。

基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，分支 `audit/fayo-risk-integration-20261126`。实际运行时为冻结代码工作树，随后只补本记录和交接；源文件SHA-256及原日志摘要在 [evidence.json](evidence.json)。最终Git提交的远端CI需查该PR，不能把本地结果贴给不同源码。测试均为隔离数据或注入替身，未发真实通知、未接真实券商、未改原用户账本。

环境：Linux，Node `v24.22.3`、npm `11.19.1`、独立Python `3.12.14` venv（安装仓库 `tools/requirements-models-optional.txt` 固定依赖）；Playwright `1.57.0`、`@sparticuz/chromium` npm包提供 Chromium `158.0.8127.0`，实际文件 `/tmp/chromium`。容器自带chromium wrapper缺二进制、Playwright CDN下载受阻，故改用可取得的官方npm包；没有拿不可启动的浏览器当通过。

## 实际命令与结果

| 命令（仓库根，除非注明） | 结果 |
| --- | --- |
| `npm run check` | 通过；含新增workflow接线审计，前端原模块检查 |
| `bash scripts/check-github-workflows.sh` | 原actionlint v1.7.12固定下载与校验流程通过 |
| `V6_MODEL_PYTHON=/workspace/scratch/75d99b6e6e9b/test-python/bin/python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 RUNNER_TEMP=/tmp npm test` | exit0；5027项，5026通过、0失败、1跳过，560498.832066ms |
| 本轮最终通知/门禁专项，命令见下 | exit0；35通过、0失败、0跳过 |
| `node V6_BO/tests/full-server-isolated-smoke.js` | exit0；完整服务、正式原生路由/版本、404、鉴权拒绝/真实登录通过；临时副本/合成权限，无源码数据变化、无私有配置读取或出站，进程清理 |
| `NODE_PATH=/workspace/scratch/75d99b6e6e9b/ui-driver/node_modules V6_UI_BROWSER=/tmp/chromium V6_UI_QA_DIR=/workspace/scratch/75d99b6e6e9b/audit-inputs/patch-product-ui node V6_BO/scripts/fayo-browser-check.js` | exit0；8场景、6视口通过；报告与合成数据截图实际生成，手机登录拒绝与电脑账本页面人工查看无截断；不是用户真机 |
| `git diff --check` | 通过 |

最终专项入口：`private-risk-escalation-identity.test.js`、`private-risk-monitor-identity.test.js`、`private-risk-feishu-delivery.test.js`、`private-risk-journal-monitor.test.js`、`fayo-integration-gates.test.js`、`commit-check-triggers.test.js`（均在`V6_BO/tests/`；组合命令与实际计数以留存日志为准）。自动提交报价新增用例、原报价/账户恢复/并发/幂等关联用例另运行88项通过，并已包含在最终全量内，不相加冒充独立验收数量。

唯一跳过：`actual PowerShell wrapper handles paths with spaces, opens only a verified page, and cleans temporary controls`，当前无PowerShell；实际Windows路径/浏览器打开和清理仍需有对应环境的执行。其余模型可选依赖在此venv已具备。

## 首次失败与修正

最初误将 `V6_MODEL_PYTHON` 指向不存在的 `/usr/local/bin/python3`，该轮5022项为4992通过、29失败、1跳过，exit1。模型子进程ENOENT由环境配置导致；它不证明生产模型退化，也不是完整通过。纠正解释器并在独立venv补仓库固定依赖后，重新执行完整命令，结果如上。保留两轮日志哈希，未混算通过数。

## 复现和验收范围

- 原权威`saveLegacy`入口15.001秒/60秒/180秒旧价原可提交，新代码全部拒绝且现金持仓原字节不变；15秒允许。锁等待及最终序列化后过期同样拒绝，receivedAt不替代quoteAt，未来/缺失/冲突/跨日拒绝，重复既有成交重放不再次入账。
- 私密观察提醒对象和严重度绑定，A严重/B普通互换不会摘要碰撞；新严重对象可突破普通冷却，普通变化仍冷却。旧身份记录保留不确定，不把其旧gateway接受当成当前对象接受；unknown外发预留重启不重试，真实送达始终未证明。
- workflow候选补`visual-geometry`并去掉路径过滤；新增脚本真的被`npm run check`消费。此项验证源码，不代表远端管理员ruleset已生效。
- 独立集成检查点`cbfa2f493dfa4d5488115e232bce2c6df65b955b`的风险页390/1366检查结果属于另一个组合版本，不计入本主补丁全量。之后补丁组合必须记录新版本和新结果。

真实数据覆盖、设备送达、部署冷备与恢复、交易日观察5/20/60及预测效果本轮均未认证。报告不关闭对应78项任务。最终集成职责现由新总管接替；总管整合新提交后重新固定发布SHA，执行同一套门禁及相应业务边界，保持唯一写者并保全全部新增业务记录。

## 续接#361：只读报价与通知回滚保护

本增量基于 `5ea32ac70a753ecf6880757630d219c05c2417df`，分支 `fix/fayo-review-handoff-20261126`。保留主补丁实现，只补显式只读报价拒绝、通知schema3及已有身份v2日志的去重后迁移；两处成功HTTP测试桩补实际状态200以兼容#359严格回执分类。运行源与测试冻结后再执行完整回归，之后只补交接文档。精确源文件哈希、完整命令、日志哈希、组合树及回滚复现见 [continuation-evidence.json](continuation-evidence.json)；最终提交/PR与远端CI在对应PR登记。

环境：Linux，Node `v24.22.3`、npm `11.19.1`；模型解释器沿当前运行时 `CODEX_PRIMARY_RUNTIME_PYTHON`。`RUNNER_TEMP=/tmp` 使用真实目录：本环境 `/var/tmp` 是符号链接，原发布器路径保护会拒绝它；没有为测试放宽该门禁。

| 当前增量实际验证 | 结果 |
| --- | --- |
| `RUNNER_TEMP=/tmp V6_MODEL_PYTHON="$CODEX_PRIMARY_RUNTIME_PYTHON" V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test` | 完整TAP **5034项，5030通过、0失败、4跳过、0取消**；305037.525295ms |
| `node V6_BO/scripts/verify-tap-completeness.js <full.tap>` | exit0，完整性通过 |
| `npm run check` | exit0；原生前端语法与14项候选检查/9个浏览器脚本接线审计通过 |
| `node tests/full-server-isolated-smoke.js`（V6_BO目录） | exit0；完整服务、原生双端路由/版本、404、鉴权拒绝/登录；临时运行数据与进程清理 |
| 报价关联专项8个测试文件 | **81通过、0失败、0跳过** |
| 风险关联专项5个测试文件 | **29通过、0失败、0跳过** |
| `git diff --check` | exit0 |
| 当前工作环境真实浏览器 | 缺Chromium实际二进制，无法启动；没有计作通过。最终推送SHA的远端浏览器结果另查PR |

四项跳过分别是：真实PowerShell路径/打开/清理、依赖完整可选模型的五类模型比较、LightGBM回归、XGBoost回归。本轮未为这些环境项修改产品代码；原#361仅跳过一项的记录使用不同依赖环境，不能把其余三项历史通过计入本轮。专项已含在全量内，不相加冒充额外完成率。

### 固定他组head的隔离组合

这些只是临时工作树的合同验证，没有提交到dev、没有真实合并或部署，也不是所有开发组完整集成验收。

| 组合 | 固定他组head | 组合Git tree | 实测 |
| --- | --- | --- | --- |
| 当前报价增量与#356 | `fd3caeeef55b1cad63be14764a47e11a695c0b2e` | `a6a7c76b802bba53a818737e873c1b38fb4ebc3a` | 19文件，**132通过/0失败/0跳过** |
| 当前风险增量与#359 | `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f` | `f8bddc3e701cfb4f6c41d17088eaf579995ba579` | 9文件，**72通过/0失败/0跳过** |

#356需要保留其 `readOnly=false` 和全部对账/防御/锁检查，同时将 `publish(next, previousRevision, validateBeforeWrite=null)` 的回调放在 `atomicWrite` 前；正常mutate传 `result.validateBeforeWrite`，防御锁定路径保留原两参数调用。自动三方合并会把 `result` 放进错误作用域，必须复核该语义冲突。既有 `paper-fill-evidence.js` 字节保持。

#359生产代码三方合入无冲突，`classifyFeishuReceipt()`及其发送区块逐字节保留。第一次组合71项中的两个失败是#361成功HTTP桩缺 `status:200`；补齐成功桩并加入去重迁移反例后，最终72项全过。没有放宽严格分类器。较早的129项/66项及这次中间69/71结果属于不同代码快照，不作为当前验收证据。

### 回滚与未验收边界

在原#361实测，schema2的新身份摘要交给dev b9旧发送器，121秒后会再发一次；原状态为已接受或结果未知均复现。最终schema3对dev b9及原#361两个旧发送器均在网络前拒绝，日志原字节保持；已有身份v2仅去重后也迁移为3，历史条目/状态不变，迁移与后续旧程序HTTP调用均为0。所有网络均为测试桩，真实外发0。

回滚前必须停通知并保全v3去重历史和全部新增业务；不能降schema、清日志或用旧账本覆盖新流水。新总管统一最终集成/版本/验收，生产沿用既有唯一发布机制。真实供数、生产冷备、规则强制生效、设备送达和5/20/60真实交易日仍待证据。本聊天未启动dev合并、生产发布或发布者角色变更。
