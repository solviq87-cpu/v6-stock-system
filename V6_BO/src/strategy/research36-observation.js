'use strict';
// Adapt the existing immutable observation pipeline. Never relabel local receipt
// as exchange publication, or feed a newly downloaded history into an earlier run.
const {evaluateResearch36,settings}=require('./research36');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clock=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const close=d=>Date.parse(d+'T15:00:00+08:00');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const range=(dates,last,n)=>{const i=dates.indexOf(last);return i>=n-1?dates.slice(i-n+1,i+1):[];};
function compileObservation(observation,{tradingDates=[],config={}}={}){
 settings(config);const {stock,asOf}=observation||{};
 if(!stock||typeof stock.symbol!=='string'||!/^\d{6}$/.test(stock.symbol)||!clock(asOf))throw Error('股票观察身份或时点无效');
 const code=stock.symbol,issues=[],features={},bars=[];
 const source=stock.source,version=observation.observation?.observationHash;
 const calendarOK=Array.isArray(tradingDates)&&tradingDates.length>0&&tradingDates.length<=20000&&tradingDates.every((d,i)=>day(d)&&(!i||d>tradingDates[i-1]));
 const recordOK=stock.simulated!==true&&stock.retracted!==true&&hash(version)&&['eastmoney','tencent'].includes(source)&&stock.provider===source&&stock.priceBasis==='unadjusted'&&
  clock(stock.observedAt)&&stock.observedAt<=asOf&&Array.isArray(stock.bars)&&stock.bars.length<=500;
 if(!recordOK)issues.push('观察档案、来源、价格口径或接收时点不完整');
 if(!calendarOK)issues.push('缺少有序交易日历，不能将缺失日线当连续交易日');
 if(recordOK&&calendarOK){
  let prior='',invalid=false;
  for(const b of stock.bars){
   const known=b?.priceKnownAt??b?.knownAt;
   if(!b||!day(b.date)||b.date<=prior||!clock(known)||known>stock.observedAt||known>asOf||
    known<close(b.date)+600000||b.closed===false||b.isClosed===false||
    b.source!==undefined&&b.source!==source||b.provider!==undefined&&b.provider!==source||b.priceBasis!==undefined&&b.priceBasis!=='unadjusted'||
    !['open','high','low','close','volume'].every(k=>finite(b[k]))||Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||
    b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||!tradingDates.includes(b.date)){
    invalid=true;break;
   }
   prior=b.date;
   bars.push({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
    source,priceBasis:'unadjusted',final:true,observedAt:close(b.date),availableAt:known,recordedAt:known,
    finalityBasis:'local-1510-cutoff-not-supplier-certified'});
  }
  // No silent deletion of holidays, missing sessions or malformed rows.
  if(!invalid&&bars.length){const expected=tradingDates.filter(d=>d>=bars[0].date&&d<=bars.at(-1).date);invalid=expected.length!==bars.length||expected.some((d,i)=>bars[i].date!==d);}
  if(invalid){bars.length=0;issues.push('日线存在日期缺口、未闭合、来源混合、未来或非法数值');}
 }
 const last=bars.at(-1),proof=(value,unit,src=source,refs='observation:'+version,at=last?.observedAt,known=bars.length?Math.max(...bars.map(b=>b.recordedAt)):null)=>({
  code,value,unit,source:src,evidenceId:refs,observedAt:at,availableAt:known,recordedAt:known,
  timeBasis:'session-period-end; conservative-local-availability',verifiedExternal:false});
 if(bars.length>=21){
  const width=rows=>{const mean=rows.reduce((n,b)=>n+b.close,0)/rows.length;return 4*Math.sqrt(rows.reduce((n,b)=>n+(b.close-mean)**2,0)/rows.length)/mean;};
  const previous=width(bars.slice(-21,-1)),current=width(bars.slice(-20));
  if(previous>0&&finite(current/previous))features.bandWidthRatio=proof(current/previous,'ratio');
  const p=bars.at(-2),earlier=bars.at(-3);
  if(p.high>p.low)features.priorWeakClose=proof(p.close<=earlier.close&&(p.close-p.low)/(p.high-p.low)<=.35,'boolean');
 }
 if(bars.length>=36){
  let breakout=-1,level=null;
  for(let i=bars.length-11;i<bars.length-1;i++){
   const high=Math.max(...bars.slice(i-20,i).map(b=>b.high));
   if(bars[i].close>high){breakout=i;level=high;}
  }
  const retest=breakout>=0?bars.slice(breakout+1,-1):[];
  features.priorBreakoutRetestHeld=proof(retest.length>0&&retest.some(b=>b.low<=level)&&retest.every(b=>b.close>=level),'boolean');
 }
 const context=observation.marketContext,flow=context?.funds?.stock;
 if(last&&flow?.simulated!==true&&flow?.retracted!==true&&flow?.symbol===code&&flow.source==='eastmoney'&&flow.unit==='CNY'&&flow.fundsMethod==='vendor-order-size-estimate'&&hash(flow.rawHash)&&
   clock(flow.retrievedAt)&&flow.retrievedAt<=asOf&&flow.retrievedAt>=last.observedAt+600000&&Array.isArray(flow.records)&&flow.records.length<=120){
  const dates=range(tradingDates,last.date,5),rows=flow.records.filter(r=>day(r?.tradeDate)&&dates.includes(r.tradeDate));
  if(dates.length===5&&rows.length===5&&new Set(rows.map(r=>r.tradeDate)).size===5&&rows.every(r=>finite(r.mainNetInflow))){
   rows.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));let positive=0;
   for(let i=4;i>=0&&rows[i].mainNetInflow>0;i--)positive++;
   const total=rows.reduce((n,r)=>n+r.mainNetInflow,0),p=(value,unit)=>proof(value,unit,'eastmoney-order-size-estimate',flow.rawHash,last.observedAt,flow.retrievedAt);
   if(finite(total)){features.netFlow5=p(total,'CNY');features.positiveFlowDays=p(positive,'trading-days');features.flowCoverageDays=p(5,'trading-days');}
  }else issues.push('资金缺少同标的连续5个交易日的有限数值，真实0保留');
 }else issues.push('未取得可归因的个股资金原响应与完整接收时点');
 const index=context?.indices;
 if(last&&index?.simulated!==true&&index?.retracted!==true&&index?.source==='eastmoney'&&hash(index.rawHash)&&clock(index.retrievedAt)&&index.retrievedAt<=asOf&&index.retrievedAt>=last.observedAt+600000&&Array.isArray(index.records)&&index.records.length<=120){
  for(const horizon of [20,60]){
   const dates=range(tradingDates,last.date,horizon+1),rows=index.records.filter(r=>dates.includes(r.tradeDate));
   const own=bars.slice(-horizon-1);
   if(dates.length===horizon+1&&own.length===dates.length&&rows.length===dates.length&&new Set(rows.map(r=>r.tradeDate)).size===rows.length&&rows.every(r=>finite(r.shanghaiClose)&&r.shanghaiClose>0)){
    rows.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));
    if(own.every((b,i)=>b.date===dates[i])){
     const relative=100*(own.at(-1).close/own[0].close-rows.at(-1).shanghaiClose/rows[0].shanghaiClose);
     if(finite(relative))features['relativeReturn'+horizon+'Pct']=proof(relative,'percent','eastmoney-shanghai-index-relative',version+':'+index.rawHash,last.observedAt,Math.max(index.retrievedAt,...own.map(b=>b.recordedAt)));
    }
   }
  }
 }
 Object.assign(features,require('../core/public-stock-financials').financialFeatures(context?.financials,{code,asOf}));
 const input={stock:{code,bars,features},asOf,config};
 const result=evaluateResearch36(input);
 result.pipeline={version:'research36-observation-v1',mode:'existing-observation-pipeline',observationHash:hash(version)?version:null,
  barsUsed:bars.length,derivedFields:Object.keys({...require('./research36').technicalFeatures(input.stock,asOf),...features}).sort(),issues,
  temporalScope:'current-analysis-only; new receipt does not certify historical availability',
  incompleteStrategies:result.evaluations.filter(r=>r.missing.length).map(r=>({id:r.id,fields:r.missing.map(c=>c.field)})),
  limitations:['未复权价格可能受公司行为影响；缺状态不能认证可成交性','收盘时刻表示日线覆盖期终点，不是供应商发布时间；本次已知时点保留实际记录时间','资金按供应商订单大小估算，不表示机构真实身份','相对强弱基准为上证指数；不等于行业或全市场超额收益']};
 return {input,result};
}
module.exports={compileObservation};
