# v6-stock-system

> **手机/电脑同时刷新与周末新闻规则**：两端分别从同一云端读取数据，任意一端可用，不依赖另一端开机。周末新闻继续刷新、盘面保留最后交易日的快照日期。云端持久化部署仍需现场验证。详见 [双端云端与休市运行规则](V6_BO/docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md)。

> **国内写入/部署交接入口（2026-11-13 用户明确覆盖旧目标）**：`https://af3c7822e6aafc135.app.workbuddy.host` 为当前唯一指定目标。已只读核验官方 `/console`、`/api/site`、`/api/health`；官方发布为 `POST /api/publish`，仅托管单文件静态 HTML。完整工程后端、持久化、首轮发布及长期自动更新尚未验证。参见 [目标与鉴权](V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md) 和 [GitHub 自动更新操作](V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md)。分享码只放私有凭据存储，禁止进入 Git 或 CI 日志。 自动更新采用既有每小时 hosted 任务和当前 managed cloud 环境唯一发布者 managed-task，GitHub 每 15 分钟只读巡检；私有 shareCodeFile 注入解除 GitHub Secret 配置依赖，精确 CI/SHA/owner 与完整内容校验继续强制。本次任务/发布结果待 PR 实际回执；环境文件或权限缺失必须停发报告。 角色切换按 `V6_BO/config/repository-auto-update-owner.json` 执行停旧 scheduler→等在途结束且 journal.transaction=null（旧 owner 先恢复）→owner 变更 SHA 通过 CI→启新；owner 不能撤销在途写入，跨环境 flock 不互斥。

> **生产运行依赖政策（2026-11-13）**：生产、部署、构建和运行代码禁止接入 OpenAI / ChatGPT API，不允许 API Key、SDK、私有接口或 OpenAI 专属 hosting 配置。国内智能能力如需接入，只允许使用用户授权的 WorkBuddy 能力；核心行情、策略、回测、模拟盘和风控不得依赖任何外部大模型 API 才能启动。

V6 智能选股系统｜实时行情、智能选股、涨停复盘、风险控制

## 功能落实与公开项目对照

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
