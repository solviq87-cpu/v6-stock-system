# V6 BaoStock收盘行情研究采集与因果证据桥（2026-11-10）

## 本批范围

官方Python API文档：https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md 。使用已公开记录的三个接口：
1. query_trade_dates 获取交易日历，非靠周一到周五推测。
2. query_history_k_data_plus 读取不复权日K（adjustflag=3）、成交量（股）、原始OHLC、tradestatus（0停牌、1交易）。
3. query_adjust_factor 获取除权除息日期（dividOperateDate），**不能把此日期等同于完整的权益结算证明**。

原有V6 optional-research-sources.py虽可单票查询BaoStock，但缺独立交易日/公司行为完整度证据，不能直接交给长期影子学习。新增一个受控的BaoStock SDK采集器、一个不联网的严格转换器，串到已合并的授权历史行情和因子数据预检。

## 操作

只在操作者已审查BaoStock适用许可、确定自身拥有研究使用权限后，显式单次执行以下示例：

    npm run research:baostock:collect -- --codes 600001,000001 --start 2026-09-01 --end 2026-11-10 --dataset-id baostock-research-v1 --output /srv/v6-private/baostock/raw-2026-11-10.json --allow-research-fetch

上述为参数示例，不代表已联网认证。要求北京时间同日16点后采集，且该日实际是已更新的交易日。每次最多5只沪深A股、45至365自然日，不会默认发起网络请求；必须附带 --allow-research-fetch 才允许调用SDK。该选项是防误触开关，**不意味着上游商业/再分发许可已获得**。

采集器记录各项查询完成时的本地时间，检查官方交易日、5只以内的K线和复权因子完整返回；任何错误不得发布文件。发布为私有权限0600、已存在不得覆盖的JSON，失败不留下伪完整结果。

将上面明确采集的原始结果转为已有V6授权历史结构：

    npm run research:baostock:normalize -- /srv/v6-private/baostock/raw-2026-11-10.json /srv/v6-private/baostock/history-2026-11-10.json

转换端再次严格检查代码、时间、交易日顺序、全部已声明交易日数据、不复权、停牌日成交量、OHLCV、复权日期来源及覆盖；逐票缺数据、公司行为查询报错、错误复权、旧价格回写均不许猜测补齐。保留 provider=baostock，source=imported，observedAt 仍是原采集器记录的**本地请求完成时间**，不是独立交易所报价时间。SHA指纹并非数字签名或数据商许可认证。公司行为日期只是“需要排除未经处理收益窗口”的指示，不是可成交净收益。

之后，用同日真实选股和逐票因子原始证据调用既有的只读检查：

    npm run factor:source:preflight -- /srv/v6-private/baostock/history-2026-11-10.json /srv/v6-private/picks-current.json /srv/v6-private/factors-current.json

即使检查通过，仍仅说明本地协议可以连接，不能宣布生产授权已通过、WorkBuddy已部署、行情实时、学习样本充足或选股盈利。测试脚本中的日期/价格为合成测试资料，不是真实市场验证。

## 守门与测试

    node --test tests/baostock-eod-research-bridge.test.js
    npm run check
    npm test

研究脚本不主动注册定时任务、不接券商、不下单、不调整四套正式策略/15因子基础权重/模拟盘，也不改两张锁定主页（public/index.html和public/mobile.html）。实际在WorkBuddy部署或长期调度，需要官方接口写权限及用户对数据许可和持久存储的单独确认。
