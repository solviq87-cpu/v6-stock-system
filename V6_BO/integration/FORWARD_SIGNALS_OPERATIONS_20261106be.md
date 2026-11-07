# 信号远期价格验证小项目 be

唯一新增基线bd1006完整工程，SHA-256 8c828825f6ebe016f42fa4ea5fded8a660a543c528f88315dcdf1b2b4fcbe68d。新增纯研究模块src/core/forward-signal-observer.js和CLI scripts/forward-signals.js；原四策略/账户/数据源规则未改，手机电脑款式保留，仅缓存版本be。没有后台自动收集、HTTP写入或新页面入口；本小项目通过显式CLI消费真实来源输入。

## 操作

```bash
node scripts/forward-signals.js freeze /safe/signals.json /safe/new-cohort.json
node scripts/forward-signals.js evaluate /safe/new-cohort.json /safe/market-day1.json /safe/new-report-day1.json
node scripts/forward-signals.js evaluate /safe/new-cohort.json /safe/market-day2.json /safe/new-report-day2.json
```

每次输出必须为新文件，已存在、符号链接输入/路径拒绝，输入普通JSON限8MiB；完整暂存+同步后硬链接不覆盖发布。第二日复用同一冻结信号，提供截至第二日的独立市场快照，不能改旧文件假装已验证。SHA只核验完整性，不是外部签名。

## 信号协议

schemaVersion=1，feed={source:imported/fixture/simulated,provider,datasetId,priceBasis:unadjusted}，signals为1至500条。每条signalId唯一、symbol六位、system=fourteen/bazi/gpt/python/manual、cohort分组、provenance非空、signalDate真实日期、signalAt毫秒时间、baselineClose正数。信号必须在该日上海16:00或之后才可用当日收盘为基准；不支持直接用盘中尚不可知收盘价。不同信号ID允许同股同策略不同日期重复观察，不按股票代码删掉后续信号。

## 市场协议

schemaVersion=1，同一feed；asOf日期、observedAt毫秒时点需在asOf上海16:00或后且不超过实际时钟。calendar显式严格递增，含信号日/asOf及已知未来交易日，不能用自然日替代。stocks每条symbol唯一，bars严格递增，每根{date,close正数或null,volume非负整数,suspended布尔}；corporateActions必须显式数组（空数组是输入方声明无公司行为，不是本工具认证）。日期必须在日历中且不超过asOf，禁止载入未来价格。价格与日历必须来自有权使用的数据，工具不采集外网。

每个信号基准收盘必须与冻结值完全相同；来源/数据集/复权协议不符拒绝。最多500只，每只10000根；CLI输入8MiB限制仍生效。

## 结果口径

按交易日历索引观察1/5/20/60个交易日，不到期pending，日历不足calendar-incomplete，到期缺价/停牌/零量missing-or-suspended；不顺延到后面更有利的交易日。基准与目标之间有公司行为，corporate-action-unresolved，不用未复权价格计算伪收益。记录分system/cohort汇总，平均值只用observed记录，列出观察/未观察数量，未成熟不填零。

唯一收益字段priceReturnPct是信号日收盘至未来目标交易日收盘的未复权毛涨跌幅，未包含成本/滑点/税/资金/涨跌停成交限制，不是T+1可成交净收益、胜率或涨停概率。executionSimulated=false、canTrade=false、verifiedLive=false。原模拟盘的交易限制不受此模块影响。

冻结只能证明本次文件之后未被修改，无法证明历史信号确实在当时产生、日历是真实交易所日历、公司行为已全覆盖或供应商独立；prospectiveCertified=false。fixture测试不证明真实策略表现。

## 参考来源

参考了deepseek-harness-quant的远期观察设计，固定提交9f72ab7e64799aecfc79cf3b913359acea1dd9b9。本实现独立适配V6，无拷入其数据库/账户/AI运行时，原许可和参考说明见third_party/reference_harness/LICENSE与NOTICE.md。没有照搬按代码唯一去重或把收盘价格观察当交易净收益。六组参考改造只完成本小项目，因子生命周期、逐票证据卡等仍待。

其余数据源授权/目标机稳定性/真实新闻/概率校准/个人仓位闭环和六类现场验收仍待。未部署、未购买、不接CMR/多模型网关/真实券商。
