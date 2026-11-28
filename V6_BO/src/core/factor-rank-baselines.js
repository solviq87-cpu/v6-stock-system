'use strict';
// A deterministic descriptive comparison on the original walk-forward folds.
// The caller supplies the original training-only orthogonal projection and
// redundancy decision. No new learner, order, weight update or promotion.
const {createHash}=require('node:crypto');
const {spearman}=require('./factor-redundancy');
const {assessFactorMarginalContribution}=require('./factor-marginal-contribution');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const mean=xs=>xs.length?xs.reduce((s,v)=>s+v/xs.length,0):null;
const TOP_K=3;
function compareFrozenRankModels({phases,factorIds,markets,trainingFingerprint,redundancy,trainCutoff,validationCutoff,asOf,minRows=5,minTrainDays=15}={}){
 const base={mode:'same-pool-frozen-rank-baselines-v1',status:'unknown',reason:null,retainedFactors:[],suppressedFactors:[],training:null,validation:null,test:null,weights:null,trainingFingerprint:null,marginalContribution:null,tree:{status:'not-run',reason:'requires-licensed-model-same-pool-cost-and-independent-validation'},netReturnPct:null,executionCostsVerified:false,outOfSampleCertified:false,canTrade:false,canApprove:false,productionWeightsChanged:false};
 const bad=(reason,extra={})=>({...base,...extra,reason});
 const names=['train','validation','test'];
 if(!phases||!names.every(n=>Array.isArray(phases[n]))||names.reduce((n,k)=>n+phases[k].length,0)>10000||!Array.isArray(factorIds)||factorIds.length<1||factorIds.length>128||!Array.from(factorIds).every(id)||new Set(factorIds).size!==factorIds.length||!Array.isArray(markets)||!markets.length||markets.length>10||!Array.from(markets).every(id)||new Set(markets).size!==markets.length||typeof trainingFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(trainingFingerprint)||![trainCutoff,validationCutoff,asOf].every(time)||!(trainCutoff<validationCutoff&&validationCutoff<=asOf)||!Number.isSafeInteger(minRows)||minRows<5||minRows>500||!Number.isSafeInteger(minTrainDays)||minTrainDays<15||minTrainDays>400)return bad('invalid-original-fold');
 if(!redundancy||!Array.isArray(redundancy.suppressedFactors)||redundancy.canTrade!==false||redundancy.productionWeightsChanged!==false)return bad('original-redundancy-review-unavailable');
 const excluded=new Set(redundancy.suppressedFactors.map(r=>r?.factorId)),ids=factorIds.filter(f=>!excluded.has(f));
 const context={retainedFactors:ids,suppressedFactors:factorIds.filter(f=>excluded.has(f)),trainingFingerprint};
 if(!ids.length)return bad('no-retained-orthogonal-factors',context);
 if(names.reduce((n,k)=>n+phases[k].length,0)*ids.length>300000)return bad('rank-comparison-work-budget',context);
 const sets={},seen=new Set(),rowCounts={};
 for(const [i,name] of names.entries()){
  const rows=phases[name],cutoff=[trainCutoff,validationCutoff,asOf][i],groups=new Map();
  for(const r of rows){
   const key=JSON.stringify([r?.market,r?.code,r?.day]);
   if(!r||!id(r.code)||!markets.includes(r.market)||!day(r.day)||!day(r.targetDay)||r.targetDay<=r.day||!time(r.signalAt)||!time(r.labelKnownAt)||r.signalAt>=r.labelKnownAt||r.labelKnownAt>=cutoff||!finite(r.returnPct)||r.returnPct< -100||seen.has(key)||i>0&&r.signalAt<[trainCutoff,validationCutoff][i-1])return bad('invalid-or-duplicate-point-in-time-row',context);
   seen.add(key);if(!groups.has(r.day))groups.set(r.day,new Map());const cells=groups.get(r.day);if(!cells.has(r.market))cells.set(r.market,[]);cells.get(r.market).push(r);
  }
  const allDates=[...groups.keys()].sort(),days=[];let excludedRows=0;
  for(const d of allDates){const cells=markets.map(m=>({market:m,rows:groups.get(d).get(m)||[]})),all=cells.flatMap(c=>c.rows);
   // No selective omission of a losing row or a market with a missing field.
   if(cells.some(c=>c.rows.length<minRows||c.rows.some(r=>ids.some(k=>!finite(r.values?.[k]))))||new Set(all.map(r=>r.targetDay)).size!==1){excludedRows+=all.length;continue;}
   days.push({day:d,targetDate:all[0].targetDay,cells});
  }
  sets[name]=days;rowCounts[name]={attemptedRows:rows.length,attemptedDays:allDates.length,completeRows:rows.length-excludedRows,completeDays:days.length,excludedRows,excludedDays:allDates.length-days.length};
 }
 const nonempty=names.map(n=>sets[n]).filter(s=>s.length);
 if(nonempty.some((s,i)=>i&&(nonempty[i-1].at(-1).day>=s[0].day||nonempty[i-1].some(d=>d.targetDate>=s[0].day))))return bad('overlapping-fold-or-label-window',context);
 const work={factorIcCalls:0,scoreCalls:0,scoreProducts:0,topKComparisons:0};
 const fit=[];
 for(const d of sets.train){const correlations=ids.map(k=>d.cells.map(c=>{work.factorIcCalls++;return spearman(c.rows.map(r=>r.values[k]),c.rows.map(r=>r.returnPct));}));if(correlations.some(a=>!a.every(finite)))continue;fit.push({day:d.day,ics:correlations.map(mean)});}
 if(fit.length<minTrainDays||fit.length<Math.ceil(.8*rowCounts.train.attemptedDays))return bad('insufficient-common-training-ic',{...context,coverage:rowCounts,work});
 const trainingIC=Object.fromEntries(ids.map((k,i)=>[k,mean(fit.map(d=>d.ics[i]))]));
 const orientation=Object.fromEntries(ids.map(k=>[k,trainingIC[k]<0?-1:1])),equal=Object.fromEntries(ids.map(k=>[k,1]));
 const raw=ids.map(k=>Math.max(.0001,Math.abs(trainingIC[k]))),scale=mean(raw),linear=Object.fromEntries(ids.map((k,i)=>[k,raw[i]/scale]));
 const weights={orientation,equal,linear,trainingIC,fitDays:fit.map(d=>d.day),frozenFrom:'original-training-only',fingerprint:hash([trainingFingerprint,ids,orientation,linear,fit.map(d=>d.day)])};
 function scores(rows,w){work.scoreCalls+=rows.length;work.scoreProducts+=rows.length*ids.length;return rows.map(r=>ids.reduce((n,k)=>n+r.values[k]*orientation[k]*w[k]/ids.length,0));}
 function cellMetric(cell,w,topK=true){const rows=cell.rows,values=scores(rows,w),outcomes=rows.map(r=>r.returnPct);if(!values.every(finite))return null;
  work.factorIcCalls++;const ic=spearman(values,outcomes);if(!topK)return finite(ic)?{ic}:null;
  // A boundary tie shares the remaining Top-K slots instead of arbitrarily
  // choosing whichever equal score happened to have a profitable outcome.
  work.topKComparisons++;const threshold=[...values].sort((a,b)=>b-a)[TOP_K-1],greater=values.filter(v=>v>threshold).length,ties=values.filter(v=>v===threshold).length,share=(TOP_K-greater)/ties;
  const topKReturnPct=mean([rows.reduce((n,r,i)=>n+r.returnPct*(values[i]>threshold?1:values[i]===threshold?share:0)/TOP_K,0)]);
  return finite(topKReturnPct)?{ic:finite(ic)?ic:null,topKReturnPct,universeReturnPct:mean(outcomes),tiedBoundary:ties>1,rows:rows.length}:null;
 }
 function evaluate(name){const days=[];for(const d of sets[name]){const cells=d.cells.map(c=>({market:c.market,equal:cellMetric(c,equal),linear:cellMetric(c,linear)}));if(cells.some(c=>!c.equal||!c.linear))continue;days.push({day:d.day,targetDate:d.targetDate,cells});}
  const all=days.flatMap(d=>d.cells),summary=type=>({meanTopKPriceLabelPct:mean(days.map(d=>mean(d.cells.map(c=>c[type].topKReturnPct)))),meanRankIC:mean(days.filter(d=>d.cells.every(c=>finite(c[type].ic))).map(d=>mean(d.cells.map(c=>c[type].ic)))),rankIcDays:days.filter(d=>d.cells.every(c=>finite(c[type].ic))).length,meanUniverseLabelPct:mean(days.map(d=>mean(d.cells.map(c=>c[type].universeReturnPct)))),tiedBoundaryCells:all.filter(c=>c[type].tiedBoundary).length});
  const enough=days.length>=(name==='train'?minTrainDays:5)&&days.length>=Math.ceil(.8*rowCounts[name].attemptedDays);
  return {status:enough?'descriptive-only':'insufficient-common-days',coverage:{...rowCounts[name],evaluatedDays:days.length},equal:enough?summary('equal'):null,linear:enough?summary('linear'):null,pairedTopKDeltaPct:enough?mean(days.map(d=>mean(d.cells.map(c=>c.linear.topKReturnPct-c.equal.topKReturnPct)))):null,days};
 }
 const training=evaluate('train'),validation=evaluate('validation'),test=evaluate('test');
 let marginalContribution={status:'not-evaluated',reason:'original-marginal-work-budget-or-insufficient-factors'};
 if(ids.length>=2&&ids.length<=12&&names.reduce((n,k)=>n+phases[k].length,0)*ids.length*ids.length*2<=1000000&&names.every(n=>sets[n].length<=400)){
  const score=(days,_,w)=>{const values=days.map(d=>d.cells.map(c=>cellMetric(c,w,false)));if(values.some(cs=>cs.some(c=>!c)))return {days:0,meanIC:null};return {days:values.length,meanIC:mean(values.map(cs=>mean(cs.map(c=>c.ic))))};};
  try{marginalContribution=assessFactorMarginalContribution({training:sets.train,validation:sets.validation,holdout:sets.test,ids,acceptedWeights:equal,proposedWeights:linear,score});}catch(error){marginalContribution={status:'not-evaluated',reason:String(error.message).slice(0,180)};}
 }
 return {...base,...context,status:[training,validation,test].every(p=>p.status==='descriptive-only')?'descriptive-fold-comparison':'insufficient-phase-samples',training,validation,test,weights,marginalContribution,work,topK:TOP_K,labelMeaning:'original-next-session-close-to-close-price-label-before-costs; not simulated fills',rankingChanges:false};
}
module.exports={compareFrozenRankModels};
