# 自动行情记忆与日终研究时钟

开发起点 `28bfd80d3ab4c2c9e90107aa9227c76a44a45ad0`，已同步 PR #178 合并后的 dev `60a74c64c06b462cd026a2f91a649f3ac9e56ebd`。保留当前快照/非历史认证门禁、影子研究心跳和运行时API禁入检查。两张锁定主页、正式策略、账户和订单不接入本轮研究输出。

## 用户可直接使用的入口

`/research.html` 新增按代码采集、按明确供应商读取历史、真实日K和逐日价格查看；无需先上传JSON。采集明确选择未复权日K，先尝试东财一次，失败再尝试腾讯一次；回退来源单独归档，不混成同一历史。页面分别展示行情截止日、本轮接收时间、该内容版本的观察时间和逐bar首次已知时间。

- `POST /api/research/observe-stock`：`{symbol,provider:auto|eastmoney|tencent,historyDays:1..500,includeContext?:boolean,sectorCode?:BKxxxx}`，最多8KiB。
- `GET /api/research/stock-observations?symbol=600000&provider=tencent`：读取独立档案，不请求外部行情；读取必须明确来源。
- `GET /api/research/stock-observation-status`：查看自动队列是否启用、积压、成功、失败和暂停状态，不暴露目录、原文或账户。
- `POST /api/research/sector-capture-relations`：可提供明确的`sectorIds`；只读取已配置的冻结行情、成员、派生归档并重放校验。

全部API要求编辑者权限、响应no-store。客户端不能传URL、存储路径、日历路径或队列配置。计算/读取在192MiB有界worker中，自动与手动各最多一个任务，单任务55秒上限。来源请求继承代理及TLS、不绕策略、不跟随重定向、每次12秒/2MiB。

## 原始观察和研究档案分开

新 `stock-observation-store` 按股票、提供者和价格口径保存不可变链。相同内容重复接收不新增版本、不刷新旧bar的knownAt；真实修订产生新版本。新增成交额会推进该bar的可得时点，不能沿用旧价格时点。状态、公司行为、涨停字段分别记录可得时点；缺失不推成false。逐bar来源变化时，不继承旧来源的缺席金额、状态和证据，防止来源洗白。

原始响应按真实字节SHA保存，保留供应商附注，HTTP只返回摘要。腾讯长历史的分红附注可能是第7个对象字段，不能因为不是6字段就误拒整份OHLCV，更不能把附注当金额。腾讯缺amount时不使用volume×close补造。不同板种的供应商成交量单位未核实时保持unsupported；当前腾讯旧端点不认证科创板/北交所单位。

源观察去重与研究封存分别处理：第一次研究写入失败、后来修好目录或补到日历时，相同源数据仍可补偿封存；新的decisionAt只能是本次真实时间。已成功的相同研究证据复用原封存，不因为重复按按钮耗尽版本额度。原始响应有2000文件/128MiB上限、每身份最多500内容修订，达到上限明确阻止并等待人工归档，不静默删除用户历史。

## 日终协议 v2

旧协议错误地要求状态在当日15点前已知，导致16点后真实取得的日终状态永远不能参与下一交易日研究。v2按真实研究决策cut核验：历史formation在本日16点后、所有实际可得时点之前不可用；晚到旧bar或状态不回填旧日训练样本。

状态、价格和公司行为证据分别要求真实`statusKnownAt`、`knownAt`、`corporateActionKnownAt`。标签成熟时间取实际相关证据时间的最大值，不提前计入滚动样本外评估。缺少公司行为时点，不能只写`corporateAction:false`就得到概率。涨停仍须逐日事前涨停价/参考价/限制证据，不能按股票代码、固定ST百分比或收盘涨幅猜测。

当前形态单列为`currentFormation.status=price-only-unverified`，允许现在实际已收到的旧OHLCV用于现在观察，不把它变成当年已知样本。历史概率仍至少20个合规条件样本，真实冻结预测的后续表现另行记录。方向特征版本为`stock-trend-momentum20-eod-v2`，形态研究为`pattern-outcome-eod-v2`。

v2前瞻窗口允许真实凌晨或周末作出决策：必须在最后已知收盘之后、显式下一交易日09:30开盘之前，实际封存不晚于decisionAt后60秒与目标开盘二者较早者。开盘后、迟录、今天导入上个月预测均不计作事前预测。当前研究state按真实asOf求值，历史states保留各日cut。

旧v1档案不重写：原概率、结果和Brier按原协议保留并明确旧行动时钟未证明。新增`newProtocolForwardValidation`和`legacyForwardValidation`独立摘要；旧兼容总数不能当成v2已通过的新证据。

## 日历与板块证据

配置 `config/research-calendar-2026.json` 明确给出365自然日、242交易日，来源为上交所及深交所全年休市通知，以及两所2023/2026版本交易规则的周末条款；按2026-07-06分段溯源，未用新规则倒证旧期。12份HTTP原件的URL、SHA、真实本地首次观察时间和原文发表日精度均保留，发表日不冒充精确发布时间。本地首次观察为2026-11-12 UTC；更早回放和2027年覆盖外均未知。北交所原站证据不完整，默认不声称覆盖，须另供完整明确的BSE日历。

日历配置只用于研究，不替换生产交易日历。预测目标取最后K线之后的首个明确session；例如11月13日凌晨取得11月12日收盘，目标为11月13日；“查询日期之后的下一session”可能为11月16日，两个概念分开。私有导入日历必须完整覆盖每个自然日并有显式观察时点，不能借文件mtime倒填知识。

新板块桥复用既有`snapshots/members/sector-archive`三件冻结档案，重放市场与成员研究并校验结果/成员指纹；不能只信summary。明确记录选择的最近研究窗口、源、成员、分类版本、覆盖和实际观察时点。行业等权成员代理不是官方板块指数；缺乏真实板块资金就保留null，不把个股子集或重叠概念资金相加。分类换版、成员变化、缺日与不足20匹配日仍未知。保留PR178的`collectionMode=current-provider-snapshot`、`historicalMembershipVerified:false`门禁。

## 推送股票的可恢复采集

`V6_AUTO_STOCK_OBSERVATIONS=1`在主实例启用。默认不新增后台外连，手动研究入口独立可用。推送通过副本、条数、静默门禁后，封存真实入场时间、股票、原始signalRefs与正文哈希为`push-attempt`。意图不等于消息送达，研究采集结果不能改变发送回执、风控或订单。

意图先私有落盘，再由独立串行worker采集日K。源响应时间由实际请求产生，不使用push decisionAt伪造历史可得时间。成功后不再请求；失败60/120秒退避、最多3次，重启读盘恢复。跨进程明确是at-least-once capture，原子发布一份结果；不是“网络精确一次”。完整性错误会暂停；意图容量1000、总16MiB，超限明确报告，不吞通知或删档。

服务器启动自动恢复已启用队列。CLI也可在持续服务器运行：

```sh
npm run research:stock -- capture /private/stock-observation-config.json 600000
npm run research:stock -- once /private/stock-observation-config.json
npm run research:stock -- watch /private/stock-observation-config.json
```

示例结构见`config/stock-observation-monitor.example.json`；真实配置0600，目录0700，不进入仓库。自动启动环境变量分别为`V6_STOCK_OBSERVATIONS_DIR`、`V6_STOCK_INTELLIGENCE_DIR`、`V6_STOCK_OBSERVATION_QUEUE_DIR`；可用`V6_RESEARCH_CALENDAR_FILE`指定独立私有日历。冻结板块配置为`V6_RESEARCH_SECTOR_CAPTURE_DIR`及可选明确`V6_RESEARCH_SECTOR_IDS`，不在HTTP中接收这些路径。

## 实际验证与边界

真实有界探测曾取得腾讯3根OHLCV；首次120根请求东财503、腾讯附注结构被误拒，修复后单次取得120根未复权日K。完整真实采集链已生成内容观察和研究档案，目标日期为2026-11-13；交易状态/公司行为证据缺失、历史合规样本不足，因此概率保持未知。该代码样本用于数据通路验收，不是荐股或收益认证。

自动化包括真实HTTP编辑权限与私有路径保护（curl亦mock）、双进程CAS、SIGKILL恢复、额度、重启、来源继承反例、迟到数据、日终时钟、凌晨/周末前瞻、旧v1兼容、官方日历及板块重放。Python分类采集器同时修复“流结束后才报错却发布半份成员”的问题，原错误路径实际执行在Node全量测试中。研究页在320/390/1440 Chromium夹具测试无横向溢出，不是真机或原图1:1验收。最终全量数量与CI运行链接以本轮PR交付记录为准。

已在上述最新dev基线上实测：Node22.23.5、ML Python3.11.18及仓库固定依赖，全量2176项通过/0失败/0跳过，TAP完整性检查通过；网页构建和40项测试通过、dist一致，历史接收工具20项通过、完整服务隔离HTTP启动检查通过，OpenAI/ChatGPT运行时依赖禁入审计通过。此前第一轮2164项不代替同步PR178后的最终2176项。本地完整证据位于`/workspace/evidence-causal-market-memory`，私有行情和配置不入库。

收尾又将源观察链改为逐条验证，避免同时把500份完整历史装入worker堆；18项store专项全过，其中新增180版×500bar、约80MiB档案在96MiB受限堆下完成最新/历史查询与后续篡改检测。存档schema、完整性和容量门禁保持；该新增用例在最终CI全量中一并执行，最终数量见CI日志。

仍未证明实盘收益提高、持续源可用性、完整交易状态/公司行为原始时间与真实前瞻净收益。工作环境中的watch不能代表24小时生产服务；指定WorkBuddy部署目标未取得可用写入鉴权，不转投其他主机。回滚用本轮提交的git revert，私有行情/意图/历史独立留存，不随代码回滚删除。

本轮重新读取指定目标`/api/ai/doc?id=ai`返回HTTP403，未猜测写入路径、未部署、未换主机。
