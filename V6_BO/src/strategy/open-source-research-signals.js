'use strict';
// Independent, deterministic A-share DAILY research adaptations of public rule ideas.
// No upstream code is copied. No orders, optimized thresholds or verified earnings.
const catalog=Object.freeze([
 {id:'vnpy_boll_cci_atr',label:'布林突破+CCI+ATR（日线研究）',
  source:'https://github.com/vnpy/vnpy/blob/master/docs/community/app/cta_strategy.md',
  sourceConcept:'vn.py CTA uses Bollinger bands, CCI and ATR on intraday futures',
  adaptation:'A股日线仅观察：收盘上破此前20日布林上轨、CCI14>100、放量且ATR14适中；不做空、无委托',
  minBars:31,validatedPerformance:false},
 {id:'vnpy_atr_rsi',label:'ATR波动+RSI5恢复（日线研究）',
  source:'https://github.com/chenzj810/vnpy-stock/blob/master/docker/dockerTrader/ctaStrategy/strategy/strategyAtrRsi.py',
  sourceConcept:'Historical ATR-RSI futures strategy, not an audited stock-return source',
  adaptation:'A股日线仅观察：RSI5由≤55上穿55、收盘高于20日均线、ATR22波动占比适中；不做空、无委托',
  minBars:31,validatedPerformance:false}
]);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
const round=x=>finite(x)?Number(x.toFixed(5)):null;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
function dataError(bars){
 if(!Array.isArray(bars)||bars.length<31||bars.length>10000)return 'K线少于31根或超过上限';
 let seenDate=false,undated=false,prev=null;
 for(const b of bars){
  if(!b||![b.open,b.high,b.low,b.close,b.volume].every(finite)||
     b.open<=0||b.close<=0||b.low<=0||b.high<Math.max(b.open,b.close,b.low)||
     b.low>Math.min(b.open,b.close)||!Number.isSafeInteger(b.volume)||b.volume<0||
     b.complete===false)return 'K线OHLCV缺失、无效或包含未完成交易日';
  if(b.date===undefined){undated=true;continue;}
  seenDate=true;
  if(!validDate(b.date)||prev!==null&&b.date<=prev)return 'K线日期无效、重复或乱序';
  prev=b.date;
 }
 if(seenDate&&undated)return 'K线日期字段不一致';
 return null;
}
function atrWilder(bars,period){
 if(bars.length<=period)return null;
 let atr=0;
 for(let i=1;i<=period;i++){
  const b=bars[i],previous=bars[i-1].close;
  atr+=Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous));
 }
 atr/=period;
 for(let i=period+1;i<bars.length;i++){
  const b=bars[i],previous=bars[i-1].close;
  const tr=Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous));
  atr=(atr*(period-1)+tr)/period;
 }
 return atr;
}
function rsiWilder(bars,period,end=bars.length){
 if(end<=period)return null;
 let avgGain=0,avgLoss=0;
 for(let i=1;i<=period;i++){
  const diff=bars[i].close-bars[i-1].close;
  avgGain+=Math.max(diff,0)/period;
  avgLoss+=Math.max(-diff,0)/period;
 }
 for(let i=period+1;i<end;i++){
  const diff=bars[i].close-bars[i-1].close;
  avgGain=(avgGain*(period-1)+Math.max(diff,0))/period;
  avgLoss=(avgLoss*(period-1)+Math.max(-diff,0))/period;
 }
 return avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
}
function cci(bars,period){
 const points=bars.slice(-period).map(b=>(b.high+b.low+b.close)/3),center=mean(points);
 const mad=mean(points.map(v=>Math.abs(v-center)));
 return mad>0?(points.at(-1)-center)/(.015*mad):0;
}
function bollUpper(closes,dev=2){
 const avg=mean(closes),sd=Math.sqrt(mean(closes.map(x=>(x-avg)**2)));
 return avg+dev*sd;
}
function evaluateOpenSourceRules(stock={}, {marketRisk='unknown'}={}){
 const bars=stock?.bars,error=dataError(bars);
 const common={mode:'research-only',symbol:String(stock?.symbol||stock?.code||''),
  asOf:Array.isArray(bars)&&validDate(bars.at(-1)?.date)?bars.at(-1).date:null,
  marketRisk:['risk_on','risk_off','neutral','unknown'].includes(marketRisk)?marketRisk:'unknown',
  originalRulesChanged:false,weightsChanged:false,canTrade:false,verifiedLive:false};
 const fail=(status,reason)=>({...common,strategies:catalog.map(rule=>({
  id:rule.id,label:rule.label,source:rule.source,status,reasons:[reason],metrics:{},
  eligibleForResearch:false,validatedPerformance:false}))});
 if(error)return fail('insufficient_data',error);
 if(stock.isST===true||stock.suspended===true||stock.tradable===false||
    stock.isDelisting===true||stock.noPriceLimit===true||
    bars.at(-1).isST===true||bars.at(-1).suspended===true||bars.at(-1).tradable===false||
    bars.at(-1).isDelisting===true||bars.at(-1).noPriceLimit===true||bars.at(-1).volume===0)
  return fail('risk_blocked','停牌、ST、退市风险、无价格限制或零成交禁止生成新增研究信号');
 const last=bars.at(-1),prior=bars.slice(-21,-1);
 const closes=prior.map(b=>b.close),average20=mean(closes),upper=bollUpper(closes);
 const vol=mean(prior.map(b=>b.volume));
 const atr14=atrWilder(bars,14),atr22=atrWilder(bars,22),cci14=cci(bars,14);
 const rsiPrev=rsiWilder(bars,5,bars.length-1),rsiNow=rsiWilder(bars,5);
 const atrPct14=100*atr14/last.close,atrPct22=100*atr22/last.close;
 const checks=[
  {id:'vnpy_boll_cci_atr',conditions:[
    ['close-above-prior-boll-upper',last.close>upper],
    ['cci14-above-100',cci14>100],
    ['atr14-within-1-to-9pct',atrPct14>=1&&atrPct14<=9],
    ['volume-at-least-1p2-prior-avg',vol>0&&last.volume>=1.2*vol]],
    metrics:{close:round(last.close),priorBollUpper:round(upper),cci14:round(cci14),
      atr14:round(atr14),atrPct14:round(atrPct14),volumeRatio:round(vol>0?last.volume/vol:null)}},
  {id:'vnpy_atr_rsi',conditions:[
    ['rsi5-crosses-55-from-below',rsiPrev<=55&&rsiNow>55],
    ['close-above-sma20',last.close>average20],
    ['atr22-within-1-to-9pct',atrPct22>=1&&atrPct22<=9]],
    metrics:{rsi5Previous:round(rsiPrev),rsi5:round(rsiNow),
      sma20:round(average20),atr22:round(atr22),atrPct22:round(atrPct22)}}
 ];
 return {...common,strategies:checks.map(check=>{
  const rule=catalog.find(v=>v.id===check.id);
  const matched=check.conditions.every(pair=>pair[1]);
  return {id:rule.id,label:rule.label,source:rule.source,
    status:matched?'candidate':'not_matched',eligibleForResearch:matched,
    reasons:check.conditions.map(([name,pass])=>(pass?'通过：':'未通过：')+name),
    metrics:check.metrics,validatedPerformance:false,
    marketWarning:common.marketRisk==='risk_off'?'弱市/急跌环境下保留研究命中但不提升交易资格':null};
 })};
}
module.exports={catalog,evaluateOpenSourceRules};
