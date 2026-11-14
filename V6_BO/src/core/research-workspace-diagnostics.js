'use strict';
// Diagnostics describe the supplied research inputs, never change a strategy.
const {FLAGS}=require('./research-workspace-store');
const {conditionChanges}=require('./research-workspace-decision');
const {calcMACD}=require('../../analysis');
const array=x=>Array.isArray(x)?x:[],finite=x=>typeof x==='number'&&Number.isFinite(x);
function inputAudit(data){
 if(!data)return {status:'not-evaluated',warmup:[],...FLAGS};
 const bars=array(data.bars),lengths=[30,60,120,240],warmup=lengths.map(length=>{
  if(bars.length<length)return {length,status:'insufficient-history',value:null};
  const value=calcMACD(bars.slice(-length));return {length,status:value?'observed-unverified':'indicator-minimum-not-met',value};
 });
 const values=warmup.filter(x=>x.value),sensitive=values.length>=2&&values.some(x=>x.value.gold!==values[0].value.gold||x.value.aboveWater!==values[0].value.aboveWater);
 const financials=data.context?.financials;
 return {status:'observed-unverified',bars:bars.length,excludedFutureRows:0,closedBarsOnly:true,
  warmup,warmupStatus:values.length<2?'insufficient-history':sensitive?'signal-sensitive-to-start':'no-signal-change-in-tested-lengths',
  pointInTime:{status:'frozen-at-receipt-only',financialAvailable:!!financials,financialHistoricalEligibility:'not-certified',
   membershipScope:'observed-members-at-run-time',meaning:'只认当时封存的资料；没有公告与生效版本链时不能用作历史基本面或成分回测'},
  note:'预热差异是诊断，不自动替换参数；有限窗口一致不能证明所有启动长度无偏',...FLAGS};
}
function pairedComparison(current,previous){
 if(!current||!previous)return {status:'not-selected',...FLAGS};
 if(current.symbol!==previous.symbol||current.provider!==previous.provider||current.priceBasis!==previous.priceBasis||
  current.observationHash!==previous.observationHash||current.asOf!==previous.asOf)return {status:'unmatched-inputs',reason:'股票、来源、价格口径、观察哈希和分析时点必须相同',...FLAGS};
 return {status:'matched-frozen-input',changes:conditionChanges(current,previous),
  systems:current.systems.map(s=>({system:s.id,before:previous.systems.find(x=>x.id===s.id)?.verdict??'unknown',after:s.verdict,version:s.version})),
  performanceAttribution:'unknown-until-paired-forward-outcomes',...FLAGS};
}
function driftReport(events,asOf){
 const byDay=new Map();
 for(const e of events)if(e.kind==='analysis'&&e.recordedAt<=asOf&&e.data.asOf<=asOf){const d=e.data,key=d.provider+'|'+d.tradeDate;
  if(!byDay.has(key))byDay.set(key,new Map());byDay.get(key).set(d.symbol,d);}
 const reports=[];
 for(const provider of ['tencent','eastmoney']){
  const days=[...byDay.keys()].filter(k=>k.startsWith(provider+'|')).sort();if(days.length<2)continue;
  const before=byDay.get(days.at(-2)),after=byDay.get(days.at(-1)),matched=[...after.keys()].filter(s=>before.has(s));
  const rows=[];
  for(const field of ['close','volume']){
   const changes=matched.map(s=>[before.get(s).bars.at(-1)?.[field],after.get(s).bars.at(-1)?.[field]]).filter(([a,b])=>finite(a)&&finite(b)&&a>0).map(([a,b])=>100*(b/a-1));
   rows.push({field,matchedKnown:changes.length,meanChangePct:changes.length?changes.reduce((a,b)=>a+b,0)/changes.length:null});
  }
  const unknownRate=m=>{const conditions=[...m.values()].flatMap(d=>d.conditions);return conditions.length?conditions.filter(c=>c.status==='unknown').length/conditions.length:null;};
  reports.push({provider,before:days.at(-2).split('|')[1],after:days.at(-1).split('|')[1],matched:matched.length,
   added:[...after.keys()].filter(s=>!before.has(s)).length,removed:[...before.keys()].filter(s=>!after.has(s)).length,
   beforeUnknownRate:unknownRate(before),afterUnknownRate:unknownRate(after),fields:rows,status:matched.length>=20?'descriptive-only':'insufficient-matched-universe',
   attribution:'分别显示输入质量、样本范围和同股变化；不认证收益衰减或因果关系'});
 }
 return {reports,...FLAGS};
}
module.exports={inputAudit,pairedComparison,driftReport};
