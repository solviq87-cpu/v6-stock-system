# V6 BaoStock研究采集安全加固：前置网络门禁与采集时序（2026-11-10）

## 目的
上一版BaoStock研究采集器对最终导出JSON的字段有严格检查，但Python SDK本身的中途失败、原始请求时钟以及已经存在目标文件时误联网，缺少完整回归。这批只修复这类源级问题，完全离线测试，不替换任何数据源或正式策略。

## 具体保护
- 在导入BaoStock SDK和login网络行为之前，检查明确的--allow-research-fetch、沪深A股代码、45～365自然日的查询窗口、end就是当前北京时间日期且已经过16:00、私有绝对路径、最终输出文件尚不存在。任何一步失败不访问网络，也不覆盖旧文件。
- SDK每个query的next结束后再次检查error_code；中途成功返回几行后报错不能伪装成complete:true。重复字段名、字段缺失及数据列数不匹配都会失败。
- 各查询必须在同一北京时间收盘后采集，单次最多10分钟。记录startedAt以及每次query完成时的observedAt，时间不得倒退，逐只股票以calendar→daily→adjust顺序完成；时间超限或跨日，不发布结果。
- Node端同步验收单批次和逐票时钟，旧包没有startedAt时仍必须满足基础同日16点后与时间范围限制。新包提供startedAt时还须证明跨股票顺序正确。
- 客户端采集时间只能证明本地请求完成时刻，不是交易所逐笔原时点，不能用来认证盘中实时价，也不能改变模拟盘成交时点门禁。

## 回归
新增7组Python假SDK离线测试，通过Node包装纳入原有npm全量回归，验证部分数据后失败、重复列、时间倒退、超时、日期前置拦截、Python采集包经真实Node适配器成功转换、0600私有归档不可覆盖以及路径禁用。

在V6_BO运行：

    node --test tests/baostock-python-collector.test.js tests/baostock-eod-research-bridge.test.js
    npm run check
    npm test

官方API公开文档：https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md 。公开接口字段不构成商业授权；本批没有进行数据商实际登录、购买、收费请求或WorkBuddy部署。公司行为仅为来源返回的除权除息日期，不代表完整权益结算。已锁定的两张主页、原有四策略、15因子正式权重与模拟盘资金账本均不修改。
