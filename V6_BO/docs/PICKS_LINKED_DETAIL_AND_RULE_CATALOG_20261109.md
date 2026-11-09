# 天枢智策「选股结果」页面联动与公开战法研究｜2026-11-09

## 进入页面，不需要寻找聊天记录

- **唯一结果入口：** `/picks.html`，源码 `V6_BO/public/picks.html`。这个页面已先由 PR #40 合并到 `dev`，**不要再创建第二个同名页面覆盖它**。
- 手机 `/m` 与电脑 `/` 均通过首页导航访问“智能选股”；原手机七项导航、旧研究 `/research.html`、回测与模拟盘入口必须保留。
- 结果来自现有 `GET /api/quant-picks?board=...&max=40`；仅展示原接口的候选及 `hit`/ `reasons` 真实文本，不以分数推断战法命中，不用示例数据填池。
- 本次在原卡片上增加**“查看K线与命中依据”**；用户点股票会发内部只读事件 `v6:picks-select`，在本页新详情区展开**同一只证券**的真实已返回理由、快照价格、风险来源、原始报价时点状态与 `GET /api/kline?code=...` 的日K线。切股立即中止上一只的在途请求，防止图表串票。使用 `textContent` 渲染所有不可信业务文本。
- 界面保持完整纵向滚动，点击后平滑滚到详情；用户系统设置“减少动态效果”时不强迫动画；电脑保留原选股卡双列、手机变单列、底部七项不被遮挡。
- 401/403及 `locked` 清空原候选、总数、交易日和已选股票详情；网络临时失败仍沿用原代码“上次快照（非实时）”策略。
- **周末盘面冻结、新闻公告继续更新**的原规则没有改；网页刷新不等于报价实时，不能触发模拟成交/飞书重复推送。

## 规则目录和证据边界

`public/assets/picks-rule-catalog.js` 作为**单独的公开战法研究目录**，把已实现的历史日线规则和未接入的备选拆开；不是新的实盘策略列表，也不将研究信号转化成今天选中的股票。

- **红三兵 / 看涨吞没 / 三只乌鸦**：已有 `src/strategy/a-share-patterns.js`。三只乌鸦归看跌风险；需完成交易日K线、背景趋势与复权核验。参考 [StockCharts 蜡烛图形态字典](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary)。
- **唐奇安20日放量突破 / 窄幅蓄势放量**：已有 `src/strategy/linked-factor-research.js`，都是突破量能族，**不能同族重复加分**。唐奇安取此前20日最高值，禁止把当前K线算进突破门槛；阈值1.4倍是V6本地假设。参考 [Backtrader 突破研究](https://backtrader.readthedocs.io/en/latest/strategies-series/en/15-breakout.html)。
- **大盘—板块—个股20日相对动量**：已有独立历史研究；21根完整严格同日K线，没有板块或指数就标未知。参考 [QuantConnect 选股宇宙](https://www.quantconnect.com/docs/v1/algorithm-reference/universes)。
- **布林CCI+ATR / ATR+RSI**：已有 `src/strategy/open-source-research-signals.js` 的A股日线只读研究变体，不继承原分钟线策略的真实收益。参考 [vn.py CTA](https://github.com/vnpy/vnpy_ctastrategy)。
- **开盘区间突破+相对成交量 ORB/RVOL**：仅新增“**研究备选尚未接入**”目录信息。需持牌/合法分钟级原始行情、交易日/竞价口径及历史同时间段成交量，不能凭日线模拟盘中触发；不得改动四套正式策略或发盘中飞书。

所有条目 `production=false`、`verifiedLive=false`、`canTrade=false`、`autoWeight=false`，且原有15因子、四套正式战法、权威模拟账户及真实交易隔离保持不变。增加任何战法之前需冻结公式、样本外评估、公司行为与A股涨跌停/T+1处理；别把“多规则命中”解释成多份独立证据或已认证盈利。

## 测试与仍未完成的现场条件

- `node --test tests/picks-enhancement.test.js` 检查不覆盖已合并的原页面、只读接口、来源、命中说明和权限守门。
- GitHub `V6 UI Browser Geometry` 新增 `scripts/ui-picks-extended-browser-check.js`：隔离测试数据 + 真 Chrome 六种屏宽 320/375/390/430/1024/1536，验证页面可滑、候选切股K线、风险、XSS无执行、401后清空与 GET-only，同时原九档首页几何仍跑。
- **当前不能声称** WorkBuddy 新服务已经部署、iPhone Safari 真实设备已验收、飞书终端已送达、今日实时选股持续有效。指定 WorkBuddy 写入文档曾返回401，需经过有效权限及现场校验才能对外提供真实已更新链接。

本批仅基于已合并的 `dev` 当前分支增加功能；旧 PR #41 未合并且已关闭，避免它覆盖 PR #40 同名页面。若以后接手先读本文件与仓库 AGENTS 规则。
