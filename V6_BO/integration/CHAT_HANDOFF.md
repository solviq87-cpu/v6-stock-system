**2026-11-13 最新用户覆盖与自动更新交接（优先于以下历史档案）**：当前唯一 WorkBuddy 目标 `https://af3c7822e6aafc135.app.workbuddy.host`。官方 `/console`、`/api/site`、`/api/health` 带私有分享码只读实测 200；旧文档路径 `/api/ai/doc?id=ai` 为 404 官方指引，发布接口为 `POST /api/publish`（仅单文件静态 HTML，无 Node/Python 执行）。尚未执行写入或证明生产部署。用户已要求 GitHub 自动检测更新，详见 `docs/AUTO_UPDATE_WORKBUDDY_20261113.md`：仅发布通过 V6 CI 的 `dev` 精确头 SHA，由既有每小时 hosted 任务与当前 managed cloud 环境作为唯一 managed-task 发布者，GitHub 每 15 分钟只读巡检；原 Secret API 403 仍有效，私有 shareCodeFile 注入仅解决配置依赖，精确 CI/SHA/owner 和完整读回仍强制，本次任务配置与执行结果待实际回执。分享码/token 禁止入 Git、日志、截图。新站当前 HTML 与仓库锁定主页不同，保持四策略/模拟盘/风控与现有界面，禁止旧主页发布脚本覆盖；目标细节见 `docs/CHINA_WORKBUDDY_WRITE_TARGET.md`。 角色切换按 `V6_BO/config/repository-auto-update-owner.json` 执行停旧 scheduler→等在途结束且 journal.transaction=null（旧 owner 先恢复）→owner 变更 SHA 通过 CI→启新；owner 不能撤销在途写入，跨环境 flock 不互斥。

---

# V6 20261107bo 续编交接

唯一基线：V6_1083_full_20261106bn.zip，SHA-256 f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78，已实际校验SHA与ZIP CRC。完整保留基线文件。

本批完成：精选池、趋势池、连阳池在复制价格时同步保留同一行的供应商来源与原始报价时间；防止源行有证据、入池却丢失证据。新增quoteSnapshotFields只复制白名单标量，不从股票代码对应的其他快照借时间，不以接收时间代替原时间，不授予canTrade=true。缺时点仍未知，旧/未来时点照原值投影为stale/future。原打分、筛选、排序、交易门槛与账户历史保留。应用与双端缓存五处、共用仪表盘侧栏统一20261107bo。

新增7项回归，定向22项全通过；npm run check及变更模块/共用仪表盘语法检查通过。主工程全量1090通过、0失败/跳过/取消、退出0，93719.716018ms；完整暂存ZIP独立解压副本全量同为1090通过、0失败/跳过/取消、退出0，130617.278527ms。两份TAP完整性核验通过。1093个JS/HTML/CSS/Python源码逐字节一致；独立复测后仅补报告、日志和完整性清单，不改产品源码。

正式日志：integration/pool-quote-full-20261107bo.tap/.exit、pool-quote-clean-20261107bo.tap/.exit；正式定向pool-quote-targeted-final-20261107bo.tap。首次准备脚本碰到另一个同名scored.push后主动停止；当时的定向失败日志保留，不作为正式结果。详见POOL_QUOTE_OPERATIONS_20261107bo.md及POOL_QUOTE_DIFF_20261107bo.json。

仍待：源头本来没有逐票原始时间的全A列表，三类池仍显示未知；其他旧页、研究/信号、指数/板块/跨市场价格消费者未全部审核。盘中连续行情、许可/账号/限频、220只监控容量、真实新闻、独立样本外概率、持仓闭环及短信/真机/长期云端/跨机灾备/真实策略效果继续待验收。测试数量不是项目完成率。本批完整代码没有自动替换先前只读历史样本网页预览，不把它称作完整后台上线。未购买付费接口或服务，未接券商。

运行：先读AGENTS.md与integration/CHAT_HANDOFF.md。Node22.6+、Python3、Linux util-linux flock；ML解释器按目标机指定并有sklearn/numpy：

```sh
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/pool-quote-clean-20261107bo.tap
npm run check
npm start
```

不要把本地副本角色配置带到线上。跨账号请下载完整ZIP与本报告重新上传，私有链接不自动授权另一账号。

## 历史记录

# V6 20261106bn 最新交接

唯一基线 V6_1075_full_20261106bm.zip，实际SHA-256：232c27ba263655c88c24bbaede7dd0457a0f032c4cd22a55ae9cab4583a2af65。

新增逐票报价显示元数据，风险视图区分逐行recent/stale/future/unknown；整张列表刚收到不再掩盖逐票原时点缺失或过期。双端共用榜单显示快照价及上海原始时点，缺来源/时间与未来时间有明确状态。所选股票价格随候选数据刷新，不重复拉K线；离开候选池显示无报价。五处版本及侧栏同步bn。原四套策略规则、账户历史、排序和角色配置保留；未认证行情持续实时、未部署、未购买或接券商。

定向25项通过；npm run check和两个变更脚本语法检查通过。发布核验：最终主工程与独立解压副本均1083通过、0失败/跳过/取消、退出0，两份TAP完整性核验通过。1092个JS/HTML/CSS/Python源码逐字节一致，之后只补交接及验证记录。首次全量测试1082/1083通过，旧切股测试遗漏新增前端帮助函数依赖，已修夹具，保留失败日志；正式日志用display-quote-time-release-full-20261106bn.tap及对应.exit。操作与边界见integration/DISPLAY_QUOTE_TIME_OPERATIONS_20261106bn.md。

下一步仍须审核候选池价格生产者绑定原时点的完整链路，以及旧页面、研究/信号、指数/板块/跨市场消费者；本轮不借用其他价格的来源时间。220只容量、目标机真实盘中连续更新/限频/许可、新闻、样本外概率、持仓闭环与短信/真机/云端/灾备/策略效果均未现场验收。

运行：Node22.6+、Python3、Linux flock，V6_MODEL_PYTHON指向有sklearn/numpy的解释器，V6_TEST_CONCURRENCY=2，三个线程环境变量设1后npm test。不要复制本地副本角色配置到线上。测试数量不是工程完成率。跨账号请下载ZIP和独立报告后重新上传。

## 历史记录

# V6 20261106bm 最新交接

唯一基线：用户上传 V6_1069_full_20261106bl.zip；SHA-256 60fc9ae84b3744275f4ccb899e97576475905ea68e885403d4ab3767055ee414，已实际核对。

本批继续原时点治理：paperAuthorityQuotes 不再把 tick.t 或 stocksAt 接收时间传为权威账本 timestamp。报价与风控 observedAt 均用15秒内的逐票供应商原时点，保留 quoteSource/quoteAt；风控 marks 同样判旧并覆盖执行缓存中池外代码。ingestPx 保留来源并拒绝无穷价格、空白/非字符串来源、非正原时点；paperPxFresh 同步收紧。五处应用/缓存版本统一 bm。详见 integration/AUTHORITY_QUOTE_TIME_OPERATIONS_20261106bm.md。

定向36通过；npm run check通过。主工程完整1075通过、0失败/跳过/取消、退出0，TAP完整性核验通过。发布核验：主工程和从暂存ZIP解压的独立副本均1075通过、0失败/跳过/取消、退出0；两份TAP完整性核验通过。1090个JS/HTML/CSS/Python源码文件与独立副本逐字节一致；独立复测后仅补交接文档及日志。

仍待：paperPrices 展示估值仍含池价/全A快照，量额/昨收/停牌元数据未认证同频，其他研究/信号/展示价格消费者未全覆盖审计。220只监控容量、真实盘中持续行情及许可、新闻/概率独立样本外、持仓闭环、短信OTP、实体手机、长期云端、第二机器灾备、策略真实效果继续按原清单推进。

运行需Node22.6+、Python3、flock；V6_MODEL_PYTHON应指向实际能导入sklearn/numpy的机器学习解释器。不得把本地副本角色配置复制到线上。本轮不构成用户现场部署或行情实时认证；未购买、未接券商。测试数不等于完成率。

## 历史交接

# V6 20261106bl 最新交接

唯一基线 BK1065 完整包。本轮修复模拟盘自动成交价必须有逐票供应商原始时点且当前十五秒内有效，只有接收时间的全 A 行可展示但不作为执行价；盘中报价巡检优先覆盖模拟盘持仓。四套策略、账户历史、双端布局保留，缓存五处统一 bl。详见 PAPER_ORIGINAL_QUOTE_OPERATIONS_20261106bl.md 与 BUGS。

主工程 1069 项全通过、0 失败/跳过/取消，退出0。首次全量旧测试不符 1 项，修订夹具后最终完整回归全通过；过程日志保留。干净ZIP复测同为1069通过、0失败/跳过/取消，退出0；1089个源码文件逐字节相同。真实供应商持续盘中、权限、策略效果、短信、真机、长期云端和跨机灾备仍未现场验收。数据不足时自动买卖保守停下；未接券商或购买服务。

Node22.6+、Python3、flock，V6_MODEL_PYTHON 指向实际 ML Python：V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test。交付完整 ZIP 和独立 TXT，跨账号需下载后上传；私有链接不自动跨账号授权。

## 历史交接

# V6 20261106bi 六张照片来源实测与备用接入

唯一基线V6_1044_full_20261106bh.zip，SHA-256 0f020162af30b9e5ea8a4bd3d937eaf5a6c36ef9e970d064c59601af947a839e。原完整工程保留，不用旧包覆盖。

最新用户要求：只按六张照片逐项试，能跑通的全部接为备用，实时行情优先，不购买收费原生接口。范围为照片03日线、04分钟、05财务专题、06实时/L2、07期货跨市场，每图6行共30行；08是6项取数检查，不当额外数据源。照片文件指纹与精确接口清单随包。

本批实际结果：7条取得数据并通过研究备用投影；3条失败或超时；17条账号/权限型、3条客户端/行情前置型未调用、适配与现场条件待补。不是把目录登记当接通，也不是所有字段/频率/历史都已测试。

7条：AKShare stock_zh_a_hist（日线5条）、efinance stock.get_quote_history（日线5条）、AKShare stock_zh_a_hist_min_em（5分钟200条）、AKShare stock_zh_a_minute（新浪5分钟200条）、efinance fund.get_quote_history（基金161725净值200条）、巨潮公开公告查询（600519公告1条）、easyquotation use('sina').real（报价1条）。东财封装共享上游，不认证独立。巨潮结构化账号API未测试。分钟仅5分钟样本，不外推1分钟等全部频率。

实时：easyquotation返回原时点上海2026-11-06 15:34:59的报价，当时盘后，标stale；efinance实时未成功。没有盘中连续更新认证。新增报价刷新入口真实执行一次并返回数据，但没有常驻部署。

本批安装akshare1.20.35、efinance0.5.9、easyquotation0.7.7、baostock0.9.4到隔离研究Python，依赖见requirements-six-photo-sources.txt。主服务/npm test不依赖这些SDK。BaoStock日线/分钟未取到数据；失败记录全部保留。

入口scripts/six-photo-sources.py；config/six-photo-sources.json精确30行。先完整采样到新档案，不覆盖旧文件：
/path/to/research-python scripts/six-photo-sources.py --code 600519 --fund-code 161725 --start 2026-11-02 --end 2026-11-06 --output /safe/new-six-photo.json

账号/客户端型不调用、不创建账户/试用/使用付费额度；本批没有实现这些待条件行的原生适配，不能称输入令牌就全可用。按本次明确指令允许六图内公开SDK研究小样本，原生产来源清单和旧许可门禁不变，不作合法/商用/交易所认证声明。

备用模块src/core/six-photo-backups.js：readSixPhotoBank/ selectBackup按类型、代码、频率、复权及排除共同上游选择。普通文件8MiB，校验30唯一身份/时点/代码/OHLC/公告链接；单源数据坏仅单源失效，结构/身份损坏整库拒绝。历史为unadjusted-requested、单位未独立认证，不直接混入原前复权K线或主账户。净值、公告不当股票成交价；缺量额不填0。

实时末级备用：原em.fetchBatchSnapshot仍先东财、再腾讯，失败/空数据才检查V6_SIX_PHOTO_FILE中同股原时点15秒内的quote。未知/过期/未来时间不作当前价；不以日线代实时。新备用行canTrade=false，不进入执行用lastPx。原全主链的其他时点/资金缺失问题仍待后续治理。

固定运行文件及报价刷新：
/path/to/research-python scripts/six-photo-sources.py --code 600519 --fund-code 161725 --start 2026-11-02 --end 2026-11-06 --refresh-quote-from /safe/new-six-photo.json --active-output /safe/six-photo-active.json
V6_SIX_PHOTO_FILE=/safe/six-photo-active.json npm start

第一条追加--interval-seconds 15才持续刷新，仅采easyquotation报价，失败清除旧成功报价；历史部分原日期保留。默认0仅一次。运行文件原子更新，原档案不改，两个路径不能相同，每个运行文件仅一个写进程。实际周期还含网络耗时，技术间隔不代表供应商授权额度。本批未启动用户云端长期服务。

双端原风险卡折叠区显示精确30行及有效数据数，沿用失权/断线清除和转义。原策略/资金/排序/UI主布局、bh样本剪枝等全部保留，缓存统一bi；无文件删除。canTrade=false、verifiedLive=false、paidServicesUsed=false。

问题记录：旧隔离Python路径失效，重新建隔离环境；初轮基金倒序截到旧年份，修正稳定日期排序并重采，最终净值末日2026-11-06；巨潮大写.PDF按固定路径大小写兼容；补齐显式代码、时间、频率、查询区间和主源空数组备用保护。原始两轮SDK记录、独立报价刷新、过程回归与最终日志均在integration。

完整操作integration/SIX_PHOTO_OPERATIONS_20261106bi.md；逐行结果见外部V6_SIX_PHOTO_RESULTS_20261106bi.md。测试正式结果见integration/TEST_REPORT.md与本文末尾。测试数量不能当完成率或关闭生产验收。

原主线待办：盘中持续实时/限频/目标机稳定性与主链所有消费者时点门禁；账号/客户端型真实条件及原生联调；单位/复权/历史完整性与数据用途核实；真实新闻/概率独立样本外/持仓闭环，因子生命周期/逐票证据卡/财务筛查/ETF映射与六类现场验收。未购买/部署、不接真实券商/CMR/多模型网关。

先读AGENTS.md、integration/TEST_REPORT.md与本批操作文档。Node22.6+、Python3、Linux flock；指定目标机ML解释器：
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/six-photo-release-clean.tap

换账号下载完整ZIP、交接TXT和逐行结果报告重新上传；私有链接不自动授予权限，额度无法实时读取。

正式发布：最终干净ZIP全量1060通过，0失败/跳过/取消、退出0，91463.042999ms；发布代码定向16通过。收尾刷新前主工程全量1059通过，最终以1060包为准。1086个源文件逐字节一致。完整工程V6_1060_full_20261106bi.zip。

## 历史交接

# V6 20261106bh 参考资料选择合并交接

唯一基线V6_1038_full_20261106bg.zip，SHA-256 2c51f6bf452a8499f6782c567cf7d47c8bdeb1c0c70599ef14be0a0fa22904ee。用户提供行情与涨停复盘代码逻辑日志_20261106.zip，已先读README并对照实际代码；不整包覆盖旧工程。

本批有用合入：server.js的pruneSignals修复，按同日类型稀有度、已回验、登记先后保留样本，防止一进二/连板接力晚登记样本被大量竞价样本挤掉；明确未剪枝摘要，按类型记录剪枝量。原日期配额/容量、交易规则不改。

参考包原em.js与bg逐字节相同，竞价复盘computeNdOutcome也相同，大部分守门已在工程内，不重复复制。两处参考测试依赖未附带的_test_fe_source.js，独立运行发现缺模块后撤回兼容导入，失败日志保留，不声称独立86断言已过。运行日志显示端口占用退出，不把它当成功启动证据；推送/竞价日志不导入生产账户或学习库。

用户要求实时行情优先，收费原生接口不接、不购买。本批调用原em.fetchBatchSnapshotTx(['600519'])成功取得1453元报价，原始时间上海2026-11-06 16:14:58；当时已盘后，所以只是旧快照，不是盘中实时认证。实测记录integration/reference-mainchain-live.json。

现有腾讯批量路径新增quoteSource、quoteAt、receivedAt、quoteFreshness；15秒内仅recent-unverified，旧/未来/缺失时点分别stale/future/unknown。不拿接收时点填原时点，原价量字段与调用接口兼容。源码在em.js，不另外造一套实时来源。

明确未完成：元数据尚未统一约束主服务所有消费者，ingestPx仍有按接收时间记账路径，腾讯/新浪缺资金流仍存在填0，其他来源原始时间不完整。后续优先补消费时点门禁、缺失资金语义和交易时段连续验证。不能声称全链已消除陈旧价或已稳定实时。拿不到当日数据保持空/过期状态及网页入口，不为实时先购买收费服务。

原四策略/账户/双端布局/数据源默认门禁、bg及此前全部功能保留，缓存统一bh。无文件删除。新增6项回归，完整主工程/干净包结果见本文件末尾及integration/TEST_REPORT.md；源文件指纹、参考包对比清单、操作说明与日志在integration。

原主线数据源许可/账号/目标机稳定性、旧server网络访问范围、新闻/概率独立样本外/持仓闭环与六类现场验收，因子生命周期/逐票证据卡/财务筛查/ETF映射仍待。未部署、未购买、不接券商/CMR/多模型网关。不报猜测完成率。

先读AGENTS.md、integration/TEST_REPORT.md、integration/REFERENCE_MERGE_OPERATIONS_20261106bh.md。需要Node22.6+、Python3、Linux flock；目标机指定实际ML解释器：
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/reference-merge-full.tap

换账号下载完整ZIP及交接TXT重新上传，私有链接不自动授予权限。额度无法实时读取。

最终主工程及干净ZIP解压：各1044通过，0失败/跳过/取消，退出0；1083个源文件逐字节相同。完整工程V6_1044_full_20261106bh.zip。

## 历史交接

# V6 20261106bg 免费行情小项目交接

唯一新增基线V6_1027_full_20261106bf.zip，SHA-256 dc91f4ea8bf3b71320210394e19f4a4d46ad12b14f41b04b281df4470de04a56。完整保留旧功能，不用旧包覆盖。

最新用户要求：不接其获知年费3.5万元的收费原生接口，不先买服务；优先免费实时，拿不到就网页看，旧数据标原日期、当日缺失留空。本批没有新增/启用iFinD或Choice原生API，没有采购/注册试用/加载付费凭据。

已完成一个小项目：腾讯/东方财富（可选新浪）一次性无账号公开报价检查，单/双源独立返回，不强制第三路；网络/格式失败至多重试一次，HTTP403/429等不重试，不绕过。每源8秒/256KiB，新文件完整暂存/fsync/不覆盖发布。新增固定文件后端只读投影与双端折叠区，显示来源、价格、检查时间及供应商原报价日期，失权/断线清空，网页入口沿用原个股详情。canTrade=false、verifiedLive=false、paidServicesUsed=false、probeOnly=true。不是自动持续采集、实时认证或交易收益。

入口：scripts/public-quote-probe.js；核心src/core/public-quote-probe.js。默认两家：
node scripts/public-quote-probe.js 600519 /safe/new-free-probe.json
V6_PUBLIC_QUOTE_PROBE_FILE=/safe/new-free-probe.json npm start

可选第三参数tencent,eastmoney,sina；只接受沪深A股与固定公开地址。每次输出到新报告，旧报告保留；没有interval/watch/付费回退。CLI退出0只表示报告写出，来源可以全部失败。旧parallel-market.js生产许可门禁和清单默认状态未改。详见integration/FREE_QUOTE_PROBE_OPERATIONS_20261106bg.md。

实际连通结果必须分开说：最初Node三家请求全失败；新CLI腾讯取得1453元、上海2026-11-06 16:14:58的旧快照，东财该轮Node失败。独立Python urllib腾讯/东财均HTTP200并返回报文，不把它当Node持续稳定通过。原始JSON和日志在integration。BaoStock隔离安装0.9.4后原采集器仍unavailable。没有盘中实时验收，后续需目标机交易时段小样本连续验证。当前只是带日期快照，不认证供应商或商用转发权限。

四套策略规则、资金账户、排序、bf因子健康/be远期观察及原UI主布局保留，仅缓存bg并增加折叠区实际展示。未将观察涨跌幅或报价写进主账户。Tushare/米筐/JQData/MiniQMT/CTP/TqSdk/AllTick/iTick等本轮没有凭据/客户端或新适配，不标已接通；此前排除的爬虫类SDK不新增启用。

本轮主工程与ZIP干净解压均1038通过，0失败/跳过/取消，退出0；1082个源文件逐字节一致。新增11项已在总数内，定向23含原相关回归。完整日志、操作/问题记录/指纹清单在integration，TEST_REPORT.md注明真实失败网络与验收边界，不用测试数换完成率。

下一步：先在目标机交易时段验证腾讯/东财的报价原时间、可用率与限频，再决定持续采集；拉不到则保持空值/网页入口。数据源许可/账号/稳定性与旧server所有网络访问范围、真实新闻、概率独立样本外、持仓闭环和六类现场验收仍待。因子生命周期、逐票完整证据卡、财务筛查、ETF映射等仍待。未购买、未云端部署、不接真实券商/CMR/多模型网关。

先读AGENTS.md、integration/TEST_REPORT.md与本批操作说明。Node22.6+、Python3、Linux flock；目标机指定ML解释器：
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/free-probe-full.tap

完整工程V6_1038_full_20261106bg.zip。最终指纹见外部交接TXT，避免ZIP自引用。换账号下载完整ZIP及本交接TXT重新上传，私有链接不自动授权其他账号。额度无法实时读取。

## 历史交接

# V6 20261106bf 因子健康诊断小项目交接

唯一新增基线：V6_1015_full_20261106be.zip；SHA-256 1b95978fc107ef91d1761b7db6127cd4414a837e39a423a738f416ce1ae78826。完整保留旧工程，不用旧包覆盖。

本批完成：独立因子健康诊断CLI。freezeHealthBaseline冻结现有V6扩展因子ID/字段/版本/来源/基线/检查门槛；evaluateFactorHealth逐票区分缺失、坏值、缺证据、模拟、来源不符、无效/未来/过期时间，分别计算有效分母。样本不足/覆盖不足不判断漂移，缺失不填零。满足样本门槛后比较横截面均值，超过显式门槛标watch。

核心src/core/factor-health.js，入口scripts/factor-health.js：
node scripts/factor-health.js freeze /safe/health-input.json /safe/new-health-baseline.json
node scripts/factor-health.js evaluate /safe/new-health-baseline.json /safe/current-factors.json /safe/new-health-report.json

完整字段、毫秒时间、输入大小和门槛见integration/FACTOR_HEALTH_OPERATIONS_20261106bf.md。后续沿用冻结基线与新快照，报告输出到新文件；完整暂存/fsync/不覆盖发布。当前快照必须晚于冻结时点，不超过实际时钟。指纹不是外部签名，不能证明盲样本或防操作者重建基线。

明确范围：分数分布/输入质量诊断，不是收益衰减、IC、因果、晋级或停用认证。股票池变化也会导致漂移。canTrade=false、verifiedLive=false、prospectiveCertified=false、weightsChanged=false。没有接后台采集、HTTP或页面，没有生命周期注册器和自动调权。原四策略/资金账户/数据源许可门禁/双端布局未改，仅同步bf缓存。be远期观察原样保留，其priceReturnPct仍是未复权收盘毛涨跌幅，不是净交易收益。

下一组：因子生命周期的显式研究状态与修订审计，或远期观察自动信号采集/只读页面；沿用V6权限/信号ID/时点，不能把观察收益混进主账户。逐票完整证据卡、财务筛查、ETF映射仍待。HARNESS旧固定提交/许可/源码核查材料完整保留，本批独立实现无新增外部代码移植。

原主线仍待：14源登记不等于全部接通，许可/账号/原生适配/目标机稳定性及旧server所有网络路径访问范围审核未完成；真实新闻、概率独立样本外、实际仓位闭环和六类现场验收仍待。未购买、未部署云端，不接自动改代码、多模型网关或真实券商，不报猜测完成率，测试数不关闭生产验收。

先读AGENTS.md、integration/TEST_REPORT.md和本批操作说明。需要Node22.6+、Python3、Linux flock；ML解释器由目标机明确指定：
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/factor-health-full.tap

主工程及ZIP干净解压：各1027通过、0失败/跳过/取消、退出0；1079个源文件逐字节一致。12项新增已在总数内；首次缓存版本失败与修复日志保留。完整测试/修改与问题记录在integration。换账号应下载完整ZIP及外部交接TXT重新上传，私有链接不自动授权其他账号。额度无法实时读取。

完整工程：V6_1027_full_20261106bf.zip。最终ZIP指纹见外部交接TXT，避免ZIP自引用。

## 历史交接

# V6 20261106be 小项目完成交接

唯一新增基线：V6_1006_full_20261106bd.zip；SHA-256 8c828825f6ebe016f42fa4ea5fded8a660a543c528f88315dcdf1b2b4fcbe68d。完整工程保留全部旧功能，不用旧包覆盖。

## 本批完成的小项目

信号远期价格观察：freezeCohort冻结独立信号ID/日期/体系/分组/来源/收盘基准；evaluateForward按显式交易日历跟踪1/5/20/60交易日，不到期待观察，日历不足/缺价/停牌/公司行为各自标识。相同股票允许不同信号重复观察，成熟结果单独分组汇总，不把待观察当零。冻结基准/来源/指纹被改动拒绝。CLI完整暂存、同步、不覆盖发布。

核心src/core/forward-signal-observer.js，入口scripts/forward-signals.js。先freeze /safe/signals.json /safe/new-cohort.json，再evaluate /safe/new-cohort.json /safe/market.json /safe/new-report.json。完整输入字段与限制见FORWARD_SIGNALS_OPERATIONS_20261106be.md。后续观察用同一冻结信号和新行情，输出到新报告。

明确范围：这是独立研究CLI小项目，没有接后台自动取信号/HTTP/页面。priceReturnPct是收盘到后续收盘的未复权毛涨跌幅，不是T+1成交、净收益、胜率或涨停概率。canTrade=false、executionSimulated=false、prospectiveCertified=false；无法证明操作者没有事先看过历史，也不认证日历/供应商/公司行为完整性。原四套交易规则、资金账户、原数据源许可门禁与UI布局未改，仅同步be缓存版本。

## 参考与下一步

参考HARNESS远期观察设计，固定提交9f72ab7e64799aecfc79cf3b913359acea1dd9b9；独立实现，没有移植其业务代码、行情数据库或AI运行时。附third_party/reference_harness/LICENSE及NOTICE.md，源码核查报告随包保留。六组补强中本批只完成这个小项目，不声称全部合并。

下一组可以做因子生命周期/健康或远期观察自动信号采集与页面；必须沿用V6信号ID、权限和时点，不能把观察收益喂成主账户成交收益。逐票证据卡、财务筛查、ETF映射等仍待；不接HARNESS自动改代码、多模型网关或真实券商。

## 原主线仍待

14数据源登记不等于全部接通：BaoStock本环境登录失败，Ashare依赖审核、其余源许可/账号/原生适配/稳定性仍待；旧server全部网络路径仍需访问范围审核，不能宣称全工程已获法律认证。真实新闻、概率样本外、实际仓位闭环及六类现场验收仍待。未购买、未部署云端、不报猜测完成率。测试数不关闭生产验收。

先读AGENTS.md、TEST_REPORT.md和操作说明后继续。需要Node22.6+、Python3、Linux flock；ML解释器按目标机器指定。V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test。核验TAP：node scripts/verify-tap-completeness.js integration/forward-final-full.tap。

换账号时下载本完整ZIP及外部交接TXT重新上传；私有链接不自动授予另一账号权限。额度无法实时读取。

## 历史交接

# V6 20261106bd 当前交接

唯一新增基线bc1002完整工程，SHA-256 1be321381b8726ffbd150afae1331a076dcc393fd8be30416d03fac992819fe0。保留原代码、四套策略与主账户规则。

本批登记14来源，清单config/data-source-catalog.json，双端风险卡可展开全目录及真实状态。Python研究采集扩展到Ashare/BaoStock共五源，schema2兼容旧schema1；BaoStock原生d未复权查询、Ashare已审核模块导入适配，未盲装同名PyPI模块。默认仅BaoStock按发布方免费量化研究说明启用私人研究请求，安装0.9.4成功但实际SDK登录失败，数据unavailable。其余4源permission-pending未请求。之前bc实测成功仍是历史证据，不代表本版许可放行。

用户要求“全部免费都接”同时保留此前“合法合规”约束：免费返回200不等于许可。新增CLI在公开报价请求前、Python worker及supervisor在SDK前检查访问清单。不是自动法律审查，也不是全server历史路径合规认证；原server.js全部历史网络路径仍需后续审核，主服务未部署。不得把清单登记说成14源全部已完成原生接入或接通。

ifind/choice已有标准化授权网关，无原生权限；iTick/JQData/Tushare原生适配not-implemented且缺凭证/免费档范围；OpenBB是框架。Ashare还缺原项目依赖审核，mootdx/efinance/巨潮与公开行情许可范围仍待。操作及条款依据见DATA_CATALOG_OPERATIONS_20261106bd.md。

下一步：源使用范围证据、BaoStock目标机登录复测、五源真正稳定数据、其余原生API、全市场/资金/新闻/概率/个人仓位闭环和六类现场验收。无购买、无部署、无CMR/多模型网关/真实券商，零失败测试不关闭现场项，不报猜测完成率。额度无法读；跨账号下载完整ZIP和交接后上传。

## 历史交接

# V6 20261106bc 当前交接

唯一新增基线V6_996_full_20261106bb.zip，SHA-256 f88bac44a49fefeb392f06eeb7f6710115622165461762a6493a77f2ce4e6262。原策略、资金逻辑、UI布局与ba/bb链路保留。

新增可选隔离Python采集器：mootdx、efinance、巨潮三源独立子进程并发，25秒超时、失败隔离、新文件不可覆盖发布；固定服务端环境变量V6_OPTIONAL_RESEARCH_FILE消费。手机电脑共享研究状态、历史K线条数、供应商原始资金净额及中性公告，不能当实时/下单信号。操作见OPTIONAL_SOURCES_OPERATIONS_20261106bc.md，依赖requirements-research-sources.txt。

真实实跑：mootdx0.11.7安装成功但通达信节点网络不可达；efinance0.5.9返回5条近期日K及历史资金流；巨潮HTTP200返回1条公告，修订代码后再次采集仍为两源成功、一源失败。每批保留独立证据。日K完成度/公司行为/单位未正式导入校验，资金流原单位待核验。mootdx旧文档域名已跳转出售页，不依赖它。

用户新增东财/同花顺地址实测：东财日K/分时/资金流日线/龙虎榜/财报、同花顺日K/实时头返回数据；全A/批量/北向超时，同花顺池403，东财涨跌停池rc102/null。详见public-endpoint-audit-20261106.json。这是一次无账号探测，不代表新增接口全部已在工程联调或获得免费商用授权。多项原server已有逻辑，不重复造轮子。竞价分时不等于完整竞价盘口，内外盘估算不等于真实主力净流，涨停原因标签不是因果认证。

尚待：mootdx目标机网络、全市场连续采集、资金单位与历史完成门禁后的正式接入、公告更正/跨批去重/原文分析、实时新闻/概率样本外/个人仓位动作及六类外部验收。未部署、不购买、不接CMR/多模型网关/真实券商。Ashare/BaoStock本批未接，iTick等凭证不放聊天。测试数不作完成率，额度无法实时读取；跨账号下载完整ZIP+本交接重新上传。

## 历史交接

# V6 20261106bb 当前交接

唯一新基线：V6_991_full_20261106ba.zip；SHA-256 58f41caa75014f7b9a43149c6bfa1a61f786be0c3ea9031cc62fc49aeffc5cdc。保留原工程全部功能与四套策略，原授权网关和网页入口不删除。

新增腾讯/东方财富/新浪公开报价适配、无账号三路并发请求，原时间/股数单位转换、严格校验与过期状态；复用原并行核对和固定服务端输出路径，不平均或投票成买点。使用config/public-market.example.json，node scripts/parallel-market.js /safe/config.json；V6_PARALLEL_MARKET_FILE指向输出。每实例一个沪深A股，默认15秒例子轮询，不是全市场扫描器。没有新接三家K线、资金流或新闻。

真实探测要分开看：Python腾讯200/东财200/新浪403；Node实际CLI腾讯有返回但过期、东财与新浪不可用。完整结果在integration/public-live-probe.log与public-live-result.json。不能把Python200冒充Node全部通过，更不能把收盘快照当实时。没有绕过403、登录、反爬或购买服务。公开端点无稳定/商业转发授权保证。

下一步真实条件：目标云电脑复测公开端点连通/时间/连续性，新浪当前不可用；后续扩证券池与原生新闻/更正历史/概率校准/持仓动作等。六类现场验收仍待，未部署、不接CMR/多模型网关/真实券商。完整边界见PUBLIC_MARKET_OPERATIONS_20261106bb.md。无猜测完成率，测试数不关闭现场验收。额度无法读取，换账号下载完整ZIP和本交接后上传。

## 历史交接

# V6 20261106ba 当前交接

唯一新基线：V6_983_full_20261106az.zip；SHA-256 93aa00bd1c15cd50912be4cc2aff39e407895165d24395a4fc5fbc78c28ca85a。保留az四家网页入口与ay/ax/aw/av功能，不从旧包覆盖。

本批新增三路同时采集、独立超时、标准化报价校验、时点/价格冲突分析、独立报价保存与双端风险卡状态显示；CLI轮询+固定服务端输出路径消费。详见PARALLEL_MARKET_OPERATIONS_20261106ba.md，样例config/parallel-market.example.json。

重要边界：这是ifind/choice/sina的授权标准化网关协议与并行消费实现，不是已连接三家原生API。三家授权凭证、原生SDK/HTTP响应转换及真实网络/延迟/权限验收仍缺。当前仅测试接口夹具，不能声称已拉取三家真实实时行情。未购买资源、未开账号、未部署、未连券商。分析仅三源时效/数值与每源涨跌幅，不运行新涨停概率模型、不替代四套原始策略或资金风控。来源一致不证明独立或认证。

后台运行命令：node scripts/parallel-market.js /safe/config.json；主服务固定V6_PARALLEL_MARKET_FILE指向输出JSON。密钥只用服务端环境变量，不放ZIP。未配置或过期时显示不可用，不读旧缓存充实时。

剩余：三家原生授权输入适配与接通、实时新闻时点/更正存储、跨市场/汇率、概率独立样本外及推送证据链、个人仓位动作，以及六类外部现场验收仍待。零失败测试不关闭这些事项，不报猜测完成率。换账号下载完整ZIP与本交接再上传；私有链接不等于授权，额度无法实时读取。

## 历史交接

# V6 20261106ay 当前交接

唯一新增基线：V6_973_full_20261106ax.zip，SHA-256 18fcecc8afe514b802b09fc5f7fdf867074d6cab71beabee13542e4a89f149c3。不使用旧包覆盖。先读AGENTS.md、RISK_UI_OPERATIONS_20261106ay.md、TEST_REPORT.md与完整需求RISK_UI_REQUIREMENTS_20261106.md。

完成：共享后端只读风险证据投影，双端首屏可折叠风险卡，实际板块净额/现有新闻与个股关联、未知概率标识；断线/失权清除依据。修复原K线弹窗切股旧请求覆盖及关闭后迟到响应。未更改原四策略、账户写入、as存储协议；原av/aw/ax功能保留。界面保留深色原布局，增加紧凑卡片。

真实未完成：实时新闻供应商/更正时点存储/事实核验、同花顺官方授权接口或跳转验证、分时分钟K、汇率/美股会话联合校验、可参与与个人仓位动作、板块可靠建议、资金流涨停概率训练/独立样本外校准、推送完整证据链。本轮卡片仅观望，不伪造完成这些要求。下一组优先扩展新闻时点/来源模型与授权输入适配，不能把未经认证的旧新闻分类视为实时认证输入。

六类现场验收仍待；未部署云端、未购买服务、不接CMR/多模型网关/真实券商。无猜测完成率。跨账号转交下载完整ZIP+本交接，私有链接不等于授权。额度无法实时读取。

## 历史交接

# V6 20261106ax 当前交接

唯一新增基线：V6_969_full_20261106aw.zip，SHA-256 c8bfc628bea1d4f0d837e457bbd96ed25ef12a80fd28df630852271dba3c1360。保留aw完整历史归档恢复与av参数研究，不从旧包覆盖。

本批新增研究CLI可选 --expected-revision：注册器同一锁内核对修订并返回证据复算后的参数快照；过期修订拒绝且不写报告。旧命令兼容。具体命令与语义见REVISION_CONSUMPTION_OPERATIONS.md。没有接HTTP/页面/自动后台消费，不能声称这些已完成。开始研究后再发生的晋级/回滚不会取消已有任务，未来后台发布需要再次核对。

原四套策略、主权威账户和双端布局保留，仅同步ax缓存版本。授权供应商自动输入、真实数据归因/样本外/幸存者偏差仍待；六类外部验收仍待，未云端部署、不购买、不接CMR或真实券商。测试数不等于总任务完成率。原as监视协议不变；旧离线复算使用原版本，不能改指纹。


## 历史交接

# V6 最新交接 20261106aw

唯一新增基线：V6_935_full_20261106av.zip，SHA-256 c5af18322ebe78f8a01dd3dacc3864260b9997b5f6b9847c1b4e76fcfc9b5451。禁止用旧705/733/746/882覆盖。先读 AGENTS.md 和本目录操作文档。

本轮完成完整监视历史离线归档、只读核验、原子恢复；原as索引与全部报告逐字节保留，支持1000条和128MiB边界；真实进程中断、锁冲突、目标抢占、篡改、幂等及CLI已覆盖。没有自动轮转/重置历史；只有显式CLI，没有新增HTTP任意路径入口。旧av研究参数注册、au原生证据适配及原四套规则均保留。详见 MONITOR_HISTORY_ARCHIVE_OPERATIONS.md。

下一步：授权供应商自动输入适配（必须由用户提供授权/凭证）；真实数据归因、独立样本外与幸存者偏差核验。注册器页面/后台自动消费仍属后续扩展，需固定服务端目录、权限与修订验证，当前显式研究CLI消费。六类外部验收：真实行情持续输入、真实策略效果、短信、实体手机、长期云端、第二台机器灾备均待。未部署、未购买资源、不接CMR/多模型网关/真实券商。不报猜测完成率。不能以本地测试数关闭现场验收。

测试复现：Node22.6+、Python3、Linux flock；归档另需renameat2。设置目标机器ML解释器后运行：

```bash
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/archive-full-tests.tap
```

额度无法由助手实时读取，用户提示低额度时先保存完整包。本文件与完整ZIP一起下载，再上传另一账号；私有页面链接本身不代表跨账号授权。

## 历史交接（保留，不作为当前版本）

# V6 下一位接手入口：20261106av

当前唯一完整主线为935项、20261106av，基于911项20261106au完整工程。上包SHA-256：4c6122e0ff1518c2a37e88587050484fefccc21a5206db3640b6876eda096a36。应用缓存av；既有监视报告保存协议仍as。不要从882或旧705/733继续覆盖。原始来源仍为用户上传746项20261106am。

本轮完成：冻结学习参数实验、训练/验证候选选择、冻结样本外/成本压力/成熟样本门禁、研究晋级与baseline回滚；研究CLI可--registry显式应用于同来源的后续日期。后台/页面和主账户不自动消费注册器，未接券商。

先读：
1. HANDOFF_NEXT.md和TEST_REPORT.md：剩余顺序、真实验证结果。
2. LEARNING_PROFILE_OPERATIONS.md：本轮协议/命令、门禁与局限。
3. NATIVE_ADAPTIVE_OPERATIONS.md：au原四体系自动证据及离线导出/复算，保留。
4. ADAPTIVE_MARKET_OPERATIONS.md、ADAPTIVE_MONITOR_OPERATIONS.md、ADAPTIVE_REPORT_VIEW_OPERATIONS.md：四指数、回避、学习、自动报告与已完成只读页面。
5. POLICY_SETTLEMENT_OPERATIONS.md、AUDIT_ROTATION_OPERATIONS.md、RISK_EVIDENCE_OPERATIONS.md：权威资金、权益、审计与证据。
6. ACCEPTANCE_LEDGER_20261106as.md：24项现场验收映射。

主工程和干净ZIP副本均935通过、0失败/跳过/取消、退出0；TAP完整性核验通过。原四套评估文件和UI布局保留，新增可调研究学习参数，不静默更改生产配置。历史交接另存CHAT_HANDOFF_HISTORY_20261106au.md，history只追溯，不运行旧资金写入器。

还剩授权供应商输入适配、完整监视历史离线归档/恢复、真实数据效果/幸存者偏差核验三组主代码方向。注册器接页面或后台自动消费是后续扩展，需要固定服务端路径/权限/修订校验，不能接受请求中的任意服务器路径。

真实行情/效果、短信、实体手机、长期云端及跨机灾备六类外部验收仍待；云电脑未提供，未部署、不购买资源、不接CMR/多模型网关/真实券商。用户允许研究原四规则自学习调整，仍需保留旧版本和样本外证据。不把测试数换算项目百分比。每组定向、全量和干净解压核验后交完整包。
