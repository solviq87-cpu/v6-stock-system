'use strict';
// Independently authored A-share DAILY research adaptations of public factor ideas.
// No cloned upstream code, no live feed or orders, no weight/learning changes.
const catalog=Object.freeze([
 {id:'donchian20_liquidity',label:'唐奇安20日放量突破',
  family:'breakout-volume',minBars:31,
  source:'https://github.com/JamesRPowell/Donchain-Breakout',
  concept:'Prior-window highs are shifted to exclude the current bar; volume confirms breakout'},
 {id:'narrow_range_expansion',label:'窄幅蓄势后放量启动',
  family:'breakout-volume',minBars:31,
  source:'https://github.com/quantopian/zipline/blob/master/zipline/pipeline/factors/basic.py',
  concept:'Window-based price range, realized volatility, and average volume combined as independent research conditions'},
 {id:'sector_market_relative20',label:'大盘—板块—个股20日相对动量',
  family:'market-sector-relative',minBars:31,
  source:'https://github.com/pmorissette/bt/blob/master/bt/algos.py',
  concept:'Relative momentum requires aligned external market and sector series, not a fabricated benchmark'}
].map(row=>Object.freeze({...row,validatedPerformance:false})));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const avg=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
const round=x=>finite(x)?Number(x.toFixed(5)):null;
function validDay(d){
 return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
}
function badBars(bars){
 if(!Array.isArray(bars)||bars.length<31||bars.length>10000)return '缺少至少31根历史日K线';
 let prev='';
 for(const b of bars){
  if(!b||!validDay(b.date)||b.date<=prev||
     ![b.open,b.high,b.low,b.close,b.volume].every(finite)||
     b.open<=0||b.low<=0||b.high<Math.max(b.close,b.open,b.low)||
     b.low>Math.min(b.open,b.close)||b.close<=0||
     !Number.isSafeInteger(b.volume)||b.volume<0||b.complete===false)
   return '历史K线存在缺价、无效日期、未完成交易日或重复时点';
  prev=b.date;
 }
 return null;
}
function contextReturns(input, bars){
 const missing=reason=>({status:'insufficient_data',reason,metrics:null});
 if(!input||input.schemaVersion!==1||input.source!=='imported'||
     !validDay(input.asOf)||input.asOf!==bars.at(-1).date||
     !input.market||!input.sector||!['shanghai','shenzhen','chinext'].includes(input.market.id)||
     typeof input.provider!=='string'||!input.provider.trim()||input.provider.length>120||
     typeof input.sector.name!=='string'||!input.sector.name.trim()||input.sector.name.length>80)
  return missing('缺少有效的同日市场指数与板块来源信息');
 const dates=bars.slice(-21).map(b=>b.date);
 const data={};
 for(const [key,row] of [['market',input.market],['sector',input.sector]]){
  if(!Array.isArray(row.bars)||row.bars.length!==21||row.source!==input.provider||
     row.simulated===true)return missing('市场或板块历史序列来源不一致或长度不足');
  for(let i=0;i<21;i++){
   const x=row.bars[i];
   if(!x||x.date!==dates[i]||!finite(x.close)||x.close<=0)
    return missing('指数、板块与个股的21个交易日未严格对齐');
  }
  const start=row.bars[0].close,end=row.bars.at(-1).close;
  data[key]=round((end/start-1)*100);
 }
 const stockReturn20Pct=round((bars.at(-1).close/bars.at(-21).close-1)*100);
 return {status:'imported-unverified',reason:'历史研究外部来源声明，未独立核验真实性',
  metrics:{stockReturn20Pct,marketReturn20Pct:data.market,sectorReturn20Pct:data.sector,
   sectorExcessOverMarketPct:round(data.sector-data.market),
   stockExcessOverSectorPct:round(stockReturn20Pct-data.sector)},
  provider:input.provider,asOf:input.asOf,marketIndex:input.market.id,sectorName:input.sector.name};
}
function evaluateLinkedResearch(stock={}, {marketContext,marketRisk='unknown'}={}){
 const bars=stock.bars,err=badBars(bars);
 const last=Array.isArray(bars)?bars.at(-1):null;
 const common={schemaVersion:1,mode:'additional-factor-research',symbol:String(stock.symbol||stock.code||''),
  asOf:validDay(last?.date)?last.date:null,canTrade:false,verifiedLive:false,
  weightsChanged:false,autoPromotion:false,
  marketRisk:['risk_on','risk_off','neutral'].includes(marketRisk)?marketRisk:'unknown'};
 const stopped=(status,reason)=>({...common,factors:[],strategies:catalog.map(rule=>({
  id:rule.id,label:rule.label,family:rule.family,source:rule.source,
  status,eligibleForResearch:false,reasons:[reason],metrics:{},validatedPerformance:false}))});
 if(err)return stopped('insufficient_data',err);
 if(stock.isST===true||stock.suspended===true||stock.isDelisting===true||stock.noPriceLimit===true||
    stock.tradable===false||last.isST===true||last.suspended===true||last.isDelisting===true||
    last.noPriceLimit===true||last.tradable===false||last.volume===0)
  return stopped('risk_blocked','ST、停牌、退市风险、无价格限制或零成交不生成新研究信号');
 const p20=bars.slice(-21,-1),p10=bars.slice(-11,-1);
 const priorHigh20=Math.max(...p20.map(x=>x.high)),
   priorHigh10=Math.max(...p10.map(x=>x.high)),priorLow10=Math.min(...p10.map(x=>x.low));
 const volAvg20=avg(p20.map(x=>x.volume)),volAvg10=avg(p10.map(x=>x.volume));
 const volumeRatio20=volAvg20>0?last.volume/volAvg20:null;
 const volumeRatio10=volAvg10>0?last.volume/volAvg10:null;
 const compressionPct=100*(priorHigh10-priorLow10)/Math.max(priorLow10,1e-9);
 const daily=p20.map((b,i)=>i?p20[i].close/p20[i-1].close-1:null).filter(x=>x!==null);
 const variance=avg(daily.map(x=>(x-avg(daily))**2));
 const realizedVolatility20Pct=100*Math.sqrt(variance);
 const stockReturn20Pct=100*(last.close/bars.at(-21).close-1);
 const linked=contextReturns(marketContext,bars);
 const m=linked.metrics;
 const conditions=[
  {id:'donchian20_liquidity',metrics:{priorHigh20:round(priorHigh20),close:last.close,
    volumeRatio20:round(volumeRatio20),stockReturn20Pct:round(stockReturn20Pct)},
   checks:[['收盘价突破此前20日最高价',last.close>priorHigh20],
    ['成交量达到此前20日均量1.4倍',volumeRatio20!==null&&volumeRatio20>=1.4]]},
  {id:'narrow_range_expansion',metrics:{priorHigh10:round(priorHigh10),
    priorRangePct:round(compressionPct),volumeRatio10:round(volumeRatio10),
    realizedVolatility20Pct:round(realizedVolatility20Pct)},
   checks:[['此前10日最高价与最低价区间不超过8%',compressionPct<=8],
    ['当日收盘突破此前10日最高价',last.close>priorHigh10],
    ['成交量达到此前10日均量1.3倍',volumeRatio10!==null&&volumeRatio10>=1.3]]},
  {id:'sector_market_relative20',metrics:m||{},
   missing:linked.status!=='imported-unverified',
   checks:m?[['个股20日涨幅至少5%',m.stockReturn20Pct>=5],
    ['板块20日表现领先大盘至少2个百分点',m.sectorExcessOverMarketPct>=2],
    ['个股20日表现领先板块至少2个百分点',m.stockExcessOverSectorPct>=2]]:[]}
 ];
 const factors=[
  {id:'ret20',label:'20日动量',family:'momentum',value:round(stockReturn20Pct),unit:'%',status:'derived-historical'},
  {id:'vol20',label:'20日已实现日波动',family:'volatility',value:round(realizedVolatility20Pct),unit:'%',status:'derived-historical'},
  {id:'volume_ratio20',label:'今日/前20日成交量比',family:'liquidity',value:round(volumeRatio20),unit:'倍',status:volumeRatio20===null?'unknown':'derived-historical'},
  {id:'donchian_gap20',label:'相对前20日最高价距离',family:'price-breakout',value:round(100*(last.close/priorHigh20-1)),unit:'%',status:'derived-historical'},
  {id:'sector_excess20',label:'板块相对大盘20日超额',family:'sector-relative',
   value:m?.sectorExcessOverMarketPct??null,unit:'%',status:m?'imported-unverified':'unknown'}
 ];
 return {...common,factors,contextEvidence:linked,strategies:conditions.map(row=>{
  const rule=catalog.find(x=>x.id===row.id);
  const status=row.missing?'insufficient_data':row.checks.every(pair=>pair[1])?'candidate':'not_matched';
  return {id:rule.id,label:rule.label,family:rule.family,source:rule.source,status,
   eligibleForResearch:status==='candidate',validatedPerformance:false,metrics:row.metrics,
   reasons:row.missing?[linked.reason]:row.checks.map(([name,pass])=>(pass?'通过：':'未通过：')+name),
   marketWarning:common.marketRisk==='risk_off'?'市场弱势下仅保留研究观察，不改变正式风控':null};
 })};
}
module.exports={catalog,evaluateLinkedResearch};
