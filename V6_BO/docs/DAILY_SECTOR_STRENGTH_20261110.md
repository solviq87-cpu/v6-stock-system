# V6 同日板块强弱与个股参与度研究（2026-11-10）

## 目的
解决“板块涨得多，但可能仅有两只龙头拉升”的误判。使用板块涨幅、成员上涨广度、中位数涨幅、领涨集中度与可选涨停标记评估同日板块研究热度。

## 借鉴案例（仅参考思想，未复制第三方代码）
- https://github.com/simonlin1212/vibe-astock ：涨停股行业聚集、跨日题材延续。本批只实现同日聚集观察，跨日连续性尚未实现。
- https://github.com/wenyuanw/a-share-heatmap ：行业内部涨跌分布和多周期热力观察。本批只实现同日统计。
- https://github.com/akfamily/akshare ：行业/概念板块和成分股数据接口可作为未来适配来源。尚未接通或验证生产许可。

## 实现位置
- src/strategy/daily-sector-strength.js：evaluateDailySectorStrength(snapshot,{asOf,tradeDate,maxAgeMs})；纯函数，无网络，无写盘。
- src/core/research-explanation-projection.js：可选传入 market.sectorBreadthSnapshot；返回 dailySectorStudy 和个股 rationale.dailySectorStrength；缺少输入时保留旧接口。
- public/assets/complete-workbench.js：历史研究结果按行业和概念分别展示前五名，以及个股对应的板块参与度；不修改锁定的 index.html 和 mobile.html。

## 输入要求
快照需有 source='imported'、非模拟 provider、tradeDate (YYYY-MM-DD)、observedAt (Unix毫秒)、marketChangePct（同日市场基准的百分数）、sectors 数组。
每个 sector 需有 code、name、category（industry 或 concept）、source、tradeDate、observedAt、changePct、memberCount、stocks 数组。
每个 stock 需有 symbol（六位代码）、source、tradeDate、observedAt、changePct；可传 tradingStatus='trading' 或 tradingStatus='halted' 且 changePct=null；可选 isLimitUp 布尔值。
示例：历史研究传 market.sectorBreadthSnapshot = {source:'imported',provider:'licensed-provider',tradeDate:'2026-11-10',observedAt:1794289800000,marketChangePct:0.2,sectors:[...] }；省略成员详情的示例**不能计算排名**，数字不代表当日真实行情。
全字段需来源同一、日期同一、时间不超前也不超过20分钟。单个板块至少5个有效交易股票，且有效股票数/成员总数≥80%；每个同类至少3个有效板块才能显示排名。无报价、停牌不得填0冒充涨跌。
历史研究的成分股名单应冻结为信号当日已知归属，不能用未来成分股回填。概念与行业存在重叠，不跨分类直接比较排名。

## 公式及限制
- 上涨广度=上涨股票数/有有效行情的股票数；统计上涨、下跌、平盘、停牌数、成分股中位涨幅。
- 龙头集中度=正涨幅最高两只股票的涨幅和/该板块全部正涨幅之和；这是等股票的涨幅贡献近似，不是市值或主力资金贡献。
- 初始研究权重：板块涨幅30%、上涨广度25%、中位涨幅20%、相对市场涨幅15%、涨停密度10%。涨停证据不全则省略该因子、重新归一化并标 partial-evidence，不把缺失视为零涨停。
- 龙头集中度≥70%时研究评分扣12分。初始规则只产生 broad-strength、leader-concentrated、developing-strength、weak、mixed 标签；阈值尚未历史校准。
- 排名只代表本次导入、满足覆盖要求的同类板块样本，不代表全市场强度；既不证明个股上涨因果，也不等于资金净流入或实盘建议。

## 运行边界与后续工作
本轮不自动采集实时行情，不声称2026-11-10实际板块排名，也不接实盘或自动买卖，不改原四套策略、选股评分、模拟盘和自动学习权重。先验收可授权数据源、成分股覆盖率、停牌与不同板涨停规则、接口限频、盘中/收盘准确时点；随后冻结因子做滚动样本外和极端行情验证，才可讨论模型进化。

## 验证命令
cd V6_BO
node --check src/strategy/daily-sector-strength.js
node --test tests/daily-sector-strength.test.js tests/sector-cohort-rps.test.js
npm run check
npm test

GitHub PR CI 与正式部署、供应商许可、真实手机推送验收是独立事项。
