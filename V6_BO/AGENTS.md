# AGENTS.md — 量化看盘项目 AI 协作规则

> **云端多端及周末规则（用户2026-11-09确认）**：手机、电脑是同一云端读客户端；两端分别可手动/自动更新，另一端离线不影响；账户、观察池和历史不能只保存在某台手机/电脑。休市继续刷新新闻公告，盘面标注最近交易日并冻结，不触发模拟成交；禁止重复采集和未经授权的收费接口。云端飞书唯一主实例，周末新闻公告可以继续发送，休市旧报价不得触发选股交易提醒；敏感信息仅私密通道且不能因为超时自动改发公共群。操作与验收见 `docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md`。

> **交接绝对不要忘国内目标**：用户指定 WorkBuddy 主机 `https://acd98a1c1a46e6ce4.app.workbuddy.host`；文档入口 `/api/ai/doc?id=ai`。先读 `docs/CHINA_WORKBUDDY_WRITE_TARGET.md`；当前文档读取报401，实际写入路由及鉴权未核实，禁止猜路径、硬编码分享码或自行更换部署地址。

> 本文件对 AI Agent（Claude Code / WorkBuddy / 任何 AI 编程助手）生效。
> 每次修改代码前必读。用户已确认（2026-10-28）。

> **选股结果入口与研究条件守门（2026-11-09）**：用户在 `/picks.html` 直接看本次云端选中的股票及命中条件，手机/电脑都可滑动、筛选、联动历史 K 线。公开规则先核对现有实现，新增只作研究候选，不以同族重复信号充当独立战法，不动正式4套策略和权威模拟账本；缺行情就显示空/未知。交接见 `docs/PICKS_RESULTS_HUB_AND_RULES_20261109.md`。

> **最高优先级 UI 参考图（用户一再强调）**：手机 `7165.jpeg`、电脑 `E419BE1D-AB04-4D50-A482-8676AE7FB869(1).jpeg`。实际页面必须按图还原；手机可读性、桌面多栏比例、七项底栏、K线与解释都要实测。切勿把静态参考截图冒充线上实机验收，见 `docs/ORIGINAL_UI_REFERENCE_ACCEPTANCE_20261109.md`。不得为了视觉相似删除四套策略、云端刷新、模拟盘、风控、飞书与研究入口。

## 一、界面简洁铁律

**删掉多余的标语、说明文字和次要标签。**

- 界面上每一个元素都要回答"用户需要它吗？"
-  decorative 文字、重复提示、过期标签——直接删
- **自测方法**：如果把说明文字全删掉，界面就看不懂了 → 说明布局本身有问题 → **重新设计布局**，不是加更多文字去解释

## 二、改动质量铁律

**每次修改必须同时兼顾三个体验，缺一不可：**

| 体验 | 含义 | 检查点 |
|------|------|--------|
| **用户体验** | 最终用户在手机/电脑上看得到、点得到 | 功能正常、界面不混乱、提示清晰 |
| **开发体验** | 后来维护代码的人（人或AI）读得懂 | 注释说明"为什么"而非"是什么"、命名清晰、结构合理 |
| **AI Agent 体验** | AI 改代码时不会误伤、不会踩坑 | 版本号一致、测试可回归、配置不污染、模块边界清晰 |

**底线：不能破坏现有功能。**

- 改 A 功能前，确认 B/C/D 功能不依赖被改的代码
- 版本号四端同步 bump（server.js / index.html / mobile.html / sw.js）
- 改配置时注意区分"本地副本配置"和"线上配置"，不要把 pushRole=replica 之类的本地状态带到线上

---

*最后更新：2026-10-28*

> 20261106aw：完整监视历史离线归档恢复，操作见 integration/MONITOR_HISTORY_ARCHIVE_OPERATIONS.md；原as协议/四策略/双端布局保留。

> ax新增研究参数消费预期修订保护，未接后台/HTTP；见integration/REVISION_CONSUMPTION_OPERATIONS.md。

> ay新增双端同源只读风险卡/关联新闻展示与K线切股竞态修复；数据未认证保持观望，新增需求尚未全部完成。

> ba：三路授权网关并行采集核验，来源尚未接通认证；操作见integration/PARALLEL_MARKET_OPERATIONS_20261106ba.md。

> bb公开报价三路适配，新浪实测403，双源HTTP200不代表三家生产验收；见integration/PUBLIC_MARKET_OPERATIONS_20261106bb.md。

> bc可选SDK与公告研究采集，mootdx连接失败，efinance/巨潮单次实测成功；不作为实时或交易认证。

> bd登记14来源、增加Ashare/BaoStock适配与新采集器访问门禁，不代表全部已接通或全工程法律认证。

> be独立冻结信号远期价格观察CLI；非模拟盘净收益、不写账户。见integration/FORWARD_SIGNALS_OPERATIONS_20261106be.md。

> bf新增独立因子健康诊断CLI：冻结现有因子ID/版本/门槛，逐票输入质量与横截面均值漂移；不改权重、不认证收益衰减。见integration/FACTOR_HEALTH_OPERATIONS_20261106bf.md。

> bg按用户排除收费原生接口：新增腾讯/东财等一次性免费公开报价检查与双端带日期只读展示；非持续实时接通，不购买、不启用付费原生接口，旧生产许可门禁保留。见integration/FREE_QUOTE_PROBE_OPERATIONS_20261106bg.md。

> bh选择合并用户参考包的稀有类型样本剪枝修复；现有腾讯批量快照增原始时点元数据。收费接口不启用，盘中实时与全链消费时点门禁仍待，见integration/REFERENCE_MERGE_OPERATIONS_20261106bh.md。

> bi仅按用户六张照片逐行核对30条：7条本环境返回并接研究备用，凭据/客户端型待条件；新显式采集器、只读备用库和批量报价末级备用，禁止旧/未知时间补实时，禁止只读备份进lastPx。见integration/SIX_PHOTO_OPERATIONS_20261106bi.md。

> bl：模拟盘成交只认逐票原始报价时点15秒，持仓优先巡检；见integration/PAPER_ORIGINAL_QUOTE_OPERATIONS_20261106bl.md。

> bm：权威账本报价与风控marks保留逐票原时点15秒门禁；见integration/AUTHORITY_QUOTE_TIME_OPERATIONS_20261106bm.md。

> bn：共用仪表盘逐票快照原时点展示与风险覆盖统计，列表接收不替代报价时点；见integration/DISPLAY_QUOTE_TIME_OPERATIONS_20261106bn.md。

> bo：精选/趋势/连阳三类池保留同一价格行的来源和原始报价时点，不借其他快照补时间；见integration/POOL_QUOTE_OPERATIONS_20261107bo.md。

> bp：仓库根npm命令转发V6_BO，容器补Python/curl/flock基础依赖；见docs/GITHUB_UPDATE_20261107bp.md。
