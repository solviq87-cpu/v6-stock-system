# V6 报价多源窗口质量诊断（离线研究）

新增日期：2026-11-10。入口为 src/core/quote-source-window-quality.js 的 auditQuoteSourceWindow，命令行入口为 scripts/quote-source-window-quality.js。

本模块不采集行情、不改多源路由、不更新用户持仓、不更改四套策略、不连接真实资金或券商。研究结果不能自动改变行情供应商选择。

## 补强理由

现有单次双源诊断能发现一次报价偏差，但不能说明多次请求中缺少报告、单源缺失、双源原始时点错位分别发生多少次。一次接口成功也不能证明长期稳定。本模块依靠操作者事先声明的采样时刻，防止只选择成功样本计算高分。

## 输入

输入 JSON 顶层包含 registeredAt（计划创建时刻，epoch ms）、asOf（截止时刻）、expectedSlots（3～250个时间点、相隔至少30秒、必须在注册之后）、observations（数组，每项包含 slotAt 和 report，report 为 checkTwoPublicSources 的原样返回）。

可选 maxReportLagMs（默认30000，范围0～60000）和 maxPairSkewMs（默认3000，范围0～15000）。所有时间点使用 Unix 毫秒，不依赖电脑本地时区。事前采样表须真实预登记，不能用事后整理的成功数据冒充事前计划。真实交易日和法定节假日由授权外部日历另行核实，周一至周五时间窗不是法定交易日证明。

## 调用

在 V6_BO 目录执行：
- node --check src/core/quote-source-window-quality.js
- node --test tests/quote-source-window-quality.test.js
- node scripts/quote-source-window-quality.js /private/research/records.json

命令行仅读一个本地普通 JSON 文件（小于4MiB，禁止符号链接），打印 JSON 报告到 stdout，不写磁盘、不访问网络。若状态 blocked，退出码为2。要归档时应使用新的文件路径，不得覆盖原始研究证据。

## 审计字段及限制

- sourceCoverage 每个来源统计 freshSlots、datedSlots、unavailableSlots、missingEvidenceSlots。operationalFreshnessScore 和 freshCoveragePct 是预定采样时间内原报价时点新鲜覆盖率（百分制），绝非价格正确率、授权状态或供应商排名。
- pair.freshPairs 代表双源都有新鲜原时点；仅当原始时点差不超过 maxPairSkewMs 时，才计入 timeAlignedPairs，再区分 alignedPriceAgreements 或 alignedPriceDisagreements。源数据时间错位不得作为一致证据。
- missingSlotCount 将缺档纳入分母，连续观测不等于真实交易所认证。异常报告不猜测是哪家错，不对冲突报价求平均。
- 全部产物固定 canTrade=false、canTrain=false、canNotify=false、verifiedLive=false、canAutoSelectProvider=false、providerIndependenceVerified=false。供应商可能共享上游；没有独立认证交易所时钟、许可和可成交性。

## 当前交付边界

本批仅为新增离线数据研究模块、只读命令行和单元测试，不自动链接正在运行的行情流，也不改变纸面成交价。隔离环境单元测试使用与现有模块相同的 session 时段函数：7个用例通过；GitHub 仓库全量回归、既有 CI 故障排查、联网数据认证及现场部署尚未进行。合并前必须按根 AGENTS.md 做全量回归、受影响的模块验证、现有 CI 复核及反负优化审查。主页文件与版本号均不修改。
