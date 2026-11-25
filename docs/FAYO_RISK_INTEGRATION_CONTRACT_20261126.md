# 绯曜 FAYO 风险组接口与六组集成合同

## 1. 范围、基线与证据边界

本组负责 **01、02、03、04、05、14、30 共七项**：统一风险工作台、实际生效规则、账户权益证据、风险动作可执行性、提醒闭环、多题材压力情景和风险降噪。本文记录代码接口、跨组依赖与合并约束，**不表示全部 66 项完成**。

| 项目 | 本次合同记录 |
| --- | --- |
| 仓库、目标分支 | solviq87-cpu/v6-stock-system，dev |
| 开工及本次远端复核基线 | b9b44474be7fd27732e37d868ed64dbfddd3e8e9 |
| 本组独立分支与 PR | feat/fayo-risk-center-20261126；[#359](https://github.com/solviq87-cpu/v6-stock-system/pull/359)。恢复原本地 34e0c18、7f8515d 后在独立副本续接，工作区分支已对齐原 PR，普通快进更新同一 PR |
| 本组工作区入口版本 | 20261126ab；最终集成组须统一协调正式入口与缓存版本 |
| 本次远端合同读取日期 | 北京时间 2026-11-26；本轮复核原 PR HEAD 为 86a5bf4787f2b5a1746fffc11b9a60a06b5e387f，提交前再次检查远端未被其他写者推进 |
| 开工源码恢复证据 | 根组已建立并验证源码 bundle；其位置、最终提交 SHA、PR 与恢复步骤由本组最终验证/交接记录保管 |
| 验证记录职责 | 专项、全量回归、隔离 HTTP、双端浏览器的实际命令、结果、日志及未测范围由根组单独维护验证文档；本文不复制容易过期的通过数量 |

本文所列代码和测试入口存在于本组工作区；列出测试名称不表示该测试已在最终集成 SHA 运行。没有根据本文确认生产部署、线上恢复、GitHub CI、实盘或真实消息送达。现场结论必须分别绑定精确 SHA、实际节点、授权配置和真实回执。

2026-11-26 用户将原第一组的最终集成职责移交给新建的“绯曜 FAYO｜总管与最终交付”。总管统一任务总表、最终集成、合并安排、验收和交付跟踪；本组继续原七项并提交独立 PR，不独立安排主线合并。当前没有合并或生产发布进行中，既有唯一发布机制保持，不新建发布入口。其他组的草稿 PR 在本次只读核对中没有被合并、覆盖、重写或标记验收通过。最终集成必须重新读取最新 dev 和各 PR 的当前 HEAD。

## 2. 单一权威与原门禁复用

风险报告是可追溯的派生证据。原现金、持仓、订单、成交、费用、公司行为及账户重置仍由原账户服务负责；本组没有第二套账本，也不提供交易、规则启用或风控阈值放宽接口。

| 原能力 | 本组的使用方式 | 必须保留的边界 |
| --- | --- | --- |
| paper-application-service 与原账户读校验 | 从原 _paperAuthority 的 read() 取得 pool/pre 快照；权益报告保留原 revision 和指纹 | 不接受客户端自报现金、持仓、规则或交易资格 |
| common-entry-risk、portfolio-risk-gate、imported-risk-evidence | 读取实际安装的 riskPolicy、策略变更、行业及前收盘证据；沿原风控口径展示占用 | 原 submit、fill、saveLegacy 锁内检查继续裁决；页面展示不代表新规则已启用 |
| paper-plan-observer | 复用原 quoteEvidence、sellEligibility、planLedgerContext 和已存观察 | 扩展原纯检查导出，并修正合法数值/字符串股票代码的同股匹配；原 T+1、时段、价格及流动性规则保持 |
| 原冻结计划、条件意图、执行清单和日报 | 保留 planId、entryEventId、orderId、成交及观察引用 | 提醒、条件意图、已提交订单、部分成交和完整退出分别留证；不由风险页面重新提交交易 |
| 原行情使用门禁与逐票原始时点 | 当前估值和退出观察核验来源、报价时点、日期及冲突 | 接收时刻不替代报价时刻；旧价、未来价和冲突价不产生新止损判断 |
| 原设备授权、编辑身份与主副角色 | HTTP 沿原 requireEditor；异步返回前复核身份；状态写入前再次授权核验 | 副本不冒充主账本；在途撤权后不得返回私有报告或修改提醒 |
| 原私密通知队列、冷却及持久去重 | 为同一风险生命周期增加持久预留与真实回执，仍调用原 pushAll / 私密队列 | 不启用新通道，不转发到公共通道；缺接收证据不称送达 |

实现入口：[风险 runtime](../V6_BO/src/server/risk-workbench-runtime.js)、[统一报告](../V6_BO/src/core/risk-workbench.js)、[服务端接线](../V6_BO/server.js)。

### 2.1 续接修复：同一股票的原始类型差异

原订单 reducer 接受 `600000` 与 `"600000"`，其 `state.symbol` 均为同一六位代码，但原 `order.symbol` 和成交字段保留输入类型。原服务及部分只读投影直接做严格类型比较，会漏算同票未成交敞口、卖单冻结、已用成交量或原计划退出关联。续接修复只在比较/分组时使用核验后的同股身份，不重写原订单、成交、报价证据、幂等指纹或历史账本。

修复覆盖原 `common-entry-risk`、`paper-application-service`、`paper-plan-observer` 与本组权益、实际规则和动作投影。原提交、成交、公司权益结算仍走原事务；拒绝后权威文件应逐字节不变。新增隔离原服务回归覆盖混合类型、部分成交、撤单与重启。此处是原门禁的实际修复，不能再泛称所有原账户/风控模块对 dev 无字节差异；原19个具名函数的历史保护记录仅覆盖记录中列出的函数。

### 2.2 续接修复：断网与页面恢复

首页/个股风险摘要和完整风险页在 `offline`、`pagehide` 时清空旧私有报告，取消请求并使旧代次失效。离线不继续显示当前执行资格，晚到响应不能恢复旧判断。`online`、`pageshow` 按当前角色和新请求重新核验，销毁视图时卸载监听；关闭的个股抽屉不会因重连自动打开。服务端原风险门禁、站内风险来源与静音语义保持。

## 3. HTTP 接口

### 3.1 读取统一风险

~~~http
GET /api/risk-workbench?account=pool
GET /api/risk-workbench?account=pre&code=600000
~~~

沿原 Bearer / 设备编辑授权读取；两接口均使用 Cache-Control: no-store。account 只接受 pool 或 pre，默认 pool；code 可选且必须是六位代码。

GET 不写账户、不写权益观察、不更新提醒查看状态、不为刷新页面制造历史覆盖。code 仅筛选同一后端结果的个股风险行与动作，保留共有账户风险；它不是逐股重算或公开脱敏接口。

成功包装为 {ok:true,result}；result 的协议为 fayo-risk-workbench-v1，schemaVersion 为 1：

| 字段 | 消费含义 |
| --- | --- |
| version、generatedAt | 报告实现版本和本次生成时点；generatedAt 不能替代各项 sourceAt / quoteAt |
| account、accountEpoch、accountRevision | 原账户身份、原重置期间和读到的原账户修订；副本/不可核验时相关值可能为 null |
| summary | 需要处理数量、未知数量和七类风险统计；incomplete-evidence 不可显示成安全 |
| risks | 按同一根因归并的统一风险行，详见第 4 节 |
| equity、equityHistory | 本次封存权益证据与已有观察历史；当前报告和历史采样分别留时点 |
| rules、actions、stress | 实际规则、原动作可执行性、多题材情景证据 |
| alerts | 同一账户期间的持久提醒生命周期与当前设备查看状态 |
| manualHoldings | 明确 accountAuthority:false 的手工申报观察，不参加权威权益与可卖量 |
| strategy、classifications | 原研究结论和时点分类；缺失、未核验或尚未接入均保留未知 |
| runtime、instance | 按账户分开的观察错误/检查时点、主副角色和私密通道配置状态 |
| equityMissingMessages、stressMissingMessages | 展示层中文缺项；不写入已封存 equity 或 stress 子报告 |
| readOnly、canTrade、writesAccount | 固定 true、false、false；不是执行许可 |

参数错误返回 400，方法错误返回 405，报告构建不可用返回 422。进入接口的权限拒绝沿原授权行为；异步读取后撤权的回包返回 403 且不含 result。部分上游不可用时，可返回含明确未知和来源缺口的有效报告，而不是伪造完整数据。

### 3.2 查看与静音

~~~http
POST /api/risk-workbench/alerts
~~~

查看某根因的请求示意如下；accountEpoch、expectedRevision 和 rootCauseId 必须取自刚读取的同一报告，不能写死：

~~~json
{
  "action": "view",
  "accountId": "pool",
  "accountEpoch": "<报告中的账户期间>",
  "expectedRevision": 7,
  "rootCauseId": "rule/maxPositionPct"
}
~~~

静音使用 action: "mute"、相同账户期间与提醒 revision，并指定 rootCauseId 或 classification 二选一；classification 只接受 general / critical。mutedUntil 为未来 Unix 毫秒，传 null 恢复通知。用户查看属于授权设备身份，不是接收端投递回执。

接口仅允许 action、accountId、accountEpoch、rootCauseId、classification、mutedUntil、expectedRevision 这些字段。禁止通过此接口提交交易、篡改价格或填写 receiverReceipt / receiver-confirmed。成功结果为最新提醒视图；陈旧 revision、重置期间不一致或写前授权失效拒绝并要求刷新，不能自动重放旧操作。副本写入返回 403。

静音的确定语义是 notificationOnlyMute:true、stationVisible:true、restrictionsStillApply:true；它不撤销原后端限制、不隐藏站内风险、不删订单、观察或业务入口。

alerts 的 rootMutedUntil、categoryMutedUntil 分别说明根因与类别静音；mutedUntil 保留两者合并后的生效期限。清除根因静音不清除类别静音。请求体必须为对象；布尔、数字、字符串、未知字段和接收回执输入全部拒绝。

## 4. 风险行与三维状态

每行至少保留以下字段。首页、个股卡、风险工作区及通知从同一 builder 的结果消费，不各自推算风险。

~~~text
id, rootCauseId, category,
object: {type,id,label},
severity, evidenceStatus, executionStatus,
facts[], source, sourceAt, impact,
restrictions[], checks[], releaseConditions[],
status, references, priceDependent, followUp
~~~

category 为 data、market、stock、portfolio、strategy、execution、system。references 保留实际存在的 planId、entryEventId、orderIds、观察及规则引用；归并时保留 contributing facts / sources / evidenceReferences，不能只留下最轻的一条。

| 维度 | 枚举 | 解释 |
| --- | --- | --- |
| severity | info、warning、critical、unknown | 风险严重程度；unknown 是证据不足，不能折算成低风险 |
| evidenceStatus | available、partial、missing、stale、conflict、unknown | 证据可用程度；旧价与来源冲突分别保留，不以新生成时间刷新旧证据 |
| executionStatus | not-applicable、observing、condition-triggered、allowed、submitted、partially-filled、filled、failed、pending-reconciliation、unknown | 原执行证据状态；allowed 仅表示当前检查结果，不授予提交权限或保证成交 |
| status | active、resolved、unknown | 风险后续状态，独立于严重程度和执行状态 |

固定根因例子包括 rule/maxPositionPct、quote/600000、account/valuation、plan/&lt;planId&gt;/stop、plan/&lt;planId&gt;/target。止损与目标分别保留稳定根因；旧根因缺档不能被当作解除。完整退出需原成交与订单匹配，解除来源时点采用实际退出证据；当前无新报价不抹掉已发生的完整成交。

同根因合并分别保留最严重风险、最不足证据及实际执行状态；严重的历史触发不能覆盖当前待核对或未知执行。摘要 facts / restrictions / checks / releaseConditions 最多显示 39 条及一条明确展开提示，summaryCoverage 说明总数与截断；完整原权益缺项和引用仍在子报告，不因持仓较多而写坏提醒档案。

quote 根因的 references.kind 区分 position-valuation 与 source-consensus。前者只有在同一有效权威快照已无该持仓且已核验无该股活跃订单时，才解除其账户适用性；这不证明市场报价恢复。后者必须重新通过原 decisionCrosscheckGate 的完整独立来源一致证据，且 checkedAt 不早于原根因；诊断消失、单源、新生成时间不能证明解除。已解除历史不会因缓存暂缺重新制造事件。题材根因解除须当前分类覆盖完整且确已无该重叠；缺档保持未知。

所有金额为原账户人民币口径，数量为股；带 Pct 后缀通常为百分数而非 0–1 比例，仍须按对应字段说明读取。未知数值使用 null，不能用零、空数组或无提醒替代风险结论。

## 5. 账户实际生效规则与动作证据

### 5.1 生效规则

[effective-risk-evidence.js](../V6_BO/src/core/effective-risk-evidence.js) 的 buildEffectiveRiskEvidence 消费原 book、quotes、now、calendar、accountId 和 automaticPolicy。报告包含 policyConfigured、policyVersion、policyConfiguredAt、policyFingerprint，逐规则 enabled / configurationStatus / limit / used / remaining / exceeded / evidenceStatus / missing，以及 occupancy。

覆盖 maxPositionPct、maxGrossExposurePct、maxSectorPct、maxStrategyPct、maxDrawdownPausePct、maxDailyLossPausePct、maxConsecutiveLosses。行业与前收盘规则复用原导入证据的日期/来源/可知时点；策略归因使用原订单与成交关联。没有安装的规则明确 not-configured，原配置不可读为 unknown。

未终结买单按剩余数量乘原委托价进入风险敞口，冻结现金计入原费率；已成交部分只在原持仓体现。未成交买单不计入持仓权益。原自动账户的最大持仓只数、止损、止盈和持有天数放在 automaticRules，不能冒充统一百分比规则。

显式 tradeDate 与原 quoteAt 所属上海日期冲突时，限额占用与权益均保留未知；不能在同一输入上将权益判为未知却称规则估值可用。

规则与动作携带 accountEpoch、authoritySnapshotFingerprint；统一 builder 要求它们与封存权益的 accountId / revision / epoch / 原快照指纹全部相符，缺字段也拒绝绑定。rules / actions / stress 的生成时点必须对应本次报告，压力还需绑定同一 equity 指纹，不能把旧子报告包装为当前结果。

occupancy.activeOrderSymbols 是已核验的全部非终态买卖单代码（六位字符串、去重排序）；无单为 []，原单状态、方向、代码或引用无效为 null。解除及发送前复核消费此字段，不另算订单资格。automaticRules.enabled 仅在原完整 maxPos / tp / sl / expireDays 和显式原 enabled 可核对时给出布尔值，缺配置保持 unknown，不能误写 disabled。

前收盘回撤/单日亏损暂停属于原限额语义，与第 6 节的连续权益观察不同。展示模块没有更改任何阈值；提交、补单、成交或原自动路径仍在原事务内重新检查当时敞口和规则。

### 5.2 实际可执行性

[risk-action-evidence.js](../V6_BO/src/core/risk-action-evidence.js) 的 buildRiskActionEvidence 消费原计划、账户、实际观察、报价、交易日历及原退出检查。每项分别返回 condition、execution、constraints、orders、fills、historicalTriggers、observationCoverage 和 continueObserving。

constraints 保留 remainingQuantity、sellableQuantity、todayLockedQuantity、frozenQuantity、session、price 和 liquidity；这些是同一原持仓的约束证据。执行状态与条件状态独立：例如条件已触发但 T+1 不可卖，或订单已部分成交且剩余持仓继续观察。

没有冻结计划的权威持仓仍显示可卖、冻结、时段及报价约束，planId 为 null、计划阈值未知；不会生成计划、默认止损价或交易许可。多个买入批次难以唯一关联、订单/成交不一致或观察缺档时保留待核对/未知。手工申报持仓不进入该可卖核对。

已全部退出的原批次只保留该批次原成交对应的订单引用；后续同股买入及退出不改变旧计划的完成状态。原订单缺少独立提交时点时，同日未与该批次成交关联的终态订单不能凭代码和日期附到新计划。无计划持仓的部分成交也只从成功核对的原成交事件提取 fills；缺原事件时保留待核对，不从订单数量补造成交。

计划止损价始终是触发依据；实际成交价只来自原成交回执。行情故障不使用旧价推导自动清仓。

权益与动作复用同一 positionAvailability：批次保留全部冻结数量，可卖仅来自成熟批次扣除对应冻结和原活动卖单；异常日期、批次数量不一致、无法核对的终态使数量未知。原快照或账本验证失败时保留原引用但标记待核对，不输出允许执行或可信当前价格。部分退出后撤单或较小卖单已全成，仍跟踪剩余仓位与真实成交引用。

## 6. 统一权益证据与组合回撤

### 6.1 封存报告

[account-equity-evidence.js](../V6_BO/src/core/account-equity-evidence.js) 导出 buildAccountEquityEvidence、validateEquityEvidence、buildEquityHistory、createAccountEquityEvidenceStore，以及共用的 accountEpochOf、valuationMarkOf、positionAvailability。复用这些只读校验器，不建立第二套权威状态。

协议 fayo-account-equity-evidence-v1 的核心字段为：

| 字段 | 合同 |
| --- | --- |
| accountId、accountEpoch、observedAt、day | 账户、重置期间、真实观察时点及上海交易日期 |
| status | complete / partial / unknown，仅描述本次估值证据 |
| cash、equity、marketValue、observedMarketValue | 原现金、完整权益、完整市值、实际已覆盖的部分市值；缺报价时完整权益/市值为 null |
| settledPnl、unrealizedPnl、fees | 已结算盈亏、持仓浮盈亏、原费用分别提供；费用历史不全时 total 为 null 并保留 observedTotal |
| positions、coverage、missing | 每仓成本、数量、原始报价、可卖/冻结及缺口；quantityPct 明确按股数计覆盖，不冒充市值覆盖 |
| source | 原账户修订、快照/账本/成交历史指纹及有界事件引用覆盖 |
| cashMovements | 原初始额、成交和公司行为现金勾稽；未暴露外部资金事件时明确 not-exposed-by-authority |
| fingerprint | 封存 payload 的完整性指纹；消费方只读保留，不能增加展示字段后仍沿用旧指纹 |
| manualHoldingsIncluded、canTrade、canNotify、accountMutated | 均为 false |

当前原账户没有独立的外部出入金事件接口。reset / setInitial 开启新 accountEpoch；不能把初始金额变化当作利润，也不能跨 epoch 连接历史高点。公司现金分红属于原权益收益。无法由原成交、公司行为解释的现金变化会使连续收益/回撤勾稽未知；本组没有创建新的出入金账本以填补这个缺口。

### 6.2 观察历史的能力与限制

权益历史协议为 fayo-observed-equity-history-v1。其 points、gaps、from、to、sampleCount、comparisonCount、truncated、observedMaxDrawdownPct、currentObservedDrawdownPct 都基于实际保存的观察。正常无账户变化采样由 store 按一分钟节流；超出默认 90 秒观察间隔、估值缺口或权威事件连续性不可核验时明确记录缺档。

**continuousAccountMaxDrawdownPct 当前明确为 null。** 已观察采样点无法证明采样间极值与全部历史覆盖，不能将 observedMaxDrawdownPct、已结算盈亏曲线或策略回测回撤改名为连续账户最大回撤。历史读取默认有界，报告截断必须一同展示。

默认 maxObservationGapMs=90000 下，最后一个采样超过 90 秒时 currentObservedDrawdownPct 为 null；latestObservedDrawdownPct 保留最后真实采样值，其原时点由 history.to / points.at(-1).at 给出。前端将权益称为“核验时点权益”，不会用刷新时点抹掉原 quoteAt 或把采样间隔解释为持续精确估值。

权益观察默认写入 V6_BO/data/risk-evidence/equity/&lt;accountId&gt;/&lt;accountEpoch&gt;/&lt;day&gt;，实际根可由原服务端 V6_RISK_EVIDENCE_DIR 指定。只有原主实例后台 tick 追加；GET 不补写。提醒派生资料位于同一根的 notifications。两个账户独立记录失败，单个派生档损坏不阻断另一账户观察；恢复不补造失去的历史。

### 6.3 策略组消费约定

策略执行验证和归因消费完整 equity / equityHistory 及 actions 引用，以 accountId + accountEpoch + source.accountRevision + source.snapshotFingerprint 确认同一原快照。计划和成交仍按原 planId / entryEventId / orderId / eventId 核对，不能仅凭代码和相近日期拼接。

消费者应先调用 validateEquityEvidence，保留原 fingerprint。完整权益缺失、资金勾稽未知、期间不一致或历史缺档时，对应组合收益/回撤/仓位归因返回 null 和原因。策略组可以显示已有原净结算拆分，但不得用它补齐缺失账户净值，更不能把假设费用/滑点压力写成原费用。

## 7. 多题材重叠与压力假设

[portfolio-stress-evidence.js](../V6_BO/src/core/portfolio-stress-evidence.js) 直接消费同一封存权益证据；返回协议 fayo-portfolio-stress-evidence-v1，保留 equityEvidenceId、authoritySnapshotFingerprint、accountEpoch、asOf、current、classificationCoverage、groups、overlaps、scenarios 和 missing。

分类输入需包含 symbol、themes、source、sourceRecordId、version、day、knownAt；可选 publishedAt / effectiveFrom / effectiveTo。没有发布时点时，只从首次可知时点使用，不伪造正式生效时间。当前 adapter 读取原打板客当日归档分类；跨日、未来、失效或多源冲突保持未知。

每股可以属于多个题材；各题材可重复展示同一股票，组合总额和单个情景按代码去重。overlaps 只证明共同题材，statisticalCorrelation 为 null，不从类别重叠编造收益相关系数。

当前固定假设版本为 fayo-stress-research-20261126-v1，明确来源为本仓库需求 14 的研究情景：组合跳空 10%、共同题材退潮 15%、流动性恶化价格冲击 5%，可卖部分额外清算成本 300 bps。它们未经市场概率校准，不是已启用风险阈值。改变数值必须改变假设版本并重新验证，不能沿用同版本覆盖原假设。

estimatedLoss 只有在对应覆盖完整时给值；部分证据保留 coveredLossEstimate 与 missingSymbols。潜在可卖和暂不可卖损失分别显示，不能把不可卖仓位算成已经清仓。未成交买单仍由 rules.occupancy 管理；当前持仓压力情景 includesPendingOrders:false，不能误称已包含未来成交组合。任何情景都不保证成交或最大可能损失。

压力 asOf 固定为 equity.observedAt，generatedAt 才是生成时点。current 检查本次观察和已估值仓的原 quoteAt 是否在原 15 秒资格内；新生成报告不会刷新旧报价。缺价仓另由 status / missing / 情景 estimatedLoss 体现覆盖缺口，current=true 不等于覆盖完整。权益、限额占用和压力共用报价身份、时点、日期及冲突检查。

## 8. 提醒生命周期与可靠投递

[risk-alert-lifecycle.js](../V6_BO/src/core/risk-alert-lifecycle.js) 以 accountId + accountEpoch 隔离状态，以 rootCauseId 归组，记录首次出现、升级、解除、再次出现、最后检查、观察缺档、按设备查看及静音偏好。一般信息和关键风险分别管理。

通知状态独立于第 4 节的三维风险状态：

| 状态 | 可向用户表述的事实 |
| --- | --- |
| not-queued | 尚未进入本次原通知队列；也可能未配置通道、静音或未满足外发条件 |
| queued | 已有持久预留并进入原发送处理，不表示接收端收到 |
| gateway-accepted | 原网关受理，接收端确认仍未知 |
| gateway-rejected | 网关明确拒绝或本次未外发 |
| unconfirmed | 超时、缺回调或不确定/矛盾回执，保留原预留 |
| receiver-confirmed | 仅保留可信来源、回执 ID 和真实接收时点后的接收证据；当前原私密通道 adapter 不提供该证据 |

当前 alerts.receiverConfirmationSupported 为 false，原通道正常回调始终不会据网关成功制造接收确认。用户点“已查看”也不改变投递事实。

持久预留先于原队列调用；相同生命周期事件只有一次预留。重启、重复观察和不确定回执不创建无限重发。原队列只对可明确判定的限流拒绝保留原有限重试规则，不对网络未知结果补发。新生命周期还受分类每日上限与一般冷却约束；当前模块常量分别为每类每日 12 次、一般 120 秒，升级/关键风险有明确分支，不能由前端绕过。

活跃计划提醒仍由原 plan observer 在持久观察提交后触发；后台通用 tick 不成为第二个活跃计划提醒生产者。出队前再次核验主实例、通道、静音、epoch、原启用状态、当前计划持仓/报价和条件。无真实来源或失效报价不产生新的价格敏感退出提醒。

原 observePlans 回调仅使缓存失效；展示与发送必须从原持久观察读取 record fingerprint 与 alert digest，内存预览或写入失败不能伪装已落档。原计划档读取失败时保留引用，但暂停依据缓存产生新条件。出队还复核原规则版本/占用，以及报价、题材、来源冲突的解除证据。account/valuation 汇总只在站内展示，逐票根因沿原通知链外发，避免同一报价缺失占用两次冷却。带“429”文本的超时或不确定 HTTP 错误不等同于明确限流拒绝。

## 9. 跨组消费合同及已核对的 PR

### 9.1 交互组

优先复用 [risk-workbench-view.mjs](../V6_BO/public/nova/risk-workbench-view.mjs) 的 createRiskSummary / renderRiskWorkbench，或消费同一 HTTP 报告。首页和个股卡共享风险 ID；完整页使用同一行及原动作报告。

客户端只做范围筛选、格式化和折叠；不重算规则、可卖量、仓位、权限或交易资格。切账户、切代码、撤权、离线或卸载时清掉旧私有结果并拒绝晚到响应。查看角色不请求私有风险。保留 sourceAt、覆盖率、未知原因、计划订单引用以及“静音仅影响通知”。

首页优先待处理风险，研究证据可展开；原研究风险、执行日报及业务路由继续保留。原 paper 估值显示为参考权益，不替代本组经核验的当前权益。

### 9.2 策略结论输入

runtime 留有只读 readStrategy 适配点，统一 builder 也可消费原 research.strategyDecay。可识别的证据包需有 status、knownAt、version、source、reason/conclusion，及明确的 severity 和 riskStatus；knownAt 必须是报告可知时间且不晚于当前时点。原 status 或证据不满足合同，风险行继续 unknown。

这不是策略结论认证器。策略组负责收益衰减、模型校准、样本筛选、试验预算与人工晋级；本组保留原结论含义、未知原因及版本。当前主服务尚未接入 #353 新治理结果的专用 readStrategy adapter，不能把该 PR 的存在当作策略证据已就绪。不得将纸面恶化线索强制映射为“已验证策略失效”，也不得借风险显示自动调参。

### 9.3 前轮只读核对快照（保留历史）

下表的 HEAD 是实际读取时点的远端结果，均以同一基线 dev 为 base。链接锁定文档或 PR；其后有新提交必须重新核对。本表不是 CI 或生产状态报告。

| PR | 已读精确 HEAD | 与本组有关的合同与合并注意 |
| --- | --- | --- |
| [#353 研究治理](https://github.com/solviq87-cpu/v6-stock-system/pull/353) | 301641650c0246d29142b8c9e16165064cfa1f2c | [固定版本合同](https://github.com/solviq87-cpu/v6-stock-system/blob/301641650c0246d29142b8c9e16165064cfa1f2c/docs/FAYO_RESEARCH_GOVERNANCE_20261126.md)。intelligence-execution-validation 新增原净结算 attribution / byStrategy，portfolioEquity 和缺失的市场、行业、仓位、实际滑点、延迟、未成交归因仍为 null；需要消费本组统一权益/动作。strategy-health-monitor、fayo-research-governance 的离线诊断和概率合同不等同于本组风险行，须保留纸面/未认证语义后显式适配。 |
| [#358 研究证据](https://github.com/solviq87-cpu/v6-stock-system/pull/358) | 70be46b5d5e05c02f9d2fe353df072c62f065ef4 | [固定版本合同](https://github.com/solviq87-cpu/v6-stock-system/blob/70be46b5d5e05c02f9d2fe353df072c62f065ef4/docs/FAYO_EVIDENCE_WORKBENCH_20261126.md)。承接原 #355 全部提交，增加时点新闻、时间轴、选股模板与原日报改进跟踪。与本组共享 server.js、market.js、operations.js、入口及缓存版本和交接文档；保留 reportHash、reportVersion、planVersion、原引用与双方入口。原 #354/#355 是前序增量，不重复合并。 |
| [#356 高级资金风险](https://github.com/solviq87-cpu/v6-stock-system/pull/356) | d50395972e9ae693a37e934dab785234c654e250 | [固定版本合同](https://github.com/solviq87-cpu/v6-stock-system/blob/d50395972e9ae693a37e934dab785234c654e250/docs/FAYO_ADVANCED_SAFETY_PHASE1_20261126.md)。现已包含原只读 advancedAccounts 接线与原写锁安全修复；server.js 增量扩展 /api/research/risk-center?advanced=1，另有受限 worker。权益/可卖/冻结/费用需核对同一原快照，不能成为第二套生效风控。锁协议升级另需停写，不能混跑新旧写者，本组没有替代其锁修复。 |
| [#357 智能增强](https://github.com/solviq87-cpu/v6-stock-system/pull/357) | 9a1132264a191091ea526cba698177f2b5d0c703 | [固定版本合同](https://github.com/solviq87-cpu/v6-stock-system/blob/9a1132264a191091ea526cba698177f2b5d0c703/docs/FAYO_INTELLIGENCE_EVOLUTION_20261126.md)。returnStudy.expectation、similarCases.neighbours / excursions 和因果诊断属于成熟信号纸面研究；净期望、尾部样本均值和区间高低不能替代实际成交、连续账户回撤、概率认证或止盈止损触发顺序。 |

#356 的 advancedAccounts.mode 为 advanced-account-risk-readonly，各账户使用 account、revision、checkedAt、equity、sellable、orderFrozen 等字段；当前不是 fayo-risk-workbench-v1，也没有本组完整 epoch / 封存权益协议。总管如接入，必须保留现有消费者兼容，验证同一账户、原修订/指纹与时间后生成单一适配结果。无法证明同一原快照时保持独立“未核验诊断”，不能覆盖本组 equity、rules 或 actions。

#356 的 cashFlowPerformance 需要每次外部资金流前后原权益边界；本组当前原账户未暴露此类事件，不能用 reset、相邻采样或人为归因凑出 TWR / XIRR。其 tailRisk 需要同日对齐历史总收益，其单标签行业/题材分组也不能替换本组多题材重叠。两组固定压力假设均须保留版本、范围和未校准说明。

### 9.4 数据与来源依赖

上游需提供逐票原始报价时间和使用资格、独立来源冲突回执、当时时点有效的行业/多题材版本、权威账户与计划档案。引用必须能绑定原来源、代码、日期、首次可知时间及原记录指纹；未拿到的字段用缺项表示。题材首次观察不是正式公告生效时间，新闻标题也不是成交或风险解除证据。

### 9.5 前轮实际合并预检（保留历史）

以本组冻结源码的独立临时 Git index 快照运行 `git merge-tree --write-tree`；没有修改共享 index、工作区、HEAD、分支或远端，没有真正合并。文档仍在收尾，因此此结果是冲突定位，不能替代最终集成 SHA 验收。

与 #358 `70be46b5d5e05c02f9d2fe353df072c62f065ef4` 有六处文本冲突：DEPLOYMENT.md、HANDOFF.md、public/nova/index.html、public/nova/market.js、public/sw.js、scripts/fayo-browser-check.js（源码路径均位于 V6_BO）。market.js 须同时保留本组 stockRisk 节点与对方“联动回放”页签；SW 目录须同时缓存 risk-workbench-view.mjs、evidence-workbench.mjs、event-research.mjs、research-review.mjs。入口修订、查询版本、缓存名及浏览器严格版本断言由总管一次统一；两份交接保留双方有效记录。operations.js、server.js 和缓存契约虽可自动合并，仍须检查最终运行结果。

与 #356 `d50395972e9ae693a37e934dab785234c654e250` 无文本冲突，但 advancedAccounts 仅由原 HTTP `?advanced=1` 返回；本组 runtime 直接读取原 readResearchRiskCenter，不会自动消费该 HTTP 投影。其 account / revision / checkedAt 缺本组 epoch / authoritySnapshotFingerprint，仍属显式适配依赖。原写锁升级独立保留，停写与同卷恢复另验；自动合并成功不等于语义已统一。

供总管决定合并顺序的依赖约束：先确认最新主线的数据/账户/锁门禁及升级边界；本组提供统一权益与动作证据后，再接策略及高级研究消费者。#358 与本组的双端接线无强制先后，但六处冲突须合并保留、一起统一版本和缓存。#357 的纸面研究保持原独立语义。最后在总管选定的完整合并 SHA 验证全量、HTTP、双端、权限与账本一致性，再按既有唯一机制安排生产验收。

### 9.6 续接最终源码与七个活动 PR 的只读预检

本轮以本组冻结实现 `d1dabdb763d6348f8e1633db4a535f6f2327ce9f` 与下表精确 HEAD 执行 `git merge-tree --write-tree`。只生成临时树对象，没有修改 HEAD、index、分支或远端，没有实际合并。完整冲突路径及有界复现见 [机器预检](validation/fayo-risk-20261126/merge-preflight.json)。后续文档提交不改变这些实现，但最终集成仍须重新读取各 PR 最新 HEAD。

| PR | 本次已核对 HEAD | 文本冲突及需要保留的内容 |
| --- | --- | --- |
| #353 | c3c26519b005db219265c5b9b5718d8d053d8928 | HANDOFF；研究新结果须按同一账户期间、修订、指纹和时点适配 |
| #356 | fd3caeeef55b1cad63be14764a47e11a695c0b2e | workflow、DEPLOYMENT、HANDOFF；账户服务文本自动合并，但新增对账器存在下述数值代码兼容问题 |
| #357 | 03d314dcec9c528d7fc46fe21c5a11939dc015d8 | workflow、index、terminal-workbench、sw；保留统一风险摘要、研究优先事项和可展开原风险证据 |
| #358 | 1c5675e70fc48c1666894b5e17c6d6961660ba16 | workflow、DEPLOYMENT、HANDOFF、index、market、sw、fayo-browser-check；同时保留个股stockRisk与replay页签、所有缓存模块及双方浏览器场景 |
| #361 | 5ea32ac70a753ecf6880757630d219c05c2417df | workflow、HANDOFF、TASK_MASTER、paper-application-service；保留原始报价15秒最终提交检查、通知身份修复和本组同股敞口/冻结/成交量匹配 |
| #362 | a72f953c93e25a8a26ac784ecd7b68eaa7d71465 | HANDOFF；来源真实性改进不等于新增实时交易资格 |
| #363 | d2b9b428f35e07bbe7cc6d6f5411d3a79e385d49 | DEPLOYMENT、RELEASE_QUEUE、TASK_MASTER、index、sw、fayo-browser-check、server、WORK_LOG；保留风险与深度研究独立完整路由、授权复查及RUNNING_RELEASE |

上述源码简称均位于既有 V6_BO 目录，精确路径见机器预检。原 #355 由 #358 承接；#360 是 #357 的测试夹具增量，核对当前 #357 是否已继承后处理，不能重复覆盖。

**需要总管/原负责组修复的两处语义兼容问题：**

1. **#356 新对账器** `account-safety-state.js` 以 raw `order.symbol` / `event.symbol` 建立 Map，且以严格类型比较关联买入批次。用本组原权威服务实际生成的隔离数值股票账户只读复现：字符串代码返回 consistent；数值代码在旧档报 `ORPHAN_PURCHASE_LOT`，带独立期初封存的新档还报 `POSITION_QUANTITY_FLOW_MISMATCH`。应在身份关联、冻结 Map、数量流水 Map 中统一读取代码，保留原字段和指纹、不重写账本。现有对账、防御、只读与锁升级机制均应保留；不能凭账户服务文本自动合并认定兼容。
2. **#356 与 #361 的 publish 回调**：额外只读预检看到 `if(result.validateBeforeWrite)` 被放到 `publish(next, previousRevision)`，其中没有 `result` 作用域。总管须从 `mutate` 显式传递回调，在原锁内、紧邻 `atomicWrite` 前再次校验原报价；保留 #356 的 readOnly/对账/防御发布及停写升级要求。此项为静态拼接发现，未将该组合运行结果称为已验证。

本组与 #361 的自动成交冲突块，必须同时保留 `requireCurrentAutomaticQuote`、`newExecutionQuotes.push(q)` 与本组按同股身份累加的已用成交量；不能择一整段覆盖。#361 workflow 移除路径过滤后，应继续让后端变更产生浏览器检查，同时保留每组新增场景和截图目录。

以上是依赖和保留约束，不是本组决定的最终合并安排。总管先统一原账户/锁/数据提交边界及上述兼容，再接各组只读消费者；双端入口和缓存版本在完整组合中一次统一。最终必须验证总管选定的精确合并 SHA，不能沿用本组或其他组独立绿色结果。

## 10. 七项任务的代码与验证映射

本节“已接入”描述本组代码范围；历史覆盖、跨组适配和现场验证仍按最后一列保留。测试结果以根组独立验证记录为准。

| 任务 | 本组代码状态 | 主要代码 | 对应测试/验证入口 | 跨组及现场待证 |
| --- | --- | --- | --- | --- |
| 01 统一风险工作台 | 七类风险统一后端、首页/个股/风险页同源、三维状态与事实/解除条件已接入 | risk-workbench.js、risk-workbench-runtime.js、risk-workbench-view.mjs、server.js 与原生入口 | risk-workbench.test.js、risk-workbench-http.test.js、v6-terminal-workbench.test.js、fayo-risk-browser-check.js | 策略新治理报告专用 adapter、真实市场/系统覆盖与最终集成双端复验 |
| 02 生效风控配置 | 只读展示原安装版本、限额、占用、余额和缺项；未成交买单沿原占用口径 | effective-risk-evidence.js；原 common-entry-risk / portfolio-risk-gate / paper-application-service | effective-risk-evidence.test.js、dated-fees-common-risk.test.js、paper-application-service.test.js、risk-workbench-http.test.js | 各真实账户未配置项保持未配置；真实行业/策略/前收盘证据完整性待现场核对 |
| 03 权益与回撤 | 原账户派生权益、事件指纹、费用/已结算/浮盈亏分离、期间隔离与采样回撤已接入 | account-equity-evidence.js、risk-workbench-runtime.js | account-equity-evidence.test.js、risk-workbench-runtime-isolation.test.js、risk-workbench-http.test.js | 连续采样间极值仍未知；原外部出入金事件未暴露；#353 归因消费及 #356 资金流边界待适配 |
| 04 风险动作可执行性 | 原计划与无计划权威持仓约束、T+1/冻结/时段/报价/流动性、订单与成交状态已接入 | risk-action-evidence.js；复用 paper-plan-observer | risk-action-evidence.test.js、paper-plan-observer.test.js、paper-order-state-machine.test.js、risk-workbench.test.js | 现场报价/可卖/流动性回执与多批次关联覆盖；#358 日报继续使用其原封存证据 |
| 05 提醒闭环 | 根因、首次/升级/解除/重开、设备查看、分类静音、持久预留与原队列回执已接入 | risk-alert-lifecycle.js、risk-workbench-runtime.js、feishuq.js、private-risk-feishu-delivery.js | risk-alert-lifecycle.test.js、risk-workbench-runtime-notifications.test.js、risk-workbench-http.test.js | 当前无可信接收端确认 adapter；真实通道配置和实际送达须单独现场确认 |
| 14 重叠与压力 | 多题材同仓识别、时点分类、跳空/退潮/流动性情景、覆盖及可卖分解已接入 | portfolio-stress-evidence.js、account-equity-evidence.js | portfolio-stress-evidence.test.js、risk-workbench.test.js、fayo-risk-browser-check.js | 完整当时分类、独立历史校准、真实相关性与高级尾部风险输入未认证 |
| 30 降噪与清理 | 同根因合并、保留事实与来源、首页待办优先、证据展开和通知独立静音已接入 | risk-workbench.js、risk-alert-lifecycle.js、risk-workbench-view.mjs、terminal-workbench.js | risk-workbench.test.js、risk-alert-lifecycle.test.js、v6-terminal-workbench.test.js、risk-workbench-http.test.js、双端浏览器脚本 | 最终六组合并后的重复入口、未知措辞、角色清理与实际移动端体验重验 |

上述测试覆盖缺数、旧价/未来价、来源冲突、未成交敞口、部分成交、T+1、重复事件、重启、观察缺档、通知失败、不确定回执、账户重置、在途撤权和账户间故障隔离。覆盖列表是测试范围索引，不替代精确 SHA 的执行结果。

## 11. 共享文件最小合并注意

| 文件/区域 | 本组增量与合并约束 |
| --- | --- |
| V6_BO/server.js | 新 runtime 构造器、两个 HTTP 路由、原计划提醒接线、后台派生观察和入口版本。#356 修改相邻的原研究风险路由；逐块保留两个合同，不整文件覆盖。原主副角色、异步身份复核、原交易路径与统一账户实例不能回退。 |
| V6_BO/public/nova/operations.js | 风险工作区接入并保留原研究风险入口。#358 承接原 executionEvidencePanel 纪律复盘；保留其 import、日报视图和本组风险路由两个增量。 |
| market.js、terminal-workbench.js | 个股/首页接同一风险摘要，旧研究内容转入可展开区域；保留原候选同源和全部路由，不增加客户端风控计算。 |
| risk-workbench-view.mjs、fayo.css | 独立风险展示与限定范围样式；与其他组 UI 合并时维持键盘/窄屏可用、晚到响应失效和隐私清理。 |
| public/nova/index.html、public/sw.js | 总管统一 application-version、frontend-revision、模块缓存入口及版本，不各组互相覆盖缓存号。锁定的 public/index.html、public/mobile.html 和旧恢复控制器字节继续按原契约核验。 |
| scripts/fayo-browser-check.js | #358 与本组均有严格 frontend-revision 断言；统一最终修订后保留双方新增夹具和功能检查，不用删断言消除冲突。 |
| paper-plan-observer.js | 扩展原纯检查导出及数值/字符串同股匹配；保留原计划归属、批次、时段、T+1和流动性裁决，不生成第二次计划提醒。 |
| paper-application-service.js、common-entry-risk.js | 本组新增同股身份匹配修复。与 #356 的写锁/publish、费用及策略归属和 #361 的最终原始报价复核逐块保留；不得用任一整文件覆盖其余门禁。 |
| feishuq.js、private-risk-feishu-delivery.js | 保留原队列和角色/通道门禁，区分明确拒绝与不确定结果；不能在整文件合并时恢复对未知回执的重复发送。 |
| HANDOFF.md、DEPLOYMENT.md | 各 PR 都有阶段记录；总管逐条保留，统一更新当前检查点、真实部署状态、完整验证与恢复证据，不用一组历史摘要覆盖其他组新记录。 |
| 测试与工作流 | 原全量通配和 TAP 完整性检查继续保留；新增风险浏览器脚本并入既有双端验证。旧首页断言仅对齐参考权益及新的只读风险 GET，原隐私/缺值/三候选同源与历史字节断言不删。 |

本组另修正 managed-publisher-runtime.test.js 的 fixture 临时父目录规范化：平台 /var/tmp 为符号链接时先解析真实路径后创建测试目录。生产发布器的 symlink 拒绝、完整性、所有者与权限门禁保持原样；不能把这项环境修正当作发布能力验证。

## 12. 最终集成验证与恢复

总管应在最终合并工作分支、精确 HEAD 上执行原 npm run check、npm test（保留 scripts/run-full-regression.sh 与 TAP 完整性检查）、受影响专项、真实隔离 HTTP 与原全套双端浏览器验证。新风险脚本的复现入口是 V6_BO/scripts/fayo-risk-browser-check.js；它不是所有页面验收的替代。策略、研究、通知、权限、账本、版本/缓存与锁定历史字节的原回归必须一并重跑。

合并前重新读取每个 PR 当前 HEAD，按现有任务总表原编号逐项核对真实完成/依赖/未知状态。**组内绿色、旧 SHA 绿色、只通过新增测试，均不能代替总管最终全量和双端验收。** 当前合同中尚未接通的 adapter 和真实数据缺口应进入最终逐项状态，不以演示输入或代码存在消除。

源码恢复使用本组验证过的基线 bundle / 精确 Git 提交，在独立恢复分支逐块回退本组增量，保留其他组提交。生产若未来部署，先按 DEPLOYMENT / HANDOFF 完成现场冷备、停写协调和账本校验；源码 bundle 不是生产数据冷备。

新增风险档案属于派生证据，恢复时仍应保留原账户期间、权益观察、提醒预留及回执，不能为“重新开始”而删除它们后重复通知。损坏的派生档应保全并单独处理，禁止写回原现金、持仓、订单或成交来迎合报告。角色恢复、观察恢复和通知恢复分别取得后续真实证据；缺档不补造，未确认投递不补称送达。
