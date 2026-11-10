# V6 双来源盘中复权数据的跨交易日质量研究

2026-11-10。本模块延续已合并的双供应商复权对账，仅统计多交易日信号的来源对质量与证据可比性，**不证明两家真实独立或任何一家已经正确**。仅离线消费合法导入的历史档案，无网络、交易、报价主源切换或正式因子训练。

## 输入

入口：V6_BO/src/core/sector-provider-pair-rolling-quality.js 的 auditSectorPairQuality；CLI：V6_BO/scripts/sector-provider-pair-quality.js。

输入文件为 JSON，顶层包含 schemaVersion=1、mode="sector-provider-pair-quality-imported-input"、source="imported"、asOf、tradeDates、expectedSignalDates、policy、episodes。

- tradeDates 必须是明确升序的交易日历，22–2500个日期，不可用自然日随意替代。
- expectedSignalDates 为**预先登记的预计冻结信号日**，按日期升序且无重复，1–90个，全部在日历内。缺少某一天档案时不会将其从统计分母抹掉。
- policy 包含 schemaVersion=1、mode="preregistered-sector-provider-pair-quality"、registeredAt（时间戳，最早预期信号日北京时间9:30前）、minMaturedSessions（3–30）、maxDisagreementRatePct（0–50）、maxNonComparableRatePct（0–50）。这是运营者设置的研究门槛而非交易所标准；不能验证历史预注册是否真实发生。
- episodes 是先前双来源审计的完整输入对象集合，每项都有 primary、secondary、policy、asOf；所有冻结原始行情、成员、交易日历和公司行为均沿用上一批已审计对象。程序逐批重新执行已合并的 auditSectorDualSource，不相信操作者手填的报告状态。
- 不同日期的两家供应商身份、行业分类版本、报价来源、指数代码与阈值必须不变。不一致意味着两项不同研究，整体阻断，禁止把不同口径拼成改善趋势。

## 审计规则

分别对第1、5、20个**明确交易日**后续窗口统计：

1. 未成熟：对应目标交易日未到或显式日历不够长，计 notMaturedSignalDays，不当作数据失败。
2. 应有记录但缺档：计 missingEpisodeDays；时间已到但观察仍pending：计 pendingAfterMaturityDays。
3. 行业不完整或来源不可比：计 unknownOrPartialDays；真实双源行业或指数分歧：计 disagreementDays。
4. 完整比较且差异不超限：计 agreeDays。comparableRatePct 是可比较信号日/已成熟预期信号日；nonComparableRatePct 把缺档和无效数据都算入分子；disagreementRatePct 的分母仅为可比较信号日。各报告还列出逐股复权收益最大基点差、同指数最大基点差。
5. 触发超过事先登记阈值则 status 为 pair-quality-watch-unverified；成熟样本不足为 insufficient-evidence；全部窗口门槛满足才是 pair-quality-reviewed-unverified，仍非真实数据认证或生产可用性。

报告恒有 canTrade=false、canTrain=false、outOfSampleValidated=false、providersIndependentlyVerified=false、approvedSourceForTrading=null。只说明这**一对**数据的研究质量，绝不推断哪一家“错”或自动改行情源、正式权重、模拟盘、用户主页。

## 离线运行

在 V6_BO 目录运行：

- 只读预览：node scripts/sector-provider-pair-quality.js preview /private/pair-bundle.json
- 私有发布：node scripts/sector-provider-pair-quality.js publish /private/pair-bundle.json /private/reports/pair-quality.json
- 专项测试：node --test tests/sector-provider-pair-rolling-quality.test.js tests/sector-dual-adjusted-source-audit.test.js
- 全量门禁：npm run check && npm test

发布模式仅保存研究结果，0600私有文件、不可覆盖、同内容幂等；被阻断或样本不足不发布。测试为构造样本，不是当前供应商已接通的真实持续服务或数据授权验证。

## 未完成

需以真实合法数据审核不同供应商的独立性、持续可达、历史信号日的真实预注册、原始报价时间、复权公司行为、指数总收益以及长周期交易日历；再讨论长期样本外和错误来源归因。现有四套策略、模拟盘、账户、网页、生产定价及因子配置均未触及。
