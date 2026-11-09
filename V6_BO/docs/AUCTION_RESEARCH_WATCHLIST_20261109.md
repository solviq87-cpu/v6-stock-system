## V6竞价研究观察池（2026-11-09）

### 本批已经落地的源码
- `public/auction-picks.html` + `public/assets/auction-picks-page.js`：手机、电脑共享同一只读页面，读取既有 `GET /api/auction-resonance?board=...&max=40`；展示真实返回的共振候选、板块、评分和原始理由。由主面板、手机页、选股页与策略研究页可达。
- `src/strategy/auction-evidence-rules.js`：三项*独立研究规则*。竞价原始报价、采集时点、9:20可撤单边界、9:25实际撮合标记、前收及独立量基准均有门禁。只返回 `candidate/not_matched/insufficient_data/risk_blocked`，原四套策略和模拟盘权重保持原样。
- `scripts/auction-evidence-report.js`：研究员可对显式给出的历史逐票竞价快照生成只读 JSON 报告，不联网、不写回账户或通知。
- 权限层只新放行静态网页壳 `/auction-picks.html`，`/api/auction-resonance` 始终沿用原来的设备令牌门禁；GET 绝不附 `force=1`。

### 规则（本地假设，不是获证收益）
1. `noncancel-volume-hold`：9:20–9:25≥两次独立、至少间隔60秒的虚拟匹配量，后/前≥1.1，虚拟撮合价最大回落≤1%，此前收价的强度0.5%–6%；这是 *非真实成交量*。
2. `open-amount-confirmation`：9:25有实际撮合标记，开盘实际成交额≥300万且≥此前20日均日成交额3%，高开0.5%–3%；不可用盘中累计成交额代替。
3. `first-to-second-sector`：前日首板来源已明确核实、板块排名前5、9:25高开1%–6%、实际成交额≥500万。缺证据不符合，不推测“一进二”。
4. 统一否决风险：ST、停牌、退市、无涨跌幅限制、新股豁免；9:20前虚拟高报价明显回落；近涨幅上限不可成交。规则之间OR，一项完整成立即能进 *研究* 观察；同家族不得重复加权。

### 数据与用户查看边界
竞价共振现有接口**并不提供逐票原始竞价quoteAt和9:25真实执行成交额**。本页不能凭 existing 评分自动宣称三条新战法命中；新规则代码已经实现并可对合格的显式历史输入进行离线评估。后续生产采集器要在确认数据源许可/精确字段及云运行边界后将数据送入只读研究链，禁止用浏览器截图或接收时点填充。

离线测试：`node --test tests/auction-evidence-rules.test.js tests/auction-picks-ui.test.js`；全量 `npm test`、web构建、HTTP路由、九种viewport自动检查由GitHub Actions执行。

### 后续验收仍待
实际盘中多时点真实样本、9:25原始成交证明、完整历史样本外回验、真机UI与参考原图逐图对齐、WorkBuddy部署和飞书实际送达仍未完成。本批不接券商实盘、不改主模拟盘、不触发新增飞书消息。