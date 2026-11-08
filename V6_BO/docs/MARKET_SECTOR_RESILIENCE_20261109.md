# V6 大盘—板块逆势与抗跌联动研究（2026-11-09）

## 目标与范围
研究用同一交易日有效的上证、深证、创业板指数涨跌、上涨家数比例和板块涨跌幅解释个股上下文；A50 仅作可选旁证，不替代两项境内指数。本模块**只读**，不涉及真实券商、模拟账户变更、正式策略权重或因子学习自动晋级。

## 输入协议
在既有 `market.linkage.market` 添加 `indices` 字段，分别按 `shanghai`、`shenzhen`、`chinext`、可选 `a50` 提供 `changePct`、`tradeDate`、`source`、`observedAt`。市场自身必须提供已有的 `breadthScore`（上涨比例0–100）及 `coverage`（至少0.8）。在 `market.linkage.sectors[stockSymbol]` 的原有板块强度之外，可额外填写板块 `changePct` 与有效来源时点。历史研究调用时 `asOf` 为所提供历史日K线日期15:00（北京时间）。全部观察要求交易日一致、有效时间不晚于评估时点，默认不超过20分钟。模拟、未来、过期、来源交叉冒用、日期不一致时标 `unverified`，而不是补0分。这里的 `source` 是**上传者声明的来源标签**，不代表已完成供应商独立认证。

## 分类假设（未经回测的阈值）
- 3项境内指数中至少2项跌幅不高于-3%，上涨比例≤25%：`systemic-selloff-observed`（系统性下跌形态观察，不自动证明不可抗力）。
- 其中至少2项跌幅≤-2%，上涨比例≤35%：`broad-selloff-observed`。
- 至少2项涨幅≥1%，上涨比例≥60%：`broad-advance-observed`。
- 否则 `mixed-observed`；若有效境内指数少于2项，则证据不足。
- 板块涨跌幅相对有效境内指数**等权平均**差额≥2个百分点时，在大盘下跌且板块当日上涨的情况下标 `countertrend-observed`；大盘下跌但板块仍下跌只是跌得少则标 `relative-resilience-observed`。
- 板块表现低于指数等权平均至少2个百分点时标 `sector-underperforming-observed`，独立显示风险，不因看涨形态而清除。

上述阈值没有做历史校准、统计显著性或样本外验证，不能把相对强弱当作真实资金流向证据，也不能把同期发生的板块表现解释为某只股票上涨的确切原因。

## 接入与不变式
- `src/strategy/market-sector-resilience.js`：纯函数分类、来源校验、风险与同向线索。
- `market-sector-pattern-linkage.js`：仅在用户显式提供 `indices` 或板块 `changePct` 时额外输出 `resilienceResearch`；**未提供新字段时原接口返回保持不变**。
- `candidate-rationale.js`：把只读联动证据放入 `marketSectorResilience`，在价格上涨时提供“同期逆势上涨”的未证实线索，同时保留公告与大盘风险。
- `public/assets/complete-workbench.js`：研究页个股详情展示指数均值、板块涨跌及相对超额，不展示虚构实时价格。
- `tests/market-sector-resilience.test.js`：覆盖下跌、上涨、抗跌、逆势、弱板块、A50不替代境内指数、未来/过期/模拟/跨来源、向后兼容和个股解释。

## 运营边界
大盘急跌学习保护仍是独立只读诊断（`market-shock-learning-gate.js`），不能声称已接入自动参数写入器。市场急跌期间亏损样本、回撤、风控和账户审计必须保留。GitHub CI 通过也不代表 Workbuddy 已部署；部署权限、HTTPS 和国内数据源要另行验收。
