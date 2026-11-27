# C组第二批交接：组合压力、分类失效与风险不误解除

## 基线、责任、范围
- dev 精确基线 0c45291d7156be8a1206f0bb272f3c719d5d2336；独立分支 fix/fayo-c-portfolio-stress-evidence-20261127。源码提交 1199c53301dce667afa0e0a84465e0d36326d69a；测试提交 35ac08f2a1d2a7879a8edcec9c7e785abc9e65c0。最终 head 以本PR实际回执为准。
- 原14/原72关联；本批主验收 22.10、22.11（部分）；映射 C-EX04/05/25/27/40/41/47/48/51 的相关证据边界，不以映射数量重复记完成。先复用现有组合压力与风险工作台，不修改A组账户权威和B组市场分类生成。
- #429 首批单独保留；复核 #427、#428、#430 变更路径，本批目标未见交叉。#429 的三个工作流当前排队，不能计为已通过。共享 DEPLOYMENT.md、HANDOFF.md、TASK_MASTER.md 仍由总管协调；本独立交接供总管纳入既有台账/发布清单。
- 仅修改 V6_BO/src/core/portfolio-stress-evidence.js，新增专项测试和验证记录。原固定情景假设、版本、15秒、账户、数据、交易权限和唯一发布者不变。

## 复现与修复
1. 原 classifyAt 先过滤无效/已失效分类，再选最新版；同源当前日较新证据过期、撤回、字段无效时可重用旧版本，空题材数组还可冒充已完整分类。改为按时点选择可见有效日期范围的同源最新记录后验证内容；明确撤回、空题材、未知时点/版本、过期均保守未知，不把不同来源到达顺序当仲裁。未来尚未可知/尚未生效以及其他有效日期记录不改写当前。较旧有明确时点的无效记录可由后续有效证据取代；无法确定时间的同日记录保持阻塞。空题材数组没有完整负证据，当前生产者本就不输出空列表，故保守判未知；未新增来源字段或改变阈值。
2. 题材部分覆盖保留 observedMarketValue，但不再显示完整 marketValue/weightPct；未知成员可能改变完整暴露。原共同题材压力缺口仍保留。
3. 可卖量未知导致清算成本未知时，保留已知市值冲击的 coveredLossEstimate，完整 estimatedLoss 仍为 null；分项可卖/不可卖损失不能用未知补零。保留原T+1、冻结、已成交持仓范围。
4. 无已观察重叠情景仅在现有全部缺口为空时显示 no-observed-overlap 和该情景零损失；账户现金不一致、报价过期、估值/可卖性缺失均为 unknown。不是确认所有组合风险为零，也不是交易资格。原风险工作台以当前完整分类为解除条件，本补丁不直接修改提醒/执行或自动解除状态。

## 实际验证
本地 Node v22.16.0，完整目标原文件以 git hash-object 核对，原 blob 89a72c6b1fc125ef9ebdbb20eaff16c85fa98837；本地修后 blob 5dfe78738bb0c60d67826884ee8bf8cd16d3486a、测试 blob 446272fb4d9b5f11419f328a47fd4e302d8f1962，均与远端提交回读相同。
在隔离目录运行真实 Node 原生 test runner、assert 和 crypto；依赖以原 research-workspace-store 的 canonical/digest、原 a-share-calendar 的 aShareCalendarDate、原 account-equity-evidence 的 validateEquityEvidence 及其常量/验证辅助函数截取构建。不是完整工作树或真实账本；不执行持久化、行情或交易。
- 命令：node --check src/core/portfolio-stress-evidence.js；node --test tests/c-portfolio-stress-integrity.test.js。
- 修前11项：3通过/8失败/0跳过，失败为1—5、8—10；修后11通过/0失败/0跳过。修前TAP SHA256 216e18784c2f7795061256447bca8fbe43e0c21bf69e61e5e4cf4a8a6fc90893；修后TAP SHA256 c9a9553acb9f1e9aad6705dda77a31ff630ca862dbc2d2d608b553dcdbc61bcb，修后原始日志 [isolated-node-after.tap](validation/fayo-c-stress-20261127/isolated-node-after.tap)。
- 11个测试均为封存合成权益派生样本，不能作为真实行情/实际收益；第11项保留完整有效分类与T+1压力的正向反例。修复前后的同一测试文件保持不变。
- 完整仓库 DNS 无法解析，未在完整工作树运行原生依赖/原测试、npm check/test、浏览器、真实数据/现场。待 GitHub 原工作流及总管组合：cd V6_BO && node --test tests/c-portfolio-stress-integrity.test.js tests/portfolio-stress-evidence.test.js tests/fayo-equity-stress-integration.test.js tests/risk-workbench.test.js；另核对原实际提示与解除链、两账户与权限边界。CI、组合及生产状态独立。

## 尚未完成的实际边界、协作与回滚
- 原压力情景明确 includesPendingOrders:false；冻结买单全成、部分成交、候选增量、共用预算、执行前复核仍需A组从同一权威订单/账户快照提供只读版本化证据并认可共享合同；不能改写账本或自行假定资金。B组分类证据须有同一决策时点，未取得真实来源和授权时不放行新增风险。已有风险状态机解除、正式风险门禁、连续跌停/T+1隔夜压力与分账户推送均未完成全链验收。
- 请总管复核#429与本批精确head，分别纳入组合候选并执行原完整CI、相关端到端和双端测试；不自行合并dev或部署，不触发真实通知/订单。
- 若回归失败，撤除本组独立增量或按原流程 revert；不强推、不reset主线、不动账户或历史数据。无新增生产依赖、运行入口或配置修改。
