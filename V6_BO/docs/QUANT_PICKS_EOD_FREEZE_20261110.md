# V6 同日选股信号冻结入口｜2026-11-10

## 现有闭环中的位置

此前的 forward-signal-observer 与 forward-tracking-cloud 可以评估和归档**已经冻结**的信号，却不能直接消费现有量化候选列表；把今天看到的候选名单套回几天前的历史收盘价是前视偏差。本批新增**离线、显式输入、只生成新文件**的门禁，把**收盘后5分钟内的选股快照**和**同日授权导入的未复权日收盘数据**转换成合法冻结研究信号。

**本项不增加 HTTP 端点、不主动拉行情或索取登录凭据、不新建选股入口、不下单、不修改账户/四套正式策略/两张主页、不发飞书。** 这只是研究基础设施；它不证明行情来源、时间戳或策略信号已经被第三方独立公证，也没有自动接入WorkBuddy。

## 严格输入条件

1. 候选JSON由现有 **GET /api/quant-picks** 在目标交易日（北京时间）**16:00以后**即时生成并保存在私有文件。必须包含原本的数值型毫秒 asOf、board、totalScanned、count、items[{code,hit:[{id,text}],hitIds}]；不能被 locked/模拟/演示标识。服务已有60秒缓存，实际使用必须保证 asOf 对应本次同日有效快照。
2. 冻结命令运行的北京时间日期必须与 asOf 日期相同，asOf 不可晚于冻结时间，差值**不得超过5分钟**；越过午夜不能补造昨日信号。
3. 另一份市场JSON必须符合原有 forward-signal-observer 的市场协议：feed.source=imported、priceBasis=unadjusted、asOf 为同一天、observedAt 在候选 asOf 之后且不晚于冻结时钟；附带正确交易日历和行情来源标识，逐票日线含同日有效收盘价、成交量和停牌标记，缺证据一律拒绝。
4. **基准价只取这一份导入市场快照的同日收盘价**，不从候选 price/pct/综合得分或其他网站猜价格；使用原 evaluateForward 的整份来源/日期/基准价一致性审查。
5. 同一股票若同时命中几个完整条件，每个命中条件都保存为独立信号ID；不可按股票代码抹掉其他条件。当前限 existing 1～6 条量化选股条件，不能把其他战法直接冒充已命中。超过500条拒绝整个操作，不截断或选表现好的样本。
6. 研究信号system写为manual（仅表示此量化候选快照的外部接入方式），cohort保留“量化选股条件N”。这不是更改现有“四套正式策略”的归属或新增交易规则。信号有效时间取候选asOf，不回填更早时间；生成后 prospectiveCertified=false，不能宣传为独立前瞻认证。

## 已有获授权数据时使用（所有路径为示例）

在既有 V6_BO 应用目录中，运行一次：

    npm run tracking:freeze:picks -- /srv/v6-private/picks-20261110.json /srv/v6-private/eod-20261110.json /srv/v6-private/cohorts/frozen-20261110.json

脚本按先读后验证、原文件只读、新文件0600、原子硬链接不覆盖的顺序执行。三个路径均须为**绝对私有路径**，拒绝public和符号链接路径；已有冻结文件会拒绝覆盖。不要把令牌、私有候选或行情输入推到 Git 仓库/聊天群。

接下来只有在同一私有持久卷上由持久研究进程使用新cohort及授权市场输入，才可执行：

    npm run tracking:once -- /srv/v6-private/cohorts/frozen-20261110.json /srv/v6-private/approved-market.json /srv/v6-private/forward/current.json

已经通过的跟踪报告会由 V6_FORWARD_TRACKING_REPORT_FILE 对接现有 /api/quant-picks 的只读详情；以后换日更新仍走以前的 single-writer/watch 安全规则。

**重要**：该候选API默认最多可返回40～50只，而不是全部命中的股票。本入口只冻结输入文件实际可见的候选及其命中条件，不得称为全市场完整样本。输入里自报的 asOf/source 字段和SHA指纹都不是独立审计签名。还需要在真正的数据采集器/可信时钟/企业服务器配置合规来源、当时留痕和安全的定时执行，才能宣称已经实现“真实自动每天冻结和跟踪”。

## 回归与安全边界

    node --test tests/quant-picks-eod-freeze.test.js
    npm run check
    npm test

测试覆盖：跨日/历史/15:59/过期/未来选股快照拒绝、模拟/锁定拒绝、同日授权未复权收盘证据、缺价/停牌/零成交、多个完整条件的独立冻结、原子防覆盖、0600文件权限、源码不触碰原主页/实盘。没有真实行情和生产 WorkBuddy 授权时，只完成隔离研究开发；绝不伪造验证收益或交易记录。
