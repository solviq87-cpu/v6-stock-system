'use strict';
// Read-only projections of the existing frozen observations and rank comparison.
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const cn=t=>new Date(t+28800000).toISOString().slice(0,10);
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b/xs.length,0):null;
const states=['多头','震荡','空头'];
const validCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=10000;
function stamp(x){if(time(x))return x;if(typeof x!=='string')return null;const s=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(x)?x.replace(' ','T')+'+08:00':x;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!day(s.slice(0,10)))return null;const t=Date.parse(s);return time(t)?t:null;}
function marketStateAt(m,d,signalAt){
 if(!m||!day(d)||m.date!==d||!time(signalAt)||cn(signalAt)!==d||typeof m.source!=='string'||!m.source.trim()||m.source.length>160||/(?:fixture|mock|simulat|synthetic|demo|教学)/i.test(m.source)||['synthetic','simulated','mock','fixture','testSample','isTest','sourceConflict','conflict'].some(k=>m[k]===true)||['test','demo','synthetic'].includes(m.sampleSet)||!states.includes(m.trend)||!validCount(m.adv)||!validCount(m.dec)||m.adv+m.dec<100)return null;
 const clocks=[m.knownAt,m.availableAt,m.recordedAt].map(stamp);if(clocks.some(t=>t===null)||clocks[0]<Date.parse(d+'T15:00:00+08:00')||clocks[0]>clocks[1]||clocks[1]>clocks[2]||clocks[2]>signalAt)return null;
 const body={date:d,trend:m.trend,breadthUpPct:100*m.adv/(m.adv+m.dec),adv:m.adv,dec:m.dec,source:m.source,knownAt:clocks[0],availableAt:clocks[1],recordedAt:clocks[2],scope:'advancing-and-declining-only; flats and full-market coverage unknown'};
 return {...body,fingerprint:hash(body)};
}
// The already computed same-pool equal/linear daily labels are reused. The
// policy is fit ONLY on training dates; no fit on validation/test outcomes.
function compareStateAdaptation(phases,rankBaselines,{trainCutoff,validationCutoff,asOf}={}){
 const base={mode:'frozen-state-switch-comparison-v1',status:'unknown',reason:null,policy:null,training:null,validation:null,test:null,similarCases:null,switchPenaltyBps:20,netReturnPct:null,actualTradingCostsVerified:false,canTrade:false,canApprove:false,productionWeightsChanged:false};
 if(!rankBaselines||rankBaselines.status!=='descriptive-fold-comparison'||rankBaselines.canTrade!==false||rankBaselines.productionWeightsChanged!==false||!time(trainCutoff)||!time(validationCutoff)||!time(asOf)||!(trainCutoff<validationCutoff&&validationCutoff<=asOf))return {...base,reason:'original-paired-rank-fold-unavailable'};
 const data={};
 for(const [i,name] of ['train','validation','test'].entries()){
  const rows=phases?.[name],report=rankBaselines[name==='train'?'training':name],cutoff=[trainCutoff,validationCutoff,asOf][i];if(!Array.isArray(rows)||rows.length>10000||!Array.isArray(report?.days)||report.days.length>400||!Number.isSafeInteger(report.coverage?.attemptedDays)||report.coverage.attemptedDays<report.days.length||report.days.some((d,j)=>!day(d?.day)||!day(d.targetDate)||d.targetDate<=d.day||j&&d.day<=report.days[j-1].day||!Array.isArray(d.cells)))return {...base,reason:'invalid-original-phase'};
  const byDay=new Map();for(const r of rows){if(!byDay.has(r.day))byDay.set(r.day,[]);byDay.get(r.day).push(r);}
  const out=[];for(const d of report.days){const rs=byDay.get(d.day)||[],m=rs[0]?.marketStateEvidence;
   const valid=m&&states.includes(m.trend)&&finite(m.breadthUpPct)&&m.breadthUpPct>=0&&m.breadthUpPct<=100&&seal(m.fingerprint)&&hash(Object.fromEntries(Object.entries(m).filter(([k])=>k!=='fingerprint')))===m.fingerprint&&rs.length>=5&&rs.every(r=>r.market==='CN'&&r.marketStateEvidence?.fingerprint===m.fingerprint&&marketStateAt(r.marketStateEvidence,r.day,r.signalAt)?.fingerprint===m.fingerprint&&r.day===m.date&&time(r.signalAt)&&time(r.labelKnownAt)&&m.recordedAt<=r.signalAt&&r.signalAt<r.labelKnownAt&&r.labelKnownAt<cutoff&&r.targetDay===d.targetDate)&&d.cells.length===1&&d.cells[0]?.market==='CN'&&d.cells[0].equal?.rows===rs.length&&d.cells[0].linear?.rows===rs.length;
   const equal=d.cells?.[0]?.equal?.topKReturnPct,linear=d.cells?.[0]?.linear?.topKReturnPct;
   if(valid&&finite(equal)&&finite(linear))out.push({day:d.day,targetDate:d.targetDate,state:m.trend,breadthUpPct:m.breadthUpPct,stateFingerprint:m.fingerprint,signalAt:Math.min(...rs.map(r=>r.signalAt)),labelKnownAt:Math.max(...rs.map(r=>r.labelKnownAt)),equal,linear});
  }
  data[name]={attempted:report.coverage.attemptedDays,rows:out};
 }
 const fit=data.train.rows;if(fit.length<15||fit.length<Math.ceil(.8*data.train.attempted))return {...base,reason:'insufficient-frozen-state-training',training:{attempted:data.train.attempted,comparable:fit.length}};
 const policy=Object.fromEntries(states.map(s=>{const rs=fit.filter(r=>r.state===s),delta=mean(rs.map(r=>r.linear-r.equal));return [s,{samples:rs.length,meanTrainingDeltaPct:delta,model:rs.length>=10&&delta>.2?'linear':'equal'}];}));
 const policyFingerprint=hash({policy,training:fit,switchPenaltyBps:20,trainCutoff});
 const evaluate=({attempted,rows})=>{let previous='equal',lastTarget=null;const daily=rows.map(r=>{const model=policy[r.state].model,continuous=lastTarget===r.day;
  // Unknown intervening sessions cannot hide switch costs; reset and charge
  // a conservative additional switch when previous state is unavailable.
  const switches=continuous?Number(previous!==model):Number(previous!=='equal')+Number(model!=='equal');
  previous=model;lastTarget=r.targetDate;return {...r,model,switches,switchPenaltyPct:.2*switches,adaptiveLabelAfterSwitchPenaltyPct:r[model]-.2*switches};});
  const enough=daily.length>=5&&daily.length>=Math.ceil(.8*attempted);
  return {status:enough?'descriptive-only':'insufficient-common-days',attempted,comparable:daily.length,unknown:attempted-daily.length,switches:daily.reduce((n,r)=>n+r.switches,0),adaptiveLabelAfterSwitchPenaltyPct:enough?mean(daily.map(r=>r.adaptiveLabelAfterSwitchPenaltyPct)):null,equalLabelPct:enough?mean(daily.map(r=>r.equal)):null,linearLabelPct:enough?mean(daily.map(r=>r.linear)):null,incrementVsEqualPct:enough?mean(daily.map(r=>r.adaptiveLabelAfterSwitchPenaltyPct-r.equal)):null,daily};};
 const validation=evaluate(data.validation),test=evaluate(data.test),current=data.test.rows.at(-1);
 const cases=current?fit.filter(r=>r.state===current.state&&r.labelKnownAt<current.signalAt&&Math.abs(r.breadthUpPct-current.breadthUpPct)<=10).sort((a,b)=>Math.abs(a.breadthUpPct-current.breadthUpPct)-Math.abs(b.breadthUpPct-current.breadthUpPct)||a.day.localeCompare(b.day)).slice(0,20).map(r=>({...r,failedRelativeToEqual:r.linear<=r.equal})):[];
 return {...base,status:validation.status==='descriptive-only'&&test.status==='descriptive-only'?'descriptive-state-comparison':'insufficient-comparable-holdout',policy,policyFingerprint,training:{attempted:data.train.attempted,comparable:fit.length},validation,test,similarCases:{status:cases.length?'descriptive-historical-matches':'unknown',target:current?{day:current.day,state:current.state,breadthUpPct:current.breadthUpPct,signalAt:current.signalAt}:null,cases,failedCases:cases.filter(r=>r.failedRelativeToEqual).length,outcomeUsedForMatching:false},limitations:['original next-session price labels, not net executions','20bp assumed per model switch only; portfolio turnover, other costs and true gain unknown','no sample-out certification or promotion']};
}
// Existing catalog metadata is a declaration, never an inferred weight/data license.
function reviewCatalogRights(catalog,asOf){
 const base={mode:'pinned-catalog-rights-review-v1',status:'unknown',entries:[],runtimeAuthorized:false,canTrade:false,canApprove:false};
 if(!time(asOf)||!day(catalog?.reviewDate)||catalog.reviewDate>=cn(asOf))return base;
 try{require('../../scripts/build-model-library').validateCatalog(catalog);}catch{return {...base,reason:'original-catalog-validation-failed'};}
 const entries=catalog.entries.map(m=>({id:m.id,name:m.name,repository:m.repository,commit:m.commit,reviewedOn:m.reviewedOn,codeLicense:{declaration:m.license,sourceRefs:m.reads.map(r=>r.url),independentlyVerified:false},weightLicense:{declaration:m.weightsLicense,checkpointDigest:null,independentlyVerified:false},dataLicense:{declaration:null,datasetVersion:null,independentlyVerified:false},installed:m.installed,inferenceExecuted:m.inferenceExecuted,measuredAccuracy:null,measuredLatencyMs:null,runtimeAuthorized:false}));
 return {...base,status:'declared-rights-inventory',reviewDate:catalog.reviewDate,catalogFingerprint:hash(catalog),entries,codeVersionPinned:entries.filter(r=>r.commit).length,weightLicenseCertified:0,dataLicenseCertified:0};
}
module.exports={marketStateAt,compareStateAdaptation,reviewCatalogRights};
