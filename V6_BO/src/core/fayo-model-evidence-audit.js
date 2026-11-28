'use strict';
// Research-only additions to the original frozen diagnostic, matured IC and
// forecast projections. Never introduce an execution, learning or order route.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=x=>finite(x)?Number(x.toFixed(6)):null;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const symbol=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const clock=(t,end)=>Number.isSafeInteger(t)&&t>0&&t<=end;
const flags={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false};
function pairedDrift(before,after,field,b,s){
 const old=new Map(before.rows.map(r=>[r.symbol,r])),next=new Map(after.rows.map(r=>[r.symbol,r]));
 const oldValid=new Set(b.samples.filter(r=>r.status==='valid').map(r=>r.symbol)),newValid=new Set(s.samples.filter(r=>r.status==='valid').map(r=>r.symbol));
 const matched=[...newValid].filter(id=>oldValid.has(id)&&finite(old.get(id)?.[field])&&finite(next.get(id)?.[field]));
 const oldMean=mean(matched.map(id=>old.get(id)[field])),newMean=mean(matched.map(id=>next.get(id)[field]));
 return {status:matched.length?'paired-descriptive-only':'no-common-valid-symbols',beforeUniverse:old.size,afterUniverse:next.size,commonUniverse:[...next.keys()].filter(id=>old.has(id)).length,
  addedSymbols:[...next.keys()].filter(id=>!old.has(id)).length,removedSymbols:[...old.keys()].filter(id=>!next.has(id)).length,
  beforeValid:oldValid.size,afterValid:newValid.size,commonValid:matched.length,
  newlyValid:[...newValid].filter(id=>!oldValid.has(id)).length,noLongerValid:[...oldValid].filter(id=>!newValid.has(id)).length,
  pairedBeforeMean:round(oldMean),pairedAfterMean:round(newMean),pairedMeanShift:matched.length?round(newMean-oldMean):null,
  unitVersionVerified:false,methodologyVersionVerified:false,decayVerified:false,
  note:'同证券且两期原输入有效的分数差；样本增减、覆盖变化与分数变化分别披露。原冻结协议没有计量单位/数据方法版本，不能由漂移推断收益衰减。',...flags};
}
const regimes=['systemic-selloff','not-systemic-selloff','unknown'];
function researchScorecard(days,icRows,ids,weights){
 // The caller already evaluated these same dates with its frozen IC scorer.
 const byRegime=Object.fromEntries(regimes.map(r=>[r,[]]));
 const variants=['original','accepted','proposed'];
 let pairedRankDays=0;
 const daily=days.map((d,i)=>{
  const regime=regimes.includes(d.regime)?d.regime:'unknown',ic=icRows[i],rows=d.rows;
  const out={day:d.day,targetDate:d.targetDate??null,regime,sampleCount:Array.isArray(rows)?rows.length:null,originalIC:ic.originalIC,acceptedIC:ic.acceptedIC,proposedIC:ic.proposedIC,
   ranking:null};
  byRegime[regime].push(out);
  // Fixed top-3 reference, not a new model or a fitted hyperparameter.
  if(!Array.isArray(rows)||rows.length<5||rows.length>500||rows.some(r=>!symbol(r?.symbol)||!finite(r.returnPct)||r.returnPct<=-100||r.targetDate!==d.targetDate||ids.some(id=>!finite(r.values?.[id])||r.values[id]<0||r.values[id]>100))||new Set(rows.map(r=>r.symbol)).size!==rows.length)return out;
  const ranked=weights.map(w=>{
   const total=ids.reduce((n,id)=>n+w[id],0);if(!finite(total)||total<=0)return null;
   const scores=rows.map(r=>({symbol:r.symbol,score:ids.reduce((n,id)=>n+r.values[id]*(w[id]/total),0),label:r.returnPct})).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
   if(scores.some(r=>!finite(r.score))||scores[2].score===scores[3].score)return null;
   return {symbols:scores.slice(0,3).map(r=>r.symbol),meanGrossPriceReturnPct:round(mean(scores.slice(0,3).map(r=>r.label))),netReturnPct:null,fees:null};
  });
  if(ranked.some(r=>!r))return out;
  pairedRankDays++;out.ranking=Object.fromEntries(variants.map((k,j)=>[k,ranked[j]]));return out;
 });
 const environment=regimes.map(regime=>{
  const a=byRegime[regime];return {regime,signalDays:a.length,independentTradingDays:null,firstDay:a[0]?.day??null,lastDay:a.at(-1)?.day??null,
   originalMeanIC:round(mean(a.map(r=>r.originalIC))),acceptedMeanIC:round(mean(a.map(r=>r.acceptedIC))),proposedMeanIC:round(mean(a.map(r=>r.proposedIC))),
   pairedRankingDays:a.filter(r=>r.ranking).length,netReturnPct:null};
 });
 const selected=daily.filter(r=>r.ranking);
 return {status:'same-matured-input-descriptive',environment,ranking:{topK:3,expectedDays:days.length,pairedDays:pairedRankDays,unavailableDays:days.length-pairedRankDays,
  variants:Object.fromEntries(variants.map(k=>[k,{meanGrossPriceReturnPct:round(mean(selected.map(r=>r.ranking[k].meanGrossPriceReturnPct))),netReturnPct:null}])),
  rows:daily,executionVerified:false,independenceCertified:false,netBenefitVerified:false,
  note:'仅原5日价格标签的等权Top-3参考，不模拟成交；边界并列或覆盖不完整的日期三版本同时弃权。费用、滑点、实际净收益、高级模型增益仍未知。'},
  changesPromotionGate:false,...flags};
}
function projectRuleEvidence(data){
 const base={status:'unavailable',conditionTotal:null,boundConditions:0,unboundConditions:null,rows:[],omittedRows:0,causalAttribution:null,featureContribution:null,...flags};
 if(!data||!symbol(data.symbol)||!clock(data.asOf,8e15)||!Array.isArray(data.conditions)||!Array.isArray(data.evidence)||data.conditions.length>2000||data.evidence.length>5000)return base;
 const nodes=new Map(),duplicates=new Set();
 for(const n of data.evidence){if(!hash(n?.id))continue;if(nodes.has(n.id))duplicates.add(n.id);else nodes.set(n.id,n);}
 const rows=data.conditions.map(c=>{
  const ids=Array.isArray(c?.evidenceIds)?c.evidenceIds:[];
  const valid=ids.length>0&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>{
   const n=nodes.get(id);return hash(id)&&!duplicates.has(id)&&n?.symbol===data.symbol&&typeof n.field==='string'&&!!n.field&&typeof n.source==='string'&&!!n.source&&
    ['observed-unverified','derived-unverified'].includes(n.status)&&n.value!==null&&n.value!==undefined&&clock(n.availableAt,data.asOf)&&clock(n.receivedAt,data.asOf)&&
    (n.sourceTimestamp==null||clock(n.sourceTimestamp,data.asOf))&&(n.periodEnd==null||clock(n.periodEnd,data.asOf));
  });
  const usable=valid&&['pass','fail'].includes(c?.status)&&['number','string','boolean'].includes(typeof c.value)&&
   ids.some(id=>Object.is(nodes.get(id).value,c.value));
  return {ruleId:typeof c?.id==='string'?c.id:null,system:typeof c?.system==='string'?c.system:null,version:typeof c?.version==='string'?c.version:null,
   status:usable?'bound-frozen-rule':'unknown',originalVerdict:c?.status??null,value:usable?c.value:null,threshold:usable?c.threshold??null:null,
   references:usable?ids.map(id=>{const n=nodes.get(id);return {id,field:n.field,source:n.source,availableAt:n.availableAt,receivedAt:n.receivedAt,sourceTimestamp:n.sourceTimestamp??null,periodEnd:n.periodEnd??null};}):[],
   causalClaim:false,coefficientContribution:null};
 });
 const count=rows.filter(r=>r.status==='bound-frozen-rule').length;
 return {...base,status:count?'frozen-rule-trace':'unknown',asOf:data.asOf,conditionTotal:rows.length,boundConditions:count,unboundConditions:rows.length-count,rows:rows.slice(0,100),omittedRows:Math.max(0,rows.length-100),
  note:'仅原档案条件及其实际引用字段；不把规则命中当作因果、盈利或独立特征贡献。'};
}
function forwardScopeReport(records,asOf){
 const groups=new Map();
 for(const r of records){
  const k=JSON.stringify([r.inputFingerprint,r.modelKey,r.symbol,r.provider,r.originDate]);
  if(!groups.has(k))groups.set(k,{inputFingerprint:r.inputFingerprint,modelKey:r.modelKey,symbol:r.symbol,provider:r.provider,originDate:r.originDate,expected:r.targets,submitted:new Map(),records:0,latencies:[],memories:[]});
  const g=groups.get(k);g.records++;
  if(finite(r.latencyMs)&&r.latencyMs>=0)g.latencies.push(r.latencyMs);
  if(finite(r.peakMemoryMb)&&r.peakMemoryMb>=0)g.memories.push(r.peakMemoryMb);
  for(const row of r.rows)if(!g.submitted.has(row.horizon))g.submitted.set(row.horizon,row.status);
 }
 let expected=0,submitted=0,omitted=0,dueMissing=0,calendarUnknown=0,observed=0,unusable=0,pending=0,declaredLatency=0,declaredMemory=0,receiptCount=0;
 const rows=[...groups.values()].map(g=>{
  const horizons=[1,5,20,60].map(horizon=>{
   const target=g.expected.find(t=>t.horizon===horizon),status=g.submitted.get(horizon)??null;
   if(!target){calendarUnknown++;return {horizon,targetDate:null,due:null,status:'calendar-unavailable'};}
   expected++;const due=Date.parse(target.targetDate+'T15:10:00+08:00')<=asOf;
   if(status===null){omitted++;if(due)dueMissing++;}else {submitted++;if(status==='observed-unverified')observed++;else if(status==='pending')pending++;else unusable++;}
   return {horizon,targetDate:target.targetDate,due,status:status??'not-submitted'};
  });
  declaredLatency+=g.latencies.length;declaredMemory+=g.memories.length;receiptCount+=g.records;
  return {inputFingerprint:g.inputFingerprint,modelKey:g.modelKey,symbol:g.symbol,provider:g.provider,originDate:g.originDate,receiptCount:g.records,horizons,
   declaredLatencySamples:g.latencies.length,meanDeclaredLatencyMs:round(mean(g.latencies)),declaredMemorySamples:g.memories.length,meanDeclaredPeakMemoryMb:round(mean(g.memories)),executionVerified:false};
 });
 return {status:rows.length?'registered-input-scope':'no-registered-input',registeredModelInputs:rows.length,receiptCount,expectedCalendarCoveredHorizons:expected,submittedHorizons:submitted,notSubmittedHorizons:omitted,dueNotSubmittedHorizons:dueMissing,calendarUnknownHorizons:calendarUnknown,
  observedHorizons:observed,pendingHorizons:pending,unusableOrRepeatedHorizons:unusable,declaredLatencySamples:declaredLatency,declaredMemorySamples:declaredMemory,rows:rows.slice(-20).reverse(),omittedRows:Math.max(0,rows.length-20),
  realShadowRuns:null,verifiedRuntimeCost:null,netTradingReturn:null,approvedForProduction:false,modelExecutionVerified:false,
  note:'分母仅已登记的模型与输入组合；不能推断未登记模型、真实后台执行、策略收益或实际资源成本。声明耗时不等于测量回执。',...flags};
}
module.exports={pairedDrift,researchScorecard,projectRuleEvidence,forwardScopeReport};
