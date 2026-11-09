# 天枢智策 · 云端选股结果中心与公开战法检索｜2026-11-09

## 入口与使用方式

- **股票结果页**：`/picks.html`。GitHub 源码路径为 `V6_BO/public/picks.html`，由原有静态服务器在部署后提供。
- 电脑首页 `/`、手机看盘 `/m`、动态顶部导航以及研究工作台 `/research.html` 都保留原功能并提供新入口“选股结果”。七项原有手机导航未删除。
- 使用已有 `GET /api/quant-picks?max=100` 读取服务端选股池（不使用 `force=1`、不触发 POST、没有委托、没有额外飞书发送）。是否由服务端在缓存过期时刷新扫描，属于现有服务端 TTL 调度逻辑，不由本页面承诺“完全不扫描”。
- 可以按名称/代码/命中理由搜索，按原顺序/分数/涨幅排序，筛选已返回命中理由或明确的风险；点股票后联动明细及 `GET /api/kline?code=...` 历史 K 线。上下滑动、手机底部导航和焦点可访问性均做了 CSS 设计；窄屏单列，宽屏结果和右侧详情双栏。
- 没有有效 API 返回时不显示假股票。401/403 则清除旧候选、旧明细和旧指标；502/网络失败才保留上次页面，并明确标注**非实时**。后端原接口的模拟/假数据标记会拒绝展示为实盘行情。
- 完整理由只显示接口真实提供的 `hit[]` / `reasons[]` / `reason` 或可核实的 `hitIds[]` 标识，不根据得分臆测哪套战法命中。缺 `sector` 不填假板块，未知风险不等于安全。双端使用同一服务端数据，刷新时保持选中股票，不自动下单、不自动发送飞书。
- 日线和独立风险来源未经交易所授权/原始时点认证时必须显示为未认证，页面请求时刻绝不能算成报价本身时点。周末盘面原始快照和新闻独立刷新规则继续生效。

## 在线检索公开战法：先比对已有，不重复接入

本批核对官方文档/公开源码，新增 **`public/assets/picks-rule-catalog.js` 研究目录**，并没有将公开规则挂到生产选股总分。以下来源均属于研究机制、不是盈利担保：

| 研究条目 | 条件/信号 | 现状与重复归属 |
|---|---|---|
| 红三兵 | 三连阳实体、后续开盘位于前日实体内、收盘靠近高点；需要背景与趋势确认 | 已有 `a-share-patterns.js`，K线形态研究 |
| 看涨吞没 | 下跌后阳线实体吞没前日阴线实体 | 已有K线形态研究 |
| 三只乌鸦 | 连续三根下跌实体、收盘接近低位 | **看跌风险，不是看涨入选** |
| 唐奇安20日放量突破 | 收盘超过此前20日最高价，当前日不加入此前窗口，量比阈值为**本地假设1.4倍** | 已有 `linked-factor-research.js`，属于突破-放量族 |
| 窄幅蓄势后放量 | 前10日区间收窄＋放量突破 | 已有，同属突破-放量族，**不得与唐奇安叠加为独立二次得分** |
| 板块—个股相对动量 | 大盘、板块、个股在**相同的21个交易日**严格对齐后才比较超额涨幅 | 已有，需要完整外部市场/板块历史，不得缺数据补零 |
| 布林CCI＋ATR / ATR＋RSI | 趋势与波动率的A股日线研究适配 | 已有独立历史研究；不是已经核实的实盘战法 |
| 开盘区间突破＋相对成交量（ORB/RVOL） | 真实开盘前5分钟K线区间及对应历史同窗口量能，上破区间高点确认 | **新加入候选目录，尚未写计算引擎**；缺免费合规分钟数据不能激活 |

来源：
- StockCharts K线字典（红三兵/三只乌鸦） https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary
- StockCharts 看涨吞没 https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bullish-reversal-patterns
- Backtrader 突破研究 https://backtrader.readthedocs.io/en/latest/strategies-series/en/15-breakout.html
- QuantConnect 选股池筛选方法 https://www.quantconnect.com/docs/v1/algorithm-reference/universes
- ORB 公开源码示例 https://github.com/pabhijit/QuantConnectScripts/blob/main/OpeningRangeBreakoutUniverseOptions.py
- 已有内部独立实现核对路径 `src/strategy/a-share-patterns.js`、`src/strategy/linked-factor-research.js`、`src/strategy/open-source-research-signals.js`。

## 不做负优化的门禁

1. 只能从已观察到且权限允许的服务端接口呈现命中；不新造“实时选股”“胜率”“收益率”“每5秒报价”。
2. 原四套正式战法及原15因子打分保持不动。上述研究目录**没有交易功能、没有策略自动晋级、没有改动模型权重**，重复研究信号须按家族去重、保留风险/负向证据。
3. 用户想要更多条件，可再提新的独立候选，但每条至少有冻结公式、数据需求、A股兼容处理、历史回测与 1/5/20/60 日期外验证；缺合法分钟级数据时 ORB 只保留研究目录。
4. 手机/电脑任何一台在线可独立查看，另端不依赖本端是否在线；真正在云端持续扫描和保存必须由已验证的云端持久化及服务端任务承担。
5. `node --test tests/picks-center.test.js` 保护静态 API/安全/策略边界。GitHub `V6 UI Browser Geometry` 使用**虚构的隔离测试数据**验证 5 档 Chrome 屏宽、卡片、滑动、K线切股、筛选、无跨站脚本和 401 清屏；原9档首页测试、V6全量测试及 V6_WEB 构建继续执行。
6. 重要限制：目前用户指定 WorkBuddy 国内写入文档接口曾返回 HTTP401，**尚不能宣称 `/picks.html` 已在线部署**。GitHub PR 通过不等于 iPhone Safari 实机交互、正式行情/飞书手机送达已经通过。

优先验收问题：实机第一页能否快速找到选股结果？划动是否无卡顿、无重叠？点击股票价格、命中原因和K线是否属于同一只证券、同一份快照？用户离开/回来、网络恢复和两端同时在线是否继续共享同一云端？
