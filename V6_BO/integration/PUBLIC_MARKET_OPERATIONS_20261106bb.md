# 无账号公开报价三路接入 bb

基于ba991完整包，保留三家授权网关和四家网页入口。新增腾讯/东方财富/新浪公开报价解析，不需账号，不执行返回的JavaScript。当前仅沪深60/68/00/30个股，每进程一个代码，用于试运行及个股对照，不是全市场扫描器。历史K线沿用旧接口，本轮没有新接三家K线/资金流/新闻。

```bash
node scripts/parallel-market.js /safe/public-config.json
V6_PARALLEL_MARKET_FILE=/safe/public-quotes.json npm start
```

配置参见config/public-market.example.json；mode=public与code，intervalMs建议15000，最小支持5000。三路并行、每源独立8秒超时、256KiB限额，禁止重定向；403/限流即失败，不绕过。请求不附账号、cookie、token或伪造登录信息。默认单次运行；持续运行需显式配置intervalMs。不要复制示例输出到只读系统目录。

报价原时间上海转换，腾讯/东财成交量“手”转100股，新浪按股，现价/昨收单位元，东财fltt=2字段按浮点。缺时间不以请求接收时间替代，未来/超过15秒不进实时分析；保留lastQuote原时间供离线排查。收盘/午休可能返回旧价，按陈旧显示，不保证实时。停牌状态未独立认证，不能自动交易。公开网页格式可能改变，不认证供应商，也不代表获得商业转发权限。

公开固定地址：qt.gtimg.cn/q=，hq.sinajs.cn/list=，push2.eastmoney.com/api/qt/stock/get。解析以原始结构严校验，不采用eval，不尝试反爬绕过；新浪403不通过伪造Cookie/身份来绕过。

实际探测2026-11-06：Python原生HTTP腾讯200、东方财富200，新浪403。腾讯返回14位上海时间，东财返回f86 Unix秒；不因此声称连续稳定运行通过。Node CLI实际结果见public-live-probe.log及public-live-result.json（若有）；不同客户端网络失败单独记录，Python成功不能冒充Node成功。休市旧快照不作为实时认证。其余测试使用明确模拟报文。

限制与未完成：新浪当前环境真实不可用；三家持续稳定实时、交易所授权、商业展示权限、全市场扫描、三家K线/资金流、真实新闻、概率独立样本外、个人仓位动作及六类现场验收仍待。没有购买/开账号/部署云端/接券商。原策略、账户规则保持不变，风险卡继续观望。
