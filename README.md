# v6-stock-system

> **手机/电脑同时刷新与周末新闻规则**：两端分别从同一云端读取数据，任意一端可用，不依赖另一端开机。周末新闻继续刷新、盘面保留最后交易日的快照日期。云端持久化部署仍需现场验证。详见 [双端云端与休市运行规则](V6_BO/docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md)。

> **国内写入/部署交接入口**：用户指定 `https://acd98a1c1a46e6ce4.app.workbuddy.host` 作为既有国内部署目标；实际生产部署、持久化和自动发布仍需现场验证。新提供的 WorkBuddy 协作板仅用于协作记录，在未确认其部署能力前不替换该生产目标。分享码、令牌禁止提交到仓库或 CI 日志。

> **生产运行依赖政策（2026-11-13）**：生产、部署、构建和运行代码禁止接入 OpenAI / ChatGPT API，不允许 API Key、SDK、私有接口或 OpenAI 专属 hosting 配置。国内智能能力如需接入，只允许使用用户授权的 WorkBuddy 能力；核心行情、策略、回测、模拟盘和风控不得依赖任何外部大模型 API 才能启动。

V6 智能选股系统｜实时行情、智能选股、涨停复盘、风险控制

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
