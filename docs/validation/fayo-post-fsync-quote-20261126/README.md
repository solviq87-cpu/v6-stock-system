# 自动成交最终落盘时效边界复核 · 2026-11-26

基于 PR #361 的 `5ea32ac70a753ecf6880757630d219c05c2417df`，在独立分支 `fix/fayo-post-fsync-quote-20261126` 增量修复。上游唯一主线核查点为 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。本记录属于总管首批复核，映射原 02／04／22／49，不新增任务编号。

## 复现与改动

PR #361 已在账户锁内、序列化后检查新增自动成交的原始报价。独立复核发现 `atomicWrite` 随后还会写临时文件并执行 `fsyncSync`，之后才通过 `renameSync` 发布权威快照；该 I/O 耗时仍可能使报价超出 15 秒。

在上述未修复提交的临时账户，将最终快照的实际 `fsyncSync` 返回后注入 14,001 毫秒时钟推进。起初 1,000 毫秒的报价在发布时已为 15,001 毫秒，`saveLegacy` 仍成功；原账户字节改变，现金从 100,000 变为 98,995，新增一笔成交。注入只作用于最终账户临时文件，未修改真实账户或系统时钟。

本补丁保留原提前校验，并把同一同步校验传给 `atomicWrite` 的可选 `beforeRename` 钩子。钩子在最终临时文件完成写入、同步及关闭后立即运行，仍位于原账户锁内，随后才调用原子替换。拒绝会沿原清理逻辑删除临时文件，原权威文件不变。未提供钩子的现有两参数调用保持原行为；不新增账本，不改人工研究成交的历史合同，不重写已持久成交。

新增七项回归覆盖买卖两向最终同步后 15,000 毫秒允许、15,001 毫秒拒绝、跨午夜拒绝，以及最终同步 I/O 失败。拒绝同时核对原账户字节、零新增成交、临时文件清理、审计原因、重启读取和账户锁释放。

## 本轮实际验证

运行环境为 Linux、Node `v24.22.3`，测试使用临时数据和合成权限，没有出站、真实通知或生产切换。

| 检查 | 实际结果 |
| --- | --- |
| 修复前 PR #361 报价／账本关联专项 | 62 通过，0 失败／跳过；未覆盖最终同步耗时，不能据此判定该边界已关闭 |
| 修复后关联专项及现有行情中心端到端 | 78 通过，0 失败／跳过／取消，退出 0；含新增 7 项，不能换算项目完成率 |
| TAP 完整性 | 原 `verify-tap-completeness.js` 退出 0 |
| `npm run check` | 退出 0；原生语法及原集成门禁检查通过 |
| `node V6_BO/tests/full-server-isolated-smoke.js` | 退出 0；完整服务、原生双端入口／版本、路由、404、真实 HTTP 鉴权拒绝和登录通过，临时环境已清理 |
| `git diff --check` | 退出 0 |
| 新补丁完整回归、远端精确提交 CI、最终组合版本 | 本记录未执行；须由最终集成检查确认，不能沿用 PR #361 历史全量 |
| 生产／目标设备／真实盘中 | 未执行，原现场验收状态保持 |

关联专项在 `V6_BO` 目录执行：

```bash
node --test --test-reporter=tap --test-concurrency=2 \
  tests/automatic-paper-commit-quote-time.test.js \
  tests/paper-application-service.test.js \
  tests/legacy-authority-integration.test.js \
  tests/paper-authority-quote-time.test.js \
  tests/paper-original-quote-time.test.js \
  tests/authority-fault-matrix.test.js \
  tests/paper-account-multiprocess.test.js \
  tests/merged-authority-restart.test.js \
  tests/paper-authority-write-rollback.test.js \
  tests/paper-fill-evidence.test.js \
  tests/paper-conditional-authorization.test.js \
  tests/market-data-center-e2e.test.js
```

临时原始日志 SHA-256（仓库仅提交本摘要）：

| 日志 | SHA-256 |
| --- | --- |
| 修前关联专项 | `f5a3f2688c2aaad2a967b796af2aece59d7f92fe76adb17b346f7759047938f3` |
| 修后关联专项 | `7e66c13c7253fda3baa85a8e32c9448b76e2f7c28788c6dd21b9244865fee0fa` |
| 静态检查 | `3b689a221d672157d64d082f55d1b89f71c1611d857e313bade267b101c58ef1` |
| 完整服务隔离启动 | `ee60448bbb995095618d47e5dae993d7cc276c2f3ad50bd7b1abff9b4fea38c1` |

## 与 PR #356 的合并注意事项

PR #356 将原 `mutate` 的发布步骤提取为 `publish(next, previousRevision)`，并加入只读、对账和防御状态门禁。整合时必须保留这些行为，同时让正常事务把 `result.validateBeforeWrite` 传入 `publish`，由 `publish` 提前调用并传入 `atomicWrite(..., {beforeRename: validateBeforeWrite})`。防御状态锁存原有的 `publish(original, original.revision)` 不带新成交报价钩子；不能要求写入限制状态时凭空提供报价，也不能绕过它原有的对账核验。

本分支未自行合入其他组，没有推送、合并或改变唯一发布者。最终合并与 `HANDOFF.md`、`DEPLOYMENT.md` 统一记录由总管维护。回滚本补丁会恢复已复现的最终同步时效缺口；保留原账户与所有新增业务数据，优先向前修复，不用旧账本覆盖新流水。

## 总管完整回归与独立反证（2026-11-26）

- 命令：`RUNNER_TEMP=/tmp V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test`。
- 实际：5034项，5030通过，0失败/取消，4项原环境可选跳过；退出码0，TAP完整性通过。原日志SHA-256为`d48bdc5875fcb398616376cf8883fa54c8fb2c479b49622d720bf7f9947c03da`，未提交原始日志。跳过为PowerShell启动器、可选五类模型比较、LightGBM、XGBoost，未关闭测试。
- 独立审查只运行新增7例：7/7通过；独立进程替换为#361原atomicWrite后3通过/4失败，均为预期必须拒绝的过期买卖和跨日场景；工作树不变。
- 本补丁HEAD的远端CI和与#356组合全量待核，未部署或外发；#361旧绿色不代表本补丁最终验收。
