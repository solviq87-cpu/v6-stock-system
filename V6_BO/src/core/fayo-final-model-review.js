'use strict';
// Bounded projections; no trade, training, promotion or parameter mutation.
const list=x=>Array.isArray(x)?x:[];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const mean=x=>x.length?x.reduce((n,v)=>n+v,0)/x.length:null;
const round=x=>finite(x)?Number(x.toFixed(8)):null;
const flags={researchOnly:true,canTrade:false,canTrain:false,canNotify:false,productionWeightsChanged:false,autoPromotion:false};
function routeDiagnostic(breakdown){
 const base={status:'unknown',route:'fixed-diagnostic-v1',prospectiveRouteCertified:false,rule:'systemic-selloff: original; not-systemic-selloff: accepted; unknown: abstain',rows:[],
 expectedDays:breakdown?.ranking?.expectedDays??null,pairedDays:0,abstainedDays:null,routeSwitches:0,actualSwitchingCost:null,netTradingReturn:null,...flags};
 const rows=list(breakdown?.ranking?.rows);if(!rows.length)return base;
 let prior=null,previous=null,switches=0,changedBaskets=0,extraTurnover=0;
 const out=[];
 for(const r of rows){
  const chosen=r.regime==='systemic-selloff'?'original':r.regime==='not-systemic-selloff'?'accepted':null;
  const fixed=r.ranking?.original,routed=chosen?r.ranking?.[chosen]:null;
  const valid=x=>x&&Array.isArray(x.symbols)&&x.symbols.length===3&&new Set(x.symbols).size===3&&x.symbols.every(code)&&finite(x.meanGrossPriceReturnPct);
  if(!chosen||!valid(fixed)||!valid(routed)){
   out.push({day:r.day,targetDate:r.targetDate,regime:r.regime,status:'common-abstention',chosen:null,extraBasketTurnover:null,netReturnPct:null});
   // A gap is not evidence of continuous holding or a switch.
   prior=null;previous=null;continue;
  }
  const distinct=(a,b)=>1-a.filter(s=>b.includes(s)).length/3;
  const oldFixed=previous?distinct(previous.fixed,fixed.symbols):null,oldRoute=previous?distinct(previous.route,routed.symbols):null;
  const changed=prior!==null&&prior!==chosen;
  if(changed)switches++;
  if(oldRoute!==null&&oldRoute>0)changedBaskets++;
  const extra=oldRoute===null?null:oldRoute-oldFixed;if(extra!==null)extraTurnover+=extra;
  out.push({day:r.day,targetDate:r.targetDate,regime:r.regime,status:'paired-price-labels',chosen,routeChanged:prior===null?null:changed,
   fixedSymbols:fixed.symbols,routedSymbols:routed.symbols,fixedGrossPriceReturnPct:fixed.meanGrossPriceReturnPct,routedGrossPriceReturnPct:routed.meanGrossPriceReturnPct,
   grossDifferencePct:routed.meanGrossPriceReturnPct-fixed.meanGrossPriceReturnPct,extraBasketTurnover:round(extra),switchCost:null,netReturnPct:null});
  prior=chosen;previous={fixed:fixed.symbols,route:routed.symbols};
 }
 const paired=out.filter(r=>r.status==='paired-price-labels');
 // The cross-section is not an executable portfolio. A cost sensitivity
 // envelope is arithmetic only; absent actual costs must stay unknown.
 const costCases=[0,10,30,60].map(bps=>({assumedRoundTripBps:bps,incrementalCostLabelPct:paired.length?round(extraTurnover*bps/100/paired.length):null,
  actualFeeVerified:false,netExecutableReturnPct:null}));
 return {...base,status:paired.length?'retrospective-route-diagnostic':'unknown',rows:out,pairedDays:paired.length,abstainedDays:rows.length-paired.length,
  routeSwitches:switches,observedBasketChanges:changedBaskets,meanGrossDifferencePct:round(mean(paired.map(r=>r.grossDifferencePct))),
  costSensitivity:costCases,continuousHoldingVerified:false,changesPromotionGate:false,
  note:'固定诊断路由使用原成熟保留集已封存环境及三版本排名。不是独立事前注册的生产择时模型；断档不连仓，换篮子比例与假设双边成本单列，真实成交、换手费用和净效用未知。'};
}
function horizonPairs(records){
 const groups=new Map(),receipts=new Map();let limitedGroups=0;
 for(const r of list(records)){
  const k=JSON.stringify([r.inputFingerprint,r.modelKey,r.symbol,r.provider,r.originDate]);
  const a=receipts.get(k)||[];a.push(r);receipts.set(k,a);
 }
 const single=[],multi=[];
 for(const a of receipts.values()){
  if(a.length!==1)continue; // cannot reinterpret multiple later receipts as multitask output
  const r=a[0],rows=list(r.rows);
  if(!rows.length||rows.length>4||new Set(rows.map(x=>x.horizon)).size!==rows.length)continue;
  (rows.length===1?single:multi).push(r);
 }
 const byInput=new Map();
 for(const r of single){
  for(const x of r.rows){
   const k=JSON.stringify([r.inputFingerprint,r.symbol,r.provider,r.originDate,x.horizon,x.targetDate,x.pointKind]);
   const a=byInput.get(k)||[];a.push({record:r,row:x});byInput.set(k,a);
  }
 }
 const valid=x=>x?.status==='observed-unverified'&&finite(x.actual)&&finite(x.absoluteError)&&!x.revisedOutcome&&!x.outcomeConflictSeen&&
  x.corporateActionEvidence==='declared-no-action'&&x.latestCorporateActionEvidence==='declared-no-action'&&hash(x.outcomeRunId);
 let expectedPairs=0,paired=0,immature=0,unavailable=0;
 for(const m of multi)for(const a of m.rows){
  const key=JSON.stringify([m.inputFingerprint,m.symbol,m.provider,m.originDate,a.horizon,a.targetDate,a.pointKind]),matches=byInput.get(key)||[];
  if(matches.length>16){limitedGroups++;continue;}
  for(const {record:s,row:b} of matches){
   if(m.modelKey===s.modelKey)continue;
   expectedPairs++;
   const k=JSON.stringify([m.modelKey,s.modelKey,m.provider,a.horizon,a.pointKind]);
   if(!groups.has(k)){
    if(groups.size>=256){limitedGroups++;unavailable++;continue;}
    groups.set(k,{multiModelKey:m.modelKey,singleModelKey:s.modelKey,provider:m.provider,horizon:a.horizon,pointKind:a.pointKind,expected:0,matured:0,pending:0,unusable:0,errorsA:[],errorsB:[],days:new Set()});
   }
   const g=groups.get(k);g.expected++;
   if(a.status==='pending'||b.status==='pending'){g.pending++;immature++;continue;}
   if(!valid(a)||!valid(b)||a.actual!==b.actual||a.outcomeRunId!==b.outcomeRunId){g.unusable++;unavailable++;continue;}
   g.matured++;paired++;g.errorsA.push(a.absoluteError);g.errorsB.push(b.absoluteError);g.days.add(m.originDate);
  }
 }
 return {status:paired?'paired-output-format-research':'insufficient-paired-evidence',singleReceiptGroups:single.length,multiReceiptGroups:multi.length,
  repeatedReceiptGroups:receipts.size-single.length-multi.length,expectedPairs,paired,pending:immature,unavailable,limitedGroups,
  rows:[...groups.values()].map(g=>({multiModelKey:g.multiModelKey,singleModelKey:g.singleModelKey,provider:g.provider,horizon:g.horizon,pointKind:g.pointKind,expected:g.expected,matured:g.matured,pending:g.pending,unusable:g.unusable,
   multiMae:round(mean(g.errorsA)),singleMae:round(mean(g.errorsB)),deltaMae: g.matured?round(mean(g.errorsA)-mean(g.errorsB)):null,signalDays:g.days.size,netTradingReturn:null})),
  multiTaskTrainingVerified:false,singleTaskTrainingVerified:false,independenceCertified:false,
  note:'单一回执的一期输出与多期输出按输入、目标、期限、点值口径及首次标签逐项配对。未成熟、修订、重复回执不借用其他期限；输出形态不是训练架构证明。',...flags};
}
function rankPerturbations({stocks,strategies,evaluate}={}){
 const base={status:'unknown',evaluatedConfigurations:0,rows:[],note:'只诊断原历史收盘观察；不替换真实报价、原风控或正式策略，不挑选最佳参数。',...flags};
 if(!Array.isArray(stocks)||stocks.length<2||stocks.length>20||new Set(stocks.map(s=>s.symbol)).size!==stocks.length||
 !stocks.every(s=>code(s.symbol)&&Array.isArray(s.bars)&&s.bars.length>=28)||!Array.isArray(strategies)||!strategies.length||typeof evaluate!=='function')return base;
 const specs=[{id:'baseline',pricePct:0,weightFactor:1},{id:'close-minus-0.5pct',pricePct:-.5,weightFactor:1},{id:'close-plus-0.5pct',pricePct:.5,weightFactor:1},
  {id:'first-family-weight-minus-2pct',pricePct:0,weightFactor:.98},{id:'first-family-weight-plus-2pct',pricePct:0,weightFactor:1.02}];
 const family=strategies[0].family||strategies[0].name;
 if(typeof family!=='string'||!family)return base;
 function variant(spec){
  const rows=[];let missing=0,hardBlocked=0;
  const definitions=strategies.map(s=>({...s,strategyWeight:(s.strategyWeight??1)*((s.family||s.name)===family?spec.weightFactor:1)}));
  for(const stock of stocks){
   const bars=stock.bars,last=bars.at(-1),prev=bars.at(-2);
   if(!last||!prev||!finite(last.close)||last.close<=0||!finite(prev.close)||prev.close<=0||!finite(last.high)||!finite(last.low)||last.high<last.close||last.low>last.close){missing++;continue;}
   const close=spec.pricePct===0?last.close:Math.round(last.close*(1+spec.pricePct/100)*100)/100;
   if(!finite(close)||close<=0||close>last.high||close<last.low||finite(last.upperLimit)&&close>last.upperLimit||finite(last.lowerLimit)&&close<last.lowerLimit){missing++;continue;}
   const copy={...stock,close,pctChange:(close/prev.close-1)*100,bars:[...bars.slice(0,-1),{...last,close}]};
   try{
    const r=evaluate(copy,definitions);
    if(!r||typeof r.pass!=='boolean'||typeof r.blocked!=='boolean'||!finite(r.finalScore)){missing++;continue;}
    if(r.blocked)hardBlocked++;
    rows.push({symbol:stock.symbol,score:r.finalScore,pass:r.pass&&!r.blocked,blocked:r.blocked});
   }catch{missing++;}
  }
  return {id:spec.id,pricePct:spec.pricePct,weightFactor:spec.weightFactor,missing,hardBlocked,rows};
 }
 const variants=specs.map(variant),baseline=variants[0];
 const ranked=v=>{
  const chosen=v.rows.filter(r=>r.pass),sorted=[...chosen].sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  return {rank:new Map(sorted.map(r=>[r.symbol,{best:1+sorted.filter(x=>x.score>r.score).length,worst:sorted.filter(x=>x.score>=r.score).length}])),top:sorted.length>3&&sorted[2].score===sorted[3].score?null:sorted.slice(0,3).map(r=>r.symbol)};
 };
 const b=ranked(baseline),before=new Map(baseline.rows.map(r=>[r.symbol,r]));
 return {...base,status:baseline.missing?'incomplete-baseline':'descriptive-perturbation',evaluatedConfigurations:variants.length,expectedSecurities:stocks.length,rows:variants.map(v=>{
  const a=ranked(v),complete=!v.missing&&!baseline.missing;
  const changes=v.rows.flatMap(r=>{const old=before.get(r.symbol);return old&&old.blocked!==r.blocked?[{symbol:r.symbol,from:old.blocked,to:r.blocked}]:[]});
  const flips=complete?v.rows.flatMap(r=>{const old=b.rank.get(r.symbol),next=a.rank.get(r.symbol);return old&&next&&(old.best!==next.best||old.worst!==next.worst)?[{symbol:r.symbol,before:old,after:next}]:[]}):null;
  return {id:v.id,pricePct:v.pricePct,weightFactor:v.weightFactor,missing:v.missing,hardBlocked:v.hardBlocked,rankChanges:flips,
   topKChanged:complete&&b.top!==null&&a.top!==null?JSON.stringify([...b.top].sort())!==JSON.stringify([...a.top].sort()):null,
   originalHardRiskTransitions:changes,originalHardRiskTransitionCoverageComplete:complete,executionAuthorized:false};
 }),costNetBenefit:null,productionParametersChanged:false};
}
function runtimeAttempt({manifestFingerprint,canonical,operatorMode,startedAt,elapsedMs,outcome,lastStatus,reportFingerprint}={}){
 const identity=hash(manifestFingerprint)?manifestFingerprint:null;
 if(!time(startedAt)||!finite(elapsedMs)||elapsedMs<0||elapsedMs>86400000||!['tick-success','tick-error'].includes(outcome)||
 typeof lastStatus!=='string'||! /^[a-z0-9-]{1,90}$/.test(lastStatus))throw Error('运行回执无效');
 return {schemaVersion:1,mode:'local-shadow-worker-attempt-v1',scope:canonical===true&&operatorMode===true?'canonical-operator-research':'offline-or-test-research',
  manifestFingerprint:identity,reportFingerprint:outcome==='tick-success'&&hash(reportFingerprint)?reportFingerprint:null,startedAt,elapsedMs:round(elapsedMs),outcome,lastStatus,
  failureStage:outcome==='tick-error'?'locked-worker-evaluation':null,processReceiptOnly:true,verifiedLive:false,...flags};
}
function validAttempt(r,at){
 return !!(r?.schemaVersion===1&&r.mode==='local-shadow-worker-attempt-v1'&&['canonical-operator-research','offline-or-test-research'].includes(r.scope)&&
 (r.manifestFingerprint===null||hash(r.manifestFingerprint))&&(r.reportFingerprint===null||hash(r.reportFingerprint))&&time(r.startedAt)&&r.startedAt<=at&&finite(r.elapsedMs)&&r.elapsedMs>=0&&r.elapsedMs<=86400000&&
 ['tick-success','tick-error'].includes(r.outcome)&&typeof r.lastStatus==='string'&&/^[a-z0-9-]{1,90}$/.test(r.lastStatus)&&
 (r.outcome==='tick-error'?r.reportFingerprint===null&&r.failureStage==='locked-worker-evaluation':r.failureStage===null)&&r.processReceiptOnly===true&&r.verifiedLive===false&&Object.entries(flags).every(([k,v])=>r[k]===v));
}
function runtimeProjection(pulse,manifestFingerprint,now){
 const base={status:'unknown',attempt:null,lastFailure:null,currentManifestMatches:null,realMarketExecutionVerified:false,...flags};
 if(!pulse||!pulse.attempt)return base;
 if(!validAttempt(pulse.attempt,now)||pulse.attempt.startedAt!==pulse.observedAt||pulse.attempt.outcome!==pulse.outcome||pulse.attempt.lastStatus!==pulse.lastStatus||
 pulse.lastFailure!=null&&(!validAttempt(pulse.lastFailure,now)||pulse.lastFailure.outcome!=='tick-error'||pulse.lastFailure.startedAt>pulse.observedAt))return {...base,status:'invalid-runtime-receipt'};
 const a=pulse.attempt,match=hash(manifestFingerprint)&&a.manifestFingerprint===manifestFingerprint;
 return {...base,status:match?'local-process-receipt':'manifest-unmatched-or-unknown',attempt:a,lastFailure:pulse.lastFailure??null,currentManifestMatches:match,modelProfitabilityVerified:false};
}
module.exports={routeDiagnostic,horizonPairs,rankPerturbations,runtimeAttempt,validAttempt,runtimeProjection};
