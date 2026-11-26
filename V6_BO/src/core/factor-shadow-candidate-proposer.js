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
  sourceStatus:source.status,weightChanges:audit,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={proposeFromSealedResearch};
