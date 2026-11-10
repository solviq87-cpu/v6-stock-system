# V6 板块研究：显式授权单次行情采集 → 日度/轮动归档

> 2026-11-10。仅新增受控研究采集能力；**不宣称供应商许可已验证、不连接真实券商、不自动推送、不启用持续抓取**。公开来源也可能存在限流、商用许可和稳定性约束，须在实际部署时核查。

## 复用已有链路
`src/core/eastmoney-market-snapshot.js`（全市场分页采集、`f124` 逐票原时间）→ BaoStock 行业冻结验证 → `sector-breadth-market-bridge`（已获得快照的行业强度代理）→ `sector-daily-chain`（不可变私有存档）→ `sector-rotation-history`（3/5 交易日轮动）。不再为板块额外发第二路行情请求，也不把等权代理称作供应商正式板块指数。

## 运行方式（在 V6_BO 目录）
先由操作者合法取得当日 BaoStock 分类导出文件，并准备明确的 A 股交易日列表。`raw` 在全市场行情采集开始**之前**已冻结，不能用行情结束后的分类回填。交易日历示例：
```json
{"source":"imported","tradeDates":["2026-11-06","2026-11-09","2026-11-10"]}
```
这是协议测试示例，不能替代实际交易所交易日历或数据商授权。

只读预检（完全不联网、不写文件）：
```sh
node scripts/sector-market-capture.js preview /srv/v6-private/industry-raw.json /srv/v6-private/trade-calendar.json /srv/v6-private/sector-research
```
确认供应商使用许可与网络限频之后，**每次显式**单次采集：
```sh
node scripts/sector-market-capture.js collect /srv/v6-private/industry-raw.json /srv/v6-private/trade-calendar.json /srv/v6-private/sector-research --allow-research-fetch
```
只允许运行于显式交易日历最后一天、北京时间 09:35–11:30 和 13:05–15:00；周末拒绝，但不声称仅靠星期能识别所有法定休市日。至少60秒间隔，采集结束与请求时间匹配，供应商 `f124` 原始时间超过5分钟/缺失时拒绝纳入强弱排名；市场快照覆盖和行业分类覆盖均须≥80%、至少3组完整可比行业。

通过后分别只写私有：
```text
sector-research/
  snapshots/YYYY-MM-DD/<快照采集结束毫秒>.json
  members/YYYY-MM-DD/<快照采集结束毫秒>.json
  sector-archive/YYYY-MM-DD/<快照采集结束毫秒>.json
  rotation-archive/YYYY-MM-DD/<快照采集结束毫秒>.json
```
文件不可覆盖、权限0600、按时点索引，同样内容重放不另写；输出根目录禁止位于公开静态目录，不接受符号链接。`collect` 持单实例锁，断线/分页失败保留原始错误阶段但不发布伪行情。采集中分类或日历被修改则中止，不把 `request time` 冒充原报价时间。

## 故障处理
如果快照已落盘，但后续成员冻结或轮动存档发生冲突，**保留已写入的不可变快照**；请先检查故障和私有记录，然后使用已有 `sector-daily-chain.js preview|apply` 对该快照独立重放，不需要为了恢复去再次抓取网络。原始同日不同快照有独立文件身份，不允许同路径冲突覆盖。旧数据、停牌和缺失数据不被补0或视作实时行情。

## 自动化边界与优先下一步
这次只是把“取得新行情”接到现有板块研究链的**可运行、显式授权**入口，没有启动云端调度器、常驻服务或真实外网采集验收。持续定时采集需明确供应商授权、交易所/假期交易日历、合规访问频率、费用、异常熔断和监控日志。供应商 `f124` 是供应商自报时点，不是交易所认证；过去已冻结的板块研究仍需做3/5日趋势和1/5/20日样本外效果校验，不能据此调正式四套策略或模拟盘下单。

专项离线测试：
```sh
node --test tests/sector-market-capture.test.js tests/sector-daily-chain.test.js tests/sector-rotation-history.test.js
npm run check
npm test
```
全部样例为构造的数据，不代表 2026-11-10 真正 A 股强势板块。锁定的 `public/index.html` 与 `public/mobile.html` 完全不变。
