# 机会查看时效：本地到期重绘（候选，未部署）

本批沿原 #562、父 `6ba43926503fe8e61d4d56bad6e07da53e9e9496`，限定深化 F13.2 / F23.4 的查看时效。总管 dev `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`，冻结计划回访继续复用 #566/#567，不新建机会状态、报价、账户或审批系统。精确最终提交从 Git 与统一台账 #574 读取。

## 问题、修改及消费

原生机会卡和个股抽屉保留原始价格/来源是正确的，但在原报价未前进、网络断开而停止轮询时，旧的“原始报价”和仍显示的“可关注”结论可能不重绘。修前原服务三屏宽对照均复现，记录 `before/browser.json`；这不是发现后台执行门禁被绕过。

- 复用 `public/nova/ui.js` 新增一个按视图管理的本地单次到期回调。页面隐藏时清理计时，恢复后只重绘逾期内容；会话撤销后清理，历史/缺失/无待到期数据不循环。
- 原全部候选、系统精选和普通股票池在现有绘制函数内登记可见报价截止；个股抽屉绑定实际已显示的原报价及原后台结论时点。15,000ms 仍属原边界，15,001ms 触发本地重绘。
- 抽屉只更新原来源标签与原 `stockConclusion` 投影，不读取新报价、不改原价格或来源、不延长有效期。原 `decision-model.mjs` 继续拒绝过期结论。到期回调跳过可能发起读取的雷达/联动刷新。
- 普通刷新仍可接收合法新报价；固定来源、同股/同日、迟到结果和独立执行门禁沿用。没有调度选股、发送通知、训练模型或签发交易资格。

消费者就是当前原生机会卡、股票池及个股研究抽屉，不增加菜单。本批不代表全机会池生命周期、当前价格价值评价、真实推送/手机或前向净价值已完整验收。已有部分证据深化，总账数量不增加。

## 实际验证

- 新增5项时间行为专项：15秒边界、隐藏/离线恢复、原截止不续期、新观察替换、关闭/撤权及无效时间无循环。
- 关联69项，内核禁止建立网络连接的38项，均通过；包含原轮询、候选合并、原报价投影、板块上下文及逐股时点门禁。`node --check` 与原 `npm run check` 通过。
- 本批源完整原生回归8134/8134，零失败/跳过/取消，157543ms；源码指纹及原始日志哈希见 `full-summary.json`。提交前工作树的代码哈希与浏览器回执相同，组合及正式CI另验，不使用父版本绿灯。
- 原 `createFixture` 服务，原身份认证，原 PC `/` 和手机 `/m`，实际 Chromium 1366/390/320 三屏宽通过。金融输入为**隔离合成**：10.00元、原时点10:00:00及只供显示的“可关注”结论。断网后15,000ms不提前改为历史，15,001ms同时变为历史/原结论待核验；原价格/时点不变。该到期步骤新增 API 请求为0，关闭抽屉后不复活，页面无错误/横向溢出。
- 截图为实际运行的隔离软件，**不是实盘、真实行情、真机或中国大陆实际线路验收**。临时账户路径未新增/修改文件；本用例没有真实持仓，不能据此声称完整账本已专项验收。完整回归中的原账户/风控测试独立保留。

## 复现

在 `V6_BO` 使用已有依赖，不重装：

```sh
node --test tests/fayo-view-expiry.test.js tests/fayo-simple-picks.test.js tests/fayo-polling.test.js tests/quote-observation-view.test.js tests/decision-sector-context.test.mjs tests/decision-sector-context.test.js tests/phase4-decision-current-quote-lineage.test.js
python tests/helpers/deny-network-connect.py node --test tests/fayo-view-expiry.test.js tests/fayo-simple-picks.test.js tests/fayo-polling.test.js tests/quote-observation-view.test.js tests/decision-sector-context.test.mjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-expiry-replay node ../docs/validation/fayo-view-expiry-20261128/native.cjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-expiry-parent FAYO_EXPIRY_BASELINE=1 node ../docs/validation/fayo-view-expiry-20261128/native.cjs
npm test
```

`python` 需使用已安装 Playwright 的运行环境，浏览器固定 `/usr/bin/chromium`；原生完整回归继续用既有 PowerShell/本地模型环境。基线模式仅替换一次性服务副本的两个 UI 文件至上述精确父提交，没有写回源码或生产节点。原服务拒绝外网，浏览器仅允许同源。回调不依赖网络；实时数据仍须合法来源。

## 限制与回退

这是有界的显示时效修补，不设新的收益预测/机会期限，不以本地计时替代原服务器审批。后台休市、缓存、风险、账本和15秒执行报价代码未变。真实手机、Windows/WSL、大陆网络、合法实时行情、长期前向收益/体验及总管签收仍待。组合测试和正式 CI 按精确提交另登记。

回退限本批源码版本，保留全部新账本及研究历史。只可由原总管沿唯一发布机制集成/发布；本批没有合并 dev 或部署。
