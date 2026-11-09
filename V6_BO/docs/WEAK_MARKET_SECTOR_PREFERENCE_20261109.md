# V6 弱市避让板块研究排序（2026-11-09）

## 目标
在大盘显著下跌时，依据用户偏好把**银行、保险、证券/券商、白酒**归入“研究观察降低优先级”类别，先看其他已命中规则的股票。
此处不是对银行、保险、券商、白酒股票长期投资价值的判断，也不是完整的成分股/指数权重库，不能用行业名称推断某家公司真实指数权重。

## 严格输入与前提
- 仅用于 `historicalExplanations` 的**导入历史研究样本**，且需要同一个交易日的收盘价及按时点的市场/板块观测。
- 原市场分类来源：上证、深证、创业板至少两个可用指数，市场上涨家数比例覆盖率至少80%，数据来源/时点未通过不触发偏好。A50可作为辅助，但不代替境内指数。
- 原 `evaluateMarketSectorResilience` 检测 `systemic-selloff-observed` 或 `broad-selloff-observed`，才有弱市前提；市场混沌、广泛上涨、未知或过期均不降序。
- 行业分类只依据来源有效的历史板块名称匹配上述4个族，不使用股票名称猜测；无相同交易日、板块名称/来源与价格日期一致证据时为未知。
- 行业名称系上传者声明，没有证券公司主营业务或权重认证。示例“商业银行”“券商”仅按事先定义的字符串类别处理，不认证行业成分。

## 变化和不变
- `src/strategy/weak-market-sector-preference.js`：纯函数给出 `researchDeprioritized`、原因及 `weightsChanged:false`，只有已确认的弱市匹配才标记降低顺序。
- `src/core/research-explanation-projection.js`：将分类附到每只股票的 `rationale.weakMarketPreference` 中；在 `researchWatchlist` 将这些历史观察样本排序到其他样本之后。
- `public/assets/complete-workbench.js`：历史研究列表同样显示偏好及原因，仍展示**所有**历史股票、命中规则和原风险。已降序的股票不是被删除、封禁或者自动触发卖出。
- 原四套策略、扫描打分、选股门禁、研究战法历史收益、模拟盘账本、用户真实仓位、行情缓存与权重均不改。
- 当下数据缺失时不以虚假的“弱市”排序；这不是持仓风险通知、股票买卖信号或自动因子学习机制。

## 合规与验收
这份规则是**用户主观研究偏好**，阈值尚未做样本外效果校验和真实数据来源授权核对。不应声称回避这些类别会提高胜率，更不应与真实交易风控动作混合。

定向测试：
```bash
node --test tests/weak-market-sector-preference.test.js tests/research-explanation-ui.test.js
```
然后运行 `npm run check`、`npm test` 和 GitHub Actions 完整回归。
提交/CI通过不是实际境内行情或在线网站已部署的证据。
