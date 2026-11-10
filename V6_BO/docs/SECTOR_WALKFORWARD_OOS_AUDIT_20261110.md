# V6 板块影子学习：冻结价格的时间隔离与样本外防泄漏审计

**2026-11-10。** 本模块在 PR #107 的 1/5/20 日冻结成分股原始价格观察之上，新增**纯离线**时间分割审计与私有不可变输出。它不把未复权行情毛价差当作可执行净收益，不将观察成熟视作可信的样本外模型证明，默认不训练/不晋级/不修改四套正式策略。

## 为什么不能直接自动学习

既有 `sector-frozen-forward-prices.js` 仅计算冻结时成分股的盘中未复权原价变化；`sector-shadow-forward-observer.js` 仅比较行业评分和广度。它们都没有真实的复权总收益、市场基准、交易成本、流动性以及独立的交易日历认证。直接拿后续价格表现去调正式因子，有未来标签泄漏、重复成分股伪独立样本、样本不足和“拿同一批数据设计又验证”的风险。

本批新增 `src/core/sector-walkforward-oos-audit.js` 的 `auditSectorWalkForward`：
- 每个事件必须是**冻结当天**的 `sector-frozen-raw-quote-price-cohort` 及与其指纹匹配的 `sector-frozen-forward-gross-price-observation`；校验 SHA-256、信号日期、原始时间、三条1/5/20窗口和所有逐板块值。
- 明确操作方提供的真实交易日历（不补自然日）、`trainThrough`、`testFrom`、评价时点和训练/验证最少独立事件数。**同一信号日最多一个事件**，消除同一天多次采集制造的伪样本。
- 对每个期限独立做信息交叠剔除：如果某训练信号在后续第N个交易日才成熟，而该天已达到验证窗口开始日，就从该期限训练样本中删除。尤其防止**最长20交易日窗口的标签泄漏**。
- 仅用信号当天排名最高、无排名并列的**行业**做预先确定的领导行业，和同日其他已冻结行业的平均毛价格变化相减；概念板块可能高度重叠，不作为独立同行对照。任何行业不齐、缺价、停牌或公司行为未覆盖，窗口不成为合格样本。
- 各期限分别显示 `trainCount`、`testCount`、`purgedTrainDates`、待观察与缺证据日期，以及在最小样本数满足时才提供的*训练/验证未复权毛价差描述性均值*。训练期有效而验证期变差也如实展示，不挑选好看的时间窗。
- 跨行情来源、行业分类版本、不一致的冻结指纹、被改过的未来观察、伪造净收益字段均拒绝拼接。数据许可和市场基准未独立验收时不可宣称统计显著或盈利优势。

输出始终包含 `outOfSampleValidated=false`、`labelsAvailable=false`、`canTrain=false`、`canTrade=false`、`weightsChanged=false`、`netReturnsAvailable=false`。状态 `temporal-partition-reviewed-unverified` **仅代表时间切分门禁和描述性样本数通过**，不代表数据已认证或模型已通过样本外收益检验。

## CLI：完全离线

在 V6_BO 目录准备 JSON，字段示意：

```json
{
  "schemaVersion":1,
  "mode":"sector-walkforward-oos-input",
  "episodes":[
    {"cohort":{"...":"冻结文件中的完整frozen对象"},
     "observation":{"...":"evaluation归档中的完整report对象"}}
  ],
  "tradeDates":["2026-11-04","2026-11-05","2026-11-06","2026-11-09","2026-11-10"],
  "trainThrough":"2026-11-05",
  "testFrom":"2026-11-09",
  "asOf":1794348000000,
  "minTrain":5,
  "minTest":5
}
```

这是**字段位置示意**，不是可直接运行的实盘输入；有效日历必须至少24个明确交易日，所有输入 cohort/report 要从先前不可变私有档案提取，且每个样本及窗口严格对齐。这不会主动扫描硬盘或在线拉取数据，也不把历史样本倒填成当时真实已冻结的信号。

```sh
node scripts/sector-walkforward-oos-audit.js preview /srv/v6-private/sector-walkforward-input.json
node scripts/sector-walkforward-oos-audit.js publish /srv/v6-private/sector-walkforward-input.json /srv/v6-private/sector-oos-research/audit-20261110.json
node --test tests/sector-walkforward-oos-audit.test.js tests/sector-frozen-forward-prices.test.js
npm run check
npm test
```

`preview` 不写入文件、不联网；`publish` 只写新的0600私有报告，内容带本地 SHA-256 完整性校验，重复发布幂等，不同数据拒绝覆盖；输入协议被阻断时不发布。两个命令都不触碰账户、模拟盘、正式策略配置或网页。

## 验收状态与后续任务

该批离线测试使用**合成日期及构造报价**，测试“训练期间更好而验证期间更差”的负优化场景、20日窗口与验证期边界重叠剔除、缺数据不补样、分类版本冲突、篡改和无写入预览。合成测试通过只说明代码协议成立，不说明真实策略可靠。

生产级自动学习之前仍缺：
1. 真实且授权的复权/公司行为价格数据，与冻结原始档案逐股票对账；
2. 独立可比较的上证/深证/创业板等基准，交易时点一致、风险和成本完整、统一费用日历；
3. 更长日期的真实样本量、交易日历及事件时点审计，按行业和市场环境分层并采用时间锁定参数的多次滚动窗；
4. 真实网络质量、断线恢复、行情源稳定性及运营许可；
5. 正式门禁允许研究级影子权重实验之前的人工审查，**绝不直接把这一阶段的毛价统计送入生产因子**。

回滚本PR仅影响新增的离线审计核心、脚本、测试和文档；不改主页（`public/index.html` / `public/mobile.html`）、四套策略、模拟盘、账本、生产权重与云端部署。
