'use strict';
// Original frozen forecast evaluator and catalog; no inference, downloading,
// uploaded code execution, external calls, approval, or weight changes.
const catalog=require('../../config/open-model-library-20261114.json');
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const id=x=>typeof x==='string'&&/^[\w./@:+-]{1,160}$/.test(x)&&!x.includes('://');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const flags={researchOnly:true,canTrade:false,canNotify:false,canRun:false,licenseIndependentlyVerified:false,runtimeIndependentlyVerified:false,independentValueVerified:false,autoPromotion:false,productionWeightsChanged:false};
const ref=x=>{if(!x||!hash(x.sha256)||typeof x.url!=='string'||x.url.length>2000)return false;try{const u=new URL(x.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
function declaredProfile(p,asOf){
 const entry=catalog.entries.find(e=>e.id===p.catalogId&&e.category==='forecast'&&e.commit===p.catalogCommit);
 return entry&&p.kind==='foundation-model-profile'&&p.inputOrigin==='explicit-private-import'&&p.independentlyVerified===false&&hash(p.archiveHash)&&time(p.recordedAt)&&p.recordedAt===p.firstKnownAt&&p.recordedAt<=asOf&&time(p.validFrom)&&time(p.validUntil)&&p.validFrom<=p.recordedAt&&asOf<=p.validUntil&&p.useScope==='research-only'&&id(p.modelId)&&id(p.modelRevision)&&hash(p.weightsHash)&&date(p.trainingCutoff)&&ref(p.codeLicenseRef)&&ref(p.weightsLicenseRef)&&ref(p.trainingDataLicenseRef)&&positive(p.maxLatencyMs)&&positive(p.maxPeakMemoryMb)?entry:null;
}
function reviewFoundationReadiness(visibleRows,{asOf,forecastEvaluation}={}){
 const base={task:'F10.4',mode:'foundation-recovery-research-v1',status:'blocked',...flags,profiles:[],catalogCandidates:catalog.entries.filter(e=>e.category==='forecast').map(e=>({id:e.id,name:e.name,commit:e.commit,weightsLicense:e.weightsLicense})),blockers:['no-exact-licensed-checkpoint-budget-and-original-forward-evidence']};
 if(!time(asOf)||!Array.isArray(visibleRows)||visibleRows.length>500)return base;
 const declared=visibleRows.filter(p=>p?.kind==='foundation-model-profile');if(!declared.length)return base;
 const eligible=declared.map(p=>({p,entry:declaredProfile(p,asOf)})).filter(x=>x.entry);
 if(eligible.length!==declared.length||eligible.length>10||new Set(eligible.map(x=>JSON.stringify([x.p.modelId,x.p.modelRevision,x.p.weightsHash]))).size!==eligible.length)return {...base,blockers:['incomplete-or-duplicate-declared-rights-and-budget']};
 let evaluation;try{evaluation=typeof forecastEvaluation==='function'?forecastEvaluation():null;}catch{return {...base,blockers:['original-forward-archive-unavailable']};}
 if(evaluation?.mode!=='frozen-model-forward-evaluation'||evaluation.status!=='available'||evaluation.scope?.symbol!==null||evaluation.scope?.runId!==null||evaluation.offset!==0||!Array.isArray(evaluation.groups)||evaluation.groupTotal!==evaluation.groups.length)return {...base,blockers:['complete-original-forward-archive-required']};
 const profiles=eligible.map(({p,entry})=>{
  const groups=evaluation.groups.filter(g=>g.model?.id===p.modelId&&g.model?.revision===p.modelRevision&&g.model?.weightsHash===p.weightsHash&&g.model?.trainingCutoff===p.trainingCutoff),rows=[];
  for(const g of groups){const f=g.foundationWindows,r=g.resourceEvidence;
   const knownBefore=time(r?.firstForecastRecordedAt)&&time(r?.lastForecastRecordedAt)&&p.recordedAt<=r.firstForecastRecordedAt&&p.validFrom<=r.firstForecastRecordedAt&&r.firstForecastRecordedAt<=r.lastForecastRecordedAt&&r.lastForecastRecordedAt<=p.validUntil&&r.lastForecastRecordedAt<=asOf;
   const budget=knownBefore&&r.independentlyVerified===false&&Number.isSafeInteger(g.matured)&&g.matured>=30&&r.samples===g.matured&&positive(r.maxLatencyMs)&&positive(r.maxPeakMemoryMb)?r.maxLatencyMs<=p.maxLatencyMs&&r.maxPeakMemoryMb<=p.maxPeakMemoryMb:null;
   const paired=knownBefore&&g.completeDueOutcomeEvidence===true&&g.feedbackReview?.status==='manual-review-only'&&f?.status==='descriptive-two-blocks'&&f.independenceCertified===false&&f.bothBlocksImproved===true&&Array.isArray(f.blocks)&&f.blocks.length===2&&f.blocks.every(b=>b.bothBaselinesBeaten===true&&b.windows>=5);
   rows.push({provider:g.provider,horizon:g.horizon,matured:g.matured,knownBeforeForecast:knownBefore,declaredBudgetWithinLimit:budget,descriptiveTwoBlockImprovement:!!paired,resourceEvidence:r??null,foundationWindows:f??null});
  }
  return {catalogId:entry.id,modelId:p.modelId,modelRevision:p.modelRevision,weightsHash:p.weightsHash,trainingCutoff:p.trainingCutoff,archiveHash:p.archiveHash,declaredBudget:{maxLatencyMs:p.maxLatencyMs,maxPeakMemoryMb:p.maxPeakMemoryMb},rows,externalReviewStillRequired:true};
 });
 const comparable=profiles.some(p=>p.rows.some(r=>r.knownBeforeForecast&&r.declaredBudgetWithinLimit===true&&r.descriptiveTwoBlockImprovement));
 return {...base,status:comparable?'declarations-and-original-results-await-independent-review':'blocked',profiles,blockers:comparable?['independent-checkpoint-data-license-resource-and-value-review-required']:['missing-complete-matured-paired-forecast-or-budget-evidence','independent-review-required']};
}
module.exports={reviewFoundationReadiness};
