# 六张照片来源：实测与备用接入 bi

唯一基线V6_1044_full_20261106bh.zip，SHA-256 0f020162af30b9e5ea8a4bd3d937eaf5a6c36ef9e970d064c59601af947a839e。沿用完整工程，不整包覆盖旧版本。

## 精确范围

只按用户提供的六张图：03日线、04分钟、05财务专题、06实时/L2、07期货跨市场，每图6条共30条接口记录；08是免费额度/历史窗口/API权益/环境/口径/用途六项核对要求，不增加第31个数据源。config/six-photo-sources.json逐行对应照片，不混入原清单里的mootdx/Ashare/OpenBB等。财务三表、可转债和MiniQMT通配接口保留图中行级分组，不能将30行说成只存在30个底层方法。

用户本次明确要求这六图里能跑通的全部做备用。因此仅在新显式研究采集器允许图中的AKShare、efinance、easyquotation等小样本调用；原默认来源许可清单和旧采集器门禁不改、不宣称全工程合法认证。未购买、注册账号、调用付费接口、借用账号或连接券商；不能自动把图中的免费额度当本账号权限。

## 运行

先在隔离Python安装requirements-six-photo-sources.txt，不安装到主服务环境；Node读取结果不需要SDK。

```bash
/path/to/research-python scripts/six-photo-sources.py --code 600519 --fund-code 161725 --start 2026-11-02 --end 2026-11-06 --output /safe/new-six-photo.json
V6_SIX_PHOTO_FILE=/safe/new-six-photo.json npm start
```

输入是沪深A股代码与独立基金代码，日期范围最多31天且不超过上海当日。每条公开接口由独立子进程串行执行；最后执行带原始时点的easyquotation报价，避免慢历史接口耗尽报价新鲜期，输出仍按照片顺序排列。，25秒上限、stdout 2MiB上限，返回至多200条；BaoStock不并发登录。报告必须新文件、完整暂存/fsync后硬链接不覆盖发布；符号链接拒绝，需可信本地文件系统。SDK内部可能分页，不把25秒称为精确供应商请求限额；调用者应遵守上游规则，不盲目高频轮询。当前没有watch/自动定时生产服务。

凭据/客户端型行只做前置检查，不导入SDK、不发请求、不触发收费；记录credentials-required/client-required。对应17行凭据型与3行客户端型原生适配器本批未实现/未联调，并非填上令牌即可全部自动运行。缺这些条件不能称接口坏了，也不能称已接通。

## 本次真实结果

最终原始记录six-photo-final-live-20261106bi.json及逐行日志保留：7返回、2unavailable、1timeout、17credentials-required、3client-required。7路全部通过只读备用数据投影，详见外部逐行结果报告。第一次原始记录也保留，网络结果可能不同，不覆盖历史。

- AKShare stock_zh_a_hist：600519，未复权日线5条，2026-11-02至06。
- efinance stock.get_quote_history：同证券同范围，未复权日线5条。二者同东财上游，不算两个独立供应商证明。
- AKShare stock_zh_a_hist_min_em：5分钟、未复权200条样本；stock_zh_a_minute：新浪5分钟200条样本。不是所有分钟频率/历史窗口都已验收。
- efinance fund.get_quote_history：基金161725净值200条；净值和股票/ETF成交价分开，末日2026-11-06。
- 巨潮公开公告查询：600519公告1条；仅公开查询实跑，深证信账号型结构化API目录未实测，不能合并称全部官方结构化接口已开通。
- easyquotation use('sina').real：600519报价1条，原时间2026-11-06 15:34:59（上海），当前为stale盘后快照；不是完整逐笔、L2或连续实时认证。
- BaoStock日线/分钟均未取到数据；efinance实时失败或超时，最终各状态以原始记录为准。

采集日期/字段/频率按这次小样本，不把一个函数5分钟成功外推为所有资产、频率、历史范围和账号权限都通过。未实测盘中更新速度、全市场连续覆盖、停牌/退市/权益完整性或生产授权。

## 真正接到哪里

src/core/six-photo-backups.js读取固定服务端V6_SIX_PHOTO_FILE，报告普通文件限8MiB。核对完整30行唯一身份、来源/接口/上游、股票/基金分离、时点、未来、价格与OHLC关系等；单路坏数据仅该路data-invalid，来源身份/报告结构损坏则整份拒绝。公开文本/价量按白名单投影，不展示SDK原始字段/密钥或保存的推荐结论。

readSixPhotoBank提供统一备用库；selectBackup按kind、证券代码、frequency频率、复权要求及排除同上游条件选择（本次仅1d/5min，不满足1min请求），返回原来源和实际数据，不混拼日线/分钟/净值/公告/实时。history为unadjusted-requested，单位provider-native-unverified，不能直接塞进原qfq前复权K线或资金账本。量额单位尚未逐供应商认证；这部分仍是可追溯研究备用输入。

原em.fetchBatchSnapshot主链仍先东财、再腾讯；二者失败/无数据时，从已生成的六图文件取同股票、原时点15秒内的quote备份。文件一天后过期；报价每次读取按原时间重新判旧，unknown/stale/future不能作为当前价。全库generatedAt新不代表报价新。只提供报价备用，不用日线顶实时，不发新网络请求。

新增备用行canTrade=false；ingestPx显式跳过这些只读行，避免进入模拟成交用lastPx，原账户/成交逻辑保留。当前实际已盘后，所以easyquotation旧快照只保存展示，不能触发这条实时备用分支。原主链其他消费者的时点/资金缺失问题仍待治理，不能宣称全工程已解决陈旧价。

双端原风险卡折叠区显示六图30条状态与有效条数，失权/断线随原机制清空；原界面主布局不改。所有输出canTrade=false、verifiedLive=false、paidServicesUsed=false，研究数据不是主账户成交或概率认证。

## 本轮修正及验证

首次实测发现基金返回倒序，直接tail会截到旧历史；改成按日期排序再取最近200条，保留初轮证据，最终重采核对末日。公告实际返回大写.PDF，读端按同一固定域/路径规则大小写兼容，不放宽域名。easyquotation的量额字段与股票源不同，本次报价量字段保持null，不伪造统一单位。新增显式代码错配和新浪分钟查询区间保护。

16项新回归覆盖精确六图清单、分类选择与复权/同上游限制、未知/过期报价、OHLC/证券/未来、公告PDF、文件隐私/损坏、主链失败才读备用、只读不进账户价表、凭据型不启动子进程、Python参数与不覆盖发布。合成测试不能替代真实供应商与实体手机验收。最终全量、干净包及源码一致性见TEST_REPORT.md。

优先下一步：目标机交易时段连续取样easyquotation/原腾讯东财，校验供应商原时点、可用率和限频；再决定按允许频率持续刷新备用文件。账号/客户端型应由用户提供实际可用条件后逐项实现和验证，不先购买收费服务。其余新闻/概率样本外/持仓闭环、因子生命周期、逐票证据/财务筛查/ETF映射与六类现场验收仍待。

## 读取某类备用的开发接口

下面只读取已有固定文件，不发网络请求；与主账户数据分离：

```js
const {readSixPhotoBank, selectBackup} = require('./src/core/six-photo-backups');
const bank = readSixPhotoBank(process.env.V6_SIX_PHOTO_FILE);
const daily = selectBackup(bank, {kind:'daily', code:'600519', frequency:'1d', adjustment:'unadjusted-requested'});
const minute5 = selectBackup(bank, {kind:'minute', code:'600519', frequency:'5min', adjustment:'unadjusted-requested'});
const nav = selectBackup(bank, {kind:'fund-nav', code:'161725'});
const notices = selectBackup(bank, {kind:'announcements', code:'600519'});
const freshQuote = selectBackup(bank, {kind:'quote', code:'600519'}); // 盘后旧快照返回null
```

这些历史、分钟、净值及公告是研究备用模块提供的数据，没有直接替换原前复权K线、候选评分、新闻情绪模型或交易账户。图08六项中，额度/权益/用途与单位认证仍须按目标机及实际服务范围核实；不能把“执行了函数”当作这些外部条件全通过。

## 单独刷新报价与运行文件

历史样本档案保持不覆盖；运行文件允许原子更新，使已经启动的主服务能读到新报价。先运行一次完整采样，再用同样的代码/日期参数刷新：

```bash
/path/to/research-python scripts/six-photo-sources.py --code 600519 --fund-code 161725 --start 2026-11-02 --end 2026-11-06 --refresh-quote-from /safe/new-six-photo.json --active-output /safe/six-photo-active.json
V6_SIX_PHOTO_FILE=/safe/six-photo-active.json npm start
```

在第一条命令后追加 `--interval-seconds 15` 才持续刷新，仅轮询easyquotation新浪报价，不重复拉历史/基金/公告。间隔0为一次，持续间隔技术范围15至3600秒，实际周期还包括请求耗时，不能把技术下限当供应商额度许可。SIGINT/SIGTERM停止后续循环，进行中的子进程最多等待既有25秒上限。

原输入档案与运行输出必须不同路径，每个运行文件仅启动一个写进程。运行文件用完整临时文件/fsync/原子替换，输入档案不改；失败源不保留上一次成功报价。历史部分仍按原日期保存，不因刷新报价就自动更新历史。每天需要的新历史仍应显式重采到新档案。

本批只真实执行了一次报价刷新，结果见six-photo-active-probe-20261106bi.json/.log；当时为盘后，不能据此认定持续刷新或盘中实时已经验收。没有在用户云端部署或后台常驻运行。
