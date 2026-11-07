# 免费报价实测与带日期只读展示 bg

唯一新增基线：V6_1027_full_20261106bf.zip，SHA-256 dc91f4ea8bf3b71320210394e19f4a4d46ad12b14f41b04b281df4470de04a56。完整继承bf，不以旧包覆盖。

用户排除其获知年费3.5万元的原生接口，不购买、不注册试用、不调用付费API。本批没有新增iFinD/Choice原生接入或加载其凭据；旧三路授权网关代码保持原样但不启用。本小项目只完成免费公开地址的一次性诊断、固定文件只读消费和双端日期展示，不冒充持续稳定实时接通。

## 使用

```bash
node scripts/public-quote-probe.js 600519 /safe/new-free-probe.json
# 可显式指定一至三家，默认腾讯与东财，不必等新浪接通
node scripts/public-quote-probe.js 600519 /safe/new-other-probe.json tencent,eastmoney,sina
# 用现有主服务读取固定文件；这不是新路径上传接口
V6_PUBLIC_QUOTE_PROBE_FILE=/safe/new-free-probe.json npm start
```

只接受沪深60/68/00/30六位股票代码，以及tencent/eastmoney/sina白名单。新报告不得覆盖旧文件；符号链接路径拒绝，完整暂存/fsync后硬链接不覆盖发布。需要可信本地目录和支持fsync/link的文件系统；不宣称抵抗恶意本地进程置换祖先目录。

没有轮询、watch、付费回退、账号、Cookie或Token。每源超时8秒、原响应256KiB上限；同批并行，网络/格式失败至多重试一次，任何HTTP错误（包括403/429）不重试、不绕过；默认两家最多4次请求，三家最多6次。CLI退出0表示诊断报告完整写出，sources可能全部不可用，不等于接口已接通。旧parallel-market.js的持续采集许可门禁原样保留，来源清单未改成“合规认证”。本入口仅显式诊断，不是商业转发许可或全工程访问审核结论。

## 读端及页面

新核心src/core/public-quote-probe.js；旧公开解析器src/core/public-market.js增可选provider子集与未知ID拒绝，默认三家保持兼容。src/core/dashboard-view.js仅从环境变量固定文件读取，不接HTTP传入文件路径。

普通文件限1MiB；模式、source ID、证券、币种/股数单位、正价格、原时间/采集时间、单源仅一条等重新校验。损坏/未来/来源错配不展示价格。来源失败时保持无报价，不用上一次成功记录填入新失败结果。来自供应商的市场状态未独立核验，读端标market-state-unverified。

报价时点15秒内仅为fresh-unverified，不是实时或交易所认证；超过15秒为dated-snapshot且freshness=not-realtime。检查报告超过15秒为check-expired，仍可显示带原始日期的旧快照。所有sources按各自时间分别判断，读端不相信已保存的推荐、页面链接或真实性标签。网页入口按股票代码重新生成。

双端沿用原风险卡折叠区，增加“公开行情快照”详情，展示代码/来源/价格/原始报价时间，统一标“报价快照（非实时认证）”；检查时间另列，不替代供应商时间。即使原风险证据缺失，也能看诊断快照，但不会改变今日观望、候选排序、四策略、仓位或账户。失权/断线清除诊断展示，输出文本转义。原个股详情仍有东财、同花顺、新浪、雪球网页入口；网页可看与程序接通分开。

canTrade=false、verifiedLive=false、paidServicesUsed=false、probeOnly=true。没有净收益、概率、模拟成交或自动调权。原日线/分钟线/研究注册器/资金账户和数据源默认状态未改；四端缓存bg，双端款式保留，仅折叠区添实际数据。

## 实测证据

- free-quotes-probe-20261106bg.json：最初Node三家请求均unavailable。
- free-probe-live-20261106bg.json/.log：新CLI真实运行，腾讯返回1453元、供应商时点2026-11-06 16:14:58（上海）的旧快照；东财在该次Node运行unavailable。不能把这一轮写成Node两家通过。
- free-urllib-probe-20261106bg.json：独立Python标准库检查，保留各HTTP状态与供应商原报文。客户端差异单独记录；不把Python成功当成Node稳定通过，失败也不删除。
- baostock-probe-20261106bg.json：在隔离Python安装baostock0.9.4后，用原已允许的BaoStock采集器尝试2026-11-02至05日线，结果unavailable，未取得数据，不作为实时来源。

全部为一次性连通样本，不证明真实交易所价格、授权、持续可用或盘中时效。本环境当时已盘后，未进行盘中实时验收。没有启动主服务对用户云端部署，没有发生采购/订阅/券商行为。

## 图中路线取舍与后续

图片提供候选入口，不自动授予账号权限或免费额度。iFinD/Choice收费方案本轮排除；Tushare/米筐/JQData/MiniQMT/CTP/TqSdk/AllTick/iTick等未在本批配置账号、客户端、权限或新适配，不能登记为接通。此前排除的AKShare/efinance/Ashare/mootdx/pytdx不新增启用；旧代码保留兼容、默认门禁保持。BaoStock是日线/历史路线，失败不回填当前报价。

官方复核参考：同花顺HTTP实时接口/账号令牌说明 https://quantapi.10jqka.com.cn/gwstatic/static/ds_web/quantapi-web/help-center/manual.html 和 help-center/deploy.html；Tushare rt_k独立权限 https://tushare.pro/document/1?doc_id=372；这些仅用于区分路径，不据此购买或自动尝试账号。图片中的额度、费用、历史窗口不硬编码成已认证事实。

下一步需目标机交易时段连续小样本复测腾讯/东财可用率、原始时间、403/限流和缺失；免费数据拿不到就留空，保留网页入口。自动持续采集及正式使用范围审核、真实新闻、概率独立样本外、持仓闭环和六类现场验收仍待。不能用本地测试数关闭这些事项。
