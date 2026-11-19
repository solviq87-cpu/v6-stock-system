# FAYO 逐股决策仪表盘：上游参考的首批安全落地（2026-11-19）

参考：https://github.com/ZhuLinsen/daily_stock_analysis （MIT）。采用“决策摘要、利好利空、研究依据”的**通用信息组织原则**，独立实现，没有复制上游源码、品牌、完整报告样例或接入付费 API。

## 已写入的具体内容

- `public/nova/market-evidence.js`：纯函数 `projectDecisionBrief`，只读首页服务端返回的 `dashboard.rows`。有效六位股票代码去重、最多核对前200条、首页只展示前三条，不把局部样本称为全市场。
- `public/nova/market.js`：从既有行情模块导出该只读证据投影，不新增远程请求。
- `public/nova/terminal-workbench.js`：在 FAYO 现有盘面总览中增加逐股决策仪表盘。展示买入研究标签、观望、卖出研究标签、原评分、原行情日、行情来源、逐股报价时点、技术线索、已有策略条件和有发布日期的利好利空公告标题。
- 标题和供应商字符串通过原生 DOM 文本节点显示，不注入 HTML。用户点击股票调用已有研究抽屉，点击“查看完整策略研究”进入现有实验室。打开首页不采集、不发推送、不更改模拟盘、不下单。
- 未取得同日原报价、15秒原时间门禁、服务端独立核验声明时，任何普通高评分、`action:buy`、历史快照都保持“观望 / 待核验”，不能仅凭浏览器接收时间恢复可交易身份。源端声明“independently-verified”仍是**服务端自报**，浏览器未对供应商或回测收益独立审计。
- 公告标题只作为利好/利空线索，不证明公告正文、涨停因果或真实收益；缺失资金单位、原始日期或来源不计算流入额。没有事件不显示“无风险”。

## 新增测试

- `tests/fayo-market-evidence.test.js`：边界15秒、超过15秒、未来时间、缺时点、不同原始交易日、停止交易、重复行、没有独立核验、公告线索与缺风险数据。
- `tests/v6-terminal-workbench.test.js`：首页实际渲染既有日期与新闻线索、显示观望计数、首页无写请求。

推荐测试：

```sh
npm run check
node --test tests/fayo-market-evidence.test.js tests/v6-terminal-workbench.test.js tests/fayo-product-contract.test.js
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

此文档不代表本次 GitHub CI 已绿、任何生产行情源已联通、Windows/iPhone 真机已验收或部署已上线。精确提交 CI 与真实服务必须单独核验。

## 参考项目中仍需分阶段验证的能力

上游所列15种 Agent 问股、TickPlus/Tushare/Longbridge/YFinance 可选行情、SerpAPI/Anspire/Tavily/Brave/SearXNG 搜索、跨市场/多渠道推送须先和 V6 已有策略、数据来源目录、推送接口和业务门禁逐项去重并核对许可、是否收费、时区、来源、报价原始时点与网络可用性。不能把 README 声明当成 V6 实测接通。禁止未经证据验证的生产交易建议，不接券商实盘，不引入 OpenAI/ChatGPT API。

## 2026-11-19 安全修订（PR #311）

- 决策投影不再把普通 `quoteAt` / `quoteTimestamp` / `receivedAt` 推断成 `vendorQuoteAt`。没有同一股票源行明确的 `vendorQuoteAt` 则报价时点显示未知，研究标签保持观望；不从接收时间或快照日重建。
- 在展示 15 秒新鲜度前，还要求 `quoteAt === vendorQuoteAt`、可辨来源、`receivedAt >= vendorQuoteAt` 且不晚于当前时钟、服务端 `quoteStatus=recent-unverified`、上海当前日期与源报价日期及字段日期一致、非模拟/历史/导入/只读备用模式。15 秒整通过，超出或未来阻止。
- 买卖研究标签还要求服务端 `dashboard.verifiedLive === true` 及绑定股票代码、报价原时点和审核时点的审核记录。**当前实际服务端 `dashboardView` 明确返回 `verifiedLive:false`，且尚未把供应商专用 `vendorQuoteAt` 投到首页行，因而现网预期全部显示“观望 / 待核验”。这不是已经完成了供应商验证或可买卖推荐。**
- 即使未来服务端声明已核验，浏览器也不能独立认证供应商真实性；界面改为“服务端声明”，不将源端标记冒称交易所认证、实际收益或交易资格。需要另行审计上游报价解析/权限/审核产生链路，并以全量回归和真实可用性验收后才可升级 UI。
- 回归补充缺原时点、旧源时间与新接收时间冲突、未来、缺接收时点、非法顺序、错源、15秒边界、跨日、身份不匹配的研究审核以及模拟模式，保留原策略、账户、权限与交易路径不变。
