'use strict';
// Read-only B-group audit of declared original backtest outputs. No execution,
// portfolio compounding, fitting, notification, or parameter promotion.
const {createHash}=require('node:crypto');
const VARIANTS=Object.freeze(['fixed','adaptive','fourteen','bazi','gpt','python']);
const ENV=Object.freeze(['rising-participation','rising-pullback','rising-narrow-watch','downtrend-narrow-watch','downtrend-rebound','downtrend-recovery','downtrend-decline','mixed-watch','unknown']);
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,autoPromotion:false,weightsChanged:false,certified:false,outOfSampleCertified:false});
const str=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=256;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const stamp=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const time=(d,t)=>Date.parse(d+'T'+t+'+08:00');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=x=>finite(x)&&x>=-100&&Math.abs(x)<=1000000;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const blocked=reason=>({status:'unknown',reason,...FLAGS});
const requireOK=(v,reason)=>{if(!v)throw Error(reason);};
const fingerprints=['scopeFingerprint','costFingerprint','riskFingerprint','executionFingerprint'];
const contractMatch=(a,b)=>fingerprints.every(k=>a?.[k]===b?.[k]);
// Register before first test date. Fixed versions across disjoint test windows;
// this is NOT a rolling refit or a verified pre-registration timestamp.
function freezeEvaluationPlan(input){
 try{
  const p=input;requireOK(p&&p.simulated!==true&&p.synthetic!==true&&p.schemaVersion===1&&p.mode==='paired-policy-shadow'&&stamp(p.registeredAt)&&str(p.registrationEvidenceId)&&fingerprints.every(k=>digest(p[k])),'plan-contract-invalid');
  const dates=p.calendar?.tradeDates;requireOK(p.calendar?.simulated!==true&&str(p.calendar?.source)&&str(p.calendar?.evidenceId)&&stamp(p.calendar?.knownAt)&&p.calendar.knownAt<=p.registeredAt&&Array.isArray(dates)&&dates.length>=5&&dates.length<=2500&&dates.every((d,i)=>dayOK(d)&&(!i||d>dates[i-1])),'calendar-invalid');
  requireOK([1,5,20,60].includes(p.horizon)&&Number.isSafeInteger(p.slots)&&p.slots>=1&&p.slots<=50&&str(p.benchmarkId)&&['eastmoney','tencent','native-replay'].includes(p.provider)&&p.versions&&Object.keys(p.versions).length===VARIANTS.length&&VARIANTS.every(v=>str(p.versions[v])),'comparison-config-invalid');
  const ix=new Map(dates.map((d,i)=>[d,i])),train=ix.get(p.trainingEnd),lag=p.horizon+1;
  requireOK(train!==undefined&&train+lag<dates.length&&stamp(p.trainingKnownAt)&&p.trainingKnownAt>=time(dates[train+lag],'15:10:00')&&p.trainingKnownAt<=p.registeredAt,'training-labels-not-mature');
  requireOK(Array.isArray(p.windows)&&p.windows.length>=2&&p.windows.length<=20,'evaluation-windows-invalid');
  let last=train;const windows=p.windows.map((w,i)=>{const a=ix.get(w?.start),z=ix.get(w?.end);requireOK(a!==undefined&&z!==undefined&&a<=z&&a>last+lag&&z+lag<dates.length&&p.registeredAt<time(dates[a],'00:00:00'),'window-overlap-or-registration-late');last=z;return {id:i+1,start:dates[a],end:dates[z],signalDates:dates.slice(a,z+1)};});
  const body={schemaVersion:1,mode:p.mode,registeredAt:p.registeredAt,registrationEvidenceId:p.registrationEvidenceId,calendar:{source:p.calendar.source,evidenceId:p.calendar.evidenceId,knownAt:p.calendar.knownAt,tradeDates:[...dates]},horizon:p.horizon,slots:p.slots,benchmarkId:p.benchmarkId,provider:p.provider,versions:Object.fromEntries(VARIANTS.map(v=>[v,p.versions[v]])),...Object.fromEntries(fingerprints.map(k=>[k,p[k]])),trainingEnd:p.trainingEnd,trainingKnownAt:p.trainingKnownAt,windows};
  return {...body,status:'declared-frozen',planId:hash(body),...FLAGS};
 }catch(e){return blocked(e.message);}
}
function verifyPlan(p){if(p?.status!=='declared-frozen')return false;const rebuilt=freezeEvaluationPlan(p);return rebuilt.status==='declared-frozen'&&rebuilt.planId===p.planId&&JSON.stringify(rebuilt.windows)===JSON.stringify(p.windows);}
function expectedDates(p,d){const dates=p.calendar.tradeDates,i=dates.indexOf(d);return {entryDate:dates[i+1],exitDate:dates[i+1+p.horizon]};}
function freezePolicyDecision(plan,input){
 try{
  requireOK(verifyPlan(plan),'plan-not-frozen');const d=input;
  requireOK(d&&d.simulated!==true&&d.synthetic!==true&&d.planId===plan.planId&&contractMatch(d,plan)&&str(d.evidenceId)&&plan.windows.some(w=>w.signalDates.includes(d.signalDate))&&stamp(d.signalAt)&&stamp(d.recordedAt)&&day(d.signalAt)===d.signalDate&&d.signalAt>=time(d.signalDate,'15:10:00')&&d.recordedAt>=d.signalAt&&d.recordedAt<time(expectedDates(plan,d.signalDate).entryDate,'09:30:00')&&d.signalAt>=plan.registeredAt,'decision-clock-or-contract-invalid');
  const e=d.environment;requireOK(e&&e.simulated!==true&&e.synthetic!==true&&ENV.includes(e.label)&&e.tradeDate===d.signalDate&&str(e.evidenceId)&&stamp(e.observedAt)&&stamp(e.knownAt)&&day(e.observedAt)===d.signalDate&&e.observedAt<=e.knownAt&&e.knownAt<=d.signalAt,'environment-not-known-at-decision');
  requireOK(Array.isArray(d.candidates)&&d.candidates.length<=10000&&Number.isSafeInteger(d.expectedCandidateCount)&&d.expectedCandidateCount===d.candidates.length&&str(d.universeEvidenceId),'frozen-candidate-denominator-invalid');
  const seen=new Set();const candidates=d.candidates.map(c=>{requireOK(c&&c.simulated!==true&&c.synthetic!==true&&code(c.code)&&!seen.has(c.code)&&['pass','blocked','unknown'].includes(c.risk)&&str(c.evidenceId)&&stamp(c.knownAt)&&c.knownAt<=d.signalAt,'candidate-identity-or-risk-clock-invalid');seen.add(c.code);return {code:c.code,risk:c.risk,evidenceId:c.evidenceId,knownAt:c.knownAt};}).sort((a,b)=>a.code.localeCompare(b.code));
  requireOK(d.selections&&Object.keys(d.selections).length===VARIANTS.length,'missing-variant-selection');const selections={};
  for(const v of VARIANTS){const s=d.selections[v];requireOK(s&&s.simulated!==true&&s.synthetic!==true&&s.version===plan.versions[v]&&str(s.evidenceId)&&stamp(s.knownAt)&&day(s.knownAt)===d.signalDate&&s.knownAt<=d.signalAt&&(v!=='adaptive'||s.knownAt>=e.knownAt)&&Array.isArray(s.codes)&&s.codes.length<=plan.slots&&new Set(s.codes).size===s.codes.length&&s.codes.every(c=>seen.has(c)),'selection-version-budget-or-identity-invalid');selections[v]={version:s.version,evidenceId:s.evidenceId,knownAt:s.knownAt,codes:[...s.codes]};}
  requireOK(e.label!=='unknown'||selections.adaptive.codes.length===0,'unknown-environment-must-abstain');
  const body={planId:plan.planId,signalDate:d.signalDate,signalAt:d.signalAt,recordedAt:d.recordedAt,evidenceId:d.evidenceId,...Object.fromEntries(fingerprints.map(k=>[k,d[k]])),environment:{label:e.label,tradeDate:e.tradeDate,evidenceId:e.evidenceId,observedAt:e.observedAt,knownAt:e.knownAt},universeEvidenceId:d.universeEvidenceId,expectedCandidateCount:d.expectedCandidateCount,candidates,selections};
  return {...body,status:'declared-frozen',decisionId:hash(body),...FLAGS};
 }catch(e){return blocked(e.message);}
}
function verifyDecision(p,d){if(d?.status!=='declared-frozen')return false;const f=freezePolicyDecision(p,d);return f.status==='declared-frozen'&&f.decisionId===d.decisionId;}
function readOutcome(p,d,o,asOf){
 const {entryDate,exitDate}=expectedDates(p,d.signalDate);
 if(!o||o.planId!==p.planId||o.decisionId!==d.decisionId||!code(o.code)||!contractMatch(o,p)||o.entryDate!==entryDate||o.exitDate!==exitDate||o.origin!=='original-backtest-paper-estimate'||o.priceBasis!=='unadjusted'||o.provider!==p.provider||!str(o.evidenceId)||!stamp(o.knownAt)||!stamp(o.recordedAt)||o.knownAt<time(exitDate,'15:10:00')||o.recordedAt<o.knownAt||o.recordedAt>asOf||o.simulated===true||o.synthetic===true||o.sampleSet==='demo')return null;
 if(o.status==='entry-blocked'&&o.noEntry===true&&str(o.reason)&&o.netReturnPct===null&&o.grossReturnPct===null&&o.benchmarkReturnPct===null)return {kind:'entry-blocked',provider:o.provider,evidenceId:o.evidenceId};
 if(o.status!=='paper-estimate'||!pct(o.netReturnPct)||!pct(o.grossReturnPct)||o.netReturnPct>o.grossReturnPct+1e-8||o.benchmarkId!==p.benchmarkId||!pct(o.benchmarkReturnPct))return null;
 return {kind:'modeled',net:o.netReturnPct,relative:o.netReturnPct-o.benchmarkReturnPct,benchmark:o.benchmarkReturnPct,provider:o.provider,evidenceId:o.evidenceId};
}
function summarize(rows){
 const metrics={};for(const v of VARIANTS){const values=rows.map(r=>r.variants[v].netSlotMeanPct),relative=rows.map(r=>r.variants[v].relativeSlotContributionPp).filter(finite);metrics[v]={meanNetSlotPct:mean(values),meanRelativeSlotContributionPp:mean(relative),relativeObservedDays:relative.length,worstDaySlotPct:values.length?Math.min(...values):null,negativeDays:values.filter(n=>n<0).length,selected:rows.reduce((s,r)=>s+r.variants[v].selected,0),modeled:rows.reduce((s,r)=>s+r.variants[v].modeled,0),entryBlocked:rows.reduce((s,r)=>s+r.variants[v].entryBlocked,0),riskVeto:rows.reduce((s,r)=>s+r.variants[v].riskVeto,0),negativeModeled:rows.reduce((s,r)=>s+r.variants[v].negativeModeled,0),positiveUnselected:rows.reduce((s,r)=>s+r.variants[v].positiveUnselected,0)};}
 const paired=rows.map(r=>r.variants.adaptive.netSlotMeanPct-r.variants.fixed.netSlotMeanPct);
 // Select chronological non-overlap episodes for sample disclosure, not CI.
 let end=null;const episodes=rows.filter(r=>{if(end!==null&&r.entryDate<=end)return false;end=r.exitDate;return true;});
 return {days:rows.length,nonOverlapDays:episodes.length,metrics,adaptiveMinusFixedPp:mean(paired),nonOverlapAdaptiveMinusFixedPp:mean(episodes.map(r=>r.variants.adaptive.netSlotMeanPct-r.variants.fixed.netSlotMeanPct))};
}
function evaluateFrozenPolicies(plan,decisions,outcomes,{asOf}={}){
 const fail=reason=>({...blocked(reason),days:[],byEnvironment:{},byWindow:[],diagnosis:[]});
 if(!verifyPlan(plan)||!stamp(asOf)||asOf<plan.registeredAt||!Array.isArray(decisions)||decisions.length>2500||!Array.isArray(outcomes)||outcomes.length>100000)return fail('evaluation-input-invalid');
 const dates=plan.windows.flatMap(w=>w.signalDates),dateSet=new Set(dates),byDate=new Map(),byId=new Map(),dupes=new Set();
 for(const d of decisions){if(stamp(d?.recordedAt)&&d.recordedAt>asOf)continue;if(!verifyDecision(plan,d))return fail('decision-integrity-invalid');if(!dateSet.has(d.signalDate))return fail('unexpected-decision');if(byDate.has(d.signalDate))dupes.add(d.signalDate);else byDate.set(d.signalDate,d);byId.set(d.decisionId,new Set(d.candidates.filter(c=>c.risk==='pass').map(c=>c.code)));}
 const grouped=new Map();for(const o of outcomes){if(stamp(o?.recordedAt)&&o.recordedAt>asOf)continue;const d=byId.get(o?.decisionId);if(!d||!d.has(o.code))return fail('unexpected-outcome-or-risk-scope');const k=o.decisionId+'/'+o.code;if(grouped.has(k))grouped.set(k,null);else grouped.set(k,o);}
 const days=[];for(const w of plan.windows)for(const signalDate of w.signalDates){const d=byDate.get(signalDate),h=expectedDates(plan,signalDate),base={window:w.id,signalDate,...h,environment:dupes.has(signalDate)?'unknown':d?.environment.label??'unknown',decisionId:dupes.has(signalDate)?null:d?.decisionId??null};const bad=reason=>days.push({...base,status:'not-evaluated',reason});
  if(dupes.has(signalDate)){bad('duplicate-decision');continue;}
  if(!d||d.recordedAt>asOf){bad('decision-missing-or-not-known');continue;}
  if(asOf<time(h.exitDate,'15:10:00')){bad('label-not-mature');continue;}
  if(d.candidates.some(c=>c.risk==='unknown')){bad('risk-evidence-unknown');continue;}
  const results=new Map();for(const c of d.candidates.filter(c=>c.risk==='pass')){const o=readOutcome(plan,d,grouped.get(d.decisionId+'/'+c.code),asOf);if(o)results.set(c.code,o);}
  if(results.size!==d.candidates.filter(c=>c.risk==='pass').length){bad('common-outcome-incomplete-or-invalid');continue;}
  const sourceRows=[...results.values()],bench=sourceRows.filter(o=>o.kind==='modeled').map(o=>o.benchmark);
  if(new Set(sourceRows.map(o=>o.provider)).size>1||bench.some(v=>Math.abs(v-bench[0])>1e-8)){bad('common-provider-or-benchmark-conflict');continue;}
  const variants={};for(const v of VARIANTS){const selected=d.selections[v].codes,denied=selected.filter(c=>!results.has(c)),execution=selected.map(c=>results.get(c)).filter(Boolean),modeled=execution.filter(o=>o.kind==='modeled');variants[v]={selected:selected.length,riskVeto:denied.length,entryBlocked:execution.length-modeled.length,modeled:modeled.length,netSlotMeanPct:modeled.reduce((s,o)=>s+o.net,0)/plan.slots,relativeSlotContributionPp:modeled.length?modeled.reduce((s,o)=>s+o.relative,0)/plan.slots:null,negativeModeled:modeled.filter(o=>o.net<0).length,positiveUnselected:[...results].filter(([c,o])=>!selected.includes(c)&&o.kind==='modeled'&&o.net>0).length};}
  days.push({...base,status:'descriptive-unverified',reason:null,outcomeEvidenceIds:sourceRows.map(o=>o.evidenceId),variants});
 }
 const done=days.filter(d=>d.status==='descriptive-unverified'),byEnvironment={},byWindow=[];
 for(const env of ENV){const all=days.filter(d=>d.environment===env),rows=done.filter(d=>d.environment===env);if(all.length)byEnvironment[env]={expectedDays:all.length,coverage:rows.length/all.length,...summarize(rows)};}
 for(const w of plan.windows){const all=days.filter(d=>d.window===w.id),rows=done.filter(d=>d.window===w.id);byWindow.push({id:w.id,expectedDays:all.length,coverage:rows.length/all.length,...summarize(rows)});}
 const diagnosis=[];const previous=plan.windows.at(-2).id,recent=plan.windows.at(-1).id;
 for(const env of ENV.filter(e=>e!=='unknown')){const a=days.filter(d=>d.window===previous&&d.environment===env),b=days.filter(d=>d.window===recent&&d.environment===env);if(!a.length&&!b.length)continue;const x=summarize(a.filter(d=>d.status==='descriptive-unverified')),y=summarize(b.filter(d=>d.status==='descriptive-unverified'));
  const ready=days.filter(d=>[previous,recent].includes(d.window)).every(d=>d.status==='descriptive-unverified'&&d.environment!=='unknown')&&x.days===a.length&&y.days===b.length&&x.nonOverlapDays>=3&&y.nonOverlapDays>=3;
  const change=ready?y.nonOverlapAdaptiveMinusFixedPp-x.nonOverlapAdaptiveMinusFixedPp:null;diagnosis.push({environment:env,previous:x,recent:y,changePp:change,status:!ready?'insufficient-comparable-evidence':change<=-1&&y.nonOverlapAdaptiveMinusFixedPp<0?'adaptive-deterioration-review':'no-descriptive-threshold-breach',cause:'not-established'});}
 return {schemaVersion:1,mode:'paired-policy-shadow-audit',status:done.length?'descriptive-unverified':'unknown',reason:done.length?null:'no-mature-common-days',planId:plan.planId,asOf,expectedDays:dates.length,evaluatedDays:done.length,coverage:done.length/dates.length,days,byEnvironment,byWindow,diagnosis,overall:summarize(done),environmentAccuracy:null,portfolioDrawdown:null,actualDelivery:null,...FLAGS};
}
module.exports={freezeEvaluationPlan,freezePolicyDecision,evaluateFrozenPolicies};
