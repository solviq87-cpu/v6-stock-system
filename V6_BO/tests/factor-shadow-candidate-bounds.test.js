'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {proposeFromSealedResearch:propose}=require('../src/core/factor-shadow-candidate-proposer');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pack='a'.repeat(64);
function input({definitions=[{id:'a',baseWeight:1},{id:'b',baseWeight:1}],acceptedWeights={a:1,b:1},learning=null,suppressed=['b'],packFingerprint=pack}={}){
 const factorIds=definitions.map(d=>d.id);
 const payload={mode:'v6-factor-shadow-evolution-v1',status:'shadow-retained',canTrade:false,
  productionWeightsChanged:false,packFingerprint,lastObservationDay:'2026-11-01',factorIds,
  factorLearning:learning??Object.fromEntries(factorIds.map(id=>[id,{suggestedWeightMultiplier:.08}])),
  factorRedundancy:{suppressedFactorIds:suppressed}};
 return {source:{...payload,fingerprint:hash(payload)},definitions,acceptedWeights,packFingerprint,
  latestFrozenDay:'2026-11-02'};
}
test('valid prior evidence preserves the original independent and redundant factor changes',()=>{
 const args=input(),before=JSON.stringify(args),r=propose(args);
 assert.deepEqual(r.candidateWeights,{a:1.08,b:.98});
 assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
 assert.equal(JSON.stringify(args),before);
});
test('a parent outside the base-weight envelope cannot manufacture a bounded candidate',()=>{
 for(const a of [.3,.49,1.51,2,10])assert.throws(()=>propose(input({acceptedWeights:{a,b:1}})),/权重边界/);
});
test('base weights must be positive and form finite nonempty bounds',()=>{
 for(const baseWeight of [0,-1,Number.MIN_VALUE,Number.MAX_VALUE]){
  assert.throws(()=>propose(input({definitions:[{id:'a',baseWeight},{id:'b',baseWeight:1}]})),/权重边界/);
 }
});
test('accepted weights and learning records must bind exactly to their own factor identities',()=>{
 for(const acceptedWeights of [{a:1,b:1,c:1},Object.assign(Object.create({a:1}),{b:1}),[1,1]]){
  assert.throws(()=>propose(input({acceptedWeights})),/血缘不一致|历史封存训练报告/);
 }
 const extra={a:{suggestedWeightMultiplier:.08},b:{suggestedWeightMultiplier:.08},c:{suggestedWeightMultiplier:.08}};
 assert.throws(()=>propose(input({learning:extra})),/血缘不一致/);
 const bad=input({definitions:[{id:'constructor',baseWeight:1},{id:'b',baseWeight:1}],acceptedWeights:{constructor:1,b:1}});
 assert.throws(()=>propose(bad),/血缘不一致/);
});
test('explicit redundancy metadata cannot refer to unknown factors or duplicate entries',()=>{
 for(const suppressed of [['unknown'],['b','b'],'b',{},[null]]){
  assert.throws(()=>propose(input({suppressed})),/冗余因子证据无效/);
 }
});
test('the factor-pack fingerprint cannot be an arbitrary matching string',()=>{
 assert.throws(()=>propose(input({packFingerprint:'not-a-fingerprint'})),/历史封存训练报告/);
});
test('rounding at the boundary never violates either weight envelope',()=>{
 const definitions=[{id:'a',baseWeight:1.000000006},{id:'b',baseWeight:1}];
 const acceptedWeights={a:1.388888897,b:.500000006};
 const learning={a:{suggestedWeightMultiplier:.08},b:{suggestedWeightMultiplier:-.08}};
 const args=input({definitions,acceptedWeights,learning,suppressed:[]});
 const r=propose(args);
 for(const {id,baseWeight} of definitions){
  const v=r.candidateWeights[id],old=acceptedWeights[id];
  assert.ok(v>=Math.max(baseWeight*.5,old*.92),id+' lower');
  assert.ok(v<=Math.min(baseWeight*1.5,old*1.08),id+' upper');
 }
});
test('zero adjustment never creates a candidate just by rounding an unchanged weight',()=>{
 const acceptedWeights={a:1.000000006,b:1};
 const learning={a:{suggestedWeightMultiplier:0},b:{suggestedWeightMultiplier:0}};
 const args=input({acceptedWeights,learning,suppressed:[]});
 assert.throws(()=>propose(args),/未产生新的研究候选/);
 assert.deepEqual(propose({...args,allowUnchanged:true}).candidateWeights,acceptedWeights);
});
