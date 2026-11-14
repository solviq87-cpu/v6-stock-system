# v6-stock-system

**第二批官方数据底座（2026-11-15）**：现有89条来源目录扩展为**120条路线、79个含模糊标记的上游分组、30个参考仓库**。新增手动运行的[SEC EDGAR公司财报和欧洲央行ECB欧元每日参考汇率](V6_BO/docs/OFFICIAL_SEC_ECB_SOURCE_EXPANSION_20261115.md)研究适配器，保留申报日期/修订、原始货币方向/时间缺口与完整安全门禁。120条不是120家已接通的独立实时供应商；未获取授权、未经联网实测的数据不进入交易或账户。

**学习运行检查（2026-11-14）**：原学习卡新增手动运行条件与本地模型检查，区分当前输入、固定模型摘要和上次研究记录；提供同一份只读CLI诊断，缺数/暂停保持明确，不自动训练。见[配置、接口与实际验证](V6_BO/docs/LEARNING_RUNTIME_PREFLIGHT_20261114.md)。


**研究导航改进（2026-11-14）**：[键盘、分页与长列表](V6_BO/docs/RESEARCH_NAVIGATION_20261114.md)：页签支持方向/Home/End移焦及回车/空格激活，翻页和版本读取后保留可用焦点；修复分页请求在途切页签的行/页码错配。版本列表限高滚动、电脑两列/手机单列，原记录和入口保留。新增导航/竞态四视口回归；最终精确head CI/合并见本分支PR，未发布生产。

**多上游数据底座（2026-11-14）**：[89条可溯源数据接入路线与20个参考仓库](V6_BO/docs/MULTI_UPSTREAM_DATA_FOUNDATION_20261114.md)已落地原始上游分组、BaoStock/东财未复权对账、World Bank官方宏观只读采集、选股卡来源质量说明与独立CI门禁。89条是候选和已存在的总路线，**不代表89家已接通、已授权的实时行情**；来源未知、不一致或过期禁止冒充实时可交易价格。

**学习闭环与开源模型研究（2026-11-14）**：修复学习样本/次日交易日/缺失结果统计，研究页增加手动状态与补验卡；可选本地Qwen3经Ollama提出受限候选，独立前向验证后才产生研究版本，建议不变则保留原版本。已做合成摘要真实推理，尚未用于生产或证明收益。见[使用与验证](V6_BO/docs/LOCAL_LEARNING_EVOLUTION_20261114.md)。

**大盘—板块—个股联动卡（2026-11-14）**：现有研究页增加单卡下钻：有效权重归因、板块相对强弱与广度、成员位置、五日持续性及有证据的分时顺序。复用封存记录与补充证据入口，缺数保持未知；见[使用、证据契约与验收](V6_BO/docs/MARKET_SECTOR_STOCK_CARD_20261114.md)。

**界面与模块联动（2026-11-14）**：补查12个官方项目并将资料库扩至53来源；候选股可带代码进入研究，六分区共用显式股票选择，筛选/持仓能钻取同股记录，公开设计对照链接可恢复与清除。见[统一采用与验收记录](V6_BO/docs/UI_LINKED_WORKFLOW_ADOPTION_20261114.md)。

**研究流程改进（2026-11-14）**：[版本、导出与权限一致性](V6_BO/docs/RESEARCH_SELECTION_CONTINUITY_20261114.md)：旧研究翻页/重读保持版本，导出绑定屏幕记录与查看时点，跨页对照保留；新增“查看最新研究”，撤权清空私有草稿并隔离迟到响应。本地全量3537通过/0失败/3可选跳过，四组各四视口通过；最终精确head CI/合并以本分支PR为准，未发布生产。

**UI卡片增量（2026-11-14）**：[UI概览卡片](V6_BO/docs/UI_SUMMARY_CARDS_20261114.md)已落实研究页证据缺口、筛选批次、持仓待复核、分析任务四卡，以及资料库四张全目录状态筛选卡。支持手机/电脑、详情跳转与权限清理；两张锁定主页不改。

**模型与设计资料库（2026-11-14）**：新增[公开模型、运行与界面综合采用记录](V6_BO/docs/OPEN_MODEL_DESIGN_ADOPTION_20261114.md)：41个公开来源（原24＋新增10模型/家族参考＋7界面运行项目），可在研究页进入`/model-library.html`搜索、分类、最多三项并排比较与导出；另落实预测配对的完整配置身份和输出类型分组。模型未安装/实跑，不新增API或更改锁定主页。


> **手机/电脑同时刷新与周末新闻规则**：两端分别从同一云端读取数据，任意一端可用，不依赖另一端开机。周末新闻继续刷新、盘面保留最后交易日的快照日期。云端持久化部署仍需现场验证。详见 [双端云端与休市运行规则](V6_BO/docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md)。

> **国内写入/部署交接入口（2026-11-13 用户明确覆盖旧目标）**：`https://af3c7822e6aafc135.app.workbuddy.host` 为当前唯一指定目标。已只读核验官方 `/console`、`/api/site`、`/api/health`；官方发布为 `POST /api/publish`，仅托管单文件静态 HTML。完整工程后端、持久化、首轮发布及长期自动更新尚未验证。参见 [目标与鉴权](V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md) 和 [GitHub 自动更新操作](V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md)。分享码只放私有凭据存储，禁止进入 Git 或 CI 日志。 自动更新采用既有每小时 hosted 任务和当前 managed cloud 环境唯一发布者 managed-task，GitHub 每 15 分钟只读巡检；私有 shareCodeFile 注入解除 GitHub Secret 配置依赖，精确 CI/SHA/owner 与完整内容校验继续强制。本次任务/发布结果待 PR 实际回执；环境文件或权限缺失必须停发报告。 角色切换按 `V6_BO/config/repository-auto-update-owner.json` 执行停旧 scheduler→等在途结束且 journal.transaction=null（旧 owner 先恢复）→owner 变更 SHA 通过 CI→启新；owner 不能撤销在途写入，跨环境 flock 不互斥。

> **生产运行依赖政策（2026-11-13）**：生产、部署、构建和运行代码禁止接入 OpenAI / ChatGPT API，不允许 API Key、SDK、私有接口或 OpenAI 专属 hosting 配置。国内智能能力如需接入，只允许使用用户授权的 WorkBuddy 能力；核心行情、策略、回测、模拟盘和风控不得依赖任何外部大模型 API 才能启动。

V6 智能选股系统｜实时行情、智能选股、涨停复盘、风险控制

## 功能落实与公开项目对照

后续实现见[冻结模型预测与前向评测](V6_BO/docs/FROZEN_MODEL_FORECAST_20261114.md)：同一封存输入上明确导入预测，后续真实价格到达后计算误差、基线和区间，并在匹配样本中比较；不执行上传模型或将预测当收益。

续接实际功能见[八类研究工作区实现](V6_BO/docs/RESEARCH_WORKSPACE_IMPLEMENTATION_20261114.md)：研究页已接字段证据、变化追溯、原生体系、完整落选检索、条件化市场题材关系、四周期成绩、原持仓防守及有版本约束/诊断/回放导出。运行数据不足会显示未知，合并与生产状态单独核验。

追加[八类公开模型与研究框架对照](V6_BO/docs/PUBLIC_MODEL_COMPARISON_20261114.md)：Chronos/TimesFM/Moirai/Kronos/RD-Agent/TradingAgents/FinGPT/Qwen，逐项记录固定源码、可借鉴内容、许可、成本与未测试范围；与原16来源合计24个独立公开来源。未安装模型或调用新API。

见[八类功能核验与16个公开来源综合对照](V6_BO/docs/FEATURE_IMPLEMENTATION_PUBLIC_COMPARISON_20261114.md)：逐项列出代码/研究页入口、实际测试、尚缺闭环，以及24项候选的复用位置、优先级和验收条件。候选清单不是已实现或已部署功能；固定源码及许可记录见[来源清单](V6_BO/docs/PUBLIC_COMPARISON_SOURCES_20261114.json)。

## Development

The application is in `V6_BO/` on the `dev` branch. From the repository root:

```sh
npm run check
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
npm start
```

Node 22.6+, Python 3 and Linux `flock` are required. The ML test interpreter must include NumPy and scikit-learn. Read `V6_BO/AGENTS.md` and `V6_BO/docs/WEB_PREVIEW_DEPLOY.md` before deploying. Secrets and account state belong in private runtime storage, not Git.

Offline model research supports optional LightGBM/XGBoost comparisons and dated eligibility/liquidity filters. See [model conditions, comparison and validation](V6_BO/docs/MODEL_LOGIC_COMPARISON_20261107.md); optional models do not change production selection weights.

## Web strategy research

`V6_WEB/` is a provider-neutral static research module. Its historical preview publication is retained only as release history in `V6_WEB/README.md`; it is not a production dependency or deployment target.
