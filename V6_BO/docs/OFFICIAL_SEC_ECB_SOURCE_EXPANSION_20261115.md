# V6 数据底座：第二批官方源与数据溯源（2026-11-15）

## 本批真实交付边界

基线 `dev@64bf9b4179a21e358bc8349e5f7f01daa518bab7`（GitHub 实查；PR 合并前仍须同步最新 dev）。本批在原 89 条路线基础上，补充 **31 条官方/研究路线**，合计：

- **120 条接入路线**：保留此前全部历史代码、14 个原始来源许可白名单及已有适配器。
- **79 种上游标记**：包括复用同一机构的多个 API、以及 `multi:*` 未识别真实单一上游的研究包装器；**不是 79 家获得独立认证的实时行情供应商**。
- **30 个已核对真实存在的开源/标准仓库**：新增可复现的 A 股源质量对比、Lean、QUANTAXIS、zvt、Zipline Reloaded、SDMX 规范与 SDK 等设计资料，并非 30 个可自由转发的行情源。
- **两个新增真实代码适配器**：SEC EDGAR 公司财务事实（XBRL），欧洲央行 ECB 每日欧元参考汇率。两者是“手动可执行研究适配器”，不是已有环境连续运行认证、更不是 A 股买卖执行数据。
- **0 项未经许可自动启用；0 项新增交易/推送权限**。登记或单次成功请求均不代表生产长期可用。

## 新增可执行 SEC EDGAR 公司事实

- 入口：`src/core/sec-companyfacts.js`；手动命令 `scripts/collect-sec-companyfact.js`。
- 唯一目标：`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`。明确十位 CIK、`us-gaap` 指标名及 USD/shares 原始单位；严格 CIK、申报日期、会计期间、表单、完整 accession ID 及数字类型校验。
- SEC 公共数据 API **不需 API Key**，但自动访问需声明真实机构/软件和联系人 `User-Agent`；命令从环境变量 `V6_SEC_USER_AGENT` 读取，不写入代码、数据文件或输出日志。无真实联系信息时禁止发请求。单请求、不重试不轮询、限制 12MiB、12 秒超时、禁止重定向。
- `filedDate` 是申报日，不是 EDGAR 接收或向公众可用的精确秒级时间；后补/修订按 accession 分别留存，按 `filed<=asOf` 仅做日期层面的截断，结果始终 `pointInTimeBacktestReady=false`。**不能靠申报日早于信号日就宣称防未来函数已验收**。
- 历史事实不能直接用作 A 股财务因子或盘中行情。对于跨国映射/货币换算，还需要身份匹配和公布时点，不能自动跨市场融合。

## 新增可执行 ECB 欧元每日参考汇率

- 入口：`src/core/ecb-fx-daily.js`；手动命令 `scripts/collect-ecb-fx.js`。
- 官方接口固定：`https://data-api.ecb.europa.eu/service/data/EXR/D.<币种>.EUR.SP00.A`，使用官方 SDMX CSV 格式，固定明确单个币种、日期区间（最长 366 自然日）、512KiB 响应上限、10 秒超时，禁止重定向。
- **方向为“1 EUR 等于多少单位指定币种”**。比如 USD 记录是 USD/EUR 参考比率，不要误写成 EUR/USD，也不能当作当下可交易的 A 股/外汇实时报价。
- 逐条验证 `KEY`、频率 D、`CURRENCY`、`CURRENCY_DENOM=EUR`、周期和数值。缺失观测保持 `null`，重复交易日、错误单位、错误货币、零/负值、不可靠数值都拒绝。
- ECB 数据的观测日期 **不能代替发布时间戳**，不能用请求接收时间构造原始市场事件。始终 `publicationTimeVerified=false`, `canTrade=false`。
- `ecb` 与 `ecb-fx-daily` 同一个原始来源，只算一票；不以“不同接口名字”凑独立源。

## 新登记但未启用的官方路线

日本央行 2026 年 2 月 18 日发布 `getDataCode/getDataLayer/getMetadata` API；以及 JPX 统计/日历、美国财政部财政数据、BLS、BEA、Census、EIA（需要 API Key）、CFTC 周度持仓、CBOE 波动率指数、Eurostat SDMX、OECD、IMF、BIS、UN Comtrade、FAO、ILO、HKMA、MAS、RBA、BoE、SNB、BoC 等。

各路均单独记录 `dataClass`、`upstreamGroup`、`market`、`access`、`evidenceUrl`。例如三条财政部 Fiscal Data 路线是同一个 `us-treasury-fiscal` 上游；日本日历与行情都归 JPX，不能冒充独立验证。新注册的 JSON 只提供身份/许可线索，**不自动对真实接口发请求**。

## 执行命令（本地或经批准的云环境内手动运行）

```bash
cd V6_BO
node scripts/audit-data-source-lineage.js
node --test tests/sec-companyfacts.test.js tests/ecb-fx-daily.test.js tests/data-source-lineage.test.js
# 在环境中私密配置合法真实 SEC User-Agent（公司/应用名称及联系人），不要写入 Git 或日志
node scripts/collect-sec-companyfact.js 0000320193 Assets USD 2026-11-10 /path/to/NEW-sec-facts.json
node scripts/collect-ecb-fx.js USD 2026-11-01 2026-11-14 /path/to/NEW-ecb-fx.json
```

两种手动采集均只在已存在目录中以 `wx` 建立新的 0600 研究文件，不覆盖既有归档；数据尚未通过真机、国内网络许可/长期连通实证。没有买卖/云账户写入/模型训练副作用。CI 的本地网络全为 fixture mock，不能将 CI “绿色”宣称为海外源真实联网验收。

## 门禁、依赖与安全

- `data-source-lineage.js` 增加 JP 市场允许值，原 14 源保持不变，现有 `baostock` 与 `eastmoney-public-history` 的研究访问策略不扩权。
- `.github/workflows/v6-ci.yml` 的 `multi-source-data-lineage` 针对所有 push 和 PR 实际新增 SEC/ECB 语法及逻辑测试：公开 API 主机、接收尺寸、授权身份字段、未来日/修订、汇率方向、缺失/单位、越界、恶意响应、403/429 失败，不能绕过原全量回归。
- 不改用户锁定的 `public/index.html` 和 `public/mobile.html`，不修改 15 秒原价风控门禁、四策略、持仓账户、消息推送、部署发布者。
- 同类独立来源可以交叉验证，但外部源仍可能共同错误；不能根据“跨来源数值一致”认证价格的交易所真实性。不存在收益或准确率提升的百分比认证。

## 公共文档来源与限制

- [SEC 官方 EDGAR Companyfacts](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)，[SEC 公平访问/User-Agent 要求](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [ECB 官方 SDMX 数据接口](https://data.ecb.europa.eu/help/api/data)，[ECB 官方 EUR FX CSV 示例](https://data.ecb.europa.eu/help/api/data-examples)
- [日本央行 2026 年 API 公告](https://www.boj.or.jp/en/statistics/outline/notice_2026/not260218a.htm)
- [Eurostat 统计 API 文档](https://ec.europa.eu/eurostat/en/web/user-guides/data-browser/api-data-access/api-introduction)
- [美国 CFTC COT 周报说明](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)
- [美国 EIA 需要 Key 的 API v2 文档](https://www.eia.gov/opendata/documentation.php)
- [A 股多数据源实测对比仓库](https://github.com/ychenfen/a-share-data-sources)（仅借鉴对账与口径检查，不把公开测评当交易所真价）

本轮实测环境及最终 GitHub CI/PR 合并状态需要按精确 head 回执独立查证；只创建文档和测试不算实现已通过。回滚使用 PR 的 merge commit `git revert`，绝不可旧 ZIP 覆盖当下仓库或删除账务历史。
