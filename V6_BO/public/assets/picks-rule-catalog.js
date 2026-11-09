/* Public-rule research directory. This is NOT a trade, ranking or scheduler. */
(function(root){
'use strict';
const catalog=Object.freeze([
 {id:'three-white-soldiers',name:'红三兵',family:'K线形态',status:'已存在独立历史研究',implementation:'src/strategy/a-share-patterns.js',source:'https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary',logic:'连续三根上涨实体；每日开盘位于前一日实体区间、收盘接近当日高点；需趋势背景确认',needs:'至少3根已完成 OHLC 日K线、调整一致性与交易日历'},
 {id:'bullish-engulfing',name:'看涨吞没',family:'K线形态',status:'已存在独立历史研究',implementation:'src/strategy/a-share-patterns.js',source:'https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bullish-reversal-patterns',logic:'前一日阴线、后一日阳线实体覆盖前一日实体，结合此前下跌趋势评估',needs:'历史趋势和已完成日K线、公司行为处理'},
 {id:'three-black-crows',name:'三只乌鸦 · 看跌风险',family:'形态风险',status:'已有历史风险形态研究',implementation:'src/strategy/a-share-patterns.js',source:'https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary',logic:'连续三根下跌实体且收盘靠近低位；是风险观察，不计作看涨入选',needs:'三根完整日K线和趋势背景'},
 {id:'donchian20-liquidity',name:'唐奇安20日放量突破',family:'突破与成交量',status:'已存在独立历史研究',implementation:'src/strategy/linked-factor-research.js',source:'https://backtrader.readthedocs.io/en/latest/strategies-series/en/15-breakout.html',logic:'本日已完成收盘高于此前20日最高价且本日成交量≥此前20日平均成交量1.4倍；当前K线不能参与此前最高值',needs:'至少21根已完成日K线、停牌与涨跌停核验'},
 {id:'narrow-range-expansion',name:'窄幅蓄势后放量',family:'突破与成交量',status:'已存在独立历史研究',implementation:'src/strategy/linked-factor-research.js',source:'https://www.quantconnect.com/docs/v1/algorithm-reference/universes',logic:'前10日区间收窄、本日突破并放量；同唐奇安属一类信号，不重复加权',needs:'日K、成交量、量价口径一致'},
 {id:'sector-relative20',name:'板块—个股相对动量',family:'市场联动',status:'已有研究，依赖指数板块历史',implementation:'src/strategy/linked-factor-research.js',source:'https://www.quantconnect.com/docs/v2/research-environment/universes',logic:'个股涨幅优于板块、板块优于大盘，比较同一21日窗口；无板块数据就不能判定',needs:'股票、板块、沪深主指数严格同日对齐的21根真实历史序列'},
 {id:'vnpy-boll-cci-atr',name:'布林突破＋CCI＋ATR',family:'趋势与波动',status:'已存在独立历史研究',implementation:'src/strategy/open-source-research-signals.js',source:'https://github.com/vnpy/vnpy_ctastrategy',logic:'前20日布林上轨突破＋CCI强度＋ATR波动占比＋量能确认；只研究日线适配',needs:'有效日线、真实成交量、风险状态与预热窗口'},
 {id:'vnpy-atr-rsi',name:'ATR波动＋RSI恢复',family:'趋势与波动',status:'已存在独立历史研究',implementation:'src/strategy/open-source-research-signals.js',source:'https://github.com/vnpy/vnpy_ctastrategy',logic:'Wilder RSI5恢复上穿55、价格高于20日均线且ATR22合理；只研究日线适配',needs:'足够日线预热、波动与数据时点一致'},
 {id:'opening-range-rvol',name:'开盘区间突破＋相对量',family:'盘中突破',status:'研究备选 · 尚未接入',implementation:null,source:'https://github.com/pabhijit/QuantConnectScripts/blob/main/OpeningRangeBreakoutUniverseOptions.py',logic:'以开盘前5分钟真实分钟线形成区间，上破区间高点并用同时间窗口的历史相对量确认',needs:'合法分钟行情、完整开盘交易日、历史同期分钟成交量、停牌与集合竞价口径'}
].map(item=>Object.freeze({...item,production:false,verifiedLive:false,canTrade:false,autoWeight:false})));
if(typeof module==='object'&&module.exports)module.exports=Object.freeze({catalog});
else root.V6PicksRuleCatalog=Object.freeze({catalog});
})(typeof globalThis==='object'?globalThis:this);
