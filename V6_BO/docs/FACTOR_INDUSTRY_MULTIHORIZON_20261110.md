# V6 第三阶段：信号时点行业中性化及1/5/20/60交易日因子验证
2026-11-10

## 为什么要做

已有V6研究模型根据冻结信号、当时的扩展因子分数和5日成熟收益进行滚动学习。但某个因子看似有效，可能只是高分股票恰好集中在强势板块。该研究插件建立同一日的原始因子IC和行业内去均值因子IC两个对照，识别这种行业混淆。所有结果仅供独立研究，不是行业中性化可成交净收益或因果结论。

## 原始行业分类必须当时就已存在

在既有factorSnapshot.rows的逐票评分证据中，可以额外提供：

- industryCode: "SW_A" （仅说明协议，不是真实板块代码）
- industryEvidence: {source: "与factorSnapshot.feed.provider一致", timestamp: 信号当时已取得的毫秒时间戳, classificationVersion: "当时的行业分类版本", code: "600001"}

行业代码只允许2–32位字母、数字、点、下划线、横线。来源、逐票代码、分类版本及毫秒时间必须严格有效且不晚于对应股票信号日的实际信号时刻。不接受未来行业分类、错误代码、模拟来源及跨交易日证据。没有提供行业字段的股票继续参加原始IC诊断，但**不允许偷偷从当前的行业成分推测旧行业**。若提供了行业字段却无正确证据，冻结流程直接拒绝。

## 行业中性化方法

对同一交易日每个指定窗口的真实观察价格变化进行两种研究性Spearman秩相关：

1. 原始IC：已观察股票的当时因子分数与未来未复权价格变化，至少5只独立股票。
2. 行业内去均值IC：在每个行业内，将各股票因子分数减去同业平均，将未来价格变化减去同业平均，然后对两个残差计算Spearman秩相关。至少2个行业、每行业至少2只有效股票、合计至少5只有效股票。行业分类来源或版本冲突则不计算。

同一股票同日出现多条不同规则信号时，将这些重复信号从IC有效分母移除，不用重复计数制造样本量；原始信号仍留档。停牌、缺价、公司行为和未到期窗口必须如实单列，不能填0收益。逐一验证1/5/20/60交易日窗口的目标日期、状态和值；自然日不能代替显式交易日历。

## 结果和门禁

各期输出原始IC与行业内IC可计算的独立信号日数、平均IC、观察数、待到期/缺价/公司行为数、分类冲突及覆盖不足的原因。

只有四期各至少15个有效的独立交易日行业内IC数据，才给出描述性的跨周期方向一致性：

- insufficient-multi-horizon-industry-evidence：数据不够，绝不称通过
- mixed-horizon-directions：不同期限的行业中性方向存在冲突
- directionally-consistent-descriptive：方向一致，但仍不能证明净收益或未来可实现的优势

所有报告强制 canTrade:false、autoPromotion:false、weightsChanged:false，且safeForAutomaticProductionPromotion:false。**本次不会把60日统计直接写进正式策略或影子学习模型的升版权限**；下一阶段需真实60交易日证据和独立样本外检验才考虑将其变成晋级门禁。

## 调用（仅私有授权输入）

前两步需先由已有capture/maturity任务产生当日冻结行业信息和连续跟踪归档。随后可用：

    npm run factor:neutral:once -- /srv/v6-private/daily-captures /srv/v6-private/tracking /srv/v6-private/neutral-reports

持续只读观察：

    npm run factor:neutral:watch -- /srv/v6-private/daily-captures /srv/v6-private/tracking /srv/v6-private/neutral-reports --interval 60000

每次只读原有不可变capture与经SHA校验的tracking当前快照，在私有目录新增权限0600、按输入和报告指纹不可覆盖的neutral-horizons-<fingerprint>.json。相同证据不会重复发布，收到更多20或60日成熟数据则新建研究报告，旧报告不修改。

## 明确限制及回归

未采购或接通任何收费行情、未验证第三方行业分类授权与历史组成、未通过WorkBuddy真实云部署验收。来源为imported-unverified，不代表交易所证明。相关持有期股票样本仍存在重叠，且未纳入手续费、滑点、行业权重指数和市场基准。回归里的证券、行业和价格均是合成协议夹具而非实际A股行情。

验证命令：

    node --test tests/factor-industry-multihorizon.test.js tests/factor-evidence-capture.test.js
    npm run check
    npm test

既有四套策略、基础15因子配置、账户、模拟盘执行与手机/电脑原主页全部保持不动。