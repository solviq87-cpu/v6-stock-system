# 冷启动快照与上下文续接 · 2026-11-14

起点：`dev@4233950bab8182e05264792cc3e380d687c64bf8`，已实际拉取，含 #210/#211。
提交前整合 `a6150b6`（#212，仅5份文档各1行回执）；保留其证据链接，业务代码与完整回归时完全相同。
分支：`fix/boot-snapshot-continuation-20261114`。范围：V6-001/006 的已复现缺陷和 V6-003 的工程续接。

## 复现与改动

1. `setAllStocks` 接受100只，但启动恢复只接受超过100只；统一为至少100只，99只仍拒绝。
2. 涨停池全部被现有退市过滤器剔除时，`_bp.length ? _bp : z.pool` 把原池放回；保留真正空池及剔除记录。ST仍按原规则保留，不扩大过滤条件。
3. 未来快照时间使负数age满足新鲜度上限；增加非负检查。非有限/非正时间归零为未知；有效历史时间和逐票quoteAt/receivedAt保持原样。恢复不调用ingestPx，不写回原快照，不把快照接收时间作为成交许可。
4. 全A快照损坏以前静默吞掉；现在给出固定、不含文件内容的错误提示，其余快照仍能恢复。首次启动文件不存在不误报。

新增8个行为测试：旧基线3通过/5失败；修复后8/8。
覆盖真实临时文件保存/恢复、100/99边界、同日未来/失效时间、15秒边界、原始时点保留、有效内存优先、全部退市/混合ST、损坏隔离和诊断不泄露原文。
测试执行的是实际server函数与现有分析过滤器，未连接供应商或真实账户；不能据此宣称目标机长期恢复已验收。

## 上下文问题的可验证部分

- 原续接入口要求整读多份交接；修改前根四份协作文件和历史CHAT_HANDOFF共64,896字节，包含大量历史阶段和旧SHA。
- 实际dev已含#210/#211，但活跃交接与队列表仍有“等待合并”。历史状态和当前状态混读会引起重复核查。
- server.js约1.7MB，app.js约374KB；部分单行历史注释很长。整文件或未限制长行的搜索，会消耗大量上下文且使关键结果被截断。
- 本会话没有平台上下文计量、压缩失败日志或账户额度遥测，无法断言平台故障、精确token上限或是否触发用量限制。上下文长度与账户额度是不同问题。

处理：`HANDOFF.md` 顶部只保留一个当前检查点，最大4000字符；`npm run context:resume` 读取实际本地分支/SHA、origin/dev缓存差异与最多12项脏文件，再输出检查点，绝不回退打印整个历史。原历史保留。标记缺失/重复/超限明确失败；新增2个测试验证真实临时Git仓库输出、边界和不读取工作区文件内容。

下次先读短检查点和两级AGENTS，再查询远端，按任务读取必要函数、证据和失败日志；阶段末更新检查点。该工具改进项目接续，不修改平台上下文窗口或自动压缩机制。

官方说明（2026-11-14查阅）：[OpenAI Best practices](https://learn.chatgpt.com/docs/learn/best-practices) 的 Organize long-running chats 说明长会话会积累上下文，Codex有自动压缩；建议围绕连贯工作单元组织聊天。本文不承诺压缩永不丢细节或无限连续运行。

## 验证与交付

- `npm run check` 通过。
- 冷启动、SSE恢复、报价时点、请求治理、模拟报价与锁定主页相关专项58/58通过；续接工具专项2/2通过。
- `node V6_BO/tests/full-server-isolated-smoke.js` 通过：真实完整服务HTTP、页面/脚本/404/无凭证拒绝，临时合成配置，禁止出站及读取原私有数据。
- 最终本地全量3387项：3384通过、0失败、0取消、3项可选LightGBM/XGBoost依赖缺失跳过；TAP完整性通过，退出0。网页40/40、构建及dist一致性通过；生产依赖禁入与工作流检查通过。精确PR head CI仍需远端回执。
- 首次全量3385项中21项失败：本轮误用了旧环境不存在的 `/opt/pyvenv/bin/python3`（ENOENT），非业务断言回归；改用实际安装解释器后重跑完整套件。首次网页测试缺jsdom，按lockfile安装后40项通过。保留失败原因，不改断言或跳过门禁。
- 两张主页blob未变：电脑 `9e2fad468cb3e192df0ca2b9184babb2add8c4de`，手机 `084e36d950f9bf4c3508aa1a5cb8986799b6079e`。

复跑：

```bash
npm run check
node --test V6_BO/tests/boot-snapshot-recovery.test.js V6_BO/tests/resume-context.test.js
RUNNER_TEMP=/tmp V6_MODEL_PYTHON="$(command -v python3)" V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node V6_BO/tests/full-server-isolated-smoke.js
npm run context:resume
```

回滚：标准revert本批提交；不迁移或回写私有账本/快照。未来时间失去“新鲜”资格属于预期修正，不能为恢复显示而放宽门禁。
未完成：原24项现场验收、目标Windows/手机真机、真实盘中连续行情、跨机灾备、策略长期样本、完整后台部署。未写生产、发送消息、切换发布owner、购买服务或连接券商；既有唯一发布器和私有事务恢复要求保留。

## GitHub最终回执

- [PR #214](https://github.com/solviq87-cpu/v6-stock-system/pull/214) 已合并到dev：`ac52fda658699176bb9c6839cc94385720303975`。原head `cfe02cafe0d3bb400405f183a0389757ccade02e` 的源码tree与本地验收tree完全相同；上传后实际fetch比对无差异。
- [精确head CI 43563319326](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43563319326) 的verify、verify-web全部成功；实际PR合并树包含新主线#213股票导入，完整3397通过/0失败/0跳过，网页40通过。可选ML在CI已安装；不把本地3跳过冒充本地通过。
- 合并树 `970466d0b492c2b1476abc686960debd75cfeaa8` 保留#213所有改动及两张锁定主页；代码交付完成，生产发布/现场验收未完成。
- 首次命令行上传检查缺Git HTTPS凭据，已使用现有GitHub连接完成上传，无需重复要求用户授权。
