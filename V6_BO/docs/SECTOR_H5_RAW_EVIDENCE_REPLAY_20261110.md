# V6 板块 H5：从原始冻结证据逐行业重放再评分

2026-11-10。本批补的是 PR #100 和 PR #108 之间的研究完整性门禁：PR #108 会核对标签中成员回报的均值、跨日来源和非重叠窗口，但**只拿一张声称已成熟的标签表**时无法独立复核成员信号时点、原始K线以及当时的板块排名。格式正确的自报标签**不等于**已复算的原始证据。

## 研究入口（默认不运行，不联网）

- `replaySectorH5DailyEvidence(entry,{asOf})`：只重放单个交易日。输入 `{snapshot,membership,preflight,preflightAsOf,industries}`，其中 `snapshot` 是当时完整原始市场快照；`membership` 为当日冻结行业成员；`preflight` 为 PR #92 当天得到的原结果；`preflightAsOf` 是当时预检的原始研究时钟（Unix毫秒）；`industries` 为当时所有已排名行业的 `{sectorCode,cohort,market,label}`。
- `evaluateReplayedSectorH5WalkForward(entries,{tradeDates,asOf,roundTripCostBps})`：24～80个独立信号日的原始材料，逐日先通过上面的重放，再调用已合并 PR #108 的固定分组、非重叠 H5 与成本压力评分器。至少需要150个显式交易日的升序日历；不能直接把已算好的 `labels` 表送入这个入口。

## 复核机制

1. 从当日原始 `snapshot` + `membership` 用 `inspectSectorShadowEligibility` 重建预检，必须与 `preflight` **全字段严格一致**，不允许修改当日行业排序、归类来源、数据质量和报价时点后仍使用原结果。
2. 必须提交该日 **每一个已排名行业** 的独立 `cohort`、原始 `market` 及声称的 `label`；行业重复、缺少、跨行业重复成员股票都拒绝。不能只提交赢家。
3. 对每个行业调用原版 `evaluateSectorShadowH5PriceLabels`，它会再调用原版 `evaluateForward`，核对冻结信号指纹、同日未复权基准收盘价、明确第5交易日的原始K线、成交量、停牌、公司行为与合格覆盖。没有全部到期、存在任何停牌/缺价或公司行为，则不能输出整个行业H5毛收益标签。
4. **所有字段严格比较**声称的 `label` 和从原始证据重建的结果。自行改写某行业5只股票的收益，即使把它们的均值和中位数一起改成看似自洽的9%，仍会被阻断。
5. 24～80个交易日全部重放后，继续使用 PR #108 固定的至少12/6/6训练研究/验证研究/保留测试三段，信号日间相隔至少6个明确交易日、H5结果无重叠；固定成本敏感性压力分析。无证据或时间泄漏全局阻断。
6. 遇到新源、来源更名、历史成员变动、归档损坏，需重新验证完整原始资料，**不**默默替换成缺值0，不会删除历史证据。

## 不能误认成的能力

这是**数据内部一致性重放**：源自谁、何时真正冻结、价格有没有得到授权、交易所日历是否完整、运营成本是否真实，这些都无法仅靠用户可编辑的JSON、哈希或合成测试证明。因此输出 `rawEvidenceReplayed:true` **仅表示输入材料与现有算法重算一致**，始终 `externallyTimestampCertified:false`、`providerLicenseIndependentlyVerified:false`、`prospectiveCertified:false`、`outOfSampleValidated:false`、`eligibleForResearchPromotion:false`、`canTrain:false`、`canTrade:false`、`autoPromotion:false`、`weightsChanged:false`。不修改正式权重或将研究信号传入模拟盘。历史保留测试已经被观察过，不能随意复用再调参数。

模块为纯函数，无自动采集、无网络、无写入。用户仍需另行取得真正的事前冻结记录、合规行情、外部样本与费用/滑点/停牌可成交性证据才能讨论策略表现。

## 运行回归

```sh
cd V6_BO
node --check src/core/sector-h5-raw-evidence-replay.js
node --test tests/sector-h5-raw-evidence-replay.test.js
npm run check
npm test
```

测试构造冻结的完整市场快照与成员、一日各行业的cohort与未复权日线，然后验证原始价变更、强势板块排名偷改、伪造成对的股票收益+均值、缺行业/重复成员、公司行为/未来缺价、跨日重复/重叠以及成本极端值均被安全拦截。**这些均为离线合成协议测试，不是实际A股、供应商许可、用户服务器或真实收益的验收。**

本 PR **只新增研究模块、测试和本文档**；严格不修改电脑或手机锁定主页、正式四策略、15因子、模拟盘账户、资金、已批准接口以及其他AI正在开发的板块1/5/20日审计与模型试验预算。