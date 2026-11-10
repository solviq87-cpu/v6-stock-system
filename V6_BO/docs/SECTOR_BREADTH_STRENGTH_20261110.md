# V6 当日强势板块：涨幅 × 成分股广度研究（2026-11-10）

## 对照的公开方法
- AKShare 东方财富行业板块及成分股：板块涨跌幅、上涨/下跌家数、个股涨跌幅。只借鉴字段/思路，不复制抓取逻辑：https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_board_industry_em.py
- emaiqi/a_stock_data 的行业板块排名模型：将板块涨幅与上涨/下跌家数并列：https://github.com/emaiqi/a_stock_data
- StockLibs 以当日涨幅、近5日涨幅、成交额三维展示板块轮动。本批不虚构5日数据：https://stocklibs.com/cn/sectors/map?kind=all

## 本批新增：研究层，不改正式策略
- 新增 src/core/sector-breadth-strength.js 纯函数 evaluateSectorBreadthStrength。行业、概念各自分组排名。
- 只采用同日、有显式来源、近5分钟逐股原始供应商时点的快照；市场及板块成分股覆盖率均至少80%。缺信息不补零；拒绝未来、旧日、来源冲突、成员重复。
- 统计成分股上涨比例、涨幅中位数、相对全市场股票中位涨幅、涨幅≥2%个股占比；前三名个股正涨幅占比用于辨识狭窄领涨。前三名正涨幅占比不是成交额、市值集中度或真实资金流入。
- 研究评分（尚未做样本外验证）：0.35×上涨家数占比 + 0.30×裁剪(50+15×中位超额百分比) + 0.20×裁剪(50+10×中位涨幅) + 0.15×涨幅≥2%家数占比 − 顶部集中度惩罚（最多8分），分数裁剪到0–100。
- 板块涨幅正而成分股上涨家数<50%或中位涨幅≤0时标 narrow-led，不能冒充普涨。板块涨幅正、上涨比例≥60%、成分股中位涨幅正且超过市场中位、评分≥70时才标 broad-leading；阈值纯研究假设。
- 原 live-market-research.js 仅当显式传 sectorObservation 时额外返回 sectorStrengthStudy；没有该字段时原API响应保持不变。评分结果不更改正式选股、学习权重、风控、模拟盘或任何交易系统。

## 数据接口与使用
输入 {snapshot, sectorObservations, asOf}。snapshot 参考既有 fetchEastmoneySnapshot 输出：date、source、universeSize、stocks:[{code,pctChange,vendorQuoteAt}]；vendorQuoteAt 单位毫秒，须来自可校验的原始 f124，不得用 retrievedAt 代填。

sectorObservations 为经明确授权且已取到的板块及成分关系记录：{tradeDate,source,observedAt,sectors:[{kind:'industry'|'concept',code:'BK1001',name,source,tradeDate,observedAt,changePct,totalMembers,memberCodes:['000001',...]}]}。一个概念可能覆盖多个行业股票，不能跨板块累加涨幅。

CLI：node scripts/sector-breadth-strength.js /绝对路径/board-observation.json。输入JSON最大8MiB，显式传asOf（Unix毫秒）；CLI只读并输出JSON，不启动外部请求或自动推送。不从股票涨幅猜想其行业/概念归属。供应商原始时点不等于交易所认证实时性。

## 验收
专项：node --test tests/sector-breadth-strength.test.js tests/live-market-research.test.js
全量：npm run check && npm test

后续须做真实同源板块成员采集/日期权限验证、5日趋势及成交额相对历史基线、样本外验证、开盘前休市降级和双端只读显示。本批不声称已连接今日真实板块排名，未修改两份锁定主页（public/index.html、public/mobile.html）、四套正式策略、资金写入器；本PR可直接回滚。
