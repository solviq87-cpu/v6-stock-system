# V6 因子自动学习：1/5/20/60日观察状态与目标日因果核验

## 已确认缺口

`factor-shadow-evolution.js` 既有 `verifyAndJoin` 主要校验 **H5 `observed` 状态**的 `targetDate` 和涨跌幅；对 H1/H20/H60 的窗口顺序、H5 停牌缺价/公司行为未解决时的目标日期，以及 `pending`、`calendar-incomplete` 的日期关系缺少完整的逐窗口检查。自签SHA无法证明报告中的“已成熟/未成熟”状态具有正确的时序。

## 新增 fail-closed 门禁

在冻结因子与前瞻报告匹配后，对每条信号的四个观察窗口按顺序复核：

- `observed`：目标日必须晚于原信号日、早于或等于报告 `asOf`；收益必须为有限值且大于 -100%。
- `missing-or-suspended` 和 `corporate-action-unresolved`：目标日必须真实且已到期，收益必须明确为 `null`，绝不能以0伪装。
- `pending`：必须有真实的未来目标日（严格晚于报告 `asOf`），且不能包含任何回报。
- `calendar-incomplete`：必须同时没有目标日与回报（都为 `null`）；一旦较短窗口因日历不足，后续更长窗口不得又声称存在目标日。
- 已有的 H1/H5/H20/H60 顺序必须严格递增；不允许日期重复、倒序或早于信号日。

这是**研究数据合同的因果性检查**：不会重写来源数据、补造行情、修改冻结特征、更新正式策略或改动任何账户。原来的 `forward-signal-observer` 生成的规范记录可以继续进入研究评估。规则会同时作用于正式不可变 H5 归档读取和影子模型研究核验。

## 保护范围与兼容性

这是主动拒绝异常报告的增强。以前曾被误接受的状态矛盾记录将抛出错误并阻止研究进度；不能把它们自动补成合法成熟样本。若已经存在不一致的历史报告，需核查真正上游数据和原始信号，**不能为了通过测试改写旧的封存归档**。

不涉及实际联网、数据许可确认、云端部署、行情正式计价、自动买卖、四套规则、15个正式因子权重、两张锁定主页或模拟资金账本。交易日历仍由明确导入的市场数据自报；本检查不认证交易所开市日。

## 验收

在 `V6_BO` 执行：

```sh
node --check src/core/factor-shadow-evolution.js
node --test tests/factor-shadow-evolution.test.js tests/factor-maturity-link.test.js tests/factor-research-pipeline-e2e.test.js
npm run check
npm test
```

新增断言覆盖：真实合成观察仍被接受、未来停牌/公司行为错误成熟、到期仍标记 pending、日历缺失却附带未来目标、跨窗口日期重复、缺价却带0收益、短窗口日历缺失后长窗口伪造未来日期。

以最终提交SHA对应的 GitHub Actions `verify` 与 `verify-web` 为唯一已运行结果依据。合并后若集成CI不通过，按原 PR squash commit 执行 `git revert`，不得用旧备份覆盖整个项目。
