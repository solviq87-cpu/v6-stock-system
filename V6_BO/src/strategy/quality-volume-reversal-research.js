'use strict';
// Independently implemented daily OHLCV diagnostics; public concepts only.
// Never claims order-flow evidence, verified performance or production eligibility.
const catalog=Object.freeze([
 {id:'linear_trend_quality20',label:'回归趋势质量20日',family:'trend-quality',
  source:'https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/loader.py',
  minBars:45,validatedPerformance:false},
 {id:'obv_volume_accumulation20',label:'能量潮量价累积20日',family:'volume-accumulation',
  source:'https://backtrader.readthedocs.io/en/latest/user-guide/indicators/indicators.html',
  minBars:45,validatedPerformance:false},
 {id:'rsv14_reversal_confirmation',label:'低位区间恢复确认14日',family:'reversal-confirmation',
  source:'https://backtrader.readthedocs.io/en/latest/user-guide/indicators/indicators.html',
  minBars:45,validatedPerformance:false}
].map(x=>Object.freeze(x)));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>finite(x)?Number(x.toFixed(5)):null;
const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
function checkBars(bars){
 if(!Array.isArray(bars)||bars.length<45||bars.length>10000)return '至少45个有效交易日日线且不超过10000根';
 let prev='';
 for(const b of bars){
  if(!b||!dateOK(b.date)||b.date<=prev||b.complete===false||
    ![b.open,b.high,b.low,b.close,b.volume].every(finite)||
    Math.min(b.open,b.high,b.low,b.close)<=0||
    !Number.isSafeInteger(b.volume)||b.volume<0||
    b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close))
   return '有缺价、错误日期、未完成日线、非数值成交量或OHLC关系错误';
  prev=b.date;
 }
 return null;
}
function regression20(bars){
 const prices=bars.slice(-20).map(b=>Math.log(b.close));
 const n=prices.length,xAvg=(n-1)/2,yAvg=avg(prices);
 let xy=0,xx=0,yy=0;
 for(let i=0;i<n;i++){
  xy+=(i-xAvg)*(prices[i]-yAvg);
  xx+=(i-xAvg)**2;
  yy+=(prices[i]-yAvg)**2;
 }
 const slope=xy/xx;
 const r2=yy>1e-15?Math.max(0,Math.min(1,xy*xy/(xx*yy))):0;
 return {slopePct:(Math.exp(slope)-1)*100,r2};
}
function rsv14(bars,end=bars.length){
 const range=bars.slice(end-14,end);
 const high=Math.max(...range.map(b=>b.high)),low=Math.min(...range.map(b=>b.low));
 if(high<=low)return null;
 return 100*(range.at(-1).close-low)/(high-low);
}
function volumeEvidence(bars){
 const slice=bars.slice(-21);
 let signed=0,total=0,up=0;
 const daily=[];
 for(let i=1;i<slice.length;i++){
  const volume=slice[i].volume,returnPct=slice[i].close/slice[i-1].close-1;
  const direction=Math.sign(returnPct);
  signed+=direction*volume;total+=volume;
  if(direction>0)up++;
  daily.push({returnPct,logVolume:Math.log1p(volume)});
 }
 const short=daily.slice(-5).reduce((s,d,i)=>s+Math.sign(d.returnPct)*slice.at(-5+i).volume,0);
 const meanReturn=avg(daily.map(x=>x.returnPct)),meanVolume=avg(daily.map(x=>x.logVolume));
 const v1=avg(daily.map(x=>(x.returnPct-meanReturn)**2));
 const v2=avg(daily.map(x=>(x.logVolume-meanVolume)**2));
 const cov=avg(daily.map(x=>(x.returnPct-meanReturn)*(x.logVolume-meanVolume)));
 return {obvRatio:total>0?signed/total:null,obvLast5:short,
  upDayFraction:up/daily.length,
  priceVolumeCorr:v1>1e-15&&v2>1e-15?cov/Math.sqrt(v1*v2):null};
}
function evaluateQualityMomentumResearch(stock={}, {marketRisk='unknown'}={}){
 const bars=stock.bars,err=checkBars(bars),last=Array.isArray(bars)?bars.at(-1):null;
 const common={schemaVersion:1,mode:'quality-volume-reversal-research',
   symbol:String(stock.symbol||stock.code||''),asOf:dateOK(last?.date)?last.date:null,
   marketRisk:['risk_on','risk_off','neutral'].includes(marketRisk)?marketRisk:'unknown',
   canTrade:false,verifiedLive:false,weightsChanged:false,autoPromotion:false};
 const stop=(status,reason)=>({...common,factors:[],
  strategies:catalog.map(c=>({id:c.id,label:c.label,family:c.family,source:c.source,
   status,eligibleForResearch:false,validatedPerformance:false,reasons:[reason],metrics:{}}))});
 if(err)return stop('insufficient_data',err);
 if(stock.isST===true||stock.suspended===true||stock.tradable===false||
    stock.isDelisting===true||stock.noPriceLimit===true||
    last.isST===true||last.suspended===true||last.tradable===false||
    last.isDelisting===true||last.noPriceLimit===true||last.volume===0)
  return stop('risk_blocked','ST、停牌、退市、无涨跌停限制或零成交日不生成新增研究信号');
 const price20=bars.at(-21).close,ret20=100*(last.close/price20-1);
 const prior20=bars.slice(-21,-1),mean20=avg(prior20.map(x=>x.close));
 const vol20=avg(prior20.map(x=>x.volume)),ratio=vol20>0?last.volume/vol20:null;
 const regression=regression20(bars);
 const volume=volumeEvidence(bars);
 const rsvPrev=rsv14(bars,bars.length-1),rsvNow=rsv14(bars);
 const indicators=[
  {id:'quality_r2_20',label:'20日对数收盘回归R²',family:'trend-quality',value:round(regression.r2),unit:'',status:'derived-historical'},
  {id:'quality_slope20',label:'20日回归日斜率',family:'trend-quality',value:round(regression.slopePct),unit:'%/日',status:'derived-historical'},
  {id:'signed_volume20',label:'20日方向成交量占比（非资金流）',family:'volume-accumulation',
   value:round(volume.obvRatio),unit:'',status:volume.obvRatio===null?'unknown':'derived-historical'},
  {id:'price_volume_corr20',label:'日收益与对数成交量相关系数',family:'volume-correlation',
   value:round(volume.priceVolumeCorr),unit:'',status:volume.priceVolumeCorr===null?'unknown':'derived-historical'},
  {id:'rsv14',label:'14日收盘区间位置RSV',family:'reversal',value:round(rsvNow),unit:'%',status:rsvNow===null?'unknown':'derived-historical'},
  {id:'upday20',label:'20日收盘上涨比例',family:'breadth-within-stock',value:round(100*volume.upDayFraction),unit:'%',status:'derived-historical'}
 ];
 const tests=[
  {id:'linear_trend_quality20',checks:[
    ['20日对数收盘价回归R²达到0.70',regression.r2>=.70],
    ['回归每日斜率至少0.15%',regression.slopePct>=.15],
    ['收盘高于此前20日均线',last.close>mean20],
    ['20日收盘上涨比例至少60%',volume.upDayFraction>=.60]],
   metrics:{r2:round(regression.r2),slopePctPerDay:round(regression.slopePct),
    priorMA20:round(mean20),upDayPct:round(100*volume.upDayFraction)}},
  {id:'obv_volume_accumulation20',checks:[
    ['20日方向成交量净占比至少20%（不代表真实主力资金）',
      volume.obvRatio!==null&&volume.obvRatio>=.20],
    ['过去5日方向成交量合计为正',volume.obvLast5>0],
    ['20日涨幅在-5%至12%之间',ret20>=-5&&ret20<=12],
    ['收盘高于此前20日均线',last.close>mean20]],
   metrics:{signedVolumeRatio:round(volume.obvRatio),
    signedVolume5:round(volume.obvLast5),ret20Pct:round(ret20),priorMA20:round(mean20)}},
  {id:'rsv14_reversal_confirmation',missing:rsvPrev===null||rsvNow===null,
   checks:[
    ['前一日RSV14不高于30',rsvPrev!==null&&rsvPrev<=30],
    ['当日RSV14上穿45',rsvPrev!==null&&rsvNow!==null&&rsvPrev<45&&rsvNow>=45],
    ['当日收盘高于前一日收盘',last.close>bars.at(-2).close],
    ['当日成交量至少为此前20日均量1.1倍',ratio!==null&&ratio>=1.1]],
   metrics:{rsv14Previous:round(rsvPrev),rsv14Current:round(rsvNow),
    currentVolumeToPrior20:round(ratio)}}
 ];
 return {...common,factors:indicators,
  strategies:tests.map(test=>{
   const definition=catalog.find(c=>c.id===test.id);
   const status=test.missing?'insufficient_data':test.checks.every(x=>x[1])?'candidate':'not_matched';
   return {id:test.id,label:definition.label,family:definition.family,source:definition.source,
    validatedPerformance:false,eligibleForResearch:status==='candidate',status,
    metrics:test.metrics,reasons:test.missing?['价格区间没有可计算的波动范围']:
     test.checks.map(([label,pass])=>(pass?'通过：':'未通过：')+label),
    marketWarning:common.marketRisk==='risk_off'?'弱市可保留历史观察但禁止自动升权或绕过风控':null};
  })};
}
module.exports={catalog,evaluateQualityMomentumResearch};
