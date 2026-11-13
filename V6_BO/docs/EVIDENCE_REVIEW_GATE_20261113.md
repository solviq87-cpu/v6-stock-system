# 推荐证据审查实际门禁

基线 `60377d2cdd882741b4d6cf935db8efd0ed8beef5`，包含 A3/A4、行情消费者与 A5。主线程后续并行合入的源模式拒绝、新闻撤稿、策略条件覆盖与其他功能须保留。本批不替换原四策略、不修改模型权重或阈值，不改锁定首页、账本或数据供应商接口。

## 同一原始行与用途

`src/core/recommendation-evidence-review.js` 的纯函数 `reviewRecommendationEvidence(row,{purpose,now})` 无 IO、查价或状态写入。返回 `decision:support|contra|missing`、结构化 `support/contra/missing`、中文 `reasons`、三个用途布尔值及真实 `quoteUseEligibility` 结果。支持资格不认证供应商、预测可靠性或收益。

| purpose | 审查与允许行为 |
| --- | --- |
| `intraday-recommendation` | 复用真实逐行 `quoteUseEligibility`，要求正价格、原始时点、接收时点、来源、明确 mode 与通知用途；另拒 ST/退市/风险警示、停牌/暂停/不可交易、显式零/负成交，缺少正成交量或成交额保持 missing。未知、过期、未来、顺序颠倒、模拟与禁用来源不获推荐资格。 |
| `dated-observation` | 要求该行正研究价格及 `researchEvidence:{tradeDate,source,receivedAt}`，日期有效且不晚于当前或接收时点，不将日K套用15秒报价规则。只允许带日期观察，`canRecommend:false`。 |
| `fact-broadcast` | 要求该条事实的 `factEvidence:{kind,tradeDate,source,observedAt}`，验证日期和观察顺序。可播报来源记录，不授予报价/买入资格；附带报价未知或陈旧仍如实保留。 |

`reviewQuoteSnapshotFields` 复用原报价复制函数，保留同一行的 mode、明确 false 许可、模拟/只读/导入等标志、交易状态、成交字段；不生成 `canTrade:true`。构建候选时和它的原价格一起复制，不按 code 向 `S.stocks`、其他股票或其他价位补时点。竞价仅在虚拟匹配阶段或9:25定稿中所用价格确为同一原行 `price` 时保留其报价证据；历史开盘价保持不可通知。

## 生产入口覆盖

| 生产路径 | 本批接线 |
| --- | --- |
| `govFilter` → `govTake` | sector/pool/trend/bigmoney/bigmoney-B/similar 每个候选传原 `x`；`govTake(code,type,strong,prob,row)` 缺 row 或 code 不匹配即拒绝，审查先于额度/冷却/去重写入。合格后仍走原模型门、EV、名额和冷却，forcePush 不绕证据。返回并在可扩展原候选上保存 `evidenceReview`。 |
| tick、pre、buzhang 直调 | 全部传原模型与同一候选行；tick在模块名额前审核。四类 alert 构造直接复制各自原行，并保存 `originalQuote`；A5冻结和学习记录用该原行，不再通过同 code 的另一条快照映射取报价。旧策略条件仍按 A5 的 partial/unknown 规则，不补完整。 |
| 外围联动、板块异动、竞价 nearZT | 重建候选保留原行证据，只对合格行发价格推荐；无资格仍保留面板观察。 |
| 竞价推断/强势票/预览/摘要、竞价共振 aucres、一进二竞价确认 | 原行审核；aucres展示仍可计算，但内部通知和学习入库仅使用合格行；普通读请求不得变成内部推送。当前推荐与手动历史重发分流。 |
| `ztRushScan` / `surgeScan` | 原 `S.stocks` 行直接审核，拒绝发生在 pushed/cooldown 写入前，不从别行补证据。 |
| 板块暴动 | 个股前排单独审核；事实段明确为“本机10分钟首次观察窗口”，不冒充交易所封板发生时刻。 |
| 洗盘趋势新命中 | 保留原价格行字段，外发前审核；仅写“观察”不豁免即时价格推荐审查，冻结面板结果继续保留。 |
| 一进二/连板盘后列表 | 实际生产函数原本限制交易日15:30后；审核该封板池行的日期/来源观察证据。正文明确盘后研究、数据日期与非即时交易，次日竞价确认另走严格即时门禁。 |
| 日K涨停前形态/连续收涨/趋势扫描 | 从实际 K 线快照与所选 bar 复制研究日期、来源和原接收时间，外发审核 dated-observation，写“研究收盘价（日期）”。未知缓存仍可显示，不伪装现价推荐。 |
| 封板哨兵 ztsent | 验证该条供应商封板池记录的事实日期、来源与本机观察时点；正文为“池中记录价/来源记录观察”，不再声称该价格盘中实时。 |
| 持仓洗盘/出货形态、次日条件计划 | 日K观察要求所选 rows 与其源快照身份匹配；计划保留其原候选价格行并检查带日期证据，生成日/适用日与“研究条件场景”明确，不授予适用日现价或成交资格。 |
| 新闻/公告/复盘/学习日报/盘面摘要/服务与账户事实 | 不机械套15秒。它们的各自来源、权限和新闻撤稿门禁继续保留；混合摘要的个股即时推荐段按上述路径处理。 |

本批扫描实际 `pushAll/pushWecom/enqueueIntraday` 调用并保存清单 `/workspace/remaining-output/review-producer-inventory.txt`。这是一份所列生产入口的代码覆盖记录，不认证未来插件、任意编辑者自填通知正文、所有旧工具或所有未见生产缓存。`pushAll` 只有显式携带 `recommendationRows` 的价格推荐才使用该最终推荐规则，其余用途保留原权限；不能把一般通知 API 当作新的自动股票推荐入口。

实际 sector fixture 还复现了既有 `_secKey` 在 for 内声明、正文在 for 外读取导致 `ReferenceError` 被吞的中断；本批仅将同一归并变量提到循环前，模型与正文共用，不改门槛。原行审核失败也不再提前消耗板块15分钟冷却。

## 最后发送、缓冲与手动重发

原60秒/3分钟缓冲保留。`freezeRecommendationRows` 固定原行、审核/触发时点、原始报价时点和可用的不可变证据ID；`prepareRecommendationDelivery` 在实际 `pushAll` 前复核：

1. 所有原行仍合格才保留即时推荐正文。
2. 已过15秒但按原审核时点回放能通过的，改发独立“历史触发观察 · 非当前推荐”。只给当时报价、原时点和证据ID，不保留“现价/当前可买/具体旧止损”段；ID缺失明确 partial，不能声称过去已送达。手动重发同样是历史观察。
3. 源头就缺失、禁用或无效的，不因 force、缓冲或重发获得资格；拒绝外发并撤销相关额度占位。

历史观察不让旧条件重新变成当前交易依据，也不刷新原始 quoteAt。真实发送仍通过现有私密通道和发送回执；本批未发送任何真实消息。

## 验证、限制与恢复

固定原基线源码 `/workspace/remaining-output/review-baseline-server.js`，可复现脚本 `review-before-after.cjs`。基线中缺 row、同 code 旧候选、模拟、零成交均可通过 govTake并占额度；修改后均拒绝且不占用。真实旧报价冲板扫描由1次发送mock变0次，记录 `review-before-after.json`。

新增纯模块、实际 gov/哨兵、盘后/事实生产者、最终发送与缓冲、真实认证 HTTP 测试，另重跑 A3/A5/aucres/报价与资金受影响测试。最终14个定向文件合计107通过、0失败、0跳过，记录 `review-final-targeted.tap`；中间受影响既有测试28/28，记录 `review-affected.tap`。server/模块语法与 `git diff --check` 通过。主线程统一全量回归。HTTP fixture只访问本机临时服务，替换供应商为确定输入并禁止全部出网；发送仅 mock。真实盘中持续行情、通知送达、供应商授权、收益与真机视觉未验。

老缓存缺日期/来源/接收时点会继续显示未知，自动价格推荐或无日期研究推送可能减少；有证据的盘后研究与历史触发观察保留。没有用别股/别价补字段恢复数量，也没有认证全部研究规则或新闻历史的完整性。

本批不改首页/手机主页字节、不改四策略参数、不写账户/历史证据文件。回滚仅 revert 本批提交，保留数据源、A3/A4、A5以及主线程其他独立提交，不删除原始记录。
