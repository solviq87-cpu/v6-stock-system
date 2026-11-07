# 三路并行行情 20261106ba

唯一新增基线az983项完整包，SHA-256 93aa00bd1c15cd50912be4cc2aff39e407895165d24395a4fc5fbc78c28ca85a。保留全部旧文件与四套策略规则，新增研究只读链路不写账户。

## 已实现

ifind/choice/sina三路同时请求，单路独立超时/中止/响应体1MiB限制/来源匹配/证券/币种/复权/股数单位与时效校验，来源结果分别保留。报价15秒内、同证券三路时点差不超过5秒、现价及昨收差不超过10bps才标记consistent；不是买入结论。价差/时差/停牌/来源缺失单独列出，不平均、不投票、不回填旧缓存。每源给出价格、昨收、涨跌幅和成交量，volume是截至时点累计股数，不是资金流。三路可能共享上游，一致不证明独立或真实。

配置是服务端固定文件；示例见config/parallel-market.example.json。url必须是操作者已有授权网关的HTTPS标准化报价地址，三路分别身份认证。tokenEnv可选，仅从服务端环境取Bearer凭据，不能把密钥放配置、页面或交接。本协议不是三家原生SDK/HTTP返回格式；必须由各家已授权适配器转换后提供。未猜测私有API，未把网页入口当数据接入。当前没有供应商凭证，因此真实三家连接/原生报文适配/账号权限及延迟验收未完成。

```bash
node scripts/parallel-market.js /safe/parallel-config.json
V6_PARALLEL_MARKET_FILE=/safe/parallel-result.json npm start
```

intervalMs=0单次；后台轮询最少5000ms，请遵守实际接口配额。SIGINT/SIGTERM停止继续轮询；进行中的请求最多等配置超时，文件原子发布。输出包含sources原始标准化快照与逐股analysis；页面只读固定环境变量路径，重新校验数据、重算结论，不信任文件里直接写的buy等结论。无新增任意路径HTTP接口。

## 标准化快照

schemaVersion=1，provider为ifind/choice/sina，observedAt为Unix毫秒。quotes每项：exchange SH/SZ，六位code，currency CNY，adjustment unadjusted，volumeUnit share，status normal/halted，timestamp Unix毫秒，price/previousClose正数，volume非负数。每批1至100条，重复证券拒绝；未来/超15秒拒绝。历史日K仍走既有行情中心，不能伪装本协议实时tick。

## 外部接通依据与待办

同花顺官方手册：https://quantapi.51ifind.com/gwstatic/static/ds_web/quantapi-web/help-center/manual.html
东方财富官方Choice资料：https://choice.eastmoney.com/FileDownload/CFTG.pdf
新浪官方开发者平台：https://zyhub.finance.sina.cn/

这里只核对公开资料，不代表已开通账号或三家接口结构相同。尚需三家现有授权与对应原生协议、云端实际网络/时区/延迟核验；未购买、未试用注册、未部署、不接券商。实时新闻、概率校准、仓位动作和六类现场验收仍待。风险卡继续观望；没有修改四套策略或把三路分析当实盘放行。
