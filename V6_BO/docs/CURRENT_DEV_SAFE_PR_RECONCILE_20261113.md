# V6 旧 PR 安全收敛：BaoStock 来源语义与影子研究运行健康

日期：2026-11-13。

本批不是直接合并落后于当前 `dev` 的历史分支，而是以最新主线为基线，逐项迁移仍然缺失且与当前代码兼容的有效能力。历史 PR 的旧提交、旧基线和已被后续实现替代的部分不回灌。

## 1. BaoStock 行业成员语义门禁

消费端现在明确要求输入同时满足：

- `collectionMode: "current-provider-snapshot"`
- `historicalMembershipVerified: false`

缺失字段、伪称“按历史日期查询”的输入或把 `historicalMembershipVerified` 改成 `true` 都 fail-closed。成功转换后的 provenance 原样保留这两个语义字段。

这避免把 BaoStock 当前查询结果冒充某个历史时点的真实行业成分。它仍然只是研究来源，不获得交易权限、官方指数成分认证或数据许可认证。

## 2. 影子研究 WATCH 心跳

`factor-shadow-worker.js watch` 每次实际 tick 完成或失败后，在既有研究写锁内部原子更新：

`.shadow-worker-heartbeat.json`

心跳是可覆盖的运维状态，不属于不可变模型、候选预注册或试验档案，不参与训练、排名、策略权重、回测或交易。

状态只说明最近发生过一次 tick，不能证明：

- 进程此刻仍存活；
- 行情或 H5 来源真实可靠；
- 模型效果改善；
- 研究结果可用于生产交易。

## 3. 只读健康查询

```sh
cd V6_BO
node scripts/factor-shadow-worker.js health /private/manifest.json /private/shadow-models
```

只接受 `v6-forward-training-manifest` 规范清单。健康查询：

- 校验清单完整性和冻结特征；
- 只检查 H5 报告路径是否存在，不读取其收益内容；
- 汇总最新已接受研究版本、试验、冷却、候选预注册、预算和 WATCH 心跳；
- 不创建研究目录，不拿锁，不写模型，不消耗试验预算。

可能状态包括 `watch-not-confirmed`、`watch-heartbeat-stale`、`watch-tick-failed`、`missing-research-evidence`、`research-budget-paused`、`research-decay-paused`。

## 4. 与当前研究智能体的关系

当前 `dev` 已包含可审计研究智能体。两者职责不同：

- 研究智能体负责感知、计划、执行、复盘和不可变事件记忆；
- WATCH 心跳/health 负责只读运维可观测性。

本批不改变研究智能体的生产隔离、正式因子权重、四套策略、模拟盘、账户、行情权限、两张锁定主页或推送通道。

## 验收

必须以本批最新提交的 GitHub Actions 为准，至少要求：

- OpenAI / ChatGPT runtime API 禁入门禁继续通过；
- BaoStock 专项回归通过；
- shadow runtime health / heartbeat 专项通过；
- `npm run check` 与全量回归通过；
- verify-web 通过；
- 其他发布结构、数据源、HTTP 隔离冒烟门禁不退化。

CI 通过只证明仓库代码门禁通过，不代表国内正式部署、常驻进程、真实行情或真实收益已验证。
