'use strict';
/**
 * Deterministically propose a bounded research challenger from a PRIOR sealed
 * shadow report. This module never opens forward returns or extracts any
 * results from the future candidate's holdout.
 */
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/.test(id)&&
 !['__proto__','constructor','prototype'].includes(id);
const exactKeys=(x,ids)=>object(x)&&Object.keys(x).length===ids.length&&ids.every(id=>Object.hasOwn(x,id));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number(s.slice(0,4))>0&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
// A valid local hash is not a certificate of independent training evidence.
// Reconcile explicit producer summaries without rewriting legacy archives.
const own=(x,k)=>Object.hasOwn(x,k);
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const readOnly=x=>['canTrade','productionWeightsChanged'].every(k=>!own(x,k)||x[k]===false);
function reviewPriorEvidence(source,ids,acceptedWeights,suppressed){
 const fail=()=>{throw Error('自动预注册的历史训练证据摘要不一致');};
 const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=400;
 const observed=source.observedFingerprints,train=source.trainDays;
 if(own(source,'trainingEnd')&&(!validDate(source.trainingEnd)||source.trainingEnd>source.lastObservationDay)||
    own(source,'trainDays')&&(!count(train)||train===0)||
    own(source,'shadowWeights')&&(!exactKeys(source.shadowWeights,ids)||ids.some(id=>source.shadowWeights[id]!==acceptedWeights[id])))fail();
 if(own(source,'observedFingerprints')){
  if(!Array.isArray(observed)||!observed.length||observed.length>400||
     Array.from(observed).some(pair=>!Array.isArray(pair)||pair.length!==2||!seal(pair[0])||!seal(pair[1]))||
     new Set(observed.map(pair=>pair[0])).size!==observed.length||count(train)&&train>observed.length)fail();
 }
 if(own(source,'trialAudit')){
  const a=source.trialAudit;
  if(!object(a)||!readOnly(a)||a.schemaVersion!==1||a.status!=='consumed'||
     !validDate(a.firstHoldoutDay)||!validDate(a.lastHoldoutDay)||a.firstHoldoutDay>a.lastHoldoutDay||
     a.lastHoldoutDay>source.lastObservationDay||own(source,'trainingEnd')&&source.trainingEnd>=a.firstHoldoutDay||
     !count(a.holdoutDays)||a.holdoutDays<5||a.holdoutDays>1+(Date.parse(a.lastHoldoutDay)-Date.parse(a.firstHoldoutDay))/86400000||
     !seal(a.candidateFingerprint))fail();
 }
 const redundancy=source.factorRedundancy;
 if(own(source,'factorRedundancy')&&(!object(redundancy)||!readOnly(redundancy)||
    own(redundancy,'evidenceBasis')&&redundancy.evidenceBasis!=='frozen-training-only'||
    own(redundancy,'trainingDays')&&(!count(redundancy.trainingDays)||count(train)&&redundancy.trainingDays!==train)))fail();
 let structured=own(source,'trainingEnd')&&own(source,'trainDays')&&own(source,'observedFingerprints')&&own(source,'shadowWeights')&&own(source,'trialAudit');
 for(const id of ids){
  const row=source.factorLearning[id];
  if(!object(row)||!readOnly(row)||own(row,'reliable')&&typeof row.reliable!=='boolean')fail();
  const extended=['days','reasons','confidence','meanIC'].some(k=>own(row,k));
  const complete=['days','reasons','confidence','meanIC','reliable'].every(k=>own(row,k));
  structured=structured&&complete;
  if(own(row,'days')&&(!count(row.days)||count(train)&&row.days>train)||
     own(row,'confidence')&&(!finite(row.confidence)||row.confidence<0||row.confidence>1)||
     own(row,'meanIC')&&(row.meanIC!==null&&(!finite(row.meanIC)||Math.abs(row.meanIC)>1)||
       count(row.days)&&(row.days===0)!==(row.meanIC===null))||
     own(row,'reasons')&&(!Array.isArray(row.reasons)||Array.from(row.reasons).some(x=>typeof x!=='string'||!x)||new Set(row.reasons).size!==row.reasons.length))fail();
  if(extended&&row.reliable===false&&(row.suggestedWeightMultiplier!==0||
     own(row,'confidence')&&row.confidence!==0||own(row,'reasons')&&!row.reasons.length||suppressed.includes(id)))fail();
  if(own(row,'days')&&row.days<15&&(row.reliable===true||row.suggestedWeightMultiplier!==0)||
     row.reliable===true&&own(row,'reasons')&&row.reasons.length||
     finite(row.meanIC)&&row.meanIC*row.suggestedWeightMultiplier<0)fail();
 }
 return {grade:structured?'structured-summary-unverified':'legacy-summary-unverified',
  independenceCertified:false,trainingEligible:false,autoPromotion:false,sourceAuthenticated:false};
}
function proposeFromSealedResearch({source,definitions,acceptedWeights,
 packFingerprint,latestFrozenDay,allowUnchanged=false}={}){
 const {fingerprint,...payload}=source||{};
 if(!source||fingerprint!==hash(payload)||
    source.mode!=='v6-factor-shadow-evolution-v1'||
    !['shadow-updated','shadow-retained','paused-market-shock'].includes(source.status)||
    source.canTrade!==false||source.productionWeightsChanged!==false||
    typeof packFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(packFingerprint)||
    source.packFingerprint!==packFingerprint||
    !validDate(source.lastObservationDay)||!validDate(latestFrozenDay)||
    source.lastObservationDay>latestFrozenDay||
    !Array.isArray(definitions)||definitions.length<2||definitions.length>100||
    definitions.some(d=>!object(d))||!object(acceptedWeights))
  throw Error('自动预注册缺少有效的历史封存训练报告或因子定义');
 const ids=definitions.map(d=>d.id);
 if(new Set(ids).size!==ids.length||ids.some(id=>!validId(id))||
    JSON.stringify(source.factorIds)!==JSON.stringify(ids)||
    !exactKeys(source.factorLearning,ids)||!exactKeys(acceptedWeights,ids))
  throw Error('自动预注册的历史因子训练血缘不一致');
 const suppressed=source.factorRedundancy?.suppressedFactorIds??[];
 if(!Array.isArray(suppressed)||new Set(suppressed).size!==suppressed.length||suppressed.some(id=>!ids.includes(id)))
  throw Error('自动预注册的冗余因子证据无效');
 const evidenceReview=reviewPriorEvidence(source,ids,acceptedWeights,suppressed);
 const duplicates=new Set(suppressed);
 const proposal={},audit=[];
 for(const def of definitions){
  const id=def.id,old=acceptedWeights[id],original=def.baseWeight;
  const lo=Math.max(original*.5,old*.92),hi=Math.min(original*1.5,old*1.08);
  if(!finite(original)||original<=0||!finite(old)||old<=0||
     !finite(original*.5)||original*.5<=0||!finite(original*1.5)||
     old<original*.5||old>original*1.5||!finite(lo)||!finite(hi)||lo>hi)
   throw Error('自动预注册的基础及已接受权重边界无效');
  const learning=source.factorLearning[id];
  if(!learning||!finite(learning.suggestedWeightMultiplier)||
     Math.abs(learning.suggestedWeightMultiplier)>.08+1e-9)
   throw Error('自动预注册的因子训练增量无效');
  const adjustment=duplicates.has(id)?
   Math.min(learning.suggestedWeightMultiplier,-.02):
   learning.suggestedWeightMultiplier;
  // Round only the candidate, not its safety envelope. A zero change must
  // preserve the exact accepted value instead of consuming a trial by rounding.
  const next=adjustment===0?old:clamp(+clamp(old*(1+adjustment),lo,hi).toFixed(8),lo,hi);
  if(!finite(next)||next<=0)throw Error('自动预注册计算出无效研究权重');
  proposal[id]=next;
  audit.push({factorId:id,sourceMultiplier:learning.suggestedWeightMultiplier,
   redundancySuppressed:duplicates.has(id),proposedWeight:next});
 }
 if(!allowUnchanged&&ids.every(id=>proposal[id]===acceptedWeights[id]))
  throw Error('历史训练未产生新的研究候选，禁止伪造一次试验');
 return {status:'proposed-from-sealed-prior-training',candidateWeights:proposal,
  sourceFingerprint:fingerprint,sourceLastObservationDay:source.lastObservationDay,
  sourceStatus:source.status,weightChanges:audit,evidenceReview,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={proposeFromSealedResearch};
