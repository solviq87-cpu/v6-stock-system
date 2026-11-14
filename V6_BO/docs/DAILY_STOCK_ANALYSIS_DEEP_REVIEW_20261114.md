# daily_stock_analysis 深度源码审查与 V6 借鉴路线

审查日期：2026-11-14。用户本轮要求先深挖参考项目，网页登录与飞书现场检查暂缓。本批只形成研究结论和实施验收条件，没有新增运行功能、调用收费模型、发送消息或发布网站。

## 1. 固定证据与结论

- 上游：[ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis/tree/70f250597e9a2b0afe2d7dd6b992c90926916105)，固定 SHA `70f250597e9a2b0afe2d7dd6b992c90926916105`。
- V6 对照基线：`dev@9251e27d718e52ca2568f17b1c360ecae8a69102`，包含 #213 清单导入、#214 冷启动恢复和 #215 验证回执。
- 方法：本地只读上游源码、关键函数、数据契约、测试文件和支持范围文档；与 V6 对应模块逐项对照。功能存在、测试存在、测试通过、生产有效是不同层级。
- 核心判断：最有价值的是把“数据证据→不同策略判断→分歧→失效条件→结果复盘”连接成完整的个股研究过程。V6 已有冻结证据、四体系比较、观察日志和影子研究基础，宜补齐共同契约与使用入口。
- 本文“缺口”指本次读取范围内尚未见到同等完整串联，不代表断言整个 V6 没有任何相关功能。收益、实时行情可用性、模型回答准确率和生产性能均未在本轮验证。

## 2. 十六项值得借鉴的能力

P0/P1/P2 是本轮研究候选的先后顺序，不覆盖原有报价、账户及现场验收优先级。U 为上游根目录；V 为 V6 仓库根目录。所有路径按上述固定版本读取。

| 编号/优先级 | 上游代码中实际具备什么 | V6 已有基础 | 建议补齐与验收重点 |
| --- | --- | --- | --- |
| D01/P0 统一证据卡 | U `src/schemas/analysis_context_pack.py` 与 `src/services/analysis_context_builder.py` 按字段保存来源、时间、回退、缺失原因及 available/stale/partial 等状态；构建器复用已采集结果 | V `V6_BO/src/core/research-evidence-bundle.js` 已有归档引用与哈希；`research-risk-center.js` 已有支持/反对/缺失依据 | 做统一只读证据视图；每条结论可展开原始来源和版本。展示不重复采集，不把缺失当0，不用接收时间刷新行情时间 |
| D02/P0 决策生命周期 | U `api/v1/schemas/decision_signals.py`、`src/services/decision_signal_service.py` 保存触发、失效、观察条件、期限及 active/expired/invalidated/closed/archived 状态；新反向判断可使旧判断失效 | V `V6_BO/src/core/research-watch-journal.js` 已有观察阶段与幂等日志；`stock-intelligence-memory.js` 已有冻结预测及结果 | 串成同一股票的判断时间线：当时为何关注、现在哪些条件改变、下一次检查什么。过期信号不继续显示可执行，不覆盖旧记录 |
| D03/P0 策略分歧说明 | U `src/agent/skills/synthesis.py` 检测方向冲突、分散和高置信反对；`aggregator.py` 汇总意见 | V `V6_BO/src/strategy/rule-comparison.js` 已独立显示十四条/八字/GPT/Python 的通过、失败、未知和覆盖率 | 在原比较上增加“共同支持/主要反对/证据不足”的解释。保持四体系独立，不能直接搬上游综合分数阈值作为交易依据 |
| D04/P1 筛选淘汰漏斗 | U `src/services/screening/filter.py` 的 `hard_filter_waterfall` 按顺序记录 before/after/removed、淘汰样本及实际字段值 | V 既有条件命中与策略比较能够解释入选；统一逐级淘汰视图仍值得补齐 | 回答“为什么今天只剩这几只、某只为何落选”；区分未满足、未知和不适用。不能为了凑满推荐数自动放宽门槛；各阶段数量必须对账 |
| D05/P1 策略适用场景卡 | U `src/services/screening/models.py` 定义风格、周期、市场状态、风险、所需数据；`src/agent/skills/router.py` 按请求及市场状态挑选分析视角 | V 四体系、研究规则和因子健康已有基础 | 每套策略显示适合行情、预计观察周期、必要字段、失败条件和样本。先做说明与适用性检查，暂不自动切换生产权重 |
| D06/P1 成长质量与事件预期 | U `strategies/growth_quality.yaml`、`event_driven.yaml`、`expectation_repricing.yaml` 提供营收/利润/现金流质量、催化和预期差分析框架 | V 已有新闻证据与研究因子；这些经济维度需核对真实字段覆盖后逐项扩展 | 先验证财报发布时点、可得日期、事件来源和旧闻去重，再做独立研究因子。模板中的主观加减分不能当作已经验证的因子权重 |
| D07/P1 市场→题材→个股位置 | U `src/schemas/market_structure.py`、`src/services/market_structure_service.py` 串联主题阶段 warming/accelerating/cooling 与 leader/follower/edge/unknown；当前实现有 A 股范围限制 | V `V6_BO/src/strategy/daily-sector-strength.js`、`sector-relations.js` 已有板块强度、关联与资金证据 | 增加“主线是什么、题材处于什么阶段、这只票处于什么位置”的解释卡。龙头身份需具体证据；不能只凭涨幅最大命名龙头 |
| D08/P1 盘前/盘中/盘后行动清单 | U `src/phase_decision_guardrail.py` 补充行动窗口、当前动作、观察条件、下次检查及数据限制；质量差时收敛报告建议 | V 已有交易日历、时段和行情消费门禁 | 把用户要求的“今天能做/不能做/观望/减仓条件”放到研究详情；报告建议必须经过 V6 原有风控，文本 guardrail 不等于订单门禁 |
| D09/P1 历史报告比较与重评预览 | U `src/services/history_comparison_service.py` 对照近期报告日期/建议/分数；`decision_signal_reassess_service.py` 默认从保存的上下文预览重评，不拉新行情，明确请求且守卫通过才持久化 | V 冻结证据、修订链、观察日志已有基础 | 增加“昨日/本次变化”与依据差异，原结论、新证据、重评版本分别展示。上游当前历史比较不是完整因果解释引擎，V6 的变更原因需要自行实现 |
| D10/P1 策略成绩单 | U `src/services/skill_opinion_weight_service.py` 按归属明确的结果和观察周期限幅调权；无效或不足样本保持中性 | V `V6_BO/src/core/factor-shadow-evolution.js`、`factor-learning-reliability.js` 与 `V6_BO/src/strategy/research-rule-weight-review.js` 已有影子研究和验证约束 | 展示样本数、周期、命中/失败/无法判定与版本；保留原影子验证后再考虑变更权重。命中率不是账户净收益，也不是涨停概率 |
| D11/P1 持仓防守视图 | U `src/services/portfolio_risk_service.py` 汇总行业集中度、回撤、止损和所持股票的有效防守信号；股票身份含市场 | V 风险中心、持仓审查、账户隔离和私密投递已有实现 | 统一展示“为什么该关注风险”和触发证据；沿用既有账本，不新建第二套账户。成本、币种或行情未知时不能伪造浮盈亏 |
| D12/P1 提醒原因与状态 | U `src/services/alert_worker.py` 区分命中、冷却抑制、缺数/退化、通知尝试、成功；触发落库先于通知 | V 飞书队列、回执、幂等及未知送达保护已有基础 | 做可读状态链：规则命中→证据门禁→入队→渠道回执，并显示没推送的原因。不能把请求成功当对方收到，也不因不明送达自动重发 |
| D13/P1 一次分析的诊断记录 | U `src/services/run_diagnostics.py` 统一 trace_id、数据源回退、时延、模型调用、通知及存储结果，处理错误脱敏 | V 多源请求治理、来源状态和各模块日志已有基础 | 统一“卡在哪里”的诊断页：无行情、源超时、备用失败、证据不足、保存失败分别显示；凭据和完整私有仓位不可进入公共日志 |
| D14/P1 有边界的会话记忆 | U `src/agent/chat_context.py` 保存覆盖到哪个消息的滚动摘要、保护最近轮次、限制 trace 预算、并发摘要比较后写入；摘要失败使用已有状态回退 | V `scripts/resume-context.js` 与 `HANDOFF.md` 已有有界开发续接；应用问股会话是不同层次 | 借鉴“稳定约束+结构化摘要+最近对话+按需证据”，保留标的/周期/时效/未决事项。可先做确定性摘要，不启用受限或收费模型；不能声称改变 ChatGPT 平台上下文上限 |
| D15/P2 表格/OCR/证券名称导入 | 上游有图片、Excel/CSV/文本入口及证券解析；详见首轮对照报告 | V #213 已实现 CSV/TSV/TXT/粘贴预览、去重和逐只选择 | 后续原生 Excel、名称/拼音补全、OCR 必须先预览再确认证券身份。股票代码前导零、跨市场重名、公式与超限均需拒绝或明确提示；OCR 不应直接写持仓 |
| D16/P2 多市场与性能隔离 | U `docs/market-support.md` 明确市场差异；`data_provider/base.py` 有超时任务隔离和在途槽位保护；`src/agent/orchestrator.py` 并行技术/情报阶段并有序归并 | V 外部市场背景、请求预算、取消与冷启动恢复已有基础 | 多市场先补身份/日历/时区/币种/复权契约。采集并行必须保留源配额、总期限和上下文隔离；不能以增加线程数掩盖供应商阻塞 |

## 3. 真正新增的研究维度，与不能直接照搬的内容

### 3.1 两套策略目录不是同一类东西

`strategies/*.yaml` 此版本共有 **15 个 Agent 分析模板**：缠论、箱体、底部放量、情绪周期、预期重估、龙头、波浪、缩量回踩、多头趋势、放量突破、均线金叉、一阳穿三阴、热点题材、成长质量、事件驱动。它们规定如何使用工具、解释和打分，不构成“15套已通过样本外验证的交易系统”。

另有 `src/services/screening/strategies/*.yaml` **10 个规则筛选配置**：momentum_quality、dual_low、quality_value、shrink_pullback、low_volatility_quality、volume_breakout、balanced_alpha、capital_heat、oversold_reversal、blue_chip_income。其流水线先硬过滤和本地因子评分，再可选模型排序/分析。`ranker.py` 约束只能在已有候选中排序，失败回退本地分数；不能借模型增加股票或绕过硬过滤。

对 V6 更有增量价值的是成长与现金流质量、事件预期变化、条件不满足的解释，以及按市场状态分层复盘。均线、量价类名称先与原四体系去重。配置里有防守/蓝筹策略，不应擅自改变现有选股偏好。

### 3.2 自学习、置信度与回测的边界

- 运行中的 `SkillOpinionWeightService.compute_weights` 使用 15/15 先验及至少30个有效结果的约束，将倍率限制到约0.8333～1.2。当前提交还新增 `compute_smoothed_weights`，但聚合器仍调用前者；不能把新增辅助方法说成生产已切换的算法。
- V6 的影子验证、冻结特征、成熟样本和版本治理应保留。上游主观置信度、情绪分数与“推荐后涨跌是否命中”不是经校准的涨停概率或成本后收益。
- `src/core/backtest_engine.py` 是基于历史建议与未来日线的评估器；同根日K同时碰止盈止损时记录 ambiguous 并保守按止损先发生处理。可借鉴歧义标注，不能替代 V6 的账户回测、A股T+1、涨跌停、交易成本和滑点。

### 3.3 运行保护不是每条路径都一样

- `data_provider/base.py` 对超时线程保留在途槽位到实际退出，并隔离同类未完成请求；相关测试覆盖反复超时、配额占用和剩余期限。
- `src/services/screening/source_guard.py` 的普通包装器用 daemon thread 与有界 join 使调用方及时返回，但不能强杀阻塞线程。不能据此断言所有上游采集都具备统一硬取消。
- 技术/情报并行采用 `copy_context()`，主线程按固定顺序合并；上下文容器有克隆，但不应未经审计就假设所有嵌套对象深度隔离或所有任务可强制中止。
- 新闻发布日期与抓取时间分开有价值；上游部分新闻路径可保留日期未知项。V6 仍须把它们标成未知，不能当作刚发布的实时利好。

### 3.4 多市场和授权需要按模块看

市场支持文档明确，日/韩覆盖不等于全市场实时行情、完整基本面/行业广度或完整跨币种成本核算。不能只加市场下拉框就宣称完成六市场研究。

根许可证为 MIT；但 [THIRD_PARTY_NOTICES.md](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/THIRD_PARTY_NOTICES.md) 明确 `src/services/screening/**/*.py` 和策略 YAML 派生于 AlphaSift，采用 Apache-2.0 并带第三方声明。后续若移植实际代码，应按相应文件保留许可/来源/修改说明；本批只做分析，没有复制上游实现进入 V6。

## 4. 建议实施批次与可执行验收

### 批次一：证据、时间线、分歧（D01～D03）

先定义只读契约并复用现有档案，再接入既有研究详情。两个锁定主页不改；电脑和手机消费同一记录。不需要新增模型 API。

1. 每项证据包含证券身份、来源引用、原始事件/报价时点、接收时点、状态、失效原因及档案版本。未知不能自动升级成可用；`quoteAt` 不可用 `receivedAt` 替换。
2. “昨天关注、今天观察/失效”的变化必须指向具体字段变化与对应版本。旧报告重评是新版本，禁止把今天数据写回昨日证据；预览不写入、不推送。
3. 四体系各自显示通过/失败/未知；高分不能覆盖反对条件或数据缺失。不凭空构造统一胜率，不改变生产排序或账户权重。
4. 专项覆盖：空/部分证据、过时/未来报价、新闻撤回、相反观点、重复事件、同ID不同内容、旧版本迟到、终态复活、时间线切股竞态、权限撤销和手机布局。
5. 增量实现后才执行受影响专项、全量、网页及真实视口检查；发布仍走唯一发布者和实际回读。

### 批次二：选股过程与市场解释（D04～D09）

筛选每步数量必须与实际 mask 一致，缺数不得计作条件不满足；题材/个股角色必须有来源及日期；盘前/盘中/休市采用同一日历，休市不生成可交易实时判断。新增财务因子先证明当时可得日期、防未来与样本外表现。报告对比须展示来源不同、评分变化和未知项，不能直接将分数增加解释成基本面改善。

### 批次三：复盘、持仓、提醒、诊断（D10～D14）

按策略版本、市场状态、预测周期分桶展示实际样本；未到观察期与无法判定单列，不进入成功分母。私密持仓的信号只对授权用户展示；提醒以现有发送意图/回执为准，未知送达保持原处置。诊断按一次分析串联阶段与失败原因；摘要保留未决条件、覆盖消息边界及并发修订保护，原始档案不删除。

### 批次四：便利性与跨市场（D15～D16）

原生 Excel/证券补全优先于需模型的 OCR；先验证准确性再开放写入。跨市场先做数据契约和能力矩阵，不扩交易范围。Python 采集只在发现实际超时泄漏路径后定向补在途/限流保护，并用真实故障注入验证。

## 5. 本轮检查、未测范围与恢复

- 上游审阅的测试包括：`tests/test_analysis_context_pack_schema.py`、`test_analysis_context_builder.py`、`test_decision_signal_service.py`、`test_decision_signal_data_quality.py`、`test_screening_explanations.py`、`test_market_structure_service.py`、`test_skill_opinion_weights.py`、`test_portfolio_pr2.py`、`test_run_diagnostics_p1.py`、`test_run_diagnostics_p2.py`、`test_chat_context.py`、`test_agent_parallel_discovery.py`、`test_fundamental_timeout_guard.py`、`test_search_news_freshness.py`、`test_search_retrieval_time.py`、`test_backtest_engine.py`。部分阅读关键断言，部分只核查用例名称；不称为完整测试审计。
- 曾尝试主运行环境 Python 执行 `-m pytest tests/test_decision_signal_data_quality.py tests/test_analysis_context_pack_schema.py tests/test_analysis_context_builder.py -q --tb=short`，环境报 `No module named pytest`，未进入测试。未安装上游全套依赖，未验证其运行/端到端或联网数据成功率。
- 本轮仅文档，执行 `git diff --check`、源码路径/策略数量核对与有界交接检查；V6 运行源码不变。本批没有重新运行业务全量，不能把已有 #214 的3397项远端成功写成本轮新结果。
- 既有清单导入 #213 已合入；第一轮报告中的本地失败是当时记录，后续远端通过状态应结合 PR #213/#214 的精确提交回执阅读。该功能不会让单文件静态网站自动拥有完整后台。
- 回滚：只撤销本批文档提交，保留已有业务代码、账户和历史；后续实施另开小批代码变更。网页登录、飞书实际送达和现场验收仍保留待办，本报告不将其关闭。

## 6. 固定版本源码入口

| 主题 | 上游固定链接 |
| --- | --- |
| 证据契约 | [analysis_context_pack.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/schemas/analysis_context_pack.py) |
| 决策字段 | [decision_signals.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/api/v1/schemas/decision_signals.py) |
| 分歧归纳 | [synthesis.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/agent/skills/synthesis.py) |
| 筛选淘汰过程 | [filter.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/services/screening/filter.py) |
| 题材与个股位置 | [market_structure_service.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/services/market_structure_service.py) |
| 权重约束 | [skill_opinion_weight_service.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/services/skill_opinion_weight_service.py) |
| 会话摘要 | [chat_context.py](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/agent/chat_context.py) |
| 市场边界 | [market-support.md](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/docs/market-support.md) |
