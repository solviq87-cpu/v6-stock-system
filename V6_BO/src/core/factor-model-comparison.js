'use strict';
/**
 * Read-only, paired, chronologically fresh champion/challenger research
 * scorecard. All three versions see IDENTICAL matured cross-sections.
 * It is not a return forecast, portfolio P&L or authorization to trade.
 */
const MIN_DAYS=5,MAX_WINDOW=20;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(n,d=6)=>n===null?null:+n.toFixed(d);
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const median=xs=>{
 const s=[...xs].sort((a,b)=>a-b),i=Math.floor(s.length/2);
 return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
// Compare the same immutable evidence and explicit weight vectors. An IC
// callback is part of the trusted research engine, not an external certificate.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function ownValue(x,key){const d=record(x)?Object.getOwnPropertyDescriptor(x,key):null;return d&&Object.hasOwn(d,'value')?d.value:undefined;}
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!Object.hasOwn(Object.prototype,id)&&id!=='prototype';
function snapshotWeights(weights,ids){
 if(!record(weights)||ids.some(id=>!finite(ownValue(weights,id))||ownValue(weights,id)<=0))
  throw Error('三版本对照权重缺失或非正有限值');
 const snapshot=Object.fromEntries(ids.map(id=>[id,ownValue(weights,id)]));
 if(!finite(ids.reduce((n,id)=>n+snapshot[id],0)))throw Error('三版本对照权重合计无效');
 return Object.freeze(snapshot);
}
function verifySections(days,ids){
 const native=days.some(d=>Object.hasOwn(d,'rows'));
 const timed=native||days.some(d=>Object.hasOwn(d,'targetDate'));
 const lastTarget=new Map();
 for(const d of days){
  if(timed&&(!date(ownValue(d,'targetDate'))||d.targetDate<=d.day))
   throw Error('三版本对照收益标签日期缺失或无效');
  if(!native)continue;
  const rows=ownValue(d,'rows');
  if(!Array.isArray(rows)||rows.length<5||rows.length>500)
   throw Error('三版本对照成熟截面缺失或无效');
  const symbols=new Set();
  for(const row of rows){
   const symbol=ownValue(row,'symbol'),values=ownValue(row,'values'),ret=ownValue(row,'returnPct');
   if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||symbols.has(symbol)||
      ownValue(row,'signalDate')!==d.day||ownValue(row,'targetDate')!==d.targetDate||
      !finite(ret)||ret< -100||!record(values)||ids.some(id=>!finite(ownValue(values,id))))
    throw Error('三版本对照证券身份、因子或收益证据无效');
   if(lastTarget.has(symbol)&&lastTarget.get(symbol)>=d.day)
    throw Error('三版本对照重复证券的收益标签窗口重叠');
   symbols.add(symbol);lastTarget.set(symbol,d.targetDate);
  }
 }
 return native?'validated-native-cross-sections':timed?'dated-diagnostic-only':'legacy-diagnostic-only';
}
function freezeTree(x,seen=new WeakSet()){
 if(x!==null&&typeof x==='object'&&!seen.has(x)){seen.add(x);for(const v of Object.values(x))freezeTree(v,seen);Object.freeze(x);}
 return x;
}
function captureIC(value){
 if(ownValue(value,'days')!==1)return null;
 const ic=ownValue(value,'meanIC');
 if(ic===undefined)return null;
 if(!finite(ic)||ic< -1||ic>1)throw Error('三版本对照IC不是有限的相关系数');
 return ic;
}
function compareShadowVersions(days,ids,originalWeights,acceptedWeights,proposedWeights,score){
 if(!Array.isArray(days)||days.length>400||
    !Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||
    Array.from(ids).some(id=>!validId(id))||typeof score!=='function')
  throw Error('三版本对照的独立日期或因子协议无效');
 ids=Object.freeze([...ids]);
 const weights=[originalWeights,acceptedWeights,proposedWeights].map(w=>snapshotWeights(w,ids));
 const identicalPairs=[[0,1],[0,2],[1,2]].filter(([i,j])=>ids.every(id=>weights[i][id]===weights[j][id]));
 for(let i=0;i<days.length;i++)
  if(!date(ownValue(days[i],'day'))||(i>0&&days[i-1].day>=days[i].day))
   throw Error('三版本对照必须使用严格递增的真实交易日键');
 const crossSectionEvidence=verifySections(days,ids);
 const window=freezeTree(structuredClone(days.slice(-MAX_WINDOW)));
 const base={status:'insufficient-fresh-evidence',scope:'untouched-matured-holdout',
  requiredDays:MIN_DAYS,maxWindowDays:MAX_WINDOW,assessedDays:0,crossSectionEvidence,
  firstDay:window[0]?.day||null,lastDay:window.at(-1)?.day||null,
  perDay:[],original:null,accepted:null,proposed:null,
  proposedVsOriginal:null,proposedVsAccepted:null,
  originalGatePassed:false,canTrade:false,productionWeightsChanged:false};
 if(window.length<MIN_DAYS)return base;
 // Preserve full-precision deltas exclusively for the research promotion gate.
 // The six-decimal scorecard is presentation evidence, not decision input.
 const rows=[],rawOriginalDeltas=[],rawAcceptedDeltas=[],rawICs=[[],[],[]];
 for(const d of window){
  // Read primitive evidence immediately, before a scorer can reuse its result object.
  const ics=weights.map(w=>captureIC(score(Object.freeze([d]),ids,w)));
  if(ics.some(x=>x===null)){
   return {...base,status:'incomparable-fresh-evidence',
    assessedDays:rows.length,reason:'incomplete-paired-cross-section'};
  }
  if(identicalPairs.some(([i,j])=>ics[i]!==ics[j]))
   return {...base,status:'incomparable-fresh-evidence',
    assessedDays:rows.length,reason:'identical-weights-inconsistent-IC'};
  ics.forEach((ic,i)=>rawICs[i].push(ic));
  rawOriginalDeltas.push(ics[2]-ics[0]);
  rawAcceptedDeltas.push(ics[2]-ics[1]);
  rows.push({day:d.day,originalIC:round(ics[0]),acceptedIC:round(ics[1]),
   proposedIC:round(ics[2]),
   proposedMinusOriginal:round(ics[2]-ics[0]),
   proposedMinusAccepted:round(ics[2]-ics[1])});
 }
 const summaries=[
  ['original','originalIC'],['accepted','acceptedIC'],['proposed','proposedIC']
 ].map(([name],i)=>{
  const ic=rawICs[i];
  return [name,{meanIC:round(mean(ic)),medianIC:round(median(ic)),
   positiveDayPct:round(ic.filter(x=>x>0).length/ic.length*100,2)}];
 });
 const uplift=deltas=>{
  const split=Math.floor(deltas.length/2);
  return {meanDeltaIC:round(mean(deltas)),
   firstHalfDeltaIC:round(mean(deltas.slice(0,split))),
   recentHalfDeltaIC:round(mean(deltas.slice(split))),
   betterDayPct:round(deltas.filter(x=>x>0).length/deltas.length*100,2),
   worstDayDeltaIC:round(Math.min(...deltas))};
 };
 // Evaluate diagnostic booleans on raw paired IC deltas; round solely for output.
 // Descriptive fragility only. Five observed dates are not necessarily
 // independent trading sessions; this must never authorize promotion.
 const pairedFragility=deltas=>{
  const omitMeans=deltas.map((_,i)=>mean(deltas.filter((__,j)=>j!==i)));
  const rawWorstLeaveOneOut=Math.min(...omitMeans);
  const worstLeaveOneOut=round(rawWorstLeaveOneOut);
  const blocks=[],rawBlockMeans=[];
  for(let i=0;i+5<=deltas.length;i+=5){
   const blockMean=mean(deltas.slice(i,i+5));
   rawBlockMeans.push(blockMean);
   blocks.push({firstDay:rows[i].day,lastDay:rows[i+4].day,
    meanDeltaIC:round(blockMean)});
  }
  return {status:deltas.length<10?'limited-fresh-observations':'descriptive-unverified',
   assessedDays:deltas.length,
   worstLeaveOneOutMeanDeltaIC:worstLeaveOneOut,
   bestLeaveOneOutMeanDeltaIC:round(Math.max(...omitMeans)),
   singleDayDependent:mean(deltas)>0&&rawWorstLeaveOneOut<=0,
   completeFiveObservationBlocks:blocks,
   incompleteTailDays:deltas.length%5,
   allCompleteBlocksPositive:blocks.length>=2?
    rawBlockMeans.every(blockMean=>blockMean>0):null,
   inference:'descriptive-only-not-independent-days-or-statistical-confidence',
   changesPromotionGate:false,canTrade:false};
 };
 const relativeOriginal=uplift(rawOriginalDeltas);
 const relativeAccepted=uplift(rawAcceptedDeltas);
 const split=Math.floor(rawOriginalDeltas.length/2);
 const originalGatePassed=mean(rawOriginalDeltas)>.002&&
  rawOriginalDeltas.filter(x=>x>0).length/rawOriginalDeltas.length*100>=60&&
  mean(rawOriginalDeltas.slice(0,split))>=-.001&&
  mean(rawOriginalDeltas.slice(split))>=-.001;
 return {...base,status:'paired-scorecard-unverified',
  assessedDays:rows.length,perDay:rows,...Object.fromEntries(summaries),
  proposedVsOriginal:{...relativeOriginal,fragility:pairedFragility(rawOriginalDeltas)},
  proposedVsAccepted:{...relativeAccepted,fragility:pairedFragility(rawAcceptedDeltas)},
  originalGatePassed};
}
module.exports={compareShadowVersions};
