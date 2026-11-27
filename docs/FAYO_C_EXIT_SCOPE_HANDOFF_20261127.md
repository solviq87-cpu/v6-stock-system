# FAYO C组第五批：T+1、冻结及退出估算范围（未发布）

## 任务、基线与复用范围
- 主任务22.9、22.10部分（实际不能退出的持仓与退出时间/成本估算），映射C-EX04/25/39的子项，不把映射编号重复计为完成。沿用原 advanced-portfolio-evidence、advanced-portfolio-runtime、advanced-account-risk 的只读投影，不写账户/订单，不改原批次成熟规则、冻结、费用、原报价15秒限制、原风控参数或权限。
- 精确dev基线 0c45291d7156be8a1206f0bb272f3c719d5d2336；原树 733aa43966e839d698bc540cb6a8f86312107acc。开工及提交前复核#427、#428—#441活动PR文件，本批业务及新增测试路径未见直接交叉。依赖其他组当前报价、账本、费用与历史供数合同；完整组合应核验最新实际HEAD，不独立部署。前四批独立PR #429/#432/#434/#438保留。

## 已复现缺口与最小修复
- 原 exitRisk 在全部100%锁定而市价及历史容量可用时，输出0个条件交易日和0元预计退出成本；部分可卖则仅按可卖子集计算，却用整仓退出字段返回有限估计。禁止未知持仓退出风险随可卖量减少而变成更好结果。
- 整仓 conditionalSessions、estimatedExitCost 在剩余受限数量大于0时保持null。新 conditionalSellableSessions、estimatedSellableExitCost、exitEstimateQuantity 仅描述明确可卖子集；全锁定正持仓不产生0天/0元结果；实际空仓在原门禁完整时保留真实零。
- 原历史量额参与率、涨跌停、停牌、报价/来源/时点、费用和不保证成交边界保留。运行时单独限制子集费用与冲击估算；闭市或暂停时子集字段也为null；完整成本仅在整仓满足原单交易日条件时返回，原多日成本未知边界不变。成本估算由原模块提供，新增 costReason；顶层原诊断与 portfolioEvidence.exits 保持同字段。旧正向全成熟场景兼容。未设计新的生产阈值或实际成交路径。

## 实际测试与边界
- 本地Node v22.16.0，隔离恢复原 exitRisk、所需原模块 helper 及 quote-observation-view 前60行真正报价门禁，无模拟其行为。原完整源由GitHub精确基线取得，隔离所用各片段按字符长度及UTF-16字节FNV1a与远端一致（helper 639/bfdc3f83；round+liquidityKnown 550/aaee7687；exitRisk 2323/473ebe25；quote gate 4766/cde8d64）。隔离不是完整源文件Git blob、完整账户运行环境或真实行情。
- 相同10项真实 node:test 用例：修前3通过7失败，修后10通过0失败0跳过。前4项为原估算范围反例，其余失败含新增字段原本不存在；7失败并非7个独立漏洞。原报价时效、停牌/跌停、真实零、合法全成熟和无写入边界均覆盖。修前TAP SHA256 64699de77cb4471b7a9d8bae661376889b86a59e951453301eab572d3b0d4f20；修后TAP SHA256 b330e616a5e728b566ed1dbb225dc9623b0cb5dff0f9ffdfa53512a36dbb0b89；原始修后日志 [after.tap](validation/fayo-c-exit-scope-20261127/after.tap)。隔离测试原文件Git blob 368cf4ca8bb2320497127d110af6caf6462d8aba。隔离node --check及5份完整候选JS源码V8语法解析通过。
- 新增另一份5项完整原报告链测试（T+1全锁、部分、闭市/暂停、跌停、全成熟），已编写但未运行。待仓库执行：cd V6_BO && node --test tests/c-exit-scope-integrity.test.js tests/c-exit-scope-runtime.test.js tests/advanced-portfolio-evidence.test.js tests/advanced-portfolio-runtime.test.js tests/advanced-account-risk.test.js 。完整仓库Git克隆DNS失败，未跑本批完整原生依赖、完整关联/全量CI、双端/现场；不声称5项联动用例通过。
- #429 主CI和UI Browser Geometry已完成成功；提交覆盖45930425269仍失败，日志显示两份原逐SHA smoke回执缺失/排队，必须取得真回执后再按原工作流复核，不绕过门槛。#432/#434/#438开工时CI未完成；以精确HEAD最新回执为准。
- 五批主任务部分整改6/18（22.2、22.8、22.9、22.10、22.11、22.13），余12项待继续核验；本组完整验收0/18。累计已实测新增专项53项（不同隔离范围），修前失败用例累计38含新增契约断言，不等于独立缺陷数；新增5项运行链仍未测，不计入通过。52项增强任务保留，逐项独立验收。

## 后续与回滚
- 未完成：多日连续跌停真实规则/证券级限价及无成交路径、跳空下行情景、待买委托全部成交/新增风险预算、实时预警/双端条件防御、抱团瓦解及八维风险、A/B/D正式共同合同。不能用历史容量证明真实可卖或止损一定成交。新增字段由A组既有风险页面消费前需完成双端验收，暂不另做界面。
- 总管纳入原有组合验收，记录本独立PR精确HEAD、跨组依赖和实际CI。未合并dev、未部署、未下单、未发真实通知。回滚只撤本独立增量或按原流程revert；不重写账户和历史，不降低原门禁。
