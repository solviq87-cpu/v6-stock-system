# 绯曜 FAYO D组第十一批｜五项行情因果、质量计数及证据联动整改

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。五个局部小任务，关联 D27/D33/D34/D36/D37/D38/D41/D43/D44/D48/D55/D70/D77/D78；未认定整个大项完成。D42四套策略正式接线与B组牛熊主链最终验收仍待总管，本批不直接覆盖正式策略或市场分类模型。

1. 原行情快照时点审计：区分实际原始 retrievedAt 与后续 asOf；原回执必须为明确 ISO 时间，未收悉或原回执未知不再计算近期来源；原来未来报价不能事后变近期。保留原90秒研究默认与其他显式研究阈值，不放宽交易15秒门禁。旧无回执记录保留诊断状态。
2. 既有板块行情联动：独立证券去重集合，不因第一条报价无效漏检重复；原收悉时点与读取时点双重门禁，明确停牌/不可交易/冲突记录不充当板块有效涨跌样本。仍用原等权代理、冻结成分股、原80%覆盖要求，不认证指数或交易。
3. 数据质量统计：布尔证据、非负整数计数、正分母、成交额覆盖守恒；拒绝虚假覆盖与非法统计值。保持原85分上限和评分口径，不把质量分称为价格准确率。
4. 数据源观测窗口：按事前槽位顺序检查报告时点严格递增，重叠延迟窗口不允许同一探测或逆序报告重复充当成功样本；原统计分母、15秒时效、时间对齐及不自动换源规则保持。
5. 扫描保留快照：主列表与板块内嵌个股同样保留原报价/接收时点，原快照完成时尚未存在或先后矛盾的报价标记 snapshotTimeConflict/sourceConflict。后续读到只能保持未知，原价及原时点留作显示审计，不恢复交易/通知权限。复用原快照文件及版本，不新建数据中心。

## 实测
原文件精确 blob：
- V6_BO/src/core/market-snapshot-quote-time.js: 3cd7f7e1f223413199087c860d39f512f06d5610
- V6_BO/src/core/sector-breadth-market-bridge.js: 4d001ece85a940c90d1c1e8b59f0b3a596588bec
- V6_BO/src/core/market-evidence-quality.js: 9b678f381125aebbaf9f27fc82d6b2c3d5fda959
- V6_BO/src/core/quote-source-window-quality.js: f6ee67b2aff870c5db8ef769e51f7f1930886ec5
- V6_BO/src/core/market-response-snapshot.js: c3794f1f604972ecabcdc4ca055b039570a7911f
隔离V8执行原/修后五模块和真实 a-share-calendar、daily-sector-strength、quote-observation-view、session 逻辑。摘要、未调用文件系统/路径及公开探测依赖为测试桩；仅针对旧板块测试的纯JSON数据提供JSON复制作为 structuredClone 夹具。首次测试因环境缺 structuredClone 导致一项原测试无法执行，补齐夹具后统一重跑。无真实网络、磁盘回放、原生Node或全量执行。正式新增测试为 node:test。新增 11 项修前 3/11，修后 11/11；既有 market-session-window-hint 4项、quote-source-window-quality 8项、sector-breadth-market-bridge 前4项同步用例共同通过，组合 27/27。未执行既有窗口CLI、板块pipeline/CLI及原快照磁盘测试；原测试均未修改。修前失败：
- later quote audit never promotes original future-at-receipt evidence: equal: expected 1 got undefined
- audit time cannot substitute for a missing, invalid or later snapshot receipt: equal: expected 0 got 5
- sector bridge refuses duplicates even when first copy had no usable quote: equal: expected "duplicated-or-malformed-market-symbol" got "fresh-market-quote-coverage-insufficient"
- sector proxy excludes future-at-receipt and explicitly conflicting or halted quotes: equal: expected "fresh-market-quote-coverage-insufficient" got undefined
- quality scoring refuses invalid denominator, negative or impossible counts and coerced flags: expected exception /统计/ got none
- overlapping report-lag windows cannot count one quote diagnostic twice: equal: expected "blocked" got "limited-alignment-unverified"
- a delayed earlier slot cannot reverse the diagnostic observation order: equal: expected "blocked" got "limited-alignment-unverified"
- future original quote or receipt in retained scans cannot become current later: equal: expected true got undefined

## 交接
已查 #427 两页、#430/#458/#457/#456/#454/#450/#449/#447/#441/#436/#433/#407/#410/#419 相关路径无重叠；未宣称全历史冲突扫描。#410 的 market-feed-consensus 调用字段保持相同。总管协调 B组 live-market-research/live-candidate-bridge/market-breadth 以及四套策略正式消费方，避免仅改研究侧审计就误称交易门禁已联动。#431/#433/#436/#441/#443 各自远端CI及浏览器已通过，Commit Coverage仍未通过；#439新头及后续PR待验。未合并、发布、部署、购买、启用行情；原15秒交易门禁、原权限与历史账本保持。回退仅撤销本隔离补丁。
