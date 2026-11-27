# FAYO C组首批：原72题材拥挤证据时点完整性（未发布）

## 责任与精确基线
- 本批主验收编号：22.2 / 原72（主题拥挤与集中风险）；映射 C-EX02、C-EX25、C-EX47、C-EX48 的证据真实性子项。其他编号不因此关闭。
- 开工读取 dev `0c45291d7156be8a1206f0bb272f3c719d5d2336`；总管候选 #427 读取 head `67e6b7f80e5fde43535318d1c11221877c627d24`（V6 CI、UI Browser Geometry进行中，PR Commit Coverage成功；不代替本组验证）。
- 已核对 #404–#426 开放候选及 #427 的组合路径清单，本组目标源码与新增测试未出现在组合文件列表。已有原78/66台账、第四清单和原72研究入口保留。原 #26 高标抱团与 #27 分离度不改。
- 分支 `fix/fayo-c-crowding-evidence-20261127`。源码提交 `93fccc07820781e8c4dc9415871ede4776bfc1e6`，测试提交 `58bdfdb562a6e868fff5ebe746b070fd8ec0722f`，本记录提交后的精确head以PR回执为准。

## 已复现与修复
原 `V6_BO/src/core/deep-research-evidence.js#buildThemeCrowding` 检查成员 quoteAt，却忽略显式收到/可知/存档时钟；未来接收、明确未知、早于原报价或晚于父证据的成员可计入完整分母并触发拥挤观察。缺少成员时 current 仍可能为 true。
- 在原逐成员入口拒绝不符合原毫秒时钟合同的显式 receivedAt、knownAt、firstKnownAt、recordedAt；成员收到/可知时点不晚于父 firstKnownAt，存档不晚于父 recordedAt，且均不早于原 quoteAt。
- 完整覆盖是题材 current 的必要条件。缺失/非法成员保持全分母缺口，原统计值为 null，不产生当前拥挤观察；这不是风险解除。
- 兼容原没有逐成员可选接收时钟的研究记录，继承原父级来源合同但仍为未认证研究观察。显式未知不按缺省处理。不用接收时间覆盖原报价时间，不调整原15秒、原拥挤阈值、风险级别或任何交易权限。
- 文件仅修改原研究证据投影，新增 `V6_BO/tests/crowding-member-time-integrity.test.js`；不增加运行依赖或生产接口。

## 实际验证（隔离，不是完整Node回归）
从 GitHub 读取精确 base/head 源码与新测试、原 a-share-calendar.js，在隔离 JavaScript 执行器中加载原模块；测试框架/断言和 crypto ID 及未使用的依赖替身，不访问账户、网络和持久化。测试逻辑取自已提交原样文件。修前 3通过/6失败，修后 9通过/0失败/0跳过。原源码 blob `2af42b5eafc52f942ed2b8b62c88c9aee0f98c35`；改后 blob `93c8c7e2017ebaf63cf0ec3538374c230b343baf`；测试 blob `74deac5022530f0d5342bf5868bec364bb6dffb2`。
- 六反例：未来接收、显式未知接收、报价前已知、成员缺失、父记录后存档、父首次已知后可知。
- 三保留用例：合法晚到但早于父证据、原兼容完整记录、旧quoteAt不因新收件刷新。
- 原全量脚本包含 tests/*.test.js。待真实仓库执行：`cd V6_BO && node --test tests/crowding-member-time-integrity.test.js tests/deep-research-evidence.test.js`，并按既有 CI 执行 npm run check、npm test、端到端及浏览器。当前容器无法解析 github.com，未恢复完整工作树；未运行上述本地原生Node全量、未取得本PR CI/真实数据/实机/部署回执。无完整TAP日志哈希；不伪造。
- 状态：源码已提交；隔离专项9/9；原生专项、精确head CI、组合、真实行情、双端、生产均待验收。

## 给总管的共享合同提案（待批准，不实施共享接线）
复用 A 组现有权威风险工作台与交易门禁、B 组 marketContext，不建并行风险中心。C 组 riskAssessment 建议绑定 schemaVersion、证券、账户/epoch（无账户仅研究）、tradeDate、asOf、原quoteAt/knownAt、evidenceIds、model/configHash、B policyId、有效期及质量覆盖；分开原A硬风险、C专项否决、B政策、模型/数据未知。C 状态只可限制新增风险，不能授权交易、覆盖A门禁、改变预算、自动解除或写订单。八维独立证据保留原始值/时点/来源/未知，强度和机会不得覆盖硬风险。退出压力区分盯市损失、可卖数量、可成交假设及待确认委托；未获授权或真实成熟样本的研究保持影子。旧风险ID只作历史展示，账户/报价/配置变化、撤权及超时由A权威入口复核。提案待A/B/总管共同确认，不变更现有API。
- #427 已修改 DEPLOYMENT.md、HANDOFF.md、TASK_MASTER.md、common-entry-risk.js、execution-risk.js 和决策/双端共享入口。为避免并行覆盖，本批交接放独立文件，不编辑共享台账或发布入口；请总管将本记录及后续精确head纳入原总表与组合发布清单。先比较 #427 最新树，再集成本组源码和测试；仅总管负责合并与原唯一生产发布。
- 后续 C 组：复核22.1、22.3–22.18、全部EX剩余子项，优先C-EX11/13/15/17/20/21/25/27/35–40/47/48/51/52；原14压力与冻结委托、T+1、原入场门禁、双端风险ID需A组合同及B组状态证据。未取得数据/许可/成熟样本时保留研究或阻塞，不能宣称全项完成。

## 回滚
本增量无账户、数据、通知、依赖、配置或发布入口变更。组合候选若有负优化，撤除本组独立补丁或通过原流程 revert 该组源码和测试；不强推、不 reset dev、不覆盖新账本。历史证据与既有发布机制原样保留。未合dev、未部署、未下单、未发送真实通知。
