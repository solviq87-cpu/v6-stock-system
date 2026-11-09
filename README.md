# v6-stock-system

> **国内写入/部署交接入口**：用户指定 `https://acd98a1c1a46e6ce4.app.workbuddy.host`（文档 `/api/ai/doc?id=ai`）。下一位 AI 开工先读 [国内 WorkBuddy 写入目标及鉴权现状](V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md) 与 [AGENTS.md](AGENTS.md)。此目标与下方历史研究预览站不是一回事；实际写入 API 和生产部署尚未认证，分享码/令牌禁止提交。
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

The [V6 strategy research website](https://v6-stock-bn-preview.mythiclatch2.chatgpt.site) was published on 2026-11-08 with the existing owner-private access preserved. It includes Donchian20/10, RSI2 and momentum TopK research variants, local historical simulation and factor analysis. Default data is synthetic; live strategy performance is unverified. See [release details](V6_WEB/README.md).
