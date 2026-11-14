# 多仓库源码对照与本轮落地 · 2026-11-14

## 范围与结论

用户要求继续找值得借鉴的仓库并实际补齐功能。本轮基于 `dev@c188f9f5affab9cad9bad065e3a191870fb12f9b`，保留 #219 已交付的证据卡、时间线、分歧、筛选过程和续接摘要；另外检查 Qlib、QUANTAXIS、Qbot。以下是固定源码抽样，不是完整审计、实盘认证、收益比较或安装集成这些框架。

直接落地：**XLSX 股票清单导入、工作表选择、逐行拒绝原因**。复用原有证券归一化、去重和研究选择；不调用模型、不增加第三方依赖、不保存上传文件。其余候选按缺口和数据条件评估，不能把本表所有项目都说成已经写入。

## 固定版本与实际阅读

| 项目 | 本次 SHA | 实读文件与许可范围 |
| --- | --- | --- |
| [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) | `70f250597e9a2b0afe2d7dd6b992c90926916105` | [`src/services/import_parser.py`](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/services/import_parser.py)；完整前次审计见 [专项报告](DAILY_STOCK_ANALYSIS_DEEP_REVIEW_20261114.md)，根 MIT 与筛选子目录 Apache-2.0 分开处理 |
| [microsoft/qlib](https://github.com/microsoft/qlib) | `54355232463878d2eebb91fe0ee5fa7fa1f5976c` | [`docs/component/recorder.rst`](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/docs/component/recorder.rst)、[`qlib/data/pit.py`](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/qlib/data/pit.py)、LICENSE（MIT） |
| [yutiansut/QUANTAXIS](https://github.com/yutiansut/QUANTAXIS) | `232aa7ac9869966108f02a8fff85f1f7b09a9ce2` | [`QADataStruct.py`](https://github.com/yutiansut/QUANTAXIS/blob/232aa7ac9869966108f02a8fff85f1f7b09a9ce2/QUANTAXIS/QAData/QADataStruct.py)、[`data_resample.py`](https://github.com/yutiansut/QUANTAXIS/blob/232aa7ac9869966108f02a8fff85f1f7b09a9ce2/QUANTAXIS/QAData/data_resample.py)、`QAMarket/QAPosition.py` 的仓位字段、README 与 LICENSE（MIT） |
| [UFund-Me/Qbot](https://github.com/UFund-Me/Qbot) | `f0425ae4ae8bd02b79656b8f7039f4cd6874095e` | [`backtest_base.py`](https://github.com/UFund-Me/Qbot/blob/f0425ae4ae8bd02b79656b8f7039f4cd6874095e/qbot/engine/backtest/backtest_base.py)、[`backtest_main.py`](https://github.com/UFund-Me/Qbot/blob/f0425ae4ae8bd02b79656b8f7039f4cd6874095e/qbot/engine/backtest/backtest_main.py)、README、根 LICENSE（MIT）；有内嵌第三方目录，不能据根许可证推定全部子模块许可 |

本轮源码通过只读检出阅读；未运行上游安装脚本、交易接口或通知脚本。V6 新代码独立编写，未复制上述仓库实现。

## 功能逐项映射

| 来源与可借鉴点 | V6 核对位置与现状 | 实际差距 / 取舍 | 本轮状态 |
| --- | --- | --- | --- |
| daily_stock_analysis：文件与文本统一导入 | `public/assets/stock-list-parser.js` 已有 CSV/TSV/TXT、交易所检查、去重 | 缺直接 XLSX；原上游读首张表并可能用名称补代码，V6 应显式选择表且不猜证券身份 | **已实现 XLSX**，实现与边界见下文 |
| Qlib：一次实验记录参数、指标和产物 | `src/strategy/model-experiment.js` 已有固定切分、训练标签隔离、特征指纹、样本审计；`factor-candidate-prereg.js` 等已有研究档案 | 尚未从本次抽样确认所有研究模块拥有同一套可筛选运行目录和跨实验对照页。值得补统一索引，不能另造第二份指标真相 | **P1 候选**：索引已有结果；未实现新的统一实验中心 |
| Qlib：按观察时点解释财务周期数据，拒绝未来周期引用 | `src/core/public-stock-financials.js` 检查报告日、公告日、更新日和收到时间；特征可得时点保守使用实际收到时间 | 现有门禁是优点；历史修订版本与原始公告时刻仍需真实存档。今天抓取的财报不能用于证明过去可知 | **条件候选**：先积累合法历史版本；未接新 PIT 数据库，未回填历史 |
| QUANTAXIS：显式前/后复权数据结构与按交易时段重采样 | V6 原行情时点门禁、`historical-session.js`、已有 K 线周期聚合和成本回测 | 不能把5分钟倒推成1分钟，不能将研究复权价用于成交。可继续增强数据口径检查，但无证据需要替换引擎 | **保留现有实现**；未替换数据层或复权算法 |
| QUANTAXIS：今日/昨日与冻结仓位字段 | 原 `paper-account-ledger`、订单/撤单/冻结与权威账户链 | V6 已有资金、T+1及故障恢复规则；另接账户引擎会制造双账本风险 | **不重复实现**；保持原账户权限与 miniQMT 接入约束 |
| Qbot：策略净值与基准曲线同屏 | `src/core/performance-statistics.js` 有净值、最大回撤、波动、夏普、胜率区间；已有成本账本回测 | 值得补相同日期/交易日历/复权口径的基准超额与回撤比较。读到的 Qbot 模板是信号乘涨跌幅复利示例，不能直接替代 V6 成交/成本账本 | **P1 候选**：基准对照报告；本轮未实现 |
| Qbot：数据、策略、回测、交易分层 | V6 已有 server/core/strategy 和离线研究/正式账户隔离 | README 的集成广度不证明接口在本环境可用；主样例还依赖其他行情库/策略类 | **只借结构思路**，未接自动下单、第三方账户或更多推送渠道 |

优先顺序：先交付本轮 XLSX → 在既有结果上做实验比较与基准比较 → 具备可审计历史资料后再扩展 PIT。暂不堆新模型名称，不把提示词模板当成经样本外验证的策略。

## XLSX 的用户路径与边界

入口仍是 `/research.html` → 按代码采集并记住K线 → 导入股票清单。CSV/TSV/TXT 原体验保留。选择 XLSX 本身不上传；点击“预览并去重”后用现有编辑令牌上传到当前 V6 服务。多张可见工作表必须选择其中一张，再点击预览；隐藏表不能导入。结果继续逐只“选择研究”，不会自动联网采集、写账户或执行交易。

- 普通 UTF-8 transitional OOXML XLSX，最多512 KB、256个压缩成员、总解压3 MiB、单成员1 MiB、32张表、64列、1000行（含表头）、100只不同沪深股票。超限整体拒绝，无静默截断。不是通用 Excel 阅读器；旧 XLS、宏、外部链接、嵌入对象、合并单元格不支持。
- 必须有唯一代码表头，名称列最多一列；只返回代码/名称预览及拒绝/重复信息，不返回其他仓位金额列。共享字符串、富文本、稀疏单元格保留源行号。
- 文本代码保留前导零；普通六位整数可读。有格式的数字、日期、科学记数、短数字、公式及其缓存均不能自动转成证券身份；提示改为文本。即使样式仅为加粗，数字代码也保守拒绝，用户可转换为文本。不会按股票名称猜代码。
- 解析在 Python 3.9+ 标准库子进程中完成，使用隔离参数和最少环境变量；固定脚本，不接收执行路径或URL。5秒超时、输出上限、单任务并发；超时杀进程并等关闭才释放执行槽。ZIP 不落盘，拒绝路径穿越/重复项/加密/特殊压缩/符号链接，XML 拒绝 DTD/实体及过深结构。
- 上传数据只在请求/内存中处理，不写业务数据库；需连接完整 V6 后端，静态 HTML 托管本身不能解析 Excel。服务层原访问日志/托管平台日志策略不因本功能而自动改变。
- 令牌、输入、文件、工作表变化、离线或离开页面都会清空/失效旧预览；旧异步回复不能恢复结果。显示使用 textContent，导入名称不是上市状态认证。

## 验证与回滚

- 新 `tests/stock-workbook.test.js`：真实 ZIP → Python → JS 解析链，覆盖多表、隐藏表、共享字符串、稀疏行、公式、前导零、错误类型、重复、各类上限、路径/宏/外链/DTD/合并单元格、并发以及 HTTP 权限先行。
- 扩展 `tests/stock-list-import.test.js`：显式上传、无令牌不上传、取消请求及六种旧回复失效；已有 CSV 行为保留。
- 扩展真实 Chrome 浏览器检查：选择 XLSX 时零请求、上传、多表切换、公式行拒绝、320/390/430/1536视口；使用合成股票文件和实际解析服务，非生产账户。
- 完整服务隔离启动检查原数据锁返回 `locked:true`，不能错误地只认401/403；无凭据时没有启动解析进程。
- 本地专项21项通过；完整服务隔离启动通过；V6_WEB 40项与构建通过。`npm run check`、`git diff --check`通过。
- 本地全量3426项：3419通过、4失败、3跳过（127.8秒）。4项均在未改的 `managed-publisher-runtime.test.js`，对原始 `c188f9f` 的临时只读归档复跑同一文件也是9通过/4失败，原因是当前环境发布器运行时路径校验；没有绕开或放宽门禁。3项可选ML环境跳过。最终仍须精确head的完整CI全绿。
- Chrome浏览器通过与截图尚待CI；本环境原Chrome进程启动受socket权限限制。生产发布、iPhone/Android真机、真实用户工作簿兼容性尚未验收。
- 回滚：revert本功能提交，恢复原文本清单入口；没有账户/数据库迁移。根锁定主页与原四体系未改。
