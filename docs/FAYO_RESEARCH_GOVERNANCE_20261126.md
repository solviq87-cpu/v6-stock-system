# FAYO 研究治理与六组集成交接（2026-11-26）

本组负责 **07、08、09、10、12、13、21、24、25、26、28**，独立 PR [#353](https://github.com/solviq87-cpu/v6-stock-system/pull/353)，目标 `dev`。基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，工作分支 `feat/fayo-research-governance-20261126`。第一组“数据可靠性、运行监测与架构整理”负责最终集成、66项总清单和合并后完整验收；本组提供11项的代码、测试及依赖证据。

本次已取得完整源码并在本地运行原验证流程。前一阶段环境无法克隆的记录仅适用于当时，不作为当前限制。生产 data/durable、权威账本、配置及设备凭据未取得；源码与隔离测试不等于目标节点冷备或生产验收。没有生产切换、模型批准、账户权限修改、实盘或真实通知发送。

## 本轮实际变更

- **统一研究报告与双端**：继续使用原 `/api/decision-center/research`、原 worker、原主研究档案与 `public/nova/intelligence-view.mjs`；新增治理和概率存证卡，不增加第二套行情、账本或审批入口。桌面 `/` 与手机 `/m` 使用相同接口、权限及粉紫样式。
- **策略/因子诊断**：四策略纸面研究使用两个20交易日窗口、隔离2日，保留不足、成本、数据和环境缺口；数值因子按互不重叠留出期和完全相同的逐日市场/股票截面比较，复用原 Spearman 与因子定义。未知、无触线、冗余、分布偏移和 IC 下降分别呈现。所有线索均不构成因果衰减或实盘有效性认证。
- **概率存证**：复用 `research-workspace-store` 的私有追加事件；登记、冻结、标签、一次性评价和失败尝试留痕。正式/测试隔离，原 schema-1 密封对象保留原始 JSON 顺序，不重封历史。固定预测通道和标签来源，禁止事后择源；正式预测只能读取原信号档案，正式价格标签只能读取原观察档案，保留实际首次取得时间和修订冲突。
- **试验治理**：概率研究跨模型、目标不得重叠使用留出日期区间。额度上限引用原常量6次/90日，但窗口只使用本概率命名空间内实际归档、按日期去重的冻结信号日，并按实际查看结果的日期计入消耗；未满90个实际信号日时保守保留全部消耗。只有最近90个实际冻结信号日的起点已经晚于某次评价日期，该次消耗才离开窗口。扩展空白日历或延迟查看旧窗口不能恢复额度。预算满时仍可登记并采样新的独立未来窗口，最终评价继续受限。失败或样本不足的已封存评价消耗额度，被拒的提前查看请求留痕但不暴露指标，重读同一封存结果不新增试验。该预算仅覆盖概率研究家族，不代表原因子影子研究及其他家族已统一，也不是DSR/PBO认证。
- **模型升级**：已结算队列 top-K 仅提供 `descriptiveGain`。原候选生成锁内固定60自然日观察窗与30自然日结算等待期，保留重叠/重复尝试。所有冻结计划进入覆盖分母，未成交、未平仓、晚到、重复和无效引用均留下缺口；封存后更正会使批准证据失效。首次收口后审批被拒，也将只含收口结果的快照保存在原档案，返回409和新修订号。原五关、人工批准及原获批版本保留。
- **收益与执行真实性**：对原模拟结算拆分价格盈亏、原费用、净额及勾稽残差，单列假设费用/滑点压力；复用原样本真实性筛查。核对原入场/退出事件、委托身份、成交日期、精确分价算术，并按原账户和退出事件去重；同事件经济内容冲突全部隔离。高精度历史FIFO分摊的逐批重放证据缺失时明确保留缺口，不靠任意舍入容差宣称通过，不作为模型晋级充分证据。HFQ 次日标签 IC、独立纸面估算和真实模拟结算三种范围分别标注。
- **风险中心衔接**：原编辑者成功读取研究报告后，仅缓存白名单摘要，原风险中心 `strategyDecay` 引用原指纹/时点；超过24小时标记过期，未来/损坏证据保持未知。GET 不写日志、建目录、读取新账户或连接供应商。
- **概率表述**：规则评分、历史事件频率、模型估计和待校准映射分开；清理原生页面的“原概率”“亏损概率”和把规则一致性当置信概率的表达。保留原字段、数值、策略门槛和通知通道；原信号生产者与通知格式的语义回归继续执行。

## 按11项任务追溯

| 编号 | 已实现与复用 | 验证入口 | 尚待证据/集成 |
|---|---|---|---|
| 07 策略衰减预警 | `strategy-health-monitor`、`fayo-research-governance`、原风险中心摘要；数据/分布/IC/假设成本分别说明 | `fayo-research-diagnosis`、`fayo-research-governance`、`research-governance-cache` | 独立真实成熟样本及因果归因；不自动停策略 |
| 08 概率校准与可信度 | `probability-reliability*` 核心、持久 CLI、原档案适配、中心同源摘要与分箱展示 | `probability-reliability*`、治理 HTTP/浏览器 | 原信号缺运行参数及训练血缘，完整正式结果也仅 `source-version-only-diagnostic`；旧观察范围为unknown时不可转正式标签；净盈利缺唯一信号→计划→原结算绑定 |
| 09 策略与因子体检 | 原95规则、原正交/冗余、同定义同截面 IC/覆盖、结算按策略摘要 | `intelligence-research`、`fayo-research-governance` | 全市场覆盖与真实跨期有效性，不把观察子集泛化 |
| 10 环境适配 | 原冻结趋势/情绪/策略标签和原留出分层；`environments.byRegime/byCycle/byStrategy` | `intelligence-execution-validation`、治理与浏览器 | 各环境真实足量样本；不据描述性分组自动调风控 |
| 12 当前/候选对照 | 原数值模型同向量、完整计划分母、固定留出封存与可信回读合同 | `fayo-model-governance-integration` | 原模型排名前独立完整队列与同结果的原组合风险评审适配器 |
| 13 收益/执行偏差归因 | 原结算的实际价格盈亏、费用、净额；压力估计另列 | `intelligence-execution-validation`、`fayo-research-diagnosis` | 统一连续权益、指数/行业、仓位、委托与成交时间；相应归因保持null |
| 21 概率表达 | 原概率合同、原生徽章/统计/情绪及研究页；通知生产者保留原事件目标 | `probability-target-integrity`、`backtest-event-frequency`、`production-signal-evidence`、双端 | 生产所有实际渠道及历史消息仍需原实例抽验，不改写旧档案 |
| 24 无增益与堆叠 | 原训练正交/相关性压制及独立体检线索，显示冗余关系和覆盖 | `factor-redundancy`、`intelligence-research`、治理 | 足量真实留出边际贡献；不自动删除原因子或模型 |
| 25 过拟合/挑样本 | 修复四策略时间边界；固定预测来源、留出、失败存证、试验限额和模型完整队列 | 概率存证、治理集成、原全量 | 跨研究家族的统一试验目录由最终集成与补充增强组统筹；非DSR/PBO认证 |
| 26 回测/模拟真实性 | 原历史交易日、股票池、未复权成交基准、涨跌停/ST/停牌/公司行为门禁；原结算核对 | 原历史执行/多源/账本回归和执行验证 | 历史主数据完整度、真实逐笔及目标节点账本/权益一致性 |
| 28 变更治理 | 原候选/版本/五关/权限/锁/人工审批，新增持久前瞻收口和可信原风险回读 | 模型集成、计划冻结、原 HTTP 权限回归 | 生产可信回读适配器与人工评审；现有部署缺证据保持旧版本 |

表中测试名均对应 `V6_BO/tests/<名称>.test.js`（概率存证通配另含多个专项）。隔离测试证明合同和边界，不能证明真实收益、概率可信度或生产验收完成。

## 运行与接口合同

### 原中心与风险读接口

`GET /api/decision-center/research` 继续仅允许原编辑者，响应 `private, no-store`，读后再次验证身份。`result.governance` 的 mode 为 `fayo-research-governance-readonly`、schemaVersion 为1，增加 `probabilityResearch`，不更名原字段。所有交易、批准、通知、账户写入和生产权重动作标志为false。

概率摘要从固定 `path.join(shortlineResearchDir(), 'probability-research')` 的 formal 命名空间读取；浏览器不能指定路径、范围或历史时钟。`probabilityResearch` 的 mode 为 `fayo-probability-journal-v1`，包含计数、试验预算及最多20个计划的指标；不含原始预测/标签、私人路径、原始上下文或凭据。空目录为 `missing-evidence`，损坏为 `unavailable`，其他原研究报告继续可用。

`GET /api/research/risk-center` 原返回增量扩展 `strategyDecay` 的 `evidenceAsOf/sourceFingerprint/observations`；它来自已授权原报告的进程内白名单投影，不是新的权威风险状态或持久数据库。与 PR #356 合并时，普通 GET 和 `advanced=1` 都应将同一 `governance` 摘要传给原 `readResearchRiskCenter`，保留 #356 的开始/完成双重权限及角色检查、异步账户投影与 `advancedAccounts`。PR #359 新增 `riskWorkbenchRuntime().readResearch` 也调用同一个读取器；该调用应传入同一缓存并使用本次 `now`。本组状态 `unknown/review-observed-unverified/stale-research` 不能强改为 #359 的 `validated`，原工作台策略风险继续unknown，只显示有来源的研究线索，不能据此产生active通知。

### 概率 CLI 与私有目录

在 `V6_BO` 使用原入口；以下所有输入文件均为真实私有 JSON，不在仓库保存运行数据：

```bash
node scripts/probability-reliability.js journal-register PRIVATE_INPUT.json PRIVATE_ROOT
node scripts/probability-reliability.js journal-freeze PRIVATE_INPUT.json PRIVATE_ROOT --signals-root ORIGINAL_SIGNAL_ROOT
node scripts/probability-reliability.js journal-outcome PRIVATE_INPUT.json PRIVATE_ROOT --observations-root ORIGINAL_OBSERVATION_ROOT
node scripts/probability-reliability.js journal-evaluate PRIVATE_INPUT.json PRIVATE_ROOT --observations-root ORIGINAL_OBSERVATION_ROOT
node scripts/probability-reliability.js journal-read PRIVATE_INPUT.json PRIVATE_ROOT
```

`PRIVATE_ROOT` 应为原 `V6_SHORTLINE_DIR/probability-research` 的绝对私有路径。命名空间为 `formal/events` 与 `test/events`，目录0700、文件0600；原追加存储、哈希链、原子写与系统锁继续使用。CLI使用真实运行时钟；不能传now回填过去。登记输入包含 requestId、scope、plan、原trading-calendar、sourcePolicy；formal来源策略固定 `predictionChannel=model|riseModel`、`outcomeProvider=eastmoney|tencent|sina`、`revisionPolicy=first-post-close-observation`。后续命令只接受已登记 planFingerprint 与原档案身份。旧无状态 register/freeze/evaluate 保留兼容，单独JSON不是持久预登记证明。

正式最终评价会按预登记来源重新核对所有已记录标签，因此仍需传入原观察目录。目录缺失、来源读取失败或已知修订冲突会使相关标签从此次有效样本中隔离；原标签保留，评价仍封存并消耗试验额度。`journal-*` 输入必须是权限0600的普通 JSON 文件。formal 输入必须来自原真实档案，test 命名空间仅用于隔离协议测试。

正式标签固定采用预登记提供者在目标日收盘后的首个原观察快照；随后出现价格、状态、公司行为或原始证据冲突时隔离该标签，不改用有利修订。标签的 `sourceAvailableAt` 保留原来源可得时点，`availableAt` 使用本研究实际追加标签的时间。迟到收件不能倒填为校准期已知；最终评价还会重查来源，将已知冲突计入 `sourceRecheck` 并从有效样本中排除。已封存历史报告保留原评价截点，不用后来修订重封择优。

原 `readObservedStock` 增加只读 `sampleClassification`：`schemaVersion=1`、`basis=original-raw-stock-and-context-declarations`、`providerAuthenticated=false`，`rows` 按日期返回 `standard-declared`、`nonstandard` 或 `unknown`。分类取自原链已经校验的 `rawStock`、`context` 和逐日原始输入，不返回原上下文、路径或凭据。原档案字节、价格投影及写入语义保持不变；旧未知范围或非标准记录不能由后续声明重新标成正式。正式概率标签要求目标日及所需基准日均为 `standard-declared`。现有历史档案缺明确范围声明时仍为 `unknown`，因此不能被直接消费为正式标准标签；明确声明也不等于供应商真实性认证。

固定分箱政策：校准/保留期各至少100条、20个信号日、正负各10条，每拟合箱至少20条。Brier、log loss、ECE、分箱频率及按日留一敏感性范围均为描述性诊断；按日留一范围不是置信区间。固定政策尚未以真实市场验证最佳。原信号源码依赖指纹不能证明可变运行参数或训练截点。最终报告与每计划摘要保留 `modelIdentityBasis=source-code-version-only`、`modelParametersVerified=false`；最终报告另列 `modelProvenanceGap=model-parameter-provenance-missing`。仅当 formal 样本数量、成熟度和完整覆盖均满足原统计要求时，最终报告及对应计划的状态才是 `source-version-only-diagnostic`；不足时仍为 `insufficient-or-incomplete-evidence`。概率摘要顶层状态另用于表示档案是否存在，不应与计划状态混用。所有结果继续保持 `calibrationCertified/canTrade/canApprove/productionWeightsChanged=false`。实际净盈利目标继续拒绝没有唯一原结算身份的标签，不用价格涨幅代替。

### 原模拟结算与价格证据

结算投影只接受原 `pool/pre` 账户身份；退出需原 `exitEventId/exitOrderId/tradeDate`，入场各批次需原 `eventId/orderId/time/price`，继续核对T+1、计划冻结、数量、原成本、费用与净额。按账户和退出事件生成 `settlementIdentity`，另对规范化经济字段与计划绑定生成 `settlementContentFingerprint`。追加无关备注不会增算一笔成交；同事件内容冲突的记录全部隔离。

精确分价逐批严格核对 `grossCents == money(price * quantity)`，标记 `entryPriceEvidence=exact-cent-price-reconciled`。原FIFO是按剩余批次的分金额比例分摊，高精度价格历史多次拆分可产生超过1分的合法残差。证明没有原lot总量及前序分摊余额，因此该类仅保留原净额勾稽和描述性结果，标记 `fifo-allocation-not-replayed`；成本情景列出两类数量，双端展示未重放提示。模型对照中该类仍占计划分母，留下覆盖缺口，不能因净额为正取得晋级资格。原导入与权威账本完全不重写；完整原批次回读由原执行/风险服务提供。

### 模型试验与原审批

原候选追加 `prospectiveTrial` 和 `prospectiveResult`，旧记录不重写。前者绑定双方模型/评分/候选验证/词典指纹及固定窗口，后者保存完整输入和结果指纹、覆盖和排除。未收口的GET不披露留出收益；首次收口只发生在原锁内写路径，审批失败也保留收口。封存后资料更正、计划删除或补入旧日证据使结果失效，不能自行重封以择优。

内部同步依赖 `readProspectiveReview({trial,evidenceFingerprint,planIds,now})` 只能由原服务回读适配器提供，HTTP payload/档案自报标志不消费。回执需满足：

| 部分 | 必须核验 |
|---|---|
| 顶层 | schemaVersion1、来源 `original-research-and-risk-services`、准确试验/结果/双方模型指纹、实际可知时间 |
| cohort | 原模型排名前冻结完整观察日志、来源指纹、事前登记时钟、精确观察窗口、无重复且完全一致的计划全集 |
| risk | 原权威风险引擎、回执与政策指纹、绑定同结果及双方模型、收口后实际评审时间、通过且风险阈值未放宽、完整组合风险证据 |

只有合同齐备才有 `approvalEligible=true`，仍由原五关和人工审批 reducer 决定；研究输出 `canApprove` 始终false。当前生产 worker **没有接通该可信回读适配器**。隔离正向测试证明接口可走通，不能冒充真实风险认证；本组不新建第二账户或风险引擎来填这个缺口。

## 六组依赖及合并建议

2026-11-26核对时dev仍为本文基线，最新合并为#352；活动dev PR为#353/#356/#357/#358/#359，均为draft。#354、#355均由#358接续，#355关闭未合并，不应重复集成。尚未取得第六组独立PR证据，不能替其填写完成状态。

| 活动PR | 本次核对HEAD | 原职责及本组接口依赖 |
|---|---|---|
| #353 本组 | 前序301641650；本次以PR最终HEAD为准 | 原研究报告、概率存证、候选治理、结算描述 |
| #356 | `d50395972e9ae693a37e934dab785234c654e250` | 原高级账户风险、数据版本及写锁；共享原risk-center handler |
| #357 | `9a1132264a191091ea526cba698177f2b5d0c703` | 研究补充增强；纸面净期望/相似案例不能与原结算归因合并分母，36/61等消费原策略证据/试验摘要 |
| #358 | `70be46b5d5e05c02f9d2fe353df072c62f065ef4` | 新闻/中文筛选/纪律复盘；保留同一研究worker及前端增量 |
| #359 | `86a5bf4787f2b5a1746fffc11b9a60a06b5e387f` | 原风险工作台、封存权益与权限；新增readResearch需同一治理摘要，未知不改成认证 |

临时独立对象目录运行原 `git merge-tree --write-tree`，未合并、改分支或改共享工作树。以本轮31文件冻结代码快照核对：本组与#356的真实文本冲突仅 `V6_BO/server.js` 原风险handler；与#357、#358可文本合并；与#359冲突为 `HANDOFF.md`。以以上他组精确HEAD互相核对：#356/#357冲突 `DEPLOYMENT.md/HANDOFF.md`；#358/#359冲突 `DEPLOYMENT.md/HANDOFF.md`、`V6_BO/public/nova/index.html`、`V6_BO/public/nova/market.js`、`V6_BO/public/sw.js`。其余已核对组合能文本合并。文本合并成功不证明业务、版本或权限一致；后续HEAD变化须重检。

北京时间2026-11-26 01:09的精确HEAD检查：#356为29/29成功，#358为30/30成功；#357和#359各28成功、2失败。#357原verify日志显示新增warmup用例期望fail但实际pass，位于 `tests/fayo-intelligence-evolution.test.js:26`（run45653951469、45653919614）；#359两次visual-geometry在原浏览器脚本修订断言失败，期望 `center-20261125-3`、实际 `risk-20261126-1`（run45657213262、45657099220）。这是确定性失败，不能仅重跑假定解决；由对应组修复后重验精确HEAD。#358也改了同一版本断言，最终需统一页面、服务端、SW及原浏览器验收脚本。该快照不预判后续修复状态。

集成时以#356的异步advanced分支为结构，向原 `readResearchRiskCenter` 保留本组 `governance` 参数和成功研究GET的缓存更新，保留原二次editor与角色变化检查。#359的封存权益要求 `equityEvidenceId/accountEpoch/authoritySnapshotFingerprint`，#356当前账户摘要的 `account/revision/checkedAt` 不满足该合同，不能直接覆盖#359的equity/rules/actions。先保留其高级只读诊断，再由原风险服务以同一快照身份适配。采集、历史股票池与完整主数据沿原组职责；本组只对原观察读取器追加非敏感类别摘要。

建议第一组先落定公共数据、写锁和原风险证据合同，再整合#353治理与#357研究消费者；#358与#359的共同前端、版本和服务工作线程在统一集成分支逐块保留。确切顺序以各PR最终HEAD和依赖回执为准，不按PR号机械排序。HANDOFF/DEPLOYMENT只合并各组有效段落，版本、前端修订及SW缓存由第一组统一提升，本组保留当前 `20261125ad` 发布目标。

就以上已核对五个PR，修复失败门禁后可按 `#356 → #359 → #353最终HEAD → #358 → #357修复HEAD` 组织整合：先共享写锁/原账户诊断，再统一风险快照，接入本组两处只读消费者，随后合并证据交互与额外研究。第一组自己的公共基础变更如先行改变这些合同，应重新排序。此建议没有执行串行合并。

最终合并提交必须重新运行原全量、Web构建、HTTP、桌面/手机、安全、权限/设备、账户和权威账本一致性检查，不能用各组分支通过代替。本组11项表可并入第一组的66项总清单，其他55项未在此伪填完成。

## 验证与当前状态

前一已提交检查点 `301641650c0246d29142b8c9e16165064cfa1f2c` 的30项检查全部成功。逐提交覆盖第一次遇GitHub503，重跑原工作流通过；中间提交 `78008e217f3d0035f9038f48b7e133a1c48b5917` 已用只读验证分支触发原逐提交工作流补齐真实证据，没有手写成功状态或放宽门禁。这些结果只对应旧检查点，本轮新提交另核对精确SHA。

本轮冻结代码的本地实际结果如下，新提交的远端CI结果另在PR按精确SHA记录：

| 验证 | 实际结果 |
|---|---|
| 原 `npm run check` | 通过；原生前端68模块语法校验通过 |
| 原 `npm test` 全量及TAP完整性 | 5049项：5045通过、0失败、0取消、4跳过；退出0，原TAP完整性校验通过，560752.761705ms |
| 原Web | `npm --prefix V6_WEB run build` 成功、原测试41项通过、dist与原跟踪内容一致 |
| 原生静态发布器 | `node --test V6_BO/scripts/build-fayo-static.test.js`，9/9通过 |
| 原真实服务HTTP/风险摘要 | `fayo-research-governance-integration` + `research-governance-cache`，5/5通过；编辑者/查看者/匿名隔离、原指纹/时点、只读无建目录/写档/出站 |
| 概率与原观察 | 概率核心/持久存证18/18、原观察19/19通过；包含96MiB档案读取、两进程竞争、嵌套非正式样本、来源切换、迟验预算与已知修订冲突 |
| 原结算/诊断/导入 | 最后专项25/25通过；新增原身份、精确分价、同事件改摘要、冲突隔离及合法FIFO残差覆盖；最终全量包含后续无效冲突声明复核 |
| 模型治理 | 两个治理文件18/18通过；失败审批仍持久收口、封存后改证据失效、完整计划分母、原风险回读合同及FIFO/事件身份覆盖缺口 |
| 原研究浏览器 | Chromium143/Playwright1.57.0，1366×1000桌面 `/` 与390×844手机 `/m` 均通过；溢出0、页面错误0、查看者私有读取0、意外写入0；仅有两次明确的隔离反馈提交操作 |
| 原全界面浏览器 | `fayo-browser-check.js` 的8场景、320/390/402/768/1366/1920六宽度通过；页面横向溢出0，原导航/查询/权限撤销及只读边界保留 |
| 修改完整性 | `git diff --check`通过；原HANDOFF与DEPLOYMENT的2026-11-25发布正文逐字节保留，无删除文件；不提交运行数据、截图、日志或安装包 |

全量使用与原 `.github/workflows/v6-ci.yml` 一致的两路并发及单线程数学库：

```bash
fayo_regression_tmp=$(mktemp -d /tmp/fayo-regression-private-XXXXXX)
trap 'rm -rf -- "$fayo_regression_tmp"' EXIT
chmod 700 "$fayo_regression_tmp"
RUNNER_TEMP="$fayo_regression_tmp" V6_NATIVE_PYTHON=/usr/bin/python3 \
V6_MODEL_PYTHON="$CODEX_PRIMARY_RUNTIME_PYTHON" V6_TEST_CONCURRENCY=2 \
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

本地Node为24.22.3，模型Python具有原要求的scikit-learn1.8.0。4项原可选跳过为实际PowerShell wrapper、五模型比较、LightGBM与XGBoost测试；没有将跳过计为通过，精确HEAD的原CI另验证这些环境。首轮18项环境失败来自符号链接 `/var/tmp` 与误选无sklearn的轻量Python；修正后默认六路并发曾有1项原启动时序失败，其单文件25/25复验通过。最终使用原CI配置全量通过，未改动这些测试、启动超时或安全门禁。

所有逻辑、HTTP、浏览器测试使用隔离数据。原包与恢复流程由原CI另核对；生产来源、成熟样本、真实收益、实际消息到达、物理设备与目标节点冷备仍未验收。各组合并后的最终版本仍需重新完整验证。

## 恢复与部署边界

源码恢复点为本组改前dev SHA及PR内前序提交；当前目录是完整git源码。新增研究存证与原 `research.json`、信号/观察档案随原私有卷冷备，不对账户现金/持仓记账。回切前停原写者，保全新增试验与修订证据，在隔离副本核对旧程序兼容；不得用旧账本覆盖新流水。若已出现新模型批准，必须按原审批版本与对应完整程序恢复，不把数值模型权重解释成旧标签权重。

本组未执行生产部署或最终合并。第一组以最终dev精确SHA及目标节点完整程序/私有卷回执作为发布依据。

## 前序增量记录（历史）

以下保留早期实现记录；关于审批可用性、固定窗口、验证状态和来源能力，以本文上方最新合同为准。

## 增量二：原研究报告接线

07/09：原 unified-strategy-project 将同一股票池交易日与行情审核传入 strategy-health-monitor。按两个 20 日窗口，中间隔离 2 个交易日（本回放标签为第二个交易日开盘），排除末尾未成熟两日。每窗至少 20 笔估算、10 个有效信号日和 80% 规则观察覆盖，按信号日等权，最近为负且变化不高于 -1 个百分点时提出纸面表现复核。不声称统计显著性，行情不足、样本不足分别返回未知，实际成本、因子、环境、执行偏差未同范围关联时不认证策略衰减。该阈值为保守研究默认值，不是生产阈值。

13：原 intelligence-execution-validation 各成本情景追加 attribution，从已经校验的原结算凭据拆分实际价格盈亏、原费用、净盈亏、勾稽残差；另列假设追加费用/滑点压力结果。不重新记账。缺连续权益、指数/行业、仓位、委托和时间证据时相应归因为 null。接口供风险组读取，不能当作账户收益。

新增 tests/fayo-research-diagnosis.test.js 供原 CI 执行。提交前用同一纯函数体在隔离 JS 运行时执行 8 个逻辑断言，全部通过；不是 Node 全量测试，也不是真实市场研究。上述新增接线尚需精确 HEAD 的 CI 与现场证据核验。


## 增量三：原中心与审批接线

- 07/09/24：原智能中心新增 governance；按互不重叠样本外窗口与共同股票范围比较同定义因子分布及 IC；至少10个有效日、5只横截面、80%覆盖，IC下降0.05且当前为负或标准化均值偏移1倍作为复核线索。当前质量、分布、IC 与成本压力分别标注，非因果衰减认证。原95项目录与模型/冗余定义保持；低覆盖/冗余仅给审查线索，不自动停用。
- 10：沿原结算分趋势、情绪和策略投影，保留原环境名与缺数。样本外环境因子统计来自原 walk-forward strata；不能将相关关系当作适配因果，风险阈值不变。
- 12/28：正式档案的已获批数值模型升级必须先通过原五关，再由原锁内人工批准入口检查候选创建之后的共同成熟净结算。仅同一冻结向量、明确模型指纹、原结算、相同股票日集合、相同选取数量和成本可比；至少20个有效日/60行且原风险范围的压力对照支持增益。旧模型首次建立仍沿原五关；已获批旧版本不改写。结算队列对照不是全市场成交或连续权益认证；完整风险仍需原风险组。缺证据保持当前版本。
- 13：原执行验证增加按策略分组及现有费用/结算归因同屏入口。市场/行业/仓位/实际滑点/延迟/未成交仍需风险组权益与执行证据，不填造。
- 21：双端共用 intelligence-view 增加研究治理卡及四类概率语义。尚未把全部旧通知与概率来源逐一认证。
- 测试：提交前隔离 JS 对两个纯算法执行6项断言通过。新增 fayo-research-governance.test.js 进入原 Node 测试集合。正式 CI、原 HTTP、两端浏览器与真实成熟证据仍须精确 HEAD 回执，不使用旧提交结果代替。
