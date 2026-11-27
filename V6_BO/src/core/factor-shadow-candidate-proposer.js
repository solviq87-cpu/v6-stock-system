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
const ownData=(x,k)=>{const d=Object.getOwnPropertyDescriptor(x,k);return !!d&&d.enumerable&&Object.hasOwn(d,'value');};
const dataRecord=x=>object(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x))&&
 Reflect.ownKeys(x).every(k=>typeof k==='string'&&ownData(x,k));
const dataArray=x=>Array.isArray(x)&&Object.getPrototypeOf(x)===Array.prototype&&
 Reflect.ownKeys(x).length===x.length+1&&Array.from({length:x.length},(_,i)=>i).every(i=>ownData(x,i));
// A JSON seal must cover the values used by the proposer. Reject accessors,
// hidden data and non-JSON values before computing or consuming the seal.
function jsonData(x,ancestors=new Set(),budget={left:500000},depth=0){
 if(--budget.left<0||depth>40)return false;
 if(x===null||typeof x==='boolean'||typeof x==='string'||finite(x))return true;
 if(typeof x!=='object'||ancestors.has(x)||!(Array.isArray(x)?x.length<=500000&&dataArray(x):dataRecord(x)))return false;
 ancestors.add(x);const ok=Object.values(x).every(v=>jsonData(v,ancestors,budget,depth+1));ancestors.delete(x);return ok;
}
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/.test(id)&&
 !Object.hasOwn(Object.prototype,id)&&id!=='prototype';
const exactKeys=(x,ids)=>dataRecord(x)&&Object.keys(x).length===ids.length&&ids.every(id=>ownData(x,id));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number(s.slice(0,4))>0&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function proposeFromSealedResearch({source,definitions,acceptedWeights,
 packFingerprint,latestFrozenDay,allowUnchanged=false}={}){
 if(!dataRecord(source)||!jsonData(source)||typeof allowUnchanged!=='boolean')
  throw Error('自动预注册历史封存训练报告或输入类型无效');
 const {fingerprint,...payload}=source;
 if(fingerprint!==hash(payload)||
    source.mode!=='v6-factor-shadow-evolution-v1'||
    !['shadow-updated','shadow-retained','paused-market-shock'].includes(source.status)||
    source.canTrade!==false||source.productionWeightsChanged!==false||
    typeof packFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(packFingerprint)||
    source.packFingerprint!==packFingerprint||
    !validDate(source.lastObservationDay)||!validDate(latestFrozenDay)||
    source.lastObservationDay>latestFrozenDay||
    !Array.isArray(definitions)||definitions.length<2||definitions.length>100||
    !dataArray(definitions)||definitions.some(d=>!dataRecord(d))||!dataRecord(acceptedWeights))
  throw Error('自动预注册缺少有效的历史封存训练报告或因子定义');
 // Native sealed reports bind both the training chronology and the exact
 // accepted weight vector. Legacy reduced reports remain explicitly unbound.
 const native=Object.hasOwn(source,'schemaVersion')||Object.hasOwn(source,'shadowOnly')||Object.hasOwn(source,'observedFingerprints');
 if(['autoPromotion','verifiedLive','productionStrategyChanged','prospectiveCertified'].some(k=>Object.hasOwn(source,k)&&source[k]!==false)||
    Object.hasOwn(source,'shadowOnly')&&source.shadowOnly!==true||
    native&&(source.schemaVersion!==1||!Object.hasOwn(source,'shadowWeights')||!Object.hasOwn(source,'trainingEnd'))||
    Object.hasOwn(source,'trainingEnd')&&(!validDate(source.trainingEnd)||source.trainingEnd>source.lastObservationDay))
  throw Error('自动预注册历史封存训练报告权限、版本或时点无效');
 const ids=definitions.map(d=>ownData(d,'id')?d.id:undefined);
 if(new Set(ids).size!==ids.length||ids.some(id=>!validId(id))||
    JSON.stringify(source.factorIds)!==JSON.stringify(ids)||
    !exactKeys(source.factorLearning,ids)||!exactKeys(acceptedWeights,ids))
  throw Error('自动预注册的历史因子训练血缘不一致');
 const bound=Object.hasOwn(source,'shadowWeights');
 if(bound&&(!exactKeys(source.shadowWeights,ids)||ids.some(id=>source.shadowWeights[id]!==acceptedWeights[id])))
  throw Error('自动预注册的已接受权重与封存报告血缘不一致');
 if(Object.hasOwn(source,'factorRedundancy')&&!dataRecord(source.factorRedundancy))
  throw Error('自动预注册的冗余因子证据无效');
 const redundancy=source.factorRedundancy;
 const suppressed=redundancy&&Object.hasOwn(redundancy,'suppressedFactorIds')?redundancy.suppressedFactorIds:[];
 if(!Array.isArray(suppressed)||new Set(suppressed).size!==suppressed.length||suppressed.some(id=>!ids.includes(id)))
  throw Error('自动预注册的冗余因子证据无效');
 const duplicates=new Set(suppressed);
 const proposal={},audit=[];
 for(const def of definitions){
  const id=def.id,old=acceptedWeights[id],original=ownData(def,'baseWeight')?def.baseWeight:undefined;
  const lo=Math.max(original*.5,old*.92),hi=Math.min(original*1.5,old*1.08);
  if(!finite(original)||original<=0||!finite(old)||old<=0||
     !finite(original*.5)||original*.5<=0||!finite(original*1.5)||
     old<original*.5||old>original*1.5||!finite(lo)||!finite(hi)||lo>hi)
   throw Error('自动预注册的基础及已接受权重边界无效');
  const learning=source.factorLearning[id];
  if(!dataRecord(learning)||!ownData(learning,'suggestedWeightMultiplier')||!finite(learning.suggestedWeightMultiplier)||
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
 if([definitions.map(d=>d.baseWeight),ids.map(id=>acceptedWeights[id]),ids.map(id=>proposal[id])].some(values=>!finite(values.reduce((a,b)=>a+b,0))))
  throw Error('自动预注册研究权重合计无效');
 if(!allowUnchanged&&ids.every(id=>proposal[id]===acceptedWeights[id]))
  throw Error('历史训练未产生新的研究候选，禁止伪造一次试验');
 return {status:'proposed-from-sealed-prior-training',candidateWeights:proposal,
  sourceFingerprint:fingerprint,sourceLastObservationDay:source.lastObservationDay,
  sourceStatus:source.status,sourceWeightBinding:bound?'sealed-shadow-weights':'legacy-not-provided',weightChanges:audit,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={proposeFromSealedResearch};
