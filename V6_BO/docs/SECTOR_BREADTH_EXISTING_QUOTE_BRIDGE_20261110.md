# V6 板块强度：复用已有行情快照（2026-11-10）

## 本次接入范围
不单独增加外网行情请求：从已有 eastmoney-market-snapshot.js 的全市场快照读取 code/pctChange/vendorQuoteAt（f124），并使用操作者合法获得、在采集前冻结的行业/概念成员归属生成研究用板块广度。
- src/core/sector-breadth-market-bridge.js：bridgeExistingMarketSector(snapshot,membership,options)。
- src/core/live-market-research.js：可选 sectorMembership；复用同一市场快照，无新网络请求；没有参数时输出维持不变。
- scripts/sector-strength-research.js：once 转换已存在的私有快照；watch 每60秒（至少30秒）读取本地更新文件，不自发联网、不推送/下单。生成不可覆盖、同内容幂等的私有研究文件。

## 市场快照前置条件
marketSnapshot 使用现有代码约定：source 必须 eastmoney-clist-unverified-live，带 date、universeSize、startedAt、retrievedAt、stocks。每只 stock 有 code、pctChange 和原始 vendorQuoteAt 毫秒时间；原时间距评估时点不超过5分钟、必须与中国市场日期相同。请求时间/文件写入时间不能冒充股票原始报价时间。
行情分页采样跨度最多2分钟，全市场按原时点筛选后证券覆盖率至少80%；每板块仍需至少5只有效成员且有效覆盖率至少80%。完整 limitUp 布尔标签缺失时不把未知涨停当零，显示 partial-evidence。现有接口并未提供完整涨停标签。

## 板块成员归属输入
datedMembership 例子（演示结构，非实际行业归属；observedAt 请用已验证的中国市场交易时点 Unix 毫秒）：
  schemaVersion: 1
  source: imported
  provider: operator-authorized-classification
  classificationVersion: 2026-11-10-v1
  tradeDate: 2026-11-10
  observedAt: <采集开始前有效时点>
  sectors: [{code: BK0001, name: 示例行业, category: industry, memberCount: 5, members: [600001,600002,600003,600004,600005]}]
成员名单数量须与 memberCount 一致，每个板块代码无重复。行业和概念分开排名。不允许直接使用无时点的 stock_industry.json 或用今天成员回填历史分类；分类版本号与时间标记必须在股票行情采集开始前存在。本桥接器对外部分类许可和来源真实性尚不能独立认证。

## 研究涨幅的含义
特别注意：这里的板块涨幅是有效成员 pctChange 的算术平均（equal-weight-constituents-proxy），市场基准也是有效个股的等权涨幅（equal-weight-valid-constituents-universe）。这不是供应商发布的板块指数涨跌幅，也不是资金流、市值加权收益或资金净流入，结果必须保留 returnMethod 与 benchmarkMethod 标记。只作为同日板块强度的描述性研究。

## 使用
在 V6_BO 目录执行：
  npm run research:sector:once -- /absolute/private/market.json /absolute/private/members.json /absolute/private/research/sector.json
  npm run research:sector:watch -- /absolute/private/market.json /absolute/private/members.json /absolute/private/research/sector-archive --interval 60000
  npm run test:sector:bridge
  npm run check
  npm test
once 对已有不同结果拒绝覆盖；watch 只消费快照结束时间10分钟内、同中国交易日期的本地文件，按日期/快照结束毫秒归档，不因输入没更新而制造新行情。watch 需要由用户允许的服务器/采集进程实际启动；本次没有部署到线上，也没有给云端设置持续运行服务。

## 上线之前还缺少
1. 稳定、合规且有时点版本的行业/概念成员自动来源与冻结证据；不能把无时点 stock_industry.json 当成事实。
2. 已有全市场采集器输出可由 watch 读取的私有快照文件，并实测中国大陆环境下 f124 时点覆盖率、断线、权限、限流、停牌和法定休市日。
3. 盘中/收盘数据时点、存量历史归属、不同板涨跌停限制与真实市场基准的独立验收。
4. 冻结信号的滚动样本外、1/5/20交易日后表现、成本回撤和集中度的严谨比较。未经验证不得自动调整四套策略与学习因子权重。

本模块不修改正式排名、模拟盘、账本或自动交易，verifiedLive=false、canTrade=false；CI通过不等于数据合法性/实时性与生产部署验收。
