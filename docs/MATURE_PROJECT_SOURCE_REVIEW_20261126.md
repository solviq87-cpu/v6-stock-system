# FAYO 成熟项目具体源码与上游适用性复核

> 暂停交接：用户已要求本聊天保存后待命，剩余工作交其选定统一接续聊天。本文保留固定时点证据；当前head、67—78及责任更新见[最新增量](LATEST_HANDOFF_DELTA_20261126.md)，不以旧快照覆盖新成果。

复核时点：2026-11-26T01:37:56+08:00。交接给 **绯曜 FAYO｜总管与最终交付**。本聊天仅提供固定证据，不另行总集成、合并或发布。

## 范围与结论

- 框架、包装库和真实数据发布者分层登记；调用同一上游不算信息独立。
- 成熟源码只证明该提交存在调用方法，不证明 FAYO 已接通、当前账号获权、供应商可用或长期稳定。
- 保留原统一行情中心、权威账本、四策略和时间门禁；研究框架只进入隔离研究/回放，不成为在线账户写者。
- 所有未实测项为 unknown/not-run；不将开源代码许可转写为行情再分发或商业授权。
- 分钟条起止时间、价格复权和量额单位要先转换为显式合同；收到时间不能覆盖原始时间。
- Qlib PIT 的估算披露日和 vn.py 的 fillna(0) 不可按原样迁入严格证据链。

本轮从6个官方仓库冻结提交，读取10个实际适配源码，以及6份LICENSE和6份依赖配置。未安装或运行这些项目、未请求真实行情、未登入账户。XtData为官方文档核验，未取得官方SDK源码提交，单独保留未知。源码内容与blob/commit清单见 [`upstream-source-manifest.json`](validation/fayo-quality-20261126/upstream-source-manifest.json)，许可及依赖见 [`upstream-license-dependency-manifest.json`](validation/fayo-quality-20261126/upstream-license-dependency-manifest.json)。

## 固定版本

| 官方仓库 | 固定提交 | 提交时间（UTC） |
| --- | --- | --- |
| vnpy/vnpy | [c6e231caf32b7fc97e6459817fff66458cf7e7c4](https://github.com/vnpy/vnpy/commit/c6e231caf32b7fc97e6459817fff66458cf7e7c4) | 2026-10-06T09:38:50Z |
| vnpy/vnpy_rqdata | [8cad1ef97efe1a48559abcff6fd741b2cdf2a132](https://github.com/vnpy/vnpy_rqdata/commit/8cad1ef97efe1a48559abcff6fd741b2cdf2a132) | 2026-10-05T14:26:04Z |
| vnpy/vnpy_tushare | [8388d81e7b7eac99a15e145940756f3a4a3a7aca](https://github.com/vnpy/vnpy_tushare/commit/8388d81e7b7eac99a15e145940756f3a4a3a7aca) | 2026-10-05T14:22:55Z |
| microsoft/qlib | [54355232463878d2eebb91fe0ee5fa7fa1f5976c](https://github.com/microsoft/qlib/commit/54355232463878d2eebb91fe0ee5fa7fa1f5976c) | 2026-10-08T10:15:27Z |
| ricequant/rqalpha | [0bf04946e8250b457e30c3c81d338a6b925da0bb](https://github.com/ricequant/rqalpha/commit/0bf04946e8250b457e30c3c81d338a6b925da0bb) | 2026-10-27T10:29:09Z |
| AI4Finance-Foundation/FinRL-Meta | [fabd0077c1b6cb07d52d6de04315859705884696](https://github.com/AI4Finance-Foundation/FinRL-Meta/commit/fabd0077c1b6cb07d52d6de04315859705884696) | 2026-11-22T21:21:49Z |

## 实际调用、上游与适用范围

| 项目/适配路径 | 实际方法 | 上游与周期 | 主要条件/限制 |
| --- | --- | --- |
| XtQuant / XtData（MiniQMT；另有 Token 数据服务模式） / 官方接口文档 | xtquant.xtdata.subscribe_quote / subscribe_whole_quote / get_market_data / get_local_data / get_full_tick / download_history_data；Token 路径 xtdatacenter.set_token → init → listen | MiniQMT 所连迅投行情服务器；官方 Token 数据服务同属迅投，不是两个独立信息源。 官方原生接口列 tick、1m/5m/15m/30m/1h/1d/1w/1mon/1q/1hy/1y；实际品种/档位/历史范围依客户端及权限。 | MiniQMT 路径先启动客户端；Token 模式需要账号权限。原生文档建议单股订阅不超过50；产品表基础/券商100、投研300属于不同权限口径。L2须单独权限。不是已取得的免费配额。 |
| vn.py BaseDatafeed / [vnpy/trader/datafeed.py](https://github.com/vnpy/vnpy/blob/c6e231caf32b7fc97e6459817fff66458cf7e7c4/vnpy/trader/datafeed.py) | BaseDatafeed.init/query_bar_history/query_tick_history；get_datafeed | 无；通过 SETTINGS['datafeed.name'] 加载 vnpy_<name> 适配器。 抽象历史 Bar/Tick 请求，不是已接通市场列表。 | 未配置返回 BaseDatafeed；init=False，查询输出提示后 []；不代表空数据成功。 |
| vn.py RQData / [vnpy_rqdata/rqdata_datafeed.py](https://github.com/vnpy/vnpy_rqdata/blob/8cad1ef97efe1a48559abcff6fd741b2cdf2a132/vnpy_rqdata/rqdata_datafeed.py) | RqdataDatafeed.init；query_bar_history → _query_bar_history → rqdatac.services.get_price.get_price；query_tick_history | RQData / rqdatad-pro.ricequant.com:16011；不是 vn.py 自有行情。 该适配器映射1m/60m/1d及历史tick；股票/期货等取决于代码映射和授权。 | 读取username/password，rqdatac.init；官方许可配额可读 rqdatac.user.get_quota，文档试用每日1G；本账户配额未知。 |
| vn.py TuShare / [vnpy_tushare/tushare_datafeed.py](https://github.com/vnpy/vnpy_tushare/blob/8388d81e7b7eac99a15e145940756f3a4a3a7aca/vnpy_tushare/tushare_datafeed.py) | TushareDatafeed.init；query_bar_history → ts.pro_bar | TuShare Pro SDK 聚合接口；不是 vn.py 自有行情。 适配器1min/60min/D；SSE/SZSE/BSE及期货映射。SDK支持更多不等于这个适配器已覆盖。 | init要求username/password，password用作token；每请求代码常量8000后向分页。分钟正式权限单独开通；积分不能替代分钟授权。 |
| Qlib Yahoo Collector / [scripts/data_collector/yahoo/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/yahoo/collector.py) | YahooCollector.get_data_from_remote → yahooquery.Ticker(...).history；YahooCollectorCN1d.download_index_data | 普通证券→Yahoo（经yahooquery）；中国基准指数→INDEX_BENCH_URL 指向 Eastmoney push2his。必须逐记录区分，不统一归为Yahoo。 collector直接支持1d/1min，分钟分7天窗口；地区类定义CN/US等。覆盖名单不是有效取得证据。 | 源码无账号配置不代表公开无限制；有重试和延迟，未见已认证供应商免费配额或持续可用证明。 |
| Qlib BaoStock 5分钟 Collector / [scripts/data_collector/baostock_5min/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/baostock_5min/collector.py) | BaostockCollectorHS3005min.get_data_from_remote → bs.query_history_k_data_plus；get_data | BaoStock SDK；HS300成分来自query_hs300_stocks，非Qlib自有市场数据。 该类默认HS300+5min；get_data_from_remote按参数可处理1d，不等于所有市场tick覆盖。 | bs.login()；本轮未登录、未取真实数据；没有从无显式token推断无限额。 |
| Qlib BaoStock PIT Collector / [scripts/data_collector/pit/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/pit/collector.py) | PitCollector.get_data / get_data_from_remote；PitNormalize.normalize | BaoStock业绩快报/利润/预测/增长接口。 季度财务，非行情。collector拒绝非quarterly；normalize另有年度分支。 | BaoStock登录与历史财务覆盖条件；本轮未实测。 |
| RQAlpha 月更bundle / [rqalpha/cmds/bundle.py](https://github.com/ricequant/rqalpha/blob/0bf04946e8250b457e30c3c81d338a6b925da0bb/rqalpha/cmds/bundle.py) | download_bundle / get_exactly_url；create_bundle / update_bundle | bundle.assets.ricequant.com 月度归档；更新/创建另需RQDatac。 月度历史数据包；实际包范围需manifest，不是实时行情服务。 | download尝试按月份回退；创建/更新需rqdatac与授权。源码get_exactly_url的无限回退循环不可搬到在线链，FAYO要有界请求。 |
| RQAlpha RQData日线构建 / [rqalpha/data/bundle/daybar.py](https://github.com/ricequant/rqalpha/blob/0bf04946e8250b457e30c3c81d338a6b925da0bb/rqalpha/data/bundle/daybar.py) | DayBarTask._fully_update → rqdatac.get_price；增量更新路径 | RQData，300标的分块，frequency='1d'，adjust_type='none'，expect_df=True。 原始日线历史到本地H5；不是实时多源。 | 有效RQData许可和实际配额另核；有免费月包不等于可调用此更新路径。 |
| FinRL-Meta AKShare Processor / [meta/data_processors/akshare.py](https://github.com/AI4Finance-Foundation/FinRL-Meta/blob/fabd0077c1b6cb07d52d6de04315859705884696/meta/data_processors/akshare.py) | Akshare.get_data → ak.stock_zh_a_hist；download_data | AKShare包装的Eastmoney历史日线，不是FinRL自有数据源。 download_data只允许daily/weekly/monthly；不是实时或分钟collector。 | 源码仍旧名stock_zh_a_hist；本轮AKShare官方新版已更名stock_zh_a_hist_em，不能假定可用。sleep0.25是脚本配置，不是供应商保证。 |
| FinRL-Meta TuShare Processor / [meta/data_processors/tushare.py](https://github.com/AI4Finance-Foundation/FinRL-Meta/blob/fabd0077c1b6cb07d52d6de04315859705884696/meta/data_processors/tushare.py) | Tushare.get_data → ts.pro_bar；download_data | TuShare Pro。 download_data断言time_interval=='1d'；get_data不传freq，SDK默认D。README泛称支持分钟不证明此类分钟已实现。 | constructor需要token，download调用set_token；实际账户权限、限额未知。 |

## 时点、复权、单位、维护与采用决定

### XtQuant / XtData（MiniQMT；另有 Token 数据服务模式）

**时间：** time 为源时间戳；官方转换示例 ct/1000 表示毫秒。原接口说明未充分定义每种 K 线时标为起点或终点，接入前须逐周期实测。期货夜盘真实时点开关/版本差异必须登记。

**复权与单位：** none/front/back/front_ratio/back_ratio，tick 不适用复权。 官方更新日志明确所有品种 volume 为手；股票/转债 pvolume 为股；amount 字段需以品种字典核实。成交累计量与区间量分开，不凭字段同名推断。

**许可边界：** 未核验本项目账号使用、转发及商业授权；不开户、不生成 Token。

**维护条件：** 客户端/SDK/数据目录/订阅恢复/Windows运行环境与Python版本需固定；官方下载表最新可见 xtquant_250807（页面更新2025-12-19）。本轮未取得官方公开Git仓库commit或已签名包源码，不能声称完成具体SDK源代码审计。

**采用决定：** 保留为有条件只读候选；当前只采用官方接口、时点和恢复合同设计。不开通 xttrader 或新交易权限。

**仍未知：** 当前客户端/账号权限；实际源延迟、交易时段覆盖和断线恢复；各周期起止与闭合语义；数据再分发权；SDK包哈希/官方源代码commit。

官方SDK源代码commit/包哈希：未取得，不能填写猜测仓库。

- 官方资料：[https://dict.thinktrader.net/nativeApi/xtdata.html](https://dict.thinktrader.net/nativeApi/xtdata.html)；检索引用 turn417080675view0（新总管如用于最终网页引用需自行打开核验）。
- 官方资料：[https://dict.thinktrader.net/nativeApi/start_now.html](https://dict.thinktrader.net/nativeApi/start_now.html)；检索引用 turn724272148view0（新总管如用于最终网页引用需自行打开核验）。
- 官方资料：[https://dict.thinktrader.net/nativeApi/download_xtquant.html](https://dict.thinktrader.net/nativeApi/download_xtquant.html)；检索引用 turn724272148view1（新总管如用于最终网页引用需自行打开核验）。
- 官方资料：[https://knowledge.thinktrader.net/docs/dictionary/](https://knowledge.thinktrader.net/docs/dictionary/)；检索引用 turn442526950view3（新总管如用于最终网页引用需自行打开核验）。

### vn.py BaseDatafeed

**时间：** 只定义请求/对象；真实源时间由具体适配器处理。

**复权与单位：** 无统一复权保证。 无统一上游单位保证。

**许可边界：** 固定提交 LICENSE 为 MIT，仅框架代码许可。

**维护条件：** 动态包名、设置与插件版本要锁定；不为借一个接口引入完整交易框架运行链。

**采用决定：** 借鉴 provider/consumer 分层；FAYO 必须把未配置/失败与合法空列表分开。

**仍未知：** 任何真实行情/权限/稳定性。

固定源码：[vnpy/trader/datafeed.py](https://github.com/vnpy/vnpy/blob/c6e231caf32b7fc97e6459817fff66458cf7e7c4/vnpy/trader/datafeed.py)。

### vn.py RQData

**时间：** RQData bar 终点被减1分钟/1小时转为 vn.py 起点；China TZ；查询结束扩展至下一交易日以含期货夜盘。不可再次平移或把bar起点当新报价。

**复权与单位：** 股票 .XSHG/.XSHE 用 pre_volume；其他 none。主连另走 futures.get_dominant_price(pre,prev_close_ratio)。 取 volume/total_turnover/OI；须按RQData字段和品种合同核对，不直接假定手。

**许可边界：** adapter MIT；RQData 有效授权另需核验。

**维护条件：** 插件3.4.7.9冻结commit、rqdatac版本及账户；源时点、复权、重连和错误分类单独适配。

**采用决定：** 历史研究候选；保留其显式时区/周期转换思想，禁止把其 df.fillna(0) 当 FAYO 缺失处理。

**仍未知：** 当前账户/license/配额；真实日内延迟与缺失率；实际源使用及转发权限。

固定源码：[vnpy_rqdata/rqdata_datafeed.py](https://github.com/vnpy/vnpy_rqdata/blob/8cad1ef97efe1a48559abcff6fd741b2cdf2a132/vnpy_rqdata/rqdata_datafeed.py)。

- 官方资料：[https://www.ricequant.com/doc/rqdata/python/manual.html](https://www.ricequant.com/doc/rqdata/python/manual.html)；检索引用 turn442526950view0（新总管如用于最终网页引用需自行打开核验）。
- 官方资料：[https://www.ricequant.com/doc/rqdata/cli/manual](https://www.ricequant.com/doc/rqdata/cli/manual)；检索引用 turn386047458search1（新总管如用于最终网页引用需自行打开核验）。

### vn.py TuShare

**时间：** trade_date或trade_time；分钟/小时终点减周期转起点，上海时区。历史分钟文档为收盘后17–21点更新，不是实时行情SLA。

**复权与单位：** 调用未传 adj，按 SDK 默认None；不得当 qfq/hfq。 原适配器使用vol/amount；不同资产和周期单位必须核对官方具体接口；缺 amount/OI 代码填0不应迁入FAYO。

**许可边界：** adapter MIT；官方分钟文档仅策略研究/学习、非商业。当前实际授权未知。

**维护条件：** 插件1.4.21.1与SDK版本锁定；验证8000分页边界/重复/最早时间、源错误和空数据。

**采用决定：** 历史回放候选；不用于逐票15秒当前报价门禁。

**仍未知：** 账号真实权限与限额；完整字段单位；请求成功和连续维护成本。

固定源码：[vnpy_tushare/tushare_datafeed.py](https://github.com/vnpy/vnpy_tushare/blob/8388d81e7b7eac99a15e145940756f3a4a3a7aca/vnpy_tushare/tushare_datafeed.py)。

- 官方资料：[https://tushare.pro/document/2?doc_id=109](https://tushare.pro/document/2?doc_id=109)；检索引用 turn442526950view2（新总管如用于最终网页引用需自行打开核验）。
- 官方资料：[https://tushare.pro/document/1?doc_id=234](https://tushare.pro/document/1?doc_id=234)；检索引用 turn442526950view1（新总管如用于最终网页引用需自行打开核验）。

### Qlib Yahoo Collector

**时间：** 返回索引为bar时间；CN时区Asia/Shanghai；采集/可知时间另外记录，历史bar不能更新成当前quote。

**复权与单位：** normalize里按adjclose/close因子复权并按首日close标准化；量作相应调整。输出适合研究，非原始执行价。 规范化输出不是原始量价单位；保留原文件/转换版本与原字段。

**许可边界：** Qlib MIT不赋予Yahoo或Eastmoney数据再分发/交易权。

**维护条件：** yahooquery、地区日历、符号转换及web接口变化；源异常可落空表，必须额外保留失败分类。

**采用决定：** 隔离研究借鉴，不将Qlib训练/采集器接入原在线账户和风控路径。

**仍未知：** 当前Yahoo端点合法用途/限额/延迟；真实CN覆盖；源接口可用和后续修订。

固定源码：[scripts/data_collector/yahoo/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/yahoo/collector.py)。

### Qlib BaoStock 5分钟 Collector

**时间：** time解析 %Y%m%d%H%M%S%f 后减5分钟作为bar起点；不作为原始现价时间。

**复权与单位：** adjustflag='3'（原始不复权语义应和固定BaoStock版合同对齐）；不得与Yahoo标准化数据混拼。 volume/amount保留为源字段；实际单位和数值完整度需SDK/真实样本核实。

**许可边界：** Qlib MIT；BaoStock数据用途另核。用户zxygithub/baostock是第三方工具，官方身份已在14源报告纠正。

**维护条件：** 成分日期循环、日历、持久CSV、SDK错误码和异常重试；需逐股应得分母。

**采用决定：** 历史研究候选，非逐票15秒报价备用。

**仍未知：** 真实成分历史完整性/退市覆盖；当前服务配额/更新时刻/可用性。

固定源码：[scripts/data_collector/baostock_5min/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/baostock_5min/collector.py)。

- 官方资料：[https://pypi.org/project/baostock/](https://pypi.org/project/baostock/)；检索引用 turn379436363view1（新总管如用于最终网页引用需自行打开核验）。

### Qlib BaoStock PIT Collector

**时间：** normalize 对缺 date 按 period+45天（季度）或90天（其他）填入。它是估算日期，不能作为真实公告日、首次可知或历史信号证据。实际pubDate与归档首次取得时间仍需分开。

**复权与单位：** 不适用价格复权。 财务指标依字段定义，不能和量价共用归一化。

**许可边界：** Qlib MIT；数据权益独立。

**维护条件：** 需补 estimationFlag/真实公告来源/修订/knownAt/输入版本；历史研究若依估算，必须专门敏感性分析且不认证PIT。

**采用决定：** 只借鉴档案组织；估算fillna路径不进入FAYO正式PIT判断。

**仍未知：** 真实公告正文/发布时点覆盖；修订与首次获知历史；估算日期影响样本比例。

固定源码：[scripts/data_collector/pit/collector.py](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/scripts/data_collector/pit/collector.py)。

### RQAlpha 月更bundle

**时间：** 文件年份月份只表示包版本；逐记录bar时间与首次下载时间需另存；不能作为当前行情。

**复权与单位：** 依包字段/生成器，不以目录月份推定复权。 需固定包schema与原字段；未下载包实测。

**许可边界：** 固定 LICENSE 对非商业用遵Apache2；商业或组织用途另有限制，不能只看pyproject的Apache-2.0标签。无本项目授权证明。

**维护条件：** 包checksum/解包安全/schema迁移/日期覆盖/增量权限；月更包不能抵消日内缺数。

**采用决定：** 隔离研究参考；授权和包范围未清前不复制运行组件或作为正式数据依赖。

**仍未知：** 本项目授权；实际包hash/覆盖/调整字段；下载成功与增量账户。

固定源码：[rqalpha/cmds/bundle.py](https://github.com/ricequant/rqalpha/blob/0bf04946e8250b457e30c3c81d338a6b925da0bb/rqalpha/cmds/bundle.py)。

### RQAlpha RQData日线构建

**时间：** 日线trade date以及增量next trading date；只适用于日线可用时间合同。

**复权与单位：** 明确none。 保留取回字段但需RQData资产单位合同。

**许可边界：** 同RQAlpha限制+RQData数据授权；双层均需满足。

**维护条件：** H5 schema、ticker更替、停牌/退市、日历及实际可得时间。

**采用决定：** 借鉴分块/增量思路，限隔离研究参考；无权时保持未配置。

**仍未知：** 真实许可/量额单位/覆盖。

固定源码：[rqalpha/data/bundle/daybar.py](https://github.com/ricequant/rqalpha/blob/0bf04946e8250b457e30c3c81d338a6b925da0bb/rqalpha/data/bundle/daybar.py)。

- 官方资料：[https://www.ricequant.com/doc/rqdata/python/manual.html](https://www.ricequant.com/doc/rqdata/python/manual.html)；检索引用 turn442526950view0（新总管如用于最终网页引用需自行打开核验）。

### FinRL-Meta AKShare Processor

**时间：** 日线日期转datetime；缺原始分钟现价时点。

**复权与单位：** adj默认空字符串，允许显式指定；必须固定调用参数和AK版本。 硬编码12列重命名（含tic），随后只留tic/time/OHLCV，金额被丢弃；字段增减时需契约失败，不按列位静默误配。

**许可边界：** FinRL-Meta MIT；AKShare文档数据用于学术研究，具体上游权限另核。

**维护条件：** requirements未锁AK版本；旧函数/列数/财务复权/ta-lib等依赖成本；不能复制后当已适配。

**采用决定：** 参考研究处理流程；复用FAYO原适配器并按版本登记新名优先+显式旧版兼容。

**仍未知：** 本地锁版本真实请求；量额完整度/源时点/授权。

固定源码：[meta/data_processors/akshare.py](https://github.com/AI4Finance-Foundation/FinRL-Meta/blob/fabd0077c1b6cb07d52d6de04315859705884696/meta/data_processors/akshare.py)。

- 官方资料：[https://akshare.akfamily.xyz/data/stock/stock_quote.html](https://akshare.akfamily.xyz/data/stock/stock_quote.html)；检索引用 turn673914730view0（新总管如用于最终网页引用需自行打开核验）。

### FinRL-Meta TuShare Processor

**时间：** trade_date日级，不满足15秒原报价门禁。

**复权与单位：** adj参数显式传SDK；研究转换后价格与原执行价分开。 源vol/amount须核对；处理后研究表不能替代原始报价/成交量证据。

**许可边界：** FinRL-Meta MIT+TuShare数据权限分开，不能认为框架免费=数据无条件免费。

**维护条件：** RL训练依赖广（ray/torch相关生态、stable-baselines等见requirements），不导入在线关键线程；采用最小接口避免整套框架常驻。

**采用决定：** 仅隔离历史研究参考；不用于实时行情或账户执行。

**仍未知：** 账号有效性/数据覆盖/长期维护/研究授权。

固定源码：[meta/data_processors/tushare.py](https://github.com/AI4Finance-Foundation/FinRL-Meta/blob/fabd0077c1b6cb07d52d6de04315859705884696/meta/data_processors/tushare.py)。

- 官方资料：[https://tushare.pro/document/2?doc_id=109](https://tushare.pro/document/2?doc_id=109)；检索引用 turn442526950view2（新总管如用于最终网页引用需自行打开核验）。

## 交接给新总管的处理顺序

1. 先复用原行情中心和来源目录，保留真实发布者、传输路径和信息谱系三个字段；Qlib中国基准实际走Eastmoney，不与efinance等相加为独立证据。
2. 原22/23/51/52/53先统一证券、时区、原始时点、可知时点、复权、量额单位、周期起止/闭合与缺失合同，再接下游研究。
3. 原20/29/54明确进程隔离、资源预算、重试和限速；训练框架不进入在线关键调用或成为第二账户写者。
4. 原43/44/25/26对固定来源版本做历史截点、修订、未闭合K线及可执行性验证；Qlib估算公告日不进入真实可知证据。
5. 原28/55按原审批与完整发布流程接纳；来源授权、稳定性和运行条件不足的候选保持未启用。实测成功、连续运行及真实效果需另立回执。

此表没有任何已接通率、免费源数量或收益质量评分。其余14候选渠道及120目录去重证据见上级目录 `data-sources/OFFICIAL_SOURCE_REVIEW_20261126.md`。
