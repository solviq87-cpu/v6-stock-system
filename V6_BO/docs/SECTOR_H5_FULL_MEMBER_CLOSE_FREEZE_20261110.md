# V6 板块全行业成员：当日未复权收盘价冻结

2026-11-10。与已合并 PR #149 的候选归档配套：候选需在当天15:00～16:00采样并及时归档；**所有已排名行业的每个股票收盘基准价，在16:00～17:00另行冻结**，不能事后补造。

## 命令

先用既有 sector-shadow-candidate-capture.js 显式保存 candidate-YYYY-MM-DD.json。随后操作者自行准备已合法取得的同日原始未复权收盘数据（不是未来收益），执行：

    cd V6_BO
    node scripts/sector-h5-full-member-close-freeze.js once /private/v6/candidate-archives/candidate-YYYY-MM-DD.json /private/v6/eod/close-YYYY-MM-DD.json /private/v6/cohorts

EOD close JSON 契约：schemaVersion=1，mode=sector-h5-imported-signal-day-eod-closes-unverified，tradeDate=YYYY-MM-DD，observedAt=北京时间16:00后且当前运行前5分钟内的Unix毫秒；feed={source:"imported",provider:"供应商标识",datasetId:"固定数据批次",priceBasis:"unadjusted"}；stocks数组逐股提供{symbol:"六位股票代码",tradeDate:"YYYY-MM-DD",close:正的未复权价格,volume:正整数,suspended:false,vendorQuoteAt:当天北京时间15:00～16:00之间Unix毫秒}。**不接受futureBars、priceReturnPct或其他额外输入字段。** 此处仅为协议说明，不含真实报价。

必须覆盖预先冻结的所有已排名行业的**完整股票成员**，每个行业5～500只，总量最多6000只；跨行业重复股票、缺价、额外股票、停牌、零量、过时原报价、非法时间、混源、成员SHA变化、冒充历史冻结一律整批拒绝。

输出为私有目录内 cohorts-YYYY-MM-DD.json，每行业一个独立的原版 frozen-forward-signal-cohort：每只股票的signalDate、signalAt、baselineClose和原始来源均被冻结，并产生SHA256指纹。它可供未来显式交易日历及真实第五个交易日的未复权价格重放使用，但**没有生成任何未来K线、收益标签、交易建议或自动训练样本**。

## 写入边界

- 完整校验 PR #149 原始候选封存、SHA、快照时间、原始行业成分和候选预检；不允许重排行业、改变信号基准或从旧日期生成新cohort。
- 只读取已有私有文件，不访问网络、行情收费接口或模拟盘。路径必须为绝对路径，拒绝public和符号链接；单份输入限32MiB、档案限40MiB。
- 新档案0600权限，输出目录必须为私有0700级别（拒绝任何组/其他用户可进入的目录），临时写入+fsync+原子硬链接发布；已存在的同日输出绝不覆盖。同一源重复运行只能按当初冻结时钟验证相同文件字节和指纹；冲突则阻断。
- 首次成功：full-industry-close-cohorts-captured-unverified（退出0）；已有相同档案：already-frozen-identical（退出0）；证据不足：blocked（退出2）；私有输入/文件系统异常：failed-private-input-validation（退出1）。错误输出不回显路径、原始数据或个股代码。
- 本地时间、文件指纹可被拥有写权限者伪造；这只是内部一致性封存，**不是第三方可信时间戳、报价许可、策略有效性或前瞻认证**。所有执行路径保持canTrain:false、canTrade:false、canNotify:false、outOfSampleValidated:false、weightsChanged:false。

## 回归

    node --test tests/sector-h5-full-member-close-freeze.test.js
    npm run check
    npm test

测试从合成行情→真实 PR149 候选归档→完整股票cohort→现有 H5 标签→现有单日审计进行端到端复核，并校验缺价、额外成员、污染价格、混源、未来字段、存档篡改和历史补造拒绝。合成测试不等于真实行情接通、独立样本外有效或国内部署。两张锁定主页、正式四策略、15因子、账户及模拟盘不受影响。