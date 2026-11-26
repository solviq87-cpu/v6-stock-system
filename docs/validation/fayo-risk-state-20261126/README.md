# 风险四级/四维依赖补丁验证 · 2026-11-26

## 固定范围

- 父 PR #359，精确父提交 `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f`；分支 `fix/fayo-risk-status-supplement-20261126`。原 01/02/03/04/05/14/30，不新增任务编号。
- 本次验证针对未提交工作树中冻结的 13 个代码/测试文件；逐文件 SHA-256 见 [runtime-manifest.json](runtime-manifest.json)，清单 SHA-256 为 `e2d5c50e307b89af7f5166a5cea88639f20ad6aad31b7f0c9b7b088304ee8cdc`。最终提交/PR/CI 由交接者补实读结果，不能由本地日志替代。
- 最终总表、集成、合并与验收转交「绯曜 FAYO｜总管与最终交付」聊天；本组不操作最终合并或生产发布。

## 已执行结果

| 检查 | 实际结果 | 条件和限制 |
| --- | --- | --- |
| 风险合同、聚合、持久生命周期、运行隔离、原通知、原样式契约 | **70/70 通过，0 失败、0 跳过** | 包含 16 项新增合同/恢复边界、2 项真实 runtime 故障/恢复、1 项持久冷却边界；给定输入的规则正确性，不是预测价值 |
| `npm run check` | 通过；69 个原生模块语法通过 | 不表示浏览器或生产后端已运行 |
| 完整服务隔离启动 | 通过 | 临时程序/权限/私有目录、禁止出站；检查原生入口、版本、业务路由、404、真实鉴权拒绝与登录；临时数据及进程已清理 |
| 风险专用真实浏览器 | 1366×1000 与 390×844 通过 | 原账户服务构造隔离持仓/未成交单；相同事件 ID/合同版本、四维、未知保留三级、只读无私密请求、无越界、原账本字节不变；每日限额经真实生命周期预留后进入同一 API/页面，未发送真实消息 |
| 通用原生浏览器 | **6 个视口、8 类场景通过** | 对齐 #359 的精确前端修订、首页同源风险摘要、折叠内原账户卡可达；没有删除布局/权限门禁 |
| 独立完整回归 | **5116 项：5115 通过，0 失败，1 跳过；退出 0** | 最终冻结清单 `e2d5c50e…ee8cdc`；仓库脚本完成 TAP 完整性校验。唯一跳过为环境未提供 PowerShell 的原启动包装器测试；不视为已验证 Windows 现场 |
| 独立只读复核 | 无剩余阻塞；13/13 哈希相符，原两反例修后通过，精准 4/4 通过 | [复核结论](independent-review.md)、[实际结果](review-result.json)；包括原模块缺失后首页保留和二级复升不被吞掉 |
| 新档案供旧 #359 阅读的隔离演练 | 通过 | 独立复核绑定最终清单：旧父提交真实 loader 可读，文件字节不变；新 loader 再读保留降级历史及冷却原因。原通知事件枚举未扩展，降级保存在 `group.levelChanges`；只是读取兼容性，不代表生产回切完成 |
| 生产部署、私有卷冷备/恢复、真实行情、真实设备送达 | 未执行 | 不以隔离结果代替；不新增实盘权限 |
| 5/20/60 个交易日效果观察 | 未完成 | 本次无有效观察日计数；需按真实启用版本和成熟样本登记 |

风险/未知/限额桌面和手机截图已实看；四维文字与未知原因可读，原始时间明确，保留原样式。原规则模块报错时，首页和详情仍保留同一根因及最后有效三级。完整截图、TAP 和 HTTP 日志为本地审计证据，不将私有运行数据或大附件写入 Git。

### 被替代的验证

首个冻结清单 `adc2dfdff04da513555c197f603eaa462daebd319dd32493ae63ead43f9e36ee` 的完整回归为 5113 总项、5110 通过、2 失败、1 PowerShell 可选跳过。两个失败是原样式测试仍用旧首页卡片位置匹配浏览器脚本；随后按 #359 实际摘要/折叠位置加强对应断言。兼容降级历史和限额原因持久化也在其后更新，因此该轮仅保留为 `risk-status-full-superseded.tap`，不能证明最终代码通过。

第二个冻结清单 `3eecd8772d5f795a6dab11cc2154eb9b72a702a777a05c7e98050fe1e5dcf6bc` 的全量在 4085 项时主动停止，退出 130，无最终汇总，保留为 `risk-status-full-superseded-second.tap`。最后复核补齐了“未知间隔后的降级历史”和“已核验降级后再次进入三级/四级仍须立即升级”两个相邻边界；最终冻结版本重新执行完整回归，不能借这次中断结果通过验收。

第三个冻结清单 `635efe18bbf74587b738734b8597a31116603ac3f63349871e5166ee7b9bd139` 的完整回归为 5114 总项、5113 通过、0 失败、1 原 PowerShell 可选跳过。独立审查随后复现“上游根因缺失导致首页遗漏”和“有效二级复升被吞掉”两项，已补实现、两个精准测试及双端真实模块失败场景。该绿色结果保留为 `risk-status-full-superseded-third.tap`，不归给最终新版本。

## 本次可复现命令

在 `V6_BO` 目录：

```bash
npm run check
node --test --test-reporter=tap tests/risk-state-contract.test.js tests/risk-workbench.test.js tests/risk-alert-lifecycle.test.js tests/risk-workbench-runtime-notifications.test.js tests/risk-workbench-runtime-isolation.test.js tests/fayo-vivid-style.test.js
RUNNER_TEMP=/tmp V6_MODEL_PYTHON=/workspace/scratch/75d99b6e6e9b/test-python/bin/python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
RUNNER_TEMP=/tmp node tests/full-server-isolated-smoke.js
NODE_PATH=/workspace/scratch/75d99b6e6e9b/ui-driver/node_modules V6_UI_BROWSER=/tmp/chromium node scripts/fayo-risk-browser-check.js
NODE_PATH=/workspace/scratch/75d99b6e6e9b/ui-driver/node_modules V6_UI_BROWSER=/tmp/chromium node scripts/fayo-browser-check.js
```

本环境 Node `v24.22.3`；本地 Chromium 由已安装的 `@sparticuz/chromium` 提供，浏览器只访问隔离 loopback 夹具；运行器全量并发为 2，数值库线程为 1。外部网络、行情和通知不是这些浏览器夹具的测试范围。

## 审计文件索引

相对会话工作目录的 `audit-inputs/risk/`：

- `risk-state-runtime-manifest.json`：最终冻结代码/测试哈希。
- `risk-status-supplement.tap`、`risk-status-npm-check.log`、`risk-status-full.tap`：专项、语法和完整回归。
- `risk-state-full-server.log`：完整服务隔离启动。
- `risk-state-ui/risk-browser-report.json`：桌面/手机同源 ID、四维、未知保留与每日限额可见性。
- `risk-state-general-ui/fayo-browser-report.json`：通用原生页面、权限、布局与导航。
- `../risk-independent-review/previous-loader-result.json`：最终清单使用 #359 父提交真实 loader 的只读兼容结果；结论一并收录本目录 `review-result.json`。
- `risk-state-backward-rehearsal.json`：第三轮冻结清单时的历史兼容演练，最终代码以独立复核为准。

## 恢复与剩余条件

保全原账户、成交、计划和新派生记录后，才核验兼容回切或向前修复。新增降级记录使用额外字段，不扩展旧 `event.kind`；已对旧 loader 的读取和重复预留拒绝做隔离演练。这不是生产备份恢复验收，不能删除派生档释放去重或用旧账本覆盖新流水。

原账户完全不可读、无法证明期间时仍不能持久化新的账户期通知。规则版本、输入/首次可知时点和六类候选校准缺项按合同保留；尚无真实预测价值或“零漏报”结论。详见 [实现合同](../../FAYO_RISK_STATE_SUPPLEMENT_20261126.md)。
