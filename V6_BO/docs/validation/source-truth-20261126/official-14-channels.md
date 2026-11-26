# 14 个行情渠道与工具的官方资料复核（2026-11-26）

此文件是临时研究输入，供本轮原任务登记和补丁审查。基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，目录 `V6_BO/config/data-source-registry-2026.json` 共120条路线与30个研究仓库。14个名称均已核对其可读的一手资料；资料不完整处明确保留未知。没有开户、采购、消息外发、真实行情API调用或持续运行验证。价格、限额和文档为采集时快照。

## 必须保留的区分

- 数据发布者、数据服务、SDK封装和线路不是同一统计单位；Eastmoney/Sina/Tencent/TDX包装器不能反复增加独立证据数。
- 官方宣称实时、单次可取数、软件开源、公司自身持有授权，均不证明FAYO已有原始时点、使用权限、15秒报价资格或持续稳定性。
- 本轮12个名称有直接或间接现有目录映射，TickFlow/AShareAPI未在基线120目录内；iFinD/TDX正式接口分别保留账号/Key条件。
- 根目录和业务文件未由本研究修改。完整字段、来源URL/webref与缺失项在同名JSON，原始检索结果另存；root若用于最终网页引用，需自行打开来源。

## 关键修正入口

- AKShare官方当前改名：`stock_zh_a_hist_em`、`stock_zh_a_hist_min_sina`，原脚本仍调用旧名；需受版本约束兼容，不能吞掉新接口错误后无条件改口径。
- `sina.evidenceUrl`错误引用zxygithub/baostock；该项目为第三方SQLite下载器，BaoStock官方包身份应单独引用发布者PyPI与官网。
- TickFlow免注册free服务器只历史日K，不是注册Free实时套餐；AShareAPI匿名quote按5分钟刷新且date只有交易日。
- 当前研究仅给disabled/permission-review候选依据，未认证任何新源可交易。

## 名称与现有目录映射

| 用户名称 | 目录映射 | 接入状态证据范围 |
|---|---|---|
| 东方财富 | eastmoney、eastmoney-public-history、choice、akshare-em-daily、akshare-em-minute、efinance、efinance-fund | 资料已核对；实际连通/授权/延迟本轮未验证 |
| 腾讯财经 | tencent、akshare-tencent-daily、easyquotation-tencent、ashare-tencent-route | 资料已核对；实际连通/授权/延迟本轮未验证 |
| 新浪财经 | sina、akshare-sina-minute、akshare-sina-daily、easyquotation-sina、ashare | 资料已核对；实际连通/授权/延迟本轮未验证 |
| 同花顺（公共内容与iFinD接口分开） | ifind | 目录仅有ifind凭据网关；已有10jqka公开复盘/事件页面不等于iFinD行情API已接通。 |
| 通达信（官方服务与兼容协议工具分开） | mootdx、pytdx、pytdx-quote-route、stock-data-hub-pytdx | 120目录通过TDX上游工具条目覆盖，不存在独立id=tdx的已接通正式行情服务。 |
| BaoStock（官方包与用户给出的下载器必须分开） | baostock | 资料已核对；实际连通/授权/延迟本轮未验证 |
| AKShare | akshare-em-daily、akshare-em-minute、akshare-sina-minute、akshare-sina-daily、akshare-tencent-daily | 资料已核对；实际连通/授权/延迟本轮未验证 |
| efinance | efinance、efinance-fund、stock-data-hub-efinance | 资料已核对；实际连通/授权/延迟本轮未验证 |
| Ashare（mpquant/Ashare） | ashare、ashare-tencent-route | 资料已核对；实际连通/授权/延迟本轮未验证 |
| easyquotation | easyquotation-sina、easyquotation-tencent | 资料已核对；实际连通/授权/延迟本轮未验证 |
| mootdx | mootdx | 资料已核对；实际连通/授权/延迟本轮未验证 |
| pytdx（rainx/pytdx） | pytdx、pytdx-quote-route、stock-data-hub-pytdx | 资料已核对；实际连通/授权/延迟本轮未验证 |
| TickFlow（tickflow.org） | 基线未列；候选待登记 | 资料已核对；实际连通/授权/延迟本轮未验证 |
| A股数据 API（ashareapi.com） | 基线未列；候选待登记 | 资料已核对；实际连通/授权/延迟本轮未验证 |

## 东方财富

**身份与目录：** 官方门户quote.eastmoney.com与数据服务为不同入口；本地push2/push2his及AKShare/efinance/Choice需要按同一发布体系记录，授权档位分别核对。

**覆盖：** 官方行情门户覆盖股票/指数、基金、HK/US、期货等；目录public-quote-probe实际选A股单股，Choice为另需凭据的多资产入口。

**延迟/更新：** 官方网站使用协议不保证及时性、准确性或不中断；本次网页提取行情值为占位符，未测真实数据新鲜度。仓库历史push2delay重定向观察不能当当前主域成功或独立源。

**原始时间：** 本地public-market.js请求f86并按秒时间戳解析，是仓库适配合同；本次未取得发布方正式开放API的f86语义/缓存生成协议。web页面时间不充当原始quoteAt。

**单位/复权：** 本地fltt=2报价元、f47按手的合同有仓库旧样本；必须保留原响应和参数。历史kline复权fqt应独立记录，不能用qfq生成执行报价。

**免费限额：** 公共网页可访问，不等于公开API获得无限免费调用额度。官方当前已读页未公布push2/push2his统一免费配额；Choice另需合同/账号。

**认证：** 本地公开route无Key；正式Choice接口有独立凭据要求。本次无登录、无行情API调用。

**用途/授权：** 网站协议明确内容使用/复制/派生需权利人授权，且服务可能中断。公开网页和第三方SDK均不授予本系统数据分发或交易用途权。

**本轮处置建议：** 复用原有probe/guarded-research/授权网关各自边界，原始时间/实际权限未核定不放宽执行门禁。

**未知项：** push2正式开放接口授权合同；实时原始时间定义；免费限额；当前网络重定向及部署连通性；Choice具体数据权益。

**一手来源与抓取标识：**

- [official-quote-page](https://quote.eastmoney.com/sh600000.html) — `turn751410890view0`
- [official-website-agreement](https://passport2.eastmoney.com/pub/FAQ/Service.html) — `turn751410890view1`
- [system1-use-rights](https://passport2.eastmoney.com/pub/FAQ/Service.html) — `turn953212519search0`
- [observed-current-redirect-to-feedback](https://corp.eastmoney.com/fuwutiaokuan.html) — `turn150599310view0`

## 腾讯财经

**身份与目录：** finance.qq.com当前跳腾讯新闻财经；gu.qq.com跳stockapp.finance.qq.com/mstats/。本地qt.gtimg.cn报价及ifzq.gtimg.cn历史为同一Tencent路线体系，不因包装器增加独立证据。

**覆盖：** 官方行情中心页面本次未提取出正文；A股报价、HK示例和日/分钟历史能力由现有源码与上游包装器源码可见，尚无本次正式开放API合同证明完整覆盖。

**延迟/更新：** 未取得发布方quote接口延迟SLA；不能把旧仓库单次样本或wrapper请求耗时当当前持续实时。

**原始时间：** 本地适配器读取波浪分隔第30字段作为YYYYMMDDHHMMSS供应商时间；这是代码解释，需真实原始响应与发布方协议再核验。

**单位/复权：** 本地股票报价及历史接口按原合同解析；ifzq日K存在qfq路由，需记录复权。股票/基金/HK不能共用未经核实的volume单位。

**免费限额：** 网页可阅、wrapper无Key示例均未证明公共route有承诺免费配额；当前官方配额未知。

**认证：** 原public-quote-probe无Key；无账号登录或调用。未发现对FAYO适用的正式开发者凭据合同。

**用途/授权：** 本次未定位到适用于qt.gtimg.cn的专门行情许可。腾讯教育域的通用协议搜索结果不能直接套作财经数据授权，未用于放行。

**本轮处置建议：** 维持permission-review并复用现有Tencent根源ID；优先补原始时点和服务用途确认。

**未知项：** 官方API合同；行情数据许可；延迟/频率上限；当前覆盖；交易日字段语义。

**一手来源与抓取标识：**

- [official-domain-redirect](https://finance.qq.com/) — `turn150599310view2`
- [official-quote-center-body-unavailable](https://gu.qq.com/) — `turn751410890view4`
- [wrapper-official-source-not-publisher-license](https://github.com/mpquant/Ashare/blob/main/Ashare.py) — `turn890996500view6`
- [wrapper-official-source-not-publisher-license](https://github.com/shidenggui/easyquotation) — `turn622007935view4`

## 新浪财经

**身份与目录：** finance.sina.com.cn是官方财经入口；hq.sinajs.cn是本地既有报价route。目录sina条目曾指向zxygithub/baostock，需改为新浪官方证据，不能以下载器为身份依据。

**覆盖：** 官网有股票/基金/债券/HK/US/期货/外汇等；说明各品种数据来自合作方，具体品种有实时或延时差异。

**延迟/更新：** 官网声明常见市场除特别标明外为实时、其他至少延时15分钟，并提示错误/残缺/延时风险。这是供应方说明，不是本次逐品种实测或绝对时延保证。

**原始时间：** 官方A股页面模板有date/time占位，本地Sina CSV适配和easyquotation样例保留独立日期及时间；未以空页面模板证明当前有效quote。

**单位/复权：** 本地/包装器Sina snapshot成交股数与金额、昨收与现价必须区别；历史复权与快照分别处理。

**免费限额：** 官网称免费行情信息供获取信息之用；未公布本次可读统一API请求频率额度。AKShare新浪历史说明多次抓取可封IP，应约束访问并如实记录。

**认证：** 页面浏览与旧route无Key逻辑不构成免授权数据服务；未登录/调用行情API。

**用途/授权：** 官网说明免费行情来自合作方、仅供信息参考且不为延误错误负责；未取得自动再展示/分发/交易用途许可。

**本轮处置建议：** 原Sina根源继续作为待权限/时点验证来源；不能与Ashare/easyquotation/AKShare-Sina重复投票。

**未知项：** 合作方精确原始来源；逐品种延时；公开route使用额度与许可；原始时间含义。

**一手来源与抓取标识：**

- [system1-official-market-scope-and-disclaimer](https://finance.sina.com.cn/) — `turn150599310search4`
- [official-A-share-page](https://finance.sina.com.cn/realstock/company/sh600000/nc.shtml) — `turn150599310view1`
- [wrapper-official-frequency-caveat](https://akshare.akfamily.xyz/data/stock/stock_quote.html) — `turn673914730view0`

## 同花顺（公共内容与iFinD接口分开）

**身份与目录：** 10jqka.com.cn为同花顺门户，51ifind.com/ftwc.51ifind.com为iFinD数据接口；公共页面与账号型数据服务分层。

**覆盖：** 门户有A/HK/US/期货/基金；官方iFinD支持实时、历史、高频序列、日内快照及基本面。免费账号数据年限与日内快照交易所范围有具体限制。

**延迟/更新：** iFinD FAQ称日行情通常收盘后1—2小时入库，海外更晚；分钟线由快照合成，收费/免费站点及采样时点可能不同。未提供当前实时端到端时延验证。

**原始时间：** 不同函数有独立时间/快照语义；本次未取得完整可直接供FAYO解析的实时秒级字段合同。

**单位/复权：** 额度以单元格而非HTTP请求计；函数的复权与volume单位需按官方函数参数进一步核实，不能将免费额度当原始价格保证。

**免费限额：** 权限页列免费实时300万单元格/月、高频150万/月、历史100万/月、日内快照200万/月等；免费高频最近1年、历史最近5年、快照最近3月。权限页说有iFinD账号即可，FAQ却把免费账号描述为已购终端附少量接口，资格口径待确认。

**认证：** 需要iFinD账号/数据权限；免费、试用、正式额度分别管理，不能去掉credentials-required。无开户申请。

**用途/授权：** 同花顺产品协议明确免费标识产品限自用非商用且不复制分发，商用销售/复制/分发需书面授权；iFinD还需专门数据条款，未证明本系统拥有权益。

**本轮处置建议：** 复用ifind授权网关候选；公共研究页面和正式行情服务不能混为已接线。

**未知项：** 免费账户资格冲突；FAYO账户权限；实时字段合同；再展示/研究用途条款；实际限流/时延。

**一手来源与抓取标识：**

- [official-portal](https://www.10jqka.com.cn/) — `turn751410890view3`
- [official-license](https://news.10jqka.com.cn/clientinfo/protocol.html) — `turn751410890view2`
- [system1-license-verification](https://news.10jqka.com.cn/clientinfo/protocol.html) — `turn150599310search0`
- [system1-official-free-quotas](https://ftwc.51ifind.com/gwstatic/static/ds_web/quantapi-web/help-center/permission.html) — `turn434905895search4`
- [official-time-and-account-caveat](https://ftwc.51ifind.com/gwstatic/static/ds_web/quantapi-web/help-center/faq.html) — `turn434905895search5`

## 通达信（官方服务与兼容协议工具分开）

**身份与目录：** 官方www.tdx.com.cn运营方深圳市财富趋势科技股份有限公司；tdxaidata/tqserver为其官方服务，mootdx/pytdx为外部兼容协议工具。

**覆盖：** 官方TdxAiData文档列K线/分钟/历史、快照、交易日历、除权、财务、分笔、行情订阅；tqserver用于数据，不提供交易功能。

**延迟/更新：** 官方文档的实时能力不等于已核验端到端时延；本次未连接DLL/数据后台。

**原始时间：** 官方get_market_snapshot_batch字段RefreshTime为HHMMSS；缺完整日期时不能仅用本机日期补当前原始时刻。时间来源和交易日需按正式合同/其他字段确认。

**单位/复权：** 官方snapshot Volume为总手、NowVol现手；Amount仅标总成交金额，未据此推定缩放单位。价格小数位XsFlag及各资产缩放需核实。

**免费限额：** 官方商城/后台Key服务与免费客户端/第三方兼容工具不同；本次未取得明确免费数据服务总额度。不能把安装pytdx无Key等同官方免费API。

**认证：** 官方后台数据模式需TdxAiData.ini配置Key，会员中心创建数据服务类型Key；未创建、未使用。

**用途/授权：** 官网展示其自身交易所/指数行情授权，不能转化成FAYO终端/再分发许可。用户服务协议/具体数据服务范围需关联账户权益。

**本轮处置建议：** 已有TDX工具不重复计来源；正式tdxaidata服务仅可记认证条件明确的候选，不能偷换现有pytdx路由或增加执行权限。

**未知项：** 具体数据服务免费/收费额度；账户授权范围；RefreshTime对应交易日；单位缩放；目标系统DLL/平台兼容；真实时延。

**一手来源与抓取标识：**

- [official-portal](https://www.tdx.com.cn/) — `turn150599310view5`
- [supplier-license-not-customer-entitlement](https://www.tdx.com.cn/article/license.html) — `turn953212519view0`
- [system1-official-user-agreement](https://www.tdx.com.cn/about/yhxy/index.html?tabindex=0) — `turn150599310search2`
- [official-auth-and-functions](https://help.tdx.com.cn/quant/docs/markdown/mindoc-1hjbgqpdhv114.html) — `turn434905895search1`
- [official-snapshot-time-and-volume](https://help.tdx.com.cn/quant/docs/markdown/mindoc-1hjbidnohpjn4/mindoc-1hlir5r0t9hgc.html) — `turn434905895search2`

## BaoStock（官方包与用户给出的下载器必须分开）

**身份与目录：** 用户链接zxygithub/baostock自称从BaoStock API下载到SQLite的项目，不是已确认官方SDK。官方PyPI包作者/维护者baostock、邮箱baostock@163.com并链到www.baostock.com，可与官方域名一致性核对。

**覆盖：** 发布者PyPI页确认免费中国股票研究数据和历史日K接口；含价格、volume、amount、adjustflag、tradestatus等。官网/API/旧Wiki本次抽取为空，未用第三方下载器补写官方分钟覆盖或更新时间。

**延迟/更新：** 官方可读PyPI页未给盘中实时或更新SLA；日历史K不能成为当前报价。第三方所称日17:30/分钟20:30等未取得官方原文，保留未知。

**原始时间：** 可读官方示例日K为date字段；分钟time格式本次未从官方可访问正文核实。

**单位/复权：** 官方示例adjustflag=3默认不复权、2前复权；各字段单位/分钟周期需官方API或已固定发布包进一步核对。

**免费限额：** 发布者明确Free china stock market data；未见官方可读当前每秒/每日限额，不解释为无限。

**认证：** bs.login()示例无账号参数，仍有协议登录成功回执；未实际建立连接或声称已取得服务。

**用途/授权：** BSD是包代码许可；发布者研究/量化定位支持私人研究候选，未提供再分发或交易用途的完整数据授权证据。

**本轮处置建议：** 复用已有guarded-research路径；修正文档evidenceUrl归属，保持历史数据用途与当前报价分离。

**未知项：** 当前官方API正文；分钟覆盖/时间格式/更新时间；上游数据权；真实可达性与数据年龄。

**一手来源与抓取标识：**

- [user-link-third-party-downloader](https://github.com/zxygithub/baostock) — `turn136957708view5`
- [publisher-package](https://pypi.org/project/baostock/) — `turn379436363view1`
- [system1-free-package-verification](https://pypi.org/project/baostock/) — `turn406500640search3`
- [body-unavailable](https://www.baostock.com/) — `turn981426884view1`
- [body-unavailable](https://baostock.com/baostock/index.php/Python_API%E6%96%87%E6%A1%A3) — `turn622007935view3`

## AKShare

**身份与目录：** akfamily/akshare ↔ akshare.akfamily.xyz；SDK/接口聚合器，不是一个独立的行情原始发布方。

**覆盖：** 官方stock目录含A/HK/US等；A股东财snapshot、历史日K、东财/新浪分钟线。东财1分钟仅近5交易日且不复权；其他频率/复权按接口。

**延迟/更新：** 实时字样表示接口类型，未见统一最大延迟SLA。分钟bar时间不能自动证明当前quote新鲜。

**原始时间：** stock_zh_a_spot_em公开返回列没有原始报价日期/秒字段；东财分钟有时间，新浪分钟day为完整日期时间。必须按接口保留，不用采集时刻代替。

**单位/复权：** 东财spot/minute成交量手、金额元；新浪分钟与不同接口需逐一确认。1分钟只有最近一日有open，其余日期open可为0，不能当有效零价。

**免费限额：** 开源库免费安装，未发现统一每分钟/每日免费额度；接口文档的单次返回量不是无限抓取授权，新浪分钟明确注意调用频率。

**认证：** 已读公开行情示例无Key；其他数据域可能有各自来源要求，不能扩大概括。

**用途/授权：** MIT为代码许可；官方声明数据仅供学术研究。上游网页来源条款和数据用途需另核验。

**本轮处置建议：** 既有研究接口复用并保存实际upstream；东财/Sina/Tencent分别去重。公开spot缺原始时间不能直接满足执行门禁。

**兼容性发现：** 当前官方1.20.70文档及README确认旧名无alias：stock_zh_a_hist→stock_zh_a_hist_em；当前新浪分钟名stock_zh_a_hist_min_sina。仓库six-photo-sources.py:28/:30仍用旧名，需与依赖版本和实际失败核对后补兼容。

**未知项：** 部署安装版本；来源授权；实时源精确时间；上游实际限流；当前接口真实可用性。

**一手来源与抓取标识：**

- [user-specified-official](https://akshare.akfamily.xyz/data/stock/stock.html) — `turn874327914view2`
- [official-spot-schema](https://akshare.akfamily.xyz/data/stock/stock_quote.html) — `turn981426884view9`
- [official-minute-schema](https://akshare.akfamily.xyz/data/stock/stock_quote.html) — `turn464155429view1`
- [official-version-migration](https://github.com/akfamily/akshare) — `turn464155429view0`
- [system1-research-use](https://github.com/akfamily/akshare) — `turn939048696search0`
- [official-em-history-signature-and-units](https://akshare.akfamily.xyz/data/stock/stock_quote.html) — `turn673914730view0`

## efinance

**身份与目录：** Micro-sheep/efinance ↔ efinance.readthedocs.io；主要行情链为Eastmoney包装，不能当Eastmoney之外独立票。

**覆盖：** 官方get_realtime_quotes覆盖沪深京、基金ETF/LOF、港美、可转债/期货等市场；有历史K和单股快照。

**延迟/更新：** 文档称最新/实时，无已读最大延迟承诺；本次未请求真实行情。

**原始时间：** get_realtime_quotes示例列没有原始报价时间；get_quote_snapshot有时间但样例仅HH:MM:SS，没有交易日期。历史K日期是bar时间，不能补成当前原始quoteAt。

**单位/复权：** 各市场/接口单位需分别确认。get_quote_history默认fqt=1前复权；执行价不得直接用默认复权K。行情ID用于保留市场身份。

**免费限额：** MIT开源包，无统一免费调用额度或SLA证据；上游限制仍待核验。

**认证：** 公开示例无Key；未证明数据可无限量抓取。

**用途/授权：** 软件MIT不等于Eastmoney行情再展示/分发或自动交易许可，当前授权仍待确认。

**本轮处置建议：** 复用既有研究路径，按Eastmoney同源聚合；snapshot仅时间缺日期时应保留无法确认，不能以本机日期拼接后视作已证实。

**未知项：** 上游使用权限；统一请求限额；snapshot日期与time语义；实时延迟与覆盖；各品种成交量单位。

**一手来源与抓取标识：**

- [official-repository](https://github.com/Micro-sheep/efinance) — `turn136957708view0`
- [official-schema](https://efinance.readthedocs.io/en/latest/api.html) — `turn622007935view6`
- [official-source](https://efinance.readthedocs.io/en/latest/_modules/efinance/stock/getter.html) — `turn273266968view3`

## Ashare（mpquant/Ashare）

**身份与目录：** mpquant/Ashare单文件get_price封装；不是ashareapi.com。源码明确Sina主路/Tencent备路，1m走Tencent。

**覆盖：** A股日/周/月与1/5/15/30/60分钟K；自动fallback存在。按实际路由留源，不能称两路均独立验证成功。

**延迟/更新：** 无已读行情新鲜度SLA；分钟最新bar的close会被Tencent qt最新价覆盖，时间索引仍是bar时间。

**原始时间：** DataFrame索引time/day由上游bar文本解析，返回OHLCV没有独立原始quoteAt；minute end_date参数在腾讯路径未用于URL时间截断。

**单位/复权：** 腾讯日线请求qfq；Sina/Tencent回退应核对复权与单位是否一致，不能仅因字段同名视为同口径。

**免费限额：** 公开示例无Key，未见承诺调用频率/每日额度；不把自由访问等同无限服务。

**认证：** 源码requests公开接口，无凭据逻辑证据。

**用途/授权：** 本次已读仓库未找到明确许可证文本；数据来源Sina/Tencent的再利用许可另行核验。不能据README程序化交易措辞获得下单授权。

**本轮处置建议：** 作为已有历史研究候选补provenance，当前返回结构不足以单独证明执行报价原始时间。

**未知项：** 代码许可确认；上游用途条款；路由回退口径；原始时间；调用限额。

**一手来源与抓取标识：**

- [official-repository](https://github.com/mpquant/Ashare) — `turn136957708view1`
- [official-source](https://github.com/mpquant/Ashare/blob/main/Ashare.py) — `turn890996500view6`

## easyquotation

**身份与目录：** shidenggui/easyquotation选择Sina/Tencent/Jisilu后端；包装器不是新原始发布者。

**覆盖：** 沪深京全市场快照、个股/指数、腾讯HK等示例；后端决定真实覆盖。

**延迟/更新：** README的200+ms是网络正常时请求耗时宣传，不是原始行情最大年龄或15秒SLA。

**原始时间：** Sina示例保留date和time，组合可形成上游声明的行情时间；HK示例为带日期time。仍需真实响应验证时区/交易日/旧价/未来时间。

**单位/复权：** Sina样例turnover=交易股数，而volume=成交金额；与其他库volume=股/手含义不同。close=昨收，now=现价，不能泛用字段映射。

**免费限额：** MIT包，README称免费行情；未见统一请求限额，不能视为上游无限调用权。

**认证：** Sina/Tencent示例无Key；Jisilu功能可能另需cookie，应按后端单独核对，不使用用户cookie或登录。

**用途/授权：** MIT只证明代码许可；上游数据许可/再分发/交易用途未知。

**本轮处置建议：** 复用已有Sina/Tencent路径并同源去重；原始date/time可作为后续验证输入，但不据README自动允许执行。

**未知项：** 各后端授权；各市场真实时延；现版字段/单位稳定性；真实交易日证据。

**一手来源与抓取标识：**

- [official-readme](https://github.com/shidenggui/easyquotation) — `turn622007935view4`

## mootdx

**身份与目录：** mootdx/mootdx是TDX数据读取封装；与pytdx/TDX线路同源。官网www.mootdx.com目前跳到域名出售页，ReadTheDocs旧链接也跳失效官网。

**覆盖：** README确认通达信数据读取封装、依赖tdxpy；未用失效官网推定当前完整行情/历史覆盖。

**延迟/更新：** 本次未取得有效服务延迟SLA或原始时间字段合同。

**原始时间：** 需要核对实际tdxpy返回quote时间/交易日期语义；不能把本机now作为原始时间。

**单位/复权：** 需按具体协议与资产核实价格缩放、成交量单位及复权，不能依接口名推断。

**免费限额：** MIT代码包且未公布可用服务额度证据；不是承诺免费TDX数据服务。

**认证：** 代码使用与TDX服务器数据访问权限不同；本次未连服务器/未验证准入条件。

**用途/授权：** README同时列MIT并声明仅学习交流、不得商用；记录二者，不擅自作法律解释或将MIT视为解除上游/用途限制。

**本轮处置建议：** 保持permission-review/研究候选，不从失效域名拉取执行配置；需可信维护文档和协议样本后才能推进。

**未知项：** 当前有效文档地址；数据访问权；维护/依赖版本；时间字段；实际覆盖与延迟。

**一手来源与抓取标识：**

- [official-readme](https://github.com/mootdx/mootdx) — `turn912756268view4`
- [system1-use-restriction](https://github.com/mootdx/mootdx/blob/master/README.md) — `turn379436363search2`
- [observed-parked-domain](https://www.mootdx.com/) — `turn750075088view5`
- [observed-broken-redirect](https://mootdx.readthedocs.io/zh_CN/latest/history/) — `turn379436363view3`

## pytdx（rainx/pytdx）

**身份与目录：** rainx/pytdx原项目已在2020-04-15归档；主分支为archive声明。历史官方文档仍可读，不能把历史文档当当前维护服务。

**覆盖：** 历史标准行情文档有沪深报价、1/5/15/30/60分钟及日周月季年bar；单次K线count≤800。扩展接口有外盘/期权/期货说明。

**延迟/更新：** 无当前SLA/可用性验证；连接既有兼容行情服务器。200x文档不能证明2026线路可用。

**原始时间：** 已读报价API未给可核实的原始日期/秒级timestamp定义；bar时间与quote时点必须分开。

**单位/复权：** 历史官方文档提示某些非股票品种（如可转债）报价可能为实际价格×10，需逐品种缩放合同。

**免费限额：** 历史库安装无Key示例；K线800为单次返回量，不是每秒/每日授权配额。服务器访问额度未知。

**认证：** 示例socket连接IP/port，未表明拥有交易所或服务器授权；本次未连接。

**用途/授权：** 官方archive声明为个人学习，要求勿用于商业；历史文档还注明机构勿用。旧软件许可不能代替现行数据授权。

**本轮处置建议：** 保留TDX同源研究候选/依赖风险；不新增实盘或把旧协议当可用实时源。

**未知项：** 当前维护替代；TDX服务器授权；原始时点语义；真实兼容性；各品种缩放。

**一手来源与抓取标识：**

- [system1-archived-and-use-restriction](https://github.com/rainx/pytdx) — `turn379436363search3`
- [historical-official-doc](https://pytdx-docs.readthedocs.io/zh-cn/latest/) — `turn622007935view2`
- [historical-api](https://pytdx-docs.readthedocs.io/zh-cn/latest/pytdx_hq/) — `turn939048696view0`

## TickFlow（tickflow.org）

**身份与目录：** 官网 tickflow.org → docs.tickflow.org → api.tickflow.org / free-api.tickflow.org 的域名链可核对；未核实运营法律主体或交易所授权。没有与其他同名 TickFlow 项目合并。

**覆盖：** 官方列 A股、ETF、指数及美股/港股行情；免费服务器仅历史日/周/月/季/年K和标的信息。注册 Free 套餐另含实时行情和日K。分钟线、五档及 WebSocket 分属付费权限。

**延迟/更新：** free-api 历史日K盘中不更新。完整服务称实时，首页响应延迟/SLA属供应方宣传；本次未实测行情年龄、丢包、延迟分布或交易所到达链。

**原始时间：** REST /v1/quotes 与 WebSocket quote/depth 均有 timestamp，SDK示例按毫秒解码；日K DataFrame 还有 trade_date/trade_time，其零点时间是K线日期，不能当作盘中原始报价。timestamp是否交易所产生、聚合时刻或缓存生成时刻未在已读字段说明中明确。

**单位/复权：** 日K默认比例前复权 forward，另有 forward_additive/backward/none；必须冻结复权算法。未核实各市场 quote/depth volume 的统一单位，需接口级实测/合同。

**免费限额：** 免注册 free-api 定价页称无额度限制，但仅历史日K/标的查询且盘中不更新；注册 Free 为10次/分钟、每次最多5标的、不支持标的池查询。不能混成无鉴权无限实时行情。

**认证：** free-api无需Key；完整 REST x-api-key；WS api_key查询参数且401/403应停止重连。

**用途/授权：** 服务协议URL可达但提取只得页眉页脚，未取得实质许可条款；上游来源、再展示/再分发权、交易用途授权均未知。

**本轮处置建议：** 可登记历史研究候选与注册实时候选；全部仍待凭据/条款/时间语义/真实输入验证。不可因存在timestamp或付费档而自动放行交易。

**付费档快照：** 定价页当前显示 Starter ¥49/月、Pro ¥99/月、Expert ¥199/月；Expert WS200标的。仅记录可见报价，不采购。

**未知项：** 运营法律主体；上游真实发布方及同源关系；服务协议正文；quote timestamp语义；各市场/档位实际数据新鲜度；批量quote/depth单位。

**一手来源与抓取标识：**

- [system1-current-pricing](https://tickflow.org/pricing/) — `turn379436363search0`
- [official-doc](https://docs.tickflow.org/zh-Hans/quickstart) — `turn653293337view0`
- [official-api](https://docs.tickflow.org/zh-hans/api-reference/实时行情/查询实时行情) — `turn622007935view0`
- [official-api](https://docs.tickflow.org/zh-Hans/api-reference/websocket) — `turn653293337view3`
- [official-doc](https://docs.tickflow.org/zh-Hans/faq) — `turn653293337view1`
- [body-unavailable](https://tickflow.org/legal/terms/) — `turn637128606view1`

## A股数据 API（ashareapi.com）

**身份与目录：** 官网和 ashareapi/ashareapi-python 双向互链，服务域名 api.ashareapi.com，SDK为ashareapi；与 mpquant/Ashare 是不同项目。已读页面未明确法律运营主体或授权数据商身份。

**覆盖：** 官网端点清单当次称102端点；涵盖A股、HK/US及研究数据。quote为8字段，默认30条日线数组且首条最新；kline日及以上可匿名、分钟需要standard及以上。此处是供应方文档覆盖，不是逐端点已验真。

**延迟/更新：** 端点总表明示quote及免费日K匿名5分钟刷新，付费宣称每次取最新；quote单页通用FAQ只称实时或当日，未给原始秒级报价时间。不能符合15秒执行门禁的证据要求。

**原始时间：** quote字段date是交易日，未展示原始盘中秒级timestamp；minute用time(HHMM)。envelope的elapsed_ms是请求耗时，不是quoteAt。不能以抓取时刻补写原始时间。

**单位/复权：** quote/kline volume按手（1手100股），amount元，turnover百分数，last不是close。/v1/kline日K固定前复权、分钟不复权，原始价需另端点；不可把复权历史K当原始执行报价。

**免费限额：** 自动化脚本/SDK/Agent匿名2次/分，浏览器5次/分；PoW文档15次/分但本次未调用；匿名单次最多250根、日10万行。端点总表称quote/kline最多5标的；quote通用FAQ称单标的，存在文档冲突应保守解析并待确认。

**认证：** 免费端点无需Key；付费Authorization: Bearer <Key>，可见文档也支持query key但不建议将密钥置日志。未获取/使用任何Key。

**用途/授权：** 官方条款允许在自身应用/研究中分析，禁止原样转售及大规模爬取建库向第三方提供；不承诺SLA，说明可能延迟/缺失/错误。未据此验证上游数据权或授予本系统交易权限。

**本轮处置建议：** 可登记有明确刷新限制的研究候选；免费quote不可升格为15秒实时执行源。付费也需原始时点、来源链和实际授权核验。

**付费档快照：** 官网当次价目9.9/1万次、29.9/10万次、99/50万次、199/月；请求限流30/120/300/600次每分钟，附IP及部分端点日限额。搜索旧缓存端点数/PoW值落后，优先当次总表和单页的保守交集。

**未知项：** 法律运营主体；逐响应上游来源的稳定身份；秒级原始quote时间；5min刷新与单页实时措辞的版本一致性；批量能力冲突；真实覆盖与服务延迟。

**一手来源与抓取标识：**

- [official-endpoint-list](https://ashareapi.com/endpoints/) — `turn874327914view1`
- [official-fields-and-limit](https://ashareapi.com/docs/endpoints/quote/) — `turn464155429view4`
- [official-terms](https://ashareapi.com/terms/) — `turn890996500view4`
- [official-current-pricing](https://ashareapi.com/pricing/) — `turn890996500view5`
- [system1-price-verification-old-cached-details](https://ashareapi.com/pricing/) — `turn406500640search0`
- [official-linked-sdk](https://github.com/ashareapi/ashareapi-python) — `turn981426884view6`
- [official-change-history](https://ashareapi.com/changelog/) — `turn273266968search2`

## 验证仍需由实际接入补齐

原始响应与来源时间语义、证券身份/币种/单位/复权、权限与服务条款、覆盖分母、请求和失败回执、连续交易日延迟/断流记录，均应按独立阶段登记。公开文档引用不能填成真实数据覆盖通过；本机网络观察不能自动推成目标部署已接通。资料冲突（AShareAPI批量与PoW、iFinD免费资格）先保守登记，不能从较宽松旧缓存推定权益。

