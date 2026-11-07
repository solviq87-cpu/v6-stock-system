# 六张照片逐行结果（bi）

对应照片03至07每图6行，共30行；照片08是6项取数检查。本次为小样本，未穷举所有资产/频率；仅7路取得数据，盘中实时未认证。没有购买或注册账号。

|图|接口|上游|本次结果|返回样本数|
|---|---|---|---|---:|
|03|akshare · stock_zh_a_hist|eastmoney|取得数据，已接研究备用|5|
|03|baostock · query_history_k_data_plus|baostock|取数失败|0|
|03|efinance · stock.get_quote_history|eastmoney|取得数据，已接研究备用|5|
|03|tushare · daily|tushare|未调用：账号/权限与适配待补|0|
|03|ifind · THS_HQ|ifind|未调用：账号/权限与适配待补|0|
|03|rqdata · get_price|rqdata|未调用：账号/权限与适配待补|0|
|04|akshare · stock_zh_a_hist_min_em|eastmoney|取得数据，已接研究备用|200|
|04|akshare · stock_zh_a_minute|sina|取得数据，已接研究备用|200|
|04|baostock · query_history_k_data_plus|baostock|取数失败|0|
|04|ifind · THS_HF|ifind|未调用：账号/权限与适配待补|0|
|04|tushare · stk_mins|tushare|未调用：账号/权限与适配待补|0|
|04|rqdata · get_price|rqdata|未调用：账号/权限与适配待补|0|
|05|tushare · income/balancesheet/cashflow|tushare|未调用：账号/权限与适配待补|0|
|05|tushare · daily_basic|tushare|未调用：账号/权限与适配待补|0|
|05|efinance · fund.get_quote_history|eastmoney|取得数据，已接研究备用|200|
|05|tushare · fund_daily|tushare|未调用：账号/权限与适配待补|0|
|05|tushare · cb_daily/cb_call|tushare|未调用：账号/权限与适配待补|0|
|05|cninfo · 公告查询/结构化API目录|cninfo|取得数据，已接研究备用|1|
|06|easyquotation · use('sina').real|sina|取得数据，已接研究备用|1|
|06|efinance · stock.get_realtime_quotes|eastmoney|超时|0|
|06|ifind · THS_RQ|ifind|未调用：账号/权限与适配待补|0|
|06|miniqmt · subscribe_quote/get_market_data_ex|miniqmt|未调用：客户端/前置与适配待补|0|
|06|miniqmt · subscribe_*/get_l2_*|miniqmt|未调用：客户端/前置与适配待补|0|
|06|tushare · rt_k|tushare|未调用：账号/权限与适配待补|0|
|07|ctp · 行情前置/行情回调|ctp|未调用：客户端/前置与适配待补|0|
|07|tqsdk · get_quote/get_kline_serial|tqsdk|未调用：账号/权限与适配待补|0|
|07|jqdata · get_price|jqdata|未调用：账号/权限与适配待补|0|
|07|rqdata · get_price|rqdata|未调用：账号/权限与适配待补|0|
|07|alltick · REST/WebSocket|alltick|未调用：账号/权限与适配待补|0|
|07|itick · REST/WebSocket|itick|未调用：账号/权限与适配待补|0|

“返回”不等于实时或生产认证：easyquotation此次为15:34:59的盘后旧快照，只保存展示；日线/5分钟/基金净值/公告分别保存，禁止混用。AKShare东财与efinance共享东财上游。巨潮仅公开公告查询成功，未测试账号型结构化API。17条凭据型、3条客户端型未实现原生联调，不是插入令牌即可全部使用。

初轮基金倒序取尾导致旧样本，修正排序后重新完整采样，最终基金末日为2026-11-06。实际原始记录、版本、修正及失败日志随完整包保留。
