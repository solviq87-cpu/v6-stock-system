# V6 20261106bn：选股列表和风险展示的报价原时点

## 基线

唯一基线为 V6_1075_full_20261106bm.zip，SHA-256：232c27ba263655c88c24bbaede7dd0457a0f032c4cd22a55ae9cab4583a2af65。本轮已实际校验，保留此前权威账本和模拟盘成交15秒原时点门禁。

## 本批发现及修改

- 风险展示原来主要用 stocksAt 判断A股行情新鲜度；新收到的整张列表不能证明每行报价新鲜。现增加 marketQuotes：按逐行来源、有限正价格、原始安全整数时点统计 recent/stale/future/unknown；15秒内也仅为 recent-unverified，持续保留 verifiedLive=false、canTrade=false。缺行或原时点未齐时明确列出风险原因。marketReceivedAt 仅表示列表接收时间。
- 新增 src/core/quote-observation-view.js，供风险视图与 dashboardView 复用。候选行只取该行自己的 quoteAt/quoteSource，绝不从同代码但价格可能不同的全A行或执行缓存借用时间。
- 双端共用 terminal-dashboard.js 的表头改为“快照价”，逐行和所选股票显示上海时区原始时间；缺来源/时点写“报价时点或来源未知”，未来时点写“报价时点异常”。顶部时间明确为“列表接收”，不会把列表新收到当逐票新报价。
- 所选股票在后续数据更新时同步显示候选池当前价格，避免K线详情旁一直保留第一次选中的旧价。该更新不重复请求K线；股票离开当前候选池则显示“当前候选池无报价”。权限丢失和K线请求竞态保护沿用原行为。
- 五处应用/缓存统一bn，同时修正共用仪表盘侧栏停留be的版本文字。

## 验证

新增 quote-observation-view.test.js 五项，覆盖15秒边界、异常来源/时点/价格、不得从其他价格借用来源时间、列表接收不能掩盖逐票旧价、再次投影时过期与顺序/价格保留。terminal-dashboard.test.js 新增三项，覆盖未知时点提示、所选快照随数据变化且不重拉K线、未来时点提示。

定向25项通过，0失败/跳过/取消；npm run check与新增模块/前端脚本语法检查通过。DOM控制器测试验证状态和文本行为，未作实体手机或截图像素验收。首次全量1082/1083通过：原stock-provider-links测试只截取select函数，未同时加载新增selectedQuote/quoteDescription，出现ReferenceError。已让夹具加载同一前端源码的真实依赖函数，保留原切股、失败与竞态断言，未修改产品门禁。首轮失败日志保留为display-quote-time-full-20261106bn.tap/.exit；最终全量日志使用display-quote-time-release-full-20261106bn.tap/.exit。全量与独立解压副本的最终结果见CHAT_HANDOFF及本批TAP/exit日志。

## 仍待

- 本批覆盖共用仪表盘及风险展示投影，不宣称所有旧页面、研究、信号生产和价格消费者都完成审核。
- 候选池上游未携带逐票原时点时继续显示未知；本轮没有根据接收时间补造，也没有把其他快照的时间嫁接给候选价。后续应逐个审核上游生产者对价格与来源/时点的绑定。
- 现有指数、板块、跨市场数据的逐项原始时点、资金流缺失语义与展示估值仍待继续治理。数值展示不等于来源认证或真实可成交。
- 原220只监控容量、目标机交易时段连续更新/限频/许可、真实新闻、样本外概率、持仓闭环、短信OTP、实体手机、长期云端、第二机器灾备及策略效果仍未现场验收。

本轮未修改四套策略规则、排序、账户历史或角色配置，未购买服务、部署云端或接入券商。测试数不能换算整个工程完成率。

## 运行

先读AGENTS.md、integration/CHAT_HANDOFF.md。Node22.6+、Python3、Linux flock，ML解释器需有sklearn/numpy：

```sh
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/display-quote-time-release-full-20261106bn.tap
npm run check
npm start
```

双端共用脚本，无新增端点或后台定时采集器。

## 最终验证

发布核验：最终主工程与独立解压副本均1083通过、0失败/跳过/取消、退出0，两份TAP完整性核验通过。1092个JS/HTML/CSS/Python源码逐字节一致，之后只补交接及验证记录。

最终完整性日志为 display-quote-time-release-full-20261106bn.tap/.exit 和 display-quote-time-release-clean-20261106bn.tap/.exit。收尾同步所选价格涨跌色后再次全量复测，先前全量与解压副本记录继续保留。
