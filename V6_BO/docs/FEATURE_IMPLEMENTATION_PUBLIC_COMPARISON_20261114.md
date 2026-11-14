# 八类功能落实核验与公开项目综合对照

核验日期：2026-11-14。工程基线：`dev@9d15c034177445c071b32cb2a5b2226f656b46eb`。

**结论：八类都有相关基础，但不能说八类已经完整落地。** 证据、时间线、分歧和筛选过程已在研究页接入；覆盖范围比用户描述窄。市场题材角色、四体系完整成绩、统一持仓防守、跨分析会话与全程诊断仍需补闭环。本轮实际交付为核验报告、16个公开来源记录及可执行待办，不把建议当成新增运行功能。

唯一完整后端入口仍是 `/research.html`；有编辑/读取权限及所需数据才可使用。仓库存在、专项通过、已合并、已部署、真实业务验收是不同状态。本轮没有生产访问/写入、真实账户读取或外发消息。

## 1. 版本与证据口径

- #219 已合入当前基线，原实现记录见 [个股研究详情](RESEARCH_DECISION_REVIEW_20261114.md)；不是再造一套同名功能。
- [PR #221](https://github.com/solviq87-cpu/v6-stock-system/pull/221) 的XLSX与三仓库报告、[PR #222](https://github.com/solviq87-cpu/v6-stock-system/pull/222) 的资金/220持仓容量修复，在本轮开始核验时均未合并，不能算作当前dev已有能力。历史文本/CSV导入仍在。
- 本轮直接检查源码、页面加载/调用点及边界断言；18个相关测试文件分两组实跑 **71/71、49/49，总120通过、0失败、0跳过**。这只支持相应工程行为，不代表八项生产验收通过。
- 对照16个公开项目/官方文档，固定源码与许可记录见 [来源清单JSON](PUBLIC_COMPARISON_SOURCES_20261114.json)。实际阅读关键段，不是完整审计；没有安装/执行上游软件或复制其实现。
- 既有两张主页、四体系、账户历史、15秒原报价门禁、唯一发布者与原24项现场验收保持原约束。

## 2. 逐项核验用户提出的八类功能

下表中的“已接入”指源码和研究页存在实际调用，不表示生产或现场已验收。

| 编号 / 用户目标 | 已落实的代码与入口 | 仍缺什么 / 当前判断 | 复用位置与下一条验收 |
| --- | --- | --- | --- |
| UX-E01 统一证据卡：每条结论看来源、时间、支持/反对/缺失 | [投影](../src/core/research-decision-review.js) `buildDecisionReview` 绑定股票/来源/观察哈希；`summarizeConditions`分三类条件；[页面](../public/assets/research-decision-review.js)折叠展示。研究页“按代码采集并记住K线”→“采集并研究/读取已存历史”→“个股判断与证据” | **已接入，未全覆盖**：日K/形态/日历/上下文/封存引用可看；条件与证据卡分开，尚不是每条结论都带逐字段原时点/直接可定位原文。来源时刻未知会保留未知，不等于原文已认证 | 复用 `research-evidence-bundle`、`signal-evidence-chain`；每条结论绑定证据ID和版本，支持/反对必须能回到对应字段与时点，不借其他股票/今日资料替旧证据 |
| UX-E02 判断变化时间线：具体是哪项条件变了 | 同投影 `buildHypothesisTimeline`；现有不可变假设/首次结果/修订档案生成最近50条，并保留总数与截断提示 | **已接入，范围有限**：目前主要是原始日K收盘相对开盘研究；比较prediction/state及新增/消失形态。尚不是四体系所有判断的条件数值变化、变更原因、过期/主动失效完整时间线；不同目标日差异不是因果说明 | 复用 `price-event-research-agent`、`stock-intelligence-memory`，补“条件A原值→新值/证据版本/有效期”。同目标周期才直接比较，规则改版与数据改版分开；不改写首次评价 |
| UX-E03 策略分歧：谁支持/反对、依据何在 | [四体系对照](../src/strategy/rule-comparison.js)返回原条件；`summarizeRuleDisagreement`形成解释；研究页“四套体系·独立规则对照”→“查看规则命中与覆盖率” | **已接入，但仍需提供研究上下文**：部分体系缺输入或Python来源/日期就不可用；八字pass是评分证据覆盖，不是看多票。原页面部分条件有实际值/阈值，但摘要不能替代四体系同股同日、相同观察周期的统一来源链 | 不合并四套评分；补语义映射与字段引用。不同周期的观点不能制造“投票冲突”，缺数不能算反对；由同一冻结股票快照驱动对照 |
| UX-E04 筛选淘汰：为什么选中、某只为什么落选 | [原扫描器](../src/strategy/universe-scanner.js)、[v2扫描器](../src/strategy/research-v2-universe-scanner.js)都调用 `buildScreeningFunnel`；研究页扫描后展示质量→风险→策略→资格数量。完整items保留逐股判断 | **已接入本次输入池**：每股只在首次淘汰计数，unknown单列。页面每步最多5个样本；不等于全市场、可分页、可按任意代码检索的完整落选档案。完整items虽可供查阅，尚不是持久化的“为什么没选我”查询入口 | 在已有items之上建 `runId+证券+首个原因+其他已知原因`索引；数量对账、不静默截断、不为凑推荐数放宽条件。未进入输入池必须回答“本轮未评估” |
| UX-E05 市场—题材—个股关系 | [板块关系](../src/strategy/sector-relations.js)、[采集桥](../src/core/sector-relations-capture-bridge.js)、`daily-sector-strength`已有同日/成员/连续窗口及相关性研究。详情可展示最多6个有同日时点证据的板块 | **部分实现，角色/阶段未落实**：详情明确写 `marketPosition.role='unknown'`、`phase='unknown'`。板块间相关/成员重合/资金方向不证明题材升温、主线因果或个股龙头地位 | 先有按当时成员组成冻结的连续板块资料，再定义可复核升温/降温和位置条件。未满足就未知；不能按涨幅第一直接称龙头，不能把行业与炒作题材互换 |
| UX-E06 策略成绩单：体系×环境×周期的实际结果 | 详情scorecard展示冻结日K匹配/Brier/独立目标日。[前向审核](../src/core/forward-rule-audit.js)已分system/cohort及1/5/20/60日，区分待到期/停牌缺价/公司行为；[权重人工复核](../src/strategy/research-rule-weight-review.js)已有成本后研究与环境覆盖门禁；`performance-statistics`已有净值/回撤/胜率区间 | **基础较多，统一目标未完成**：研究详情不是四体系净收益榜；价格观察、冻结方向命中、含成本回测、权威模拟账本是不同统计对象。未核实有把四体系版本×行情环境×周期连到同口径基准/实际成交的统一报告页 | 先索引原结果再做同条件对照。列样本、独立股票/交易日、未成熟、未知、费用、滑点、基准与覆盖；不拿不能成交的推荐按理想价算赚钱，不因小样本给盈利排名 |
| UX-E07 持仓防守：风险、集中度、失效信号集中看 | [只读风险中心](../src/core/research-risk-center.js)和[页面](../public/assets/research-risk-center.js)已有手工成本浮亏/申报权重、来源质量、新闻修订与缺口。研究页“读取现有风险证据”；另有[持仓形态](../src/strategy/holding-signal-evidence.js)、`holdings.js`及原账户风控 | **部分实现，资料与视图仍分散**：风险中心主要读独立手工观察文件，不等于实际账户；未接好所有持仓原入选理由/当前失效条件/行业与相关主题暴露的同屏归因。#222超容量改进尚是候选 | 复用原权威账本和风险链做只读联接，不新建账户。成本/权重/板块未知单列；到期/失效与价格风险分开；保留锁仓、静默、私密权限和超限未覆盖提醒 |
| UX-E08 会话记忆与任务诊断 | `stock-intelligence-memory`已有版本化股票记忆；详情有行情观察/归档/记忆/冻结/复访五阶段，按钮生成≤4000字符只读摘要；`factor-research-agent`有规划/失败/继续条件；根`context:resume`用于开发续接 | **部分实现，不是通用问股会话系统**：摘要未形成应用层跨会话约束存储；五阶段显示不是统一runId下完整耗时、回退、失败位置和安全重试记录。开发HANDOFF不能代替用户会话记忆，也不能改变ChatGPT上下文上限 | 分开保存“用户稳定约束”“本次研究状态”“不可变原证据”。统一trace/run及阶段结果；失败应显示行情/分析/封存/复访哪步未完成，重启续接不重复通知或写账户 |

相关行为已测：错股/错来源/未来证据拒绝、真实0与未知、旧假设不能借新证据、八字不变看多票、到期缺证据不计失败、首次结果修订保留、50条截断、同日板块、漏斗数量对账、权限/页面清空、前向周期样本数与持仓双源冲突。**这些断言没有补出表中尚缺的功能。**

## 3. 公开来源比较：借鉴什么，为什么适合V6

S编号对应JSON固定版本与实读路径；网页按本次访问日核验，不能视为不可变版本。源码许可证只覆盖相应软件，不自动授予数据或商业服务使用权。

| 来源 | 本轮抽样实际见到的机制 | 对V6的帮助及取舍 |
| --- | --- | --- |
| S01 [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis/tree/70f250597e9a2b0afe2d7dd6b992c90926916105) | 证据字段来源/时间/缺失与fallback、一次运行诊断的trace与脱敏错误 | 补UX-E01/08完整引用和阶段诊断。前次16条借鉴不能原样再宣称全新；不搬模型置信度和提示词分数当收益 |
| S02 [Qlib Recorder](https://qlib.readthedocs.io/en/stable/component/recorder.html)及P/PRef源码 | 实验→单次Recorder分层；财务周期值按当前可知时点加载 | 做统一实验目录和财报历史版本引用；复用V6档案，不另存第二套指标真相，不接其自动训练/上线逻辑 |
| S03 [QUANTAXIS重采样源码](https://github.com/yutiansut/QUANTAXIS/blob/232aa7ac9869966108f02a8fff85f1f7b09a9ce2/QUANTAXIS/QAData/data_resample.py) | 显式交易时段与左右边界的tick/分钟聚合 | 借鉴周期/午休/收盘边界用例，沿用V6现有K线契约；不能由粗K造细K或用复权研究价成交 |
| S04 [Qbot回测示例](https://github.com/UFund-Me/Qbot/blob/f0425ae4ae8bd02b79656b8f7039f4cd6874095e/qbot/engine/backtest/backtest_base.py) | 信号收益、基准与图表层次 | 借鉴同日期基准对照展示；示例不能代替V6真实费用/滑点/涨跌停/T+1/权威账本 |
| S05 [QuantConnect研究指南](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide)与LEAN分红/拆股事件 | 提醒幸存者/前视偏差，事件有明确日期/分红额/参考价/拆股因子 | 强化历史成分、公司行为以及回测与模拟成交差异说明；不因框架支持某资产就默认V6具备A股覆盖或数据许可 |
| S06 [Freqtrade前视检测](https://www.freqtrade.io/en/stable/lookahead-analysis/)及[递归检测](https://www.freqtrade.io/en/stable/recursive-analysis/) | 比较基线和切片结果；更换预热K线数检查指标漂移 | 将“追加未来数据不得改过去”“预热长度敏感性”整理成统一策略诊断，保留已有防未来测试；不引入其加密货币成交规则。检测有漏检/假阳性边界，不是无偏证明 |
| S07 [Ghostfolio规则目录](https://github.com/ghostfolio/ghostfolio/tree/f58465aea78dd0c386cf9bcde5a22fbcf508911a/apps/api/src/models/rules) | 账户/币种/资产等聚合风险及费用占投资额规则 | 借鉴风险按暴露来源分组与费用拖累解释；V6先补A股行业/主题集中度，无需引入币种或账户引擎，不照搬阈值 |
| S08 [Portfolio Performance绩效](https://help.portfolio-performance.info/en/concepts/performance/)与[分类体系](https://help.portfolio-performance.info/en/reference/view/taxonomies/) | 区分现金流影响的资金加权与时间加权回报，并按资产分类看组合 | 若原账户未来有入出金，先区分投资者回报与策略回报；把行业/主题/策略来源作为可追踪分类，不用净入金冒充盈利 |
| S09 [OpenBB组件说明](https://docs.openbb.co/workspace/analysts/widgets/overview)与核心Fetcher | 组件携带来源/参数/展示元数据；相同参数联动；查询/采集/转换分层 | 单股证据/K线/板块统一证券及截止时点，减少切股错配；不为拖拽仪表盘重做锁定主页。当前核心许可证不能推定Workspace UI可复制 |
| S10 [Evidently数据漂移](https://docs.evidentlyai.com/metrics/preset_data_drift) | 用当前与参考数据比较分布，支持逐列指标与测试 | 将V6已有输入质量/均值漂移扩成来源故障、股票池变动与分布变化的分项诊断；漂移是代理迹象，不等于收益衰减，不自动调权 |
| S11 [MLflow实验记录](https://mlflow.org/docs/latest/ml/tracking/)与Dataset源码 | 实验运行、参数/指标/产物；数据集有source/digest/schema/profile | 补研究run目录、同数据/规则版本比较和可复现导出；可以用现有本地索引完成，不必部署MLflow服务 |
| S12 [OpenLineage对象模型](https://openlineage.io/docs/spec/object-model/)与版本/错误facet | 区分Job、Run、输入/输出Dataset及版本、失败信息 | 在证据哈希基础上加输入→变换→结论依赖边，回答上游修订影响了哪些旧报告；不强制接外部元数据平台 |
| S13 [OpenTelemetry trace](https://opentelemetry.io/docs/concepts/signals/traces/) | 一个trace串联父子span、时间、事件与状态 | 用户直接看到一次分析卡在采集、计算、保存还是复访；先本机结构化诊断，不安装云端收费监控，不把token/完整持仓写span |
| S14 [LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)与[中断恢复](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | 线程检查点与跨线程存储分开；暂停可恢复，节点恢复可能从头执行 | 借鉴稳定约束、运行检查点和可重放副作用分离。V6不需要接聊天模型；内存Saver不等于重启持久化，保存不能替代幂等保护 |
| S15 [GX Core](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/) | 将数据批次、约束集合与校验结果明确关联 | 把现有行情/财务/成员/新闻验证器结果统一成可读质量报告；保留失败门禁，借鉴格式即可，无需引入整套Python依赖 |
| S16 [TradingView回放](https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/)与[筛选模板](https://www.tradingview.com/support/solutions/43000718804-how-to-create-save-and-update-a-custom-screen/) | 历史逐步回放；保存筛选条件、列、排序，另有[撤销/重做](https://www.tradingview.com/blog/en/screener-autosave-undo-58224/) | 借鉴“回到当时只能看到当时资料”、可恢复筛选配置。保存条件与冻结结果必须分开；其商业数据/回放权限不自动可用，不采购或复制界面 |

许可证取舍：本次固定根文本核对Qlib/QUANTAXIS/Qbot/LangGraph为MIT，LEAN/Evidently/MLflow/OpenLineage/GX及本次OpenBB核心为Apache-2.0；Freqtrade为GPL-3.0、Ghostfolio为AGPL-3.0、Portfolio Performance为EPL-1.0。实际移植必须另核文件头/依赖/第三方声明；本轮均为独立总结，没有复制上游实现。GitHub按仓库ID返回OpenBB与GX的当前canonical owner已记录，未凭旧名称猜版本或许可。

## 4. 综合后新增/增强候选清单

**以下24项是可评估待办，不是24个已实现功能，也不是24个全部缺失功能。** “补闭环/增强”表示已有基础；“新增入口/契约”只指本轮未核实同等统一实现。按收益帮助、证据门槛、开发与运行成本筛选；P1/P2不覆盖原报价/账户P0。

| ID / 优先级 | 值得借鉴的功能与实际帮助 | V6已有基础 / 应接何处 | 最小验收与约束 | 来源 |
| --- | --- | --- | --- | --- |
| REF-01 / P1 | 证据血缘与修订影响：看到这条结论依赖哪些原文/行情版本 | 补闭环：`research-evidence-bundle`、`signal-evidence-chain`、新闻修订 | 每结论可定位输入哈希、字段与转换版本；上游修订只标受影响，不改旧报告 | S01/12 |
| REF-02 / P1 | 按历史可知时点查财报/成分：防今天资料回答昨天 | 增强：`public-stock-financials`、`sector-member-identity-proof` | 报告期、公告/收到/生效时间和修订分别保存；缺合法历史版本就不可回测，不用当今成分回填 | S02/05 |
| REF-03 / P1 | 来源能力与质量报告：知道哪个字段失效、影响多少判断 | 增强：来源目录、`quote-observation-view`、`factor-health` | 按来源/字段列覆盖、延迟、单位/复权/许可和错误；0与未知分开；研究备份不能变实时 | S09/10/15 |
| REF-04 / P1 | 逐股完整落选档案：按代码查“未评估/缺数/未达标/风险否决” | 新增索引/入口：两扫描器items与现有漏斗 | 冻结输入范围/排序/规则版本；首个淘汰不重复计数，其他原因单列；分页总数可对账 | S01/15/16 |
| REF-05 / P1 | 条件变化差异：直接看到阈值哪侧从满足变未满足 | 补闭环：现有时间线及条件checks | 同证券/周期/规则版本才直接比；数据修订、规则改版与市场变化分开，不凭分数变化编原因 | S01/12 |
| REF-06 / P1 | 研究运行目录：搜索/比较已有研究，而非到处找JSON | 新增只读索引：原模型/因子/冻结档案 | run包含代码SHA、输入指纹、规则/费用/分割/结果引用及失败阶段；不复制指标、不覆盖原档案 | S02/11 |
| REF-07 / P1 | 同口径基准成绩单：判断是策略作用还是整体市场上涨 | 补闭环：前向审核、成本回测、绩效统计 | 策略版本×环境×周期，同日期/股票范围/可得性/费用/复权；净收益与价格匹配分别展示，缺基准不补值 | S04/05/08 |
| REF-08 / P1 | 概率/样本可信度：区分条件分、频率、预测概率与盈利 | 增强：`probability-contract`、前向审核、Brier/独立日 | 标签必须同事件/周期；分桶校准与覆盖显示，不足样本不排名；不把相关重复信号计独立证据 | S01/05 |
| REF-09 / P1 | 持仓防守总览：原入选理由、失效、风险和集中度同屏 | 补闭环：原账本/holdings、只读风险中心 | 按授权账户联接，不再建账本；逐票报价年龄/成本缺口/锁仓/静默可见，失效提示不直接下单 | S01/07/08 |
| REF-10 / P1 | 一次分析诊断：卡在哪里、耗时多久、哪步可安全继续 | 新增统一trace：已有观察/代理/记忆/复访状态 | timeout、分析异常、保存失败、复访登记失败分别可定位；日志脱敏；恢复不能重复交易/通知 | S01/12/13/14 |
| REF-11 / P1 | 有版本的稳定约束记忆：不丢偏好、范围和未决条件 | 补闭环：个股记忆、只读摘要、开发续接规则 | 用户约束与模型推断分开，声明修改时点、冲突与撤销；持久化失败可见，原档案不删；不接收费模型 | S01/14 |
| REF-12 / P1 | 漂移归因：分清源坏了、股票池换了、市场变了 | 增强：`factor-health`、影子可靠性与已冻结基线 | 先同成员/同字段/同源比较；报告缺失率、分布/均值变化及样本门槛；不凭漂移认定盈利衰减或自动调权 | S10/15 |
| REF-13 / P1 | 防未来与指标预热诊断：识别回测好看但开机变值 | 增强：既有causal/holdout测试、指标计算 | 追加未来数据过去不变；30/60/120等预热长度按指标实际需求比较并披露差异；检测不足不能称无偏 | S05/06 |
| REF-14 / P1 | 失败、停牌、缺价和未成熟全记录：避免只展示赢家 | 补闭环：前向窗口已分pending/missing/corporateAction | 同时显示完整分母、无法判定及未评估范围；明确同股重复与跨周期重叠；不能删除亏损或未知样本 | S05/11/15 |
| REF-15 / P2 | “还差什么证据”清单：按实际影响安排补数 | 增强：`summarizeConditions.missingFields`已有策略关联 | 列缺字段、影响策略数、可用来源与下次检查；只建议补数，不伪造值/自动采购/扩大采集预算 | S01/09/15 |
| REF-16 / P2 | 筛选条件模板/撤销：复现昨天的筛选设置 | 新增保存入口：复用原输入与任务配置 | 模板与冻结结果分开；保留版本与恢复点，应用前看差异；不自动改变正式策略或锁定主页 | S16/11 |
| REF-17 / P2 | 历史逐步回放：只用当时可知资料重看判断 | 新增研究视图：冻结档案、策略回放已存在 | 游标前数据才可见；图、证据、规则统一asOf；回放不跑实时提醒或写账户，明确公司行为口径 | S16/05 |
| REF-18 / P2 | 影子版本对照：同批新旧规则是否真有改善 | 增强：已有影子候选、配对稳定性和预登记 | 同数据/费用/市场窗口，比较覆盖、回撤和尾部损失；保留失败试验/试验总数，不能挑最优窗口 | S02/05/11 |
| REF-19 / P2 | 成交与回测偏差归因：定位费用、滑点、延迟和不能成交 | 补闭环：`paper-fill-evidence`、权威订单/费用与历史验证 | 只能对有同源匹配证据的模拟成交解释；时点、停牌、涨跌停/T+1、公司行为分别计，不以理想收盘代成交 | S05/08 |
| REF-20 / P2 | 费用及流动性压力场景：看策略多依赖低摩擦假设 | 增强研究报告：原费用/滑点/回撤风控 | 冻结多组假设并列，明确假设不是预测；无成交量/盘口证据不输出可承载资金量，不自动换正式参数 | S05/07 |
| REF-21 / P2 | 行业/主题共同暴露：几只股票是否其实押同一主线 | 补闭环：行业映射、`sector-relations`及原集中度 | 按当时成员、交叉主题去重计权；无足够历史不估相关风险或VaR；不把相关当因果 | S07/08 |
| REF-22 / P2 | 入出金与策略回报拆分：避免加钱看似赚钱 | 条件候选：只在原账户将来有真实入出金语义时补统计 | 单独展示TWR/IRR定义和现金流/分红/费用；无适用现金流不强上IRR，不改账本以迎合报表 | S08 |
| REF-23 / P2 | 有效期与复访队列：不让过期关注继续当当前判断 | 补闭环：观察池生命周期、冻结目标日与复访任务 | 到期未获证据、失效、撤销、完成分开；重启不复活终态、不重复提醒；按需要复访不高频重试 | S01/14 |
| REF-24 / P2 | 可复现研究包与联动阅读：一份证据，多处显示 | 增强：证据bundle/只读摘要/导入入口/图表 | 导出输入引用、参数、代码SHA、费用和结果；脱敏、版本校验，缺附件显式说明；切股/时间同步不新增重复采集 | S09/11/12 |

## 5. 建议执行顺序与任务归属

原P0的行情原时点、未知资金、账户/权限及超容量现场问题仍先处理。#221/#222独立评审，不以本报告替它们合并或验收。

| 后续批次 | 先完成的交付 | 对应已有任务 | 完成判据 |
| --- | --- | --- | --- |
| 第一批：把已有解释真正接完整 | UX-E01～04；REF-01/04/05/15。先原items落选查询和字段差异，再扩全市场 | V6-001/008/010 | 每条支持/反对有证据ID，任意本轮代码可定位状态，漏斗总数与全部items对账；不重做主页 |
| 第二批：判断策略是否有用 | UX-E06；REF-02/06/07/08/13/14/18 | V6-007/009/010 | 同条件、成本后、基准对照、完整未知分母；真实独立长期样本不足仍标不足 |
| 第三批：持仓与使用可靠性 | UX-E07/08；REF-03/09/10/11/12/19/23/24 | V6-002/003/005/006/008/011/012 | 原账本只读聚合、私有权限、失败可定位/幂等续接、跨端同一版本；真实提醒另做现场签收 |
| 第四批：资料充分后扩展 | UX-E05；REF-16/17/20/21/22 | V6-004/007/009/010 | 有可审计题材/成员历史与交易时点；研究假设、回放、压力场景与正式运行隔离 |

先领取小批并查重再写代码。每批只围绕原模块补缺口，明确基线/测试/未测/回滚，不把表中24项一次性塞入生产或交给不可用数据填空。暂不采纳多模型自动辩论、自动实盘/调权、复制完整仪表盘、加密资产引擎替换或收费数据/API采购。

## 6. 本轮验证、交付与恢复

业务代码、前端、账户/配置/调度未改；仅新增本文与来源JSON，更新README、功能记录及协作任务索引。文档链接/源码引用/JSON结构、`git diff --check`和有界续接入口均核验。未为文档添加镜像测试，本地没有重跑全工程或上游全套测试；下述是现有功能的定向实跑，远端CI另记。

```sh
cd V6_BO
node --test --test-reporter=tap tests/research-decision-review.test.js tests/rule-comparison.test.js tests/rule-comparison-ui.test.js tests/research-risk-center.test.js tests/research-risk-center-http.test.js tests/research-risk-center-ui.test.js tests/sector-relations.test.js tests/forward-horizon-sample-audit.test.js tests/factor-health.test.js tests/stock-observation-research.test.js tests/stock-observation-monitor.test.js
# 71通过，0失败，0跳过
node --test --test-reporter=tap tests/stock-intelligence-memory.test.js tests/research-rule-weight-review.test.js tests/sector-relations-capture-bridge.test.js tests/holding-signal-evidence.test.js tests/manual-holding-risk-watch.test.js tests/public-rule-forward-audit.test.js tests/universe-scanner.test.js
# 49通过，0失败，0跳过
```

实跑覆盖范围为原模块协议、投影/页面行为、隔离HTTP与合成/离线夹具；没有真实供应商稳定性、原文事实核查、真实盈亏/推送或手机现场证据。本轮日志在`/workspace/artifacts/v6-feature-review-20261114/`，工作区留存不是跨机备份。精确候选CI/PR另行查询，不把其他PR测试数搬作本轮结果。

回滚只需revert本轮文档提交，无数据迁移；旧功能、前次报告和历史失败记录继续保留。生产发布仍按原唯一发布者执行，单HTML站不因此获得完整后端功能。
