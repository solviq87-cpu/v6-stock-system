'use strict';

const {readObservedStock,retainStockObservation}=require('../core/stock-observation-store');
const {buildWorkspaceDecision}=require('../core/research-workspace-decision');
const {readResearchCalendar}=require('../core/research-calendar-source');
const {fetchResearchHistory}=require('./public-history-fallback');
const {readResearchEvidenceBundle}=require('../core/research-evidence-bundle');
const {publicContextView}=require('../core/linked-market-intelligence');
const {workspaceView}=require('../core/research-workspace');
const {compileObservation}=require('../strategy/research36-observation');

const codeOK=code=>typeof code==='string'&&/^(?:60|68|00|30|43|83|87|88|92)\d{4}$/.test(code);
const closeAt=date=>Date.parse(date+'T15:10:00+08:00');
const dayEnd=date=>Date.parse(date+'T23:59:59.999+08:00');

// A late first receipt may explain today's formation. It never becomes an
// earlier trading signal. Keep an uninterrupted calendar segment for replay.
function causalHistory(stock,tradeDates){
 const dates=new Map(tradeDates.map((date,index)=>[date,index]));
 let segment=[],best=[];
 for(const bar of stock.bars){
  const last=dayEnd(bar.date),known=bar.priceKnownAt??bar.knownAt;
  if(!dates.has(bar.date)||!Number.isSafeInteger(known)||known>last||known<closeAt(bar.date)){
   segment=[];continue;
  }
  if(segment.length&&dates.get(bar.date)!==dates.get(segment.at(-1).date)+1)segment=[];
  const visible={date:bar.date,knownAt:known,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume};
  for(const [time,fields] of [
   ['amountKnownAt',['amount']],['statusKnownAt',['suspended','tradable','isST','market','ipoNoLimit']],
   ['corporateActionKnownAt',['corporateAction']],['limitKnownAt',['limitUpPrice','limitReferencePrice','noPriceLimit','limitPct']]
  ]){
   if(!Number.isSafeInteger(bar[time])||bar[time]>last)continue;
   for(const field of fields)if(bar[field]!==undefined)visible[field]=bar[field];
   visible[time]=bar[time];
  }
  segment.push(visible);
  if(segment.length>=32&&(!best.length||segment.at(-1).date>=best.at(-1).date))best=segment.slice();
 }
 return best.length?{source:'imported',origin:'v6-observation',provider:stock.provider,asOf:best.at(-1).date,
   priceBasis:'unadjusted',tradingDates:best.map(b=>b.date),strictHistoricalStatus:true,
   stocks:[{symbol:stock.symbol,name:stock.name,provider:stock.provider,priceBasis:'unadjusted',feed:{source:'imported',timestamp:best.at(-1).knownAt},bars:best}]}:null;
}
function currentMeasures(stock){
 const bars=stock.bars,last=bars.at(-1),values=[{name:'收盘价',value:last.close,unit:'元'}];
 if(bars.length>=2)values.push({name:'相对上一根收盘涨跌',value:+(100*(last.close/bars.at(-2).close-1)).toFixed(2),unit:'%'});
 if(bars.length>=6){
  const prior=bars.slice(-6,-1).reduce((sum,b)=>sum+b.volume,0)/5;
  if(prior>0)values.push({name:'较前五根日均量',value:+(last.volume/prior).toFixed(2),unit:'倍'});
 }
 if(bars.length>=20)values.push({name:'最近20根收盘均价',value:+(bars.slice(-20).reduce((s,b)=>s+b.close,0)/20).toFixed(2),unit:'元'});
 return values;
}
function createAutomaticResearch({paths,getDay,defaultSymbol,closeMember,publicReview,canPersist=()=>true,clock=Date.now,fetchHistory=fetchResearchHistory,
 readStored=readObservedStock,retain=retainStockObservation,calendar=readResearchCalendar,
 readBundle=readResearchEvidenceBundle,readWorkspace=workspaceView}){
 const cache=new Map(),pending=new Map();
 async function load(symbol,day){
  const start=clock(),options=paths();
  const saved=['eastmoney','tencent','sina'].map(provider=>readStored(options.observationRoot,symbol,{provider,priceBasis:'unadjusted',asOf:start}))
   .filter(r=>r.stock?.bars?.length).sort((a,b)=>b.stock.bars.at(-1).date.localeCompare(a.stock.bars.at(-1).date)||b.stock.bars.length-a.stock.bars.length);
  let record=saved.find(r=>r.stock.bars.at(-1)?.date===day),stock=record?.stock,source='V6 行情档案';
  if(!stock){
   const fresh=await fetchHistory({symbol,historyDays:120,provider:'auto'}).catch(()=>null);
   if(fresh?.stock?.symbol===symbol&&fresh.status==='observed-unverified'&&fresh.units?.volume==='shares'&&fresh.priceBasis==='unadjusted'&&fresh.stock.bars.length){
    stock={...fresh.stock,name:fresh.stock.name||closeMember?.(symbol,day)?.name||symbol};source='公开行情补采';
    // Keep the earliest proven receipt for unchanged price bars across sessions.
    record=canPersist()?retain(options.observationRoot,{stock,observedAt:fresh.retrievedAt,context:{sourceEvidence:fresh.provenance,units:fresh.units}}):{stock,observationHash:fresh.rawHash};
    if(record.stock)stock=record.stock;
   }else{record=saved[0];stock=record?.stock;}
  }
  const asOf=clock();
  if(!stock)throw Error('行情源暂未返回 '+symbol+' 的收盘记录，联网后自动重试');
  const bars=stock.bars.filter(b=>b.date<=day&&Number.isSafeInteger(b.knownAt)&&b.knownAt>=closeAt(b.date)&&b.knownAt<=asOf);
  if(!bars.length)throw Error(symbol+' 的可核对收盘记录正在同步');
  stock={...stock,bars};const date=bars.at(-1).date;
  const tradeDates=calendar({asOf,symbol,calendarFile:options.calendarFile}).tradeDates||[];
  const history=causalHistory(stock,tradeDates),member=closeMember?.(symbol,date);
  const bundle=readBundle(options.evidenceRoot,{symbol,provider:stock.provider,asOf});
  const publicContext=bundle?.marketContext?.source==='eastmoney'&&bundle.marketContext.tradeDate===date?bundle.marketContext:undefined;
  const marketContext=bundle?.marketContext?.tradeDate===date?bundle.marketContext:publicContextView(publicContext,asOf);
  const version=readWorkspace(options.workspaceRoot,{symbol,provider:stock.provider,asOf,limit:1}).selectedRun;
  const inputs={};
  if(version?.symbol===symbol&&version.provider===stock.provider&&version.tradeDate===date&&version.recordedAt<=asOf){
   for(const [key,id] of [['fourteenEvidence','fourteen'],['gptEvidence','gpt'],['pythonEvidence','python']]){
    const e=version.nativeInputs?.[id];if(e&&e.symbol===symbol&&e.date===date&&e.knownAt<=asOf)inputs[key]=e;
   }
  }
  if(!inputs.fourteenEvidence&&member&&Number.isSafeInteger(member.knownAt)&&member.knownAt<=asOf){
   const fields=Object.fromEntries([['limitUpCount',member.level],['breakCount',member.breakCount],['sealAmount',member.sealAmount],['amount',member.amount]].filter(([,v])=>Number.isFinite(v)));
   if(Object.keys(fields).length)inputs.fourteenEvidence={symbol,date,knownAt:member.knownAt,source:'v6.close-watch',stock:fields};
  }
  const decision=buildWorkspaceDecision({stock,asOf,marketContext},inputs,{publicHistory:true});
  const observationHash=record?.observationHash||record?.observations?.at(-1)?.observationHash;
  const research36=compileObservation({stock,asOf,marketContext,observation:{observationHash}},{tradingDates:tradeDates,publicHistory:true}).result;
  return {symbol,name:stock.name||symbol,source,provider:stock.provider,tradeDate:date,requestedDay:day,asOf,stock,
   observations:currentMeasures(stock),publicReview:publicReview?.(symbol,date,clock())||null,history,tradeDates,publicContext,systems:decision.systems,research36,canTrade:false};
 }
 return async function automatic(symbol){
  if(symbol!=null&&symbol!==''&&!codeOK(symbol))throw Error('研究标的代码无效');
  const day=getDay();symbol=symbol||await defaultSymbol(day);
  if(!codeOK(symbol))throw Error('最近交易日的候选池正在同步');
  const key=day+'/'+symbol,hit=cache.get(key);
  if(hit&&hit.until>clock())return hit.value;
  if(pending.has(key))return pending.get(key);
  if(pending.size>=6)throw Error('已有研究数据正在同步，请稍候');
  const work=load(symbol,day).then(value=>{
   cache.set(key,{value,until:clock()+(value.tradeDate===day?300000:30000)});
   if(cache.size>48)cache.delete(cache.keys().next().value);
   return value;
  }).finally(()=>pending.delete(key));
  pending.set(key,work);return work;
 };
}
module.exports={createAutomaticResearch,causalHistory};
