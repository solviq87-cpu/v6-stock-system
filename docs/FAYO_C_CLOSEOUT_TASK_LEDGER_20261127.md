# C组第二十七批：原任务逐项证据与剩余验收台账（候选未发布）

依据用户资料库原 C 组《高位抱团风险与防追高·全维深化版》（287行，52个EX精确标题），保留22.1—22.18与C-EX01—52全部编号。组合基线 #520 `048c82c570e234168106486bfb0be17c54838afd`，提醒联动 #522 `974cace8b9d029a0b2acdcc86294d13f09a2ab75`，账户压力整改 #525 `3ec321afd18a21310f53f5f2c71238f3c2f7b164`。原dev `0c45291d7156be8a1206f0bb272f3c719d5d2336`。本台账是逐项证据/阻塞映射，不是70项完成验收或独立缺陷数量。18项主任务按原总任务P0列账；EX优先级取原任务书，不自行升降级。

**台账覆盖70/70；完整验收仍未签收。** 分类：候选运行链 24 项（至少有相关只读原链/现有门禁及测试证据，非整项完成）；部分研究 37 项（含影子原型、研究证据和未齐方法）；共享合同阻塞 9 项（当前不能宣称接通正式合同）。分类仅为本次收尾主阻塞归类，三类都有剩余验收条件，不能将分类数或356项历史混合隔离新增专项换算为完成百分比。P0台账 42 项：候选运行链21、部分研究12、共享合同阻塞9。

## 证据索引
每个证据代号代表对应原路径与候选，非一个独立通过的全任务。#499保留在总管候选基线，不混入C-only源码。路径核查：索引所列C-only原路径来自#520组合清单，新增两项联动测试来自#522/#525；此前测试结果见原PR内日志。未重跑全部源码或原生CI。

- **S** [#445](https://github.com/solviq87-cpu/v6-stock-system/pull/445)、[#500](https://github.com/solviq87-cpu/v6-stock-system/pull/500)、[#502](https://github.com/solviq87-cpu/v6-stock-system/pull/502)、[#506](https://github.com/solviq87-cpu/v6-stock-system/pull/506)、[#508](https://github.com/solviq87-cpu/v6-stock-system/pull/508)：addStockRiskEvidence / buildChaseRiskResearch / selectFrozenRiskPlan；历史研究；C24选定82/82。`V6_BO/public/nova/shortline/stock-risk-evidence.mjs`、`V6_BO/public/nova/shortline/backtest.mjs`、`V6_BO/tests/c-crowding-exit-research.test.js`。
- **C** [#429](https://github.com/solviq87-cpu/v6-stock-system/pull/429)：buildThemeCrowding / buildDepthResearch；题材成员时点及完整性；独立CI/UI/覆盖成功。`V6_BO/src/core/deep-research-evidence.js`、`V6_BO/tests/crowding-member-time-integrity.test.js`。
- **H** [#452](https://github.com/solviq87-cpu/v6-stock-system/pull/452)：buildThemeLifecycle / buildShadowReview / compareModelOpinions；影子原型，未正式调用；选定22项隔离。`V6_BO/src/core/crowding-shadow-review.js`、`V6_BO/tests/c-crowding-shadow-review.test.js`。
- **R** [#457](https://github.com/solviq87-cpu/v6-stock-system/pull/457)、[#476](https://github.com/solviq87-cpu/v6-stock-system/pull/476)：registerRiskAudit / freezeRiskDay / evaluateRiskAudit / buildCloseRiskPath / labelSensitivity；代理标签、配对回放；37项隔离，非真实瓦解标签。`V6_BO/src/core/crowding-risk-replay-audit.js`、`V6_BO/src/core/crowding-close-path-evidence.js`、`V6_BO/tests/c-crowding-close-path-integration.test.js`。
- **F** [#434](https://github.com/solviq87-cpu/v6-stock-system/pull/434)：原冻结价位预检及离线撮合；原12+新11原生隔离；不认证实盘成交。`V6_BO/src/core/paper-execution-preflight.js`、`V6_BO/src/core/paper-intent-simulator.js`、`V6_BO/tests/c-frozen-intent-price-integrity.test.js`。
- **D** [#442](https://github.com/solviq87-cpu/v6-stock-system/pull/442)、[#466](https://github.com/solviq87-cpu/v6-stock-system/pull/466)、[#472](https://github.com/solviq87-cpu/v6-stock-system/pull/472)、[#484](https://github.com/solviq87-cpu/v6-stock-system/pull/484)、[#489](https://github.com/solviq87-cpu/v6-stock-system/pull/489)：accountExitDiagnostics / exitRisk / previewPlanBatch / buildAdvancedPortfolioReport / buildPortfolioDefense；原高级只读诊断；#489独立主CI/UI通过。`V6_BO/src/core/advanced-account-risk.js`、`V6_BO/src/core/advanced-portfolio-evidence.js`、`V6_BO/src/core/advanced-portfolio-runtime.js`、`V6_BO/src/core/portfolio-defense-evidence.js`、`V6_BO/tests/c-portfolio-defense-runtime.test.js`。
- **T** [#432](https://github.com/solviq87-cpu/v6-stock-system/pull/432)、[#451](https://github.com/solviq87-cpu/v6-stock-system/pull/451)、[#525](https://github.com/solviq87-cpu/v6-stock-system/pull/525)：buildPortfolioStressEvidence / buildAdversePathEvidence / buildPlanOddsEvidence；原工作台只读压力，C26新8/8+原22/22隔离。`V6_BO/src/core/portfolio-stress-evidence.js`、`V6_BO/src/core/portfolio-adverse-path-evidence.js`、`V6_BO/tests/c-closeout-account-stress.test.js`。
- **N** [#438](https://github.com/solviq87-cpu/v6-stock-system/pull/438)、[#492](https://github.com/solviq87-cpu/v6-stock-system/pull/492)、[#522](https://github.com/solviq87-cpu/v6-stock-system/pull/522)：resolutionCheck / reductionCheck / createRiskAlertLifecycle；原通知与恢复，C25联动9/9隔离。`V6_BO/src/core/risk-state-contract.js`、`V6_BO/src/core/risk-alert-lifecycle.js`、`V6_BO/tests/c-closeout-notification-integration.test.js`。
- **U** [#451](https://github.com/solviq87-cpu/v6-stock-system/pull/451)、[#462](https://github.com/solviq87-cpu/v6-stock-system/pull/462)、[#464](https://github.com/solviq87-cpu/v6-stock-system/pull/464)、[#483](https://github.com/solviq87-cpu/v6-stock-system/pull/483)、[#496](https://github.com/solviq87-cpu/v6-stock-system/pull/496)、[#519](https://github.com/solviq87-cpu/v6-stock-system/pull/519)、[#522](https://github.com/solviq87-cpu/v6-stock-system/pull/522)：boundRiskResearch / createRiskReceiptTracker / projectRiskNotificationHistory / renderRiskWorkbench；现有双端读取及回包隔离；组合浏览器/原生待CI。`V6_BO/public/nova/risk-workbench-read-scope.mjs`、`V6_BO/public/nova/risk-workbench-view.mjs`、`V6_BO/src/server/risk-workbench-runtime.js`、`V6_BO/tests/v6-terminal-workbench.test.js`、`V6_BO/scripts/fayo-risk-browser-check.js`。
- **P** [#446](https://github.com/solviq87-cpu/v6-stock-system/pull/446)：原压力/筹码历史修订证据；归档原始时点；历史研究。`V6_BO/public/nova/shortline/pressure.mjs`、`V6_BO/tests/c-pressure-revisions-integrity.test.js`。
- **V** [#499](https://github.com/solviq87-cpu/v6-stock-system/pull/499)：现有原否决合同+待审批探针；另依赖#427，不属于C-only树；13/13现有合同，5待审批探针未通过。`V6_BO/tests/c-entry-veto-contract.test.js`、`V6_BO/scripts/c-entry-veto-audit.js`。

## 主任务与深化任务逐条核对

|编号|优先级|原任务|主状态|证据|已有局部成果|尚缺验收/依赖|
|---|---|---|---|---|---|---|
|22.1|P0|位置风险|部分研究|S / C / P|20日收盘秩、区间、原连板及异常证据|缺1/5/10/20收益自身历史分位、ATR/均线偏离全套及认证行情|
|22.2|P0|拥挤风险|部分研究|C / S / H|原72成员完整性、声明广度、相对强度、同源时点|缺真实冻结成员/量额分位与候选相关完整生产供数|
|22.3|P0|抱团生命周期|部分研究|H / C / S|形成/强化/高潮/分歧/瓦解/修复影子阶段|缺B同快照供数、经验证阶段阈值与驻留|
|22.4|P0|核心地位与跟风|部分研究|S / H|同题材同代码龙头与跟风两日比较|缺冻结核心梯队与跨题材迁移的真实连续证据|
|22.5|P0|瓦解预警|部分研究|S / H / R|助攻、广度、接力失败及代理风险路径|缺真实瓦解/正常分歧标签和独立提前量|
|22.6|P0|量价异常与承接|部分研究|S / C / P|原连续量价、分时冲突、OHLC回撤及盘口来源边界|缺授权订单簿、同窗盘中相对强度及真实回放|
|22.7|P0|动态风险收益比|部分研究|S / T / D / V|原冻结毛赔率、风险尾部及价区失效|缺费用滑点后分布、成熟样本、实际成交|
|22.8|P0|独立防追高门禁|共享合同阻塞|F / H / V|原价格预检及13项既有否决；影子只能限制|待公共riskAssessment批准、原事务锁内消费；5探针未通过|
|22.9|P0|极端损失|候选运行链|T / D / S|同一权益无退出复合冲击、在途全成压力|真实逐证券逐日制度、跳空价格和事件路径待证|
|22.10|P0|无法退出与流动性|候选运行链|D / T|T+1/冻结/停牌/跌停、子集和整仓分离|真实授权可卖量、订单簿与多会话冲击成本|
|22.11|P0|组合抱团风险|候选运行链|D / T / C|题材并集、边际风险、共用预算、尾部共跌|缺真实风格因子、压力相关与权威锁内预算更新|
|22.12|P0|分账户状态推送|共享合同阻塞|H / N / U / T|账户/期次隔离、持仓状态与原通知回执|正式C专项决策接线、真实发送/权限、持仓差异化输出全链|
|22.13|P0|升级与解除|候选运行链|N / U|原时点、根因、去重及恢复、撤权展示门禁|待真实队列/重启/实机/稳定期与二次入场验证|
|22.14|P0|同样本风险回测|部分研究|R / F|三方配对、冻结窗口、代理标签|缺同成本可成交完整回测与真实风险标签|
|22.15|P0|误判归因|部分研究|R / N / U|误报漏报、弃权、收盘路径、历史通知时序|缺真实正常分歧、误放行、实际行动及机会成本|
|22.16|P0|自学习与晋级|部分研究|R / H|预登记、训练/验证/保留分离，禁止自动晋级|缺A试验预算、许可、成熟训练与独立样本外证明|
|22.17|P0|双端展示|候选运行链|U / N / T|复用原风险中心、私有读取、历史与压力投影|组合9视口CI、真实手机/电脑及正式八维展示待验|
|22.18|P0|全系统风险联动|共享合同阻塞|V / H / N / T / U|现有硬否决优先及只读合成链|总管批准共享合同，锁内交易、通知和B同快照组合验收|
|C-EX01|P0|好股票、好时机与可执行资格分离|共享合同阻塞|H / S / F / V|独立强度/风险/冻结价证据，研究不授权|同一股票四阶段真实冻结快照及A最终准入|
|C-EX02|P1|拥挤与过度延伸分离|部分研究|C / S|题材集中与20日位置、量价分离|换手波动分位、同质化与真实深度|
|C-EX03|P1|多尺度亏钱效应与传染|部分研究|S / H / R / D|龙头跟风同跌、接力失败及尾部共跌|冻结核心队列、跨题材传染及独立事件归因|
|C-EX04|P0|隔夜、事件与不可卖风险|候选运行链|T / D / S|隔夜/多步无退出与T+1分解|真实各板制度及逐日可成交路径、费用版本|
|C-EX05|P0|组合边际风险与风险预算|候选运行链|D / T|已持/在途/候选增量与共用预算|权威冻结、并发锁内预算与真实共同因子|
|C-EX06|P1|下行分布与尾部风险研究|部分研究|R / D / T|收盘最大不利变化、经验尾部|真实MAE/可成交净损失、分位模型覆盖|
|C-EX07|P0|风险状态机与恢复门槛|候选运行链|N / U / H|原恢复回执、缺档保持限制、过期/撤权|经验证稳定窗口及真实阶段切换|
|C-EX08|P1|分持仓生命周期防御|部分研究|H / D / T / S|持仓状态、批次和条件性复核|持有期届满、实际分账户推送/退出全路径|
|C-EX09|P1|预警质量与机会成本双目标|部分研究|R / N|同样本误报漏报、代理标签及通知时序|真实提前量、误放行、机会成本与可避免损失|
|C-EX10|P0|风险与解释全链路验收|共享合同阻塞|V / U / N / T / H|已有原风险ID和只读证据|统一C/B/A同一风险ID及模拟盘/通知/回测正式链|
|C-EX11|P0|价格走远后的机会失效|候选运行链|F / T / S / V|冻结价格、迟到和毛赔率边界|真实查看/锁内拟成交重算成本及五探针协调|
|C-EX12|P1|健康回踩、假修复与结构破坏|部分研究|S / H / R / P|分歧/修复影子、日K/回撤证据|真实正常回踩与假修复冻结路径|
|C-EX13|P0|涨跌停与真实可参与边界|候选运行链|F / D / S|逐股原限价、停牌/跌停与离线滑点范围|授权排队封单及竞价撤单、真实成交|
|C-EX14|P1|盘中异动及次日承接压力|部分研究|S / T|分钟急跌可见性、OHLC回撤与隔夜假设|同段基线、回封/尾盘真实提前量和误报|
|C-EX15|P0|单股事件与异常交易风险|部分研究|S / P|原公告版本、撤回/停牌/基本面边界|A完整公告/公司行为及授权数据|
|C-EX16|P1|高位核心、后排跟风和低位陷阱|部分研究|S / H|龙头/跟风同股同题材身份及助攻|B冻结梯队迁移、低位无催化/流动性样本|
|C-EX17|P0|执行前风险与持仓再验证|共享合同阻塞|V / F / D / T|现有原执行否决专项及冻结回执|原事务锁内C风险ID/B政策/配置重检，5探针未批准|
|C-EX18|P1|浮盈并不消除风险|候选运行链|D / S|逐批成本/浮盈与当前暴露分离|权威分红/批次历史与未成交减仓全链|
|C-EX19|P0|动态保护条件与失效边界|部分研究|S / T / D / N|冻结止损/目标、触发与成交分离|动态波动/市场保护规则、合法变更和延迟验证|
|C-EX20|P0|反向压力测试与风险承受边界|候选运行链|D / T|原风险预算反向压力及全成假设|实际多证券制度、阈值先触发与账户可承担边界|
|C-EX21|P0|批量候选共用预算与顺序|候选运行链|D / T|候选批量预算、重复计划与在途余额|A原并发冻结、顺序更新和重新评估|
|C-EX22|P1|相关性失效与联合压力|部分研究|D / T / R|压力共跌、尾部同损失并列、题材并集|真实条件相关/共同流动性和历史联合路径|
|C-EX23|P1|风险发生时间与多事件路径|部分研究|R|收盘首个不利观察、删失和成熟|真实互斥竞争事件、盘中顺序与成交标签|
|C-EX24|P1|尾部模型与风险基准比较|部分研究|R / D|历史尾部及配对标签敏感性|条件分位数/重尾/波动/可选模型对比|
|C-EX25|P0|风险单调性及对抗反例|候选运行链|S / V / D / T / N / U|原否决反例、缺价/冻结/错配保守阻断|全市场组合、模型伪造及原事务单调性证明|
|C-EX26|P1|预警能否真正减少损失|部分研究|N / U / R|生成/预留/网关/接收时序与未知行动|真实用户操作、可成交退出及净损失对照|
|C-EX27|P0|风险解除与二次入场纪律|候选运行链|N / U / F / V|恢复回执不刷新旧证据、冻结价格复核|真实市场修复、重新入围独立决策及执行联动|
|C-EX28|P1|风险沟通与盘后案例库|候选运行链|N / U / R|历史保留、未知、原风险原因与只读投影|真实盘后案例和双端同版本/发送一致性|
|C-EX29|P1|上涨路径质量与加速风险|部分研究|S / P|加速缩量、连板与OHLC位置|同累计涨幅多路径波动/回撤完整比较|
|C-EX30|P1|风险随价格和时间的敏感性|部分研究|S / F / T|现价几何毛赔率及冻结区间失效|多合法价/期限、实际成本/压力及动态成交敏感性|
|C-EX31|P1|高成交与流动性错觉|部分研究|C / S / D|原深度研究来源、盘口冲突与历史容量|授权深度/撤单、实际市场冲击|
|C-EX32|P1|相对强度惯性与边际衰减|部分研究|S / H|同窗两日相对强度、龙头同跌|长短多窗口持续衰减与经认证市场/板块输入|
|C-EX33|P1|突破失败与低位陷阱|部分研究|S / P / H|区间位置、触板失败与修复观察|事前冻结突破区间与完整延续/失效证据|
|C-EX34|P1|价格跳跃与事件辨别|部分研究|S / P|公司行为/无价格限制/公告时点隔离|完整A公司行为/停复牌及正常跳跃对照|
|C-EX35|P0|摊薄成本不等于降风险|候选运行链|D / T|加仓增量及成本不等于暴露下降|A实际多批成交/冻结事务验证|
|C-EX36|P0|证券风险与账户风险分离|候选运行链|H / U / N|原账户/期次/标的和权限隔离|未登录/撤权两端实机及正式证券级输出|
|C-EX37|P0|风险资金缓冲与未确认委托|候选运行链|D / T|严格剩余委托核对、冻结资金、全成情景|真实在途撤单/部分成交锁内资金更新|
|C-EX38|P0|分批计划中的动态门禁|共享合同阻塞|D / V / F|候选共用预算和原冻结计划校验|每笔提交/成交后A事务内C重新核验|
|C-EX39|P0|退出时滞压力曲线|候选运行链|D / T|单/多时段成本区分、T+1子集及历史容量|真实退出时滞曲线、滑点、容量校准|
|C-EX40|P0|未成交减仓不解除风险|候选运行链|D / T / N|未成交状态不降低持仓盯市敞口|实际拒单/迟到成交回执、权威账本联动|
|C-EX41|P1|组合流动性分层与集中退出|部分研究|D / T|多股容量/剩余集中及共同退出情景|真实多股同时退出成本及深度|
|C-EX42|P1|共同风格与假分散|部分研究|D / C / R|尾部共跌、题材和行业部分证据|B真实风格篮子、因子暴露、压力时相关|
|C-EX43|P1|相对抗跌与绝对亏损分离|部分研究|S / T / D|同窗相对涨跌与独立账户损失|真实净成本、相对强弱和回撤同快照展示|
|C-EX44|P1|罕见事件压力场景库|部分研究|T / D / S|固定合成压力版本、异常事件研究|真实罕见事件归档、逐证券制度及回放|
|C-EX45|P1|研究风险阈值敏感性|部分研究|R / H|固定标签敏感性、不自动晋级|研究阈值邻域、跨阶段及独立样本，不是标签敏感性|
|C-EX46|P1|罕见风险标签与样本偏差|部分研究|R|成熟/缺档/同日共跌与配对覆盖|真实事件重叠、冻结完整样本池与独立性|
|C-EX47|P0|风险根因及优先级|候选运行链|H / N / V / U|原硬风险优先、根因合并及部分解除|正式C否决统一根因、全链共同证据|
|C-EX48|P0|风险有效期与读取复核|候选运行链|U / N / V|15秒有效期、同代回包、账户/标的绑定|正式B政策/配置/风险ID与A入口再检查|
|C-EX49|P1|条件防御方案的实际可操作性|候选运行链|D / T / H / U|当前可卖量/冻结、条件防御与未知状态|真实行情/持仓、用户操作及非持仓推送|
|C-EX50|P1|预警迟到与恢复过早评价|部分研究|N / U / R|记档/网关/接收/查看分离，收盘不利观察|真实行动窗口、解除后恶化及等待成本|
|C-EX51|P0|正式风控不可越权证明|共享合同阻塞|V / H / F / N / U|现有13项否决测试及影子只读|批准正式风险合同后五探针和原事务锁内测试|
|C-EX52|P0|多行情风险组合验收|共享合同阻塞|V / H / S / R / D / T / U|多阶段研究和压力反例部分覆盖|三组同快照多市场牛熊/震荡/事件/流动性组合正式验收|

## 本轮精确HEAD工作流核验
- #520 `048c82c570e234168106486bfb0be17c54838afd`：V6 UI Browser Geometry [45970566592](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970566592) queued/无结论；V6 CI [45970566789](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970566789) queued/无结论；V6 PR Commit Coverage [45970566686](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970566686) queued/无结论。
- #522 `974cace8b9d029a0b2acdcc86294d13f09a2ab75`：V6 PR Commit Coverage [45971419803](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971419803) queued/无结论；V6 CI [45971419784](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971419784) queued/无结论；V6 UI Browser Geometry [45971419755](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45971419755) queued/无结论。
- #525 `3ec321afd18a21310f53f5f2c71238f3c2f7b164`：尚未返回关联工作流（不计成功）。
- #519 `23730b1a651b8e0982bbf0d2460e6285f4a4f06e`：V6 UI Browser Geometry [45970286792](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970286792) queued/无结论；V6 CI [45970286678](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970286678) queued/无结论；V6 PR Commit Coverage [45970286705](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45970286705) queued/无结论。
- #427 `6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f`：V6 UI Browser Geometry [45930805271](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930805271) completed/failure；V6 CI [45930805277](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930805277) completed/failure；V6 PR Commit Coverage [45930805294](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45930805294) completed/failure。
- #499 `e7089964c2563923b892c25adc88c5d4b67fca1a`：V6 UI Browser Geometry [45957151637](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957151637) completed/failure；V6 PR Commit Coverage [45957151664](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957151664) completed/failure；V6 CI [45957151570](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/45957151570) completed/failure。

## 收尾优先级与交付责任
1. C：#520→#522→#525本链实际主CI、浏览器、逐SHA覆盖回执及真实失败修复；保留原失败，不改公共工作流或造状态。#519仅是旧首页夹具修正；新组合未获成功回执之前不标绿。原#489及#508独立主CI/UI成功不能替代组合。
2. 总管/A/B/C：#499 现有13/13隔离专项已记录；五条待审批合同探针仍能到达模拟买入回调，不能记通过或认定已成交、已证实生产漏洞。核对不完整/错配卡片真实可达性，审批同一风险ID、证券、账户期间、市场政策、配置、原报价和冻结计划失效合同；在原权威事务锁内重新验收。保持原15秒和原1:2等门禁。#427与#499继承的七项HTTP及一项浏览器原组合失败留总管协调（合成候选当前毛赔率约1.77低于原2，不能降低门槛）。
3. C/A/D：授权真实行情、真实逐日限价、盘口/容量、实际费用/滑点、原权威成交和通知收件取证。真实交易权限与行情订阅不在本台账擅自开通；缺口以未知呈现。
4. C/B/A：真实抱团/分歧/瓦解成熟样本、同样本同成本可成交策略对照、预警提前量、机会成本、净风险和尾部覆盖，模型许可、预算和独立样本外审查。不为P1研究数量强行晋级。收尾需真实PC/手机、撤权/重启/重复回执以及原账本保全。总管唯一合并/发布。
5. 组合选择：#520已吸收十条C链99个既有变更路径，0删除。#481/#483择#483，#484/#485择#484，#519已在#520。#427与#520三处重叠blob已于上一轮实读一致；后续总管新的HEAD需再比对。#499独立于C-only候选。本台账不改共享TASK_MASTER、DEPLOYMENT、原生产权重/账户/权限或CI。
