# 固定24项主线验收状态

最终验收关闭0/24；本地代码/测试证据不等于生产关闭。原始名称来自上传基线。

|编号|原验收事项|状态|当前证据与边界|
|---|---|---|---|
|A01|开发者及只读用户登录、服务端权限隔离|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|A02|只读设备首次审批、手动撤权、跨会话生效|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|A03|只读设备离线24小时自动清理授权/会话|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|A04|开发者修改本人和只读用户密码、哈希与迁移|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|A05|开发者忘记密码短信OTP找回（号码私密配置）|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|B01|SSE已建立连接撤权即时主动断流|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|B02|HTTP全路由鉴权、异常、并发与压力测试|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|B03|HTTPS反向代理、可信代理IP、会话安全|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|B04|限流、审计日志脱敏、异常恢复|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|B05|备份恢复、云端部署、多人同时在线|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|C01|东方财富真实行情联网、接口稳定性与合规授权|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|C02|授权备用源、失败重试、缓存和降级|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|C03|交易日历、复权、停复牌/退市与数据质量|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|C04|全市场自动刷新、模拟行情、行情新鲜度标识|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|D01|多因子AI评分、MACD/KDJ/RSI/MA、解释与排序|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|D02|首板发掘、一进二、二进三、连板接力研究|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|D03|低吸/突破/接力策略插件与独立回测|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|D04|市场情绪、资金流、主线板块、风险过滤|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|E01|历史真实样本外回测、防未来函数与样本污染|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|E02|A股T+1、涨跌停不能成交、成本、滑点|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|E03|仓位、止损、最大回撤、异常行情控制|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|E04|胜率收益、回撤报告、压力测试与统计有效性|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|F01|深色速览、浅色完整面板、电脑手机卡片/折叠/刷新/权限|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
|F02|全量回归、三方代码合并、迁移备份、最终完整ZIP|部分实现/待最终验收|见TEST_REPORT.md和REMAINING.md；不得凭测试数自动关闭|
