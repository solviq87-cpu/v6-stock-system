# V6 新战法重叠与独立家族审计 · 2026-11-09

## 动机
同一只证券、同一交易日可能同时命中唐奇安突破和窄幅放量启动。
这两个属于同一个 `breakout-volume` 研究家族，不能当成两份独立增量证据。
未来1/5/20/60日各自的假设成交结果也不能误当成四次独立选股命中。

## 本批实现
- 仅在 `POST /api/research/complete-run` 的 `validatePublicRules:true` 且
  `publicRuleAuditOptions.includeLinkedRules:true` 时产生 `publicRuleForwardAudit.overlapDiagnostics`。
  未选中新增研究战法时，原两个公开战法验证默认响应行为不改变。
- 以 `symbol + signalDate` 为统计单位，每个交易日的信号仅按所请求的首个未来观察周期取一次。
  不依赖模拟盈亏是否盈利、能否成交，停牌、公司行为缺失、市场急跌不清除匹配记录。
- `rawRuleSignals`：策略条目触发次数（按股票日，不按每个持有期）。
  `uniqueStockDays`：至少一条策略触发的股票交易日。
  `independentFamilyExposures`：每个股票日发生的不同研究策略家族数之和。
  `sameFamilyDuplicateSignals`：同家族的额外规则命中次数。
  `byRule` 提供逐条重合与独立命中日数，以及“权重保持不变”的研究建议。
- 两条原公开技术研究规则没有预先证明彼此独立，暂保守归为
  `public-technical`；唐奇安与窄幅放量使用已有 `breakout-volume`，
  板块相对动量使用 `market-sector-relative`。
- 综合研究网页额外展示独立家族次数、同家族重复数、逐规则重叠与不升权说明；
  只读、纯文本输出，不连接任何自动调参、模拟盘账本或真实交易。

## 解释与限制
策略家族分类是**事先指定的保守设计标签**，不同家族在统计意义上仍可能高度相关。
同股不同时点的连续信号同样可能重叠，故 `uniqueStockDays` 并非独立样本量、
不能替代去相关、样本外、市场环境切片、滑点/费用或外部数据真实性校验。
任何涨跌幅/盈亏不能仅由同日共振得出自动升权或降权建议。
原四套正式策略、既有15因子及风控/模拟账户均不改。

## 验证
`node --test tests/linked-rule-forward-audit.test.js tests/linked-rule-audit-ui.test.js`，
以及 `npm test` 和本次提交对应 GitHub Actions。
代码提交、CI、在线部署、真实行情验收属于不同状态，禁止混为一谈。
