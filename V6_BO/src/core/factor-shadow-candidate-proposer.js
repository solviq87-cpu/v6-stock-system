'use strict';
/**
 * Deterministically propose a bounded research challenger from a PRIOR sealed
 * shadow report. This module never opens forward returns or extracts any
 * results from the future candidate's holdout.
 */
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function proposeFromSealedResearch({source,definitions,acceptedWeights,
 packFingerprint,latestFrozenDay}={}){
 const {fingerprint,...payload}=source||{};
 if(!source||fingerprint!==hash(payload)||
    source.mode!=='v6-factor-shadow-evolution-v1'||
    !['shadow-updated','shadow-retained','paused-market-shock'].includes(source.status)||
    source.canTrade!==false||source.productionWeightsChanged!==false||
    source.packFingerprint!==packFingerprint||
    !validDate(source.lastObservationDay)||!validDate(latestFrozenDay)||
    source.lastObservationDay>latestFrozenDay||
    !Array.isArray(definitions)||definitions.length<2||
    !acceptedWeights||typeof acceptedWeights!=='object')
  throw Error('自动预注册缺少有效的历史封存训练报告或因子定义');
 const ids=definitions.map(d=>d.id);
 if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id)||
    JSON.stringify(source.factorIds)!==JSON.stringify(ids)||
    !source.factorLearning||typeof source.factorLearning!=='object'||
    ids.some(id=>!finite(acceptedWeights[id])||acceptedWeights[id]<=0||
     !finite(definitions.find(d=>d.id===id)?.baseWeight)))
  throw Error('自动预注册的历史因子训练血缘不一致');
 const duplicates=new Set(source.factorRedundancy?.suppressedFactorIds||[]);
 const proposal={},audit=[];
 for(const def of definitions){
  const id=def.id,old=acceptedWeights[id],original=def.baseWeight;
  const learning=source.factorLearning[id];
  if(!learning||!finite(learning.suggestedWeightMultiplier)||
     Math.abs(learning.suggestedWeightMultiplier)>.08+1e-9)
   throw Error('自动预注册的因子训练增量无效');
  const adjustment=duplicates.has(id)?
   Math.min(learning.suggestedWeightMultiplier,-.02):
   learning.suggestedWeightMultiplier;
  const next=+clamp(old*(1+adjustment),
   Math.max(original*.5,old*.92),
   Math.min(original*1.5,old*1.08)).toFixed(8);
  if(!finite(next)||next<=0)throw Error('自动预注册计算出无效研究权重');
  proposal[id]=next;
  audit.push({factorId:id,sourceMultiplier:learning.suggestedWeightMultiplier,
   redundancySuppressed:duplicates.has(id),proposedWeight:next});
 }
 if(ids.every(id=>proposal[id]===acceptedWeights[id]))
  throw Error('历史训练未产生新的研究候选，禁止伪造一次试验');
 return {status:'proposed-from-sealed-prior-training',candidateWeights:proposal,
  sourceFingerprint:fingerprint,sourceLastObservationDay:source.lastObservationDay,
  sourceStatus:source.status,weightChanges:audit,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={proposeFromSealedResearch};
