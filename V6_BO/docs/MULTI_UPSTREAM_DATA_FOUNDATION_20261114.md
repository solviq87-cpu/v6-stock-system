# 天枢智策 V6 · 多上游金融数据底座（2026-11-14）

## 目标与真实状态

用户明确要求尽量广泛调查同行仓库，识别**开源程序背后的原始发布方**，在不损坏 V6 既有四体系、账户和 UI 前提下建立可信的数据底座。

本批基线：`dev@206ae60bd390836fa92d30ebde286c4b32477a46`。新增 `config/data-source-registry-2026.json`：

- 89 条明确标注数据类别、地域、原始上游、访问条件、适配位置和证据来源的候选/现有接入路线；
- 59 种上游标识（包括 `multi:*` **无法判明单一上游的聚合器标记**，不是 59 家已验真的独立生产商）；
- 20 个相互不同的研究仓库；仅借鉴归类与容错设计，没有下载执行或复制未核准源代码；
- **0 个新增已证明授权的实时报价，0 个新许可自动激活，0 个已证明交易所级独立证书，绝不将 89 条路由冒充在线的 89 家行情源**。

原 `config/data-source-catalog.json` 14 路来源注册与 `optional-research-sources.py` 权限白名单保持不变。所有新增路线默认 **registered-only / permission-review / credentials-required / client-required**，禁止自动轮询、购买、使用未经批准的付费额度。即使可调用，也不得自动进入 `lastPx` / 模拟账户 / 风控成交资格。

## 搜索覆盖与其真正的上游

| 参照工程 | 具体原始上游 | V6 处理原则 |
| --- | --- | --- |
| [AKShare](https://github.com/akfamily/akshare) | 按接口分别可能为东方财富、新浪、腾讯等 | `akshare-em-*` 只计东财；`akshare-sina-*` 只计新浪 |
| [efinance](https://github.com/Micro-sheep/efinance) | 东方财富 | 不与东财原 API 凑两票 |
| [Ashare](https://github.com/mpquant/Ashare) | 新浪/腾讯选择及回退 | 未披露**本次实际选中**上游时标成模糊来源，不参与独立性表决 |
| [easyquotation](https://github.com/shidenggui/easyquotation) | 新浪或腾讯（由后端模式决定） | 必须保留显式所选提供方 |
| [mootdx](https://github.com/mootdx/mootdx) / [pytdx](https://github.com/rainx/pytdx) | 通达信 TDX | 不误当两家市场发布方 |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 数据处理及训练框架（非数据发布者） | 借鉴统一特征处理，不当作独立行情源 |
| [stock-data-hub](https://github.com/valueflowever/stock-data-hub) | EFinance、PyTDX、AKShare、BaoStock、Yahoo等 | 保留每次选择的上游、缓存和失败身份 |
| [CNEquity](https://github.com/rootSunc/CNEquity) | 视数据集而异的官方/聚合来源 | 参考行级溯源与不可变归档，不能把数据湖当单一权威源 |
| [Qlib](https://github.com/microsoft/qlib)、[vn.py](https://github.com/vnpy/vnpy)、[OpenBB](https://github.com/OpenBB-finance/OpenBB) | 框架自身不发布行情 | 只借架构；数据权限与供应商另核 |
| [yfinance](https://pypi.org/project/yfinance/) / [yahooquery](https://github.com/dpguthrie/yahooquery) | Yahoo Finance | 同一上游、不认证实盘，特别检查个人使用限制 |
| [fredapi](https://github.com/mortada/fredapi) / pandas-datareader FRED | FRED | 需要 Key；各时间序列原版权可能另属第三方 |
| [wbgapi](https://github.com/tgherzog/wbgapi) | World Bank | 官方宏观按数据年份读取，缺失不填0、保留署名和修订未知 |
| 国家/交易所公开来源 | 上交所、深交所、北交所、巨潮、证监会、上期所等 | 分开核准用途，公共公告可参考但不等于可自由转授权的实时行情 |

源目录扩展为 A股价格/成交额与分钟线、上市公司公告财报、指数与板块、基金、可转债、商品/期货、交易日历、港美股与全球行情、GDP/通胀/利率/汇率、美国 SEC XBRL 披露。企业行情许可、交易所 L1/L2、公告网页、股权复权因子、基金净值数据不混用口径。

### 首批可执行的新链路（不是仅登记）

1. `src/core/data-source-lineage.js`：运行时统一识别原始发布方；`market-feed-consensus.js` 拒绝 `efinance`+东财或 `akshare-em-daily`+东财这种重复上游双票；未知上游沿用旧离线研究兼容但不授予身份认证。
2. `multi-source-price-consensus.js`：实时**只读研究**对比，包装源按原始厂商分组；Ashare 等不明确实际上游的调用不得投独立票；保留原有 15 秒/跨日/未来时间拦截与 `canTrade:false`。
3. `baostock-historical-normalizer.js`：从原有许可范围内的 `optional-research-sources.py` 原始 BaoStock 日线规范化为**不复权、股、人民币元**，拒绝停牌、空数、错误代码、错误复权、数量金额冲突，不创造停牌价格；采集时间绝不能替代市场发生时点。
4. `eastmoney-historical-feed.js`：在保留旧默认前复权模式的同时新增显式 `priceAdjustment:'unadjusted'`（fqt=0），供与 BaoStock 同口径比对。版本签名分离，不覆盖旧归档。
5. `scripts/research-cross-source-history.js`：读取已保存东财未复权 JSON 与 BaoStock 原始采集证据，校验相同股票/日期/单位及独立上游，生成新 JSON 差异证据文件；仅本地文件，不联网、不覆盖源文件、不产生交易价格。
6. `worldbank-indicators.js` + `scripts/collect-worldbank-indicator.js`：官方世界银行 API V2 的**单次、显式、只读宏观研究抓取**；限主机/指标/年份/响应尺寸/重定向，缺失值 null、真实 0、发布时间未知分别保留。不是自动高频采集，不进行情/交易链。
7. `public/assets/picks-page.js`：现有电脑/手机共享的 `/picks.html` 每只股票展示供应商标识（没有标识就是“价格来源未知”）、明确报价时间与质量状态，数据源消失就清旧标签，不用接收时刻假装新价。仅版本化其页面 script URL；**两个锁定主页 index.html/mobile.html 未改**。

## 可复现入口

```bash
cd V6_BO
node scripts/audit-data-source-lineage.js
node --test tests/data-source-lineage.test.js tests/multi-source-publisher-lineage.test.js \
 tests/baostock-historical-normalizer.test.js tests/research-cross-source-history.test.js \
 tests/worldbank-indicators.test.js tests/picks-data-source-evidence.test.js
# 有先前取得的单股未复权东财源与 BaoStock 原始JSON时才手动调用：
node scripts/research-cross-source-history.js /path/em-unadjusted.json /path/baostock-raw.json /path/NEW-parity-report.json
# 单次官方宏观研究（互联网和具体数据集许可仍须核实）：
node scripts/collect-worldbank-indicator.js CHN NY.GDP.MKTP.CD 2000 2025 /path/NEW-worldbank.json
```

- `.github/workflows/v6-ci.yml` 为每次 push/PR 新增真实 `multi-source-data-lineage` Job，覆盖上游同源、历史单位、跨源差异、BaoStock 规范化、World Bank 数据缺失、卡片清理、历史原有回归。
- 以上命令是**复现步骤**，不能从存在命令本身推断 CI 成功；必须以本 PR 的确切 HEAD、GitHub Actions 回执及现场网络/许可审计为准。

## 后续要完成的接入，不许误报成已上线

继续把有明确许可的数据通过同一归一化协议接入；按实际调用将新来源分为“已联网取数且通过字段验收”“能读取但只读研究”“需要账号/授权/官方交易客户端”“不再有效/封锁”，不能只数仓库名或域名。

关键补充：交易日历需交易所公告来源和完整时间范围、半日市等独立证据；公司行为按公告日与生效日进行 PIT 审计；东财/腾讯/TDX/BaoStock/官方价需日度独立对账，披露差异率与样本数。原始行情业务不得用宏观季度发布时点、公告抓取时点或者月K补当日逐票 15 秒报价。

### 真实性/授权证据

- [BaoStock 官方字段](https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md) — 日K `volume` 为股、`amount` 为人民币元、`adjustflag=3` 不复权、`tradestatus=0` 停牌。
- [World Bank Indicators API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api) — V2 公共 API 可无 Key 查询；[许可说明](https://datacatalog.worldbank.org/public-licenses) — 数据集许可可能不同，需具体核对。
- [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) — 文档化公开 JSON，不等于有权重分发所有下载材料。
- [FRED API](https://fred.stlouisfed.org/docs/api/fred/) — 需密钥、具体系列可能有第三方版权，当前不自动启用。
- [HKEX 历史数据许可](https://www.hkex.com.hk/Global/Exchange/FAQ/Market-Data/Getting-Market-Data?sc_lang=en) — 需要按产品和用途核准许可。
- [交易所数据使用与收费文件](https://www.ciis.com.hk/hongkong/en/productsandservices/documentdownloads/index.shtml) — 不能因为网页可访问而假定可以在产品中转发实时行情。

回滚：PR 未合并前直接关闭；合并后按新的合并提交 `git revert`，不要覆盖旧账户/历史记录/原工程。整个改变不采购服务、不修改自动部署发布者、不新增买卖接口。
