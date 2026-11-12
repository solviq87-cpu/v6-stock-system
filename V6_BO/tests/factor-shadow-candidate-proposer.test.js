'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {proposeFromSealedResearch}=require('../src/core/factor-shadow-candidate-proposer');
const {preregisterCandidate,verifyPreregisteredCandidate}=require('../src/core/factor-candidate-prereg');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pack='a'.repeat(64);
const defs=[{id:'a',baseWeight:1},{id:'b',baseWeight:1}];
const acceptedWeights={a:1,b:1};
function sealed(overrides={}){
 const payload={mode:'v6-factor-shadow-evolution-v1',status:'shadow-retained',
  canTrade:false,productionWeightsChanged:false,packFingerprint:pack,
  lastObservationDay:'2026-06-01',factorIds:['a','b'],
  factorLearning:{a:{suggestedWeightMultiplier:.08},
   b:{suggestedWeightMultiplier:.08}},
  factorRedundancy:{suppressedFactorIds:['b']},...overrides};
 return {...payload,fingerprint:hash(payload)};
}
const args=(source=sealed())=>({
 source,definitions:defs,acceptedWeights,packFingerprint:pack,
 latestFrozenDay:'2026-06-05'
});
test('positive but redundant factor is conservatively shrunk while independent one is capped at eight percent',()=>{
 const out=proposeFromSealedResearch(args());
 assert.equal(out.status,'proposed-from-sealed-prior-training');
 assert.equal(out.candidateWeights.a,1.08);
 assert.equal(out.candidateWeights.b,.98);
 assert.equal(out.weightChanges[1].redundancySuppressed,true);
 assert.equal(out.canTrade,false);
 assert.equal(out.productionWeightsChanged,false);
});
test('sealing prevents future report, different factor pack, lineage tampering or forged multipliers',()=>{
 const o=sealed();
 assert.throws(()=>proposeFromSealedResearch(args({...o,lastObservationDay:'2026-08-01'})),
  /历史封存训练报告/);
 assert.throws(()=>proposeFromSealedResearch(args(sealed({packFingerprint:'b'.repeat(64)}))),
  /历史封存训练报告/);
 assert.throws(()=>proposeFromSealedResearch(args(sealed({
  factorLearning:{a:{suggestedWeightMultiplier:.6},b:{suggestedWeightMultiplier:.01}}
 }))),/训练增量无效/);
 const changed=structuredClone(o);changed.factorLearning.a.suggestedWeightMultiplier=-.08;
 assert.throws(()=>proposeFromSealedResearch(args(changed)),/历史封存训练报告/);
});
test('invalid calendar dates cannot seed an automatic candidate even with a matching local SHA',()=>{
 for(const invalid of ['0000-01-01','2026-02-29','2026-02-30','2026-13-01','2026-00-10']){
  assert.throws(()=>proposeFromSealedResearch(args(sealed({lastObservationDay:invalid}))),
   /历史封存训练报告/);
 }
 for(const invalid of ['2026-06-31','2026-13-05','2026-99-99']){
  assert.throws(()=>proposeFromSealedResearch({...args(),latestFrozenDay:invalid}),
   /历史封存训练报告/);
 }
 assert.throws(()=>proposeFromSealedResearch({...args(),latestFrozenDay:undefined}),
  /历史封存训练报告/);
 const leap=sealed({lastObservationDay:'2028-02-29'});
 assert.equal(proposeFromSealedResearch({...args(leap),latestFrozenDay:'2028-03-01'}).canTrade,false);
});
test('all-zero historical multipliers do not claim an automatic learned upgrade',()=>{
 const allZero=sealed({factorLearning:{a:{suggestedWeightMultiplier:0},
  b:{suggestedWeightMultiplier:0}},factorRedundancy:{suppressedFactorIds:[]}});
 assert.throws(()=>proposeFromSealedResearch(args(allZero)),
  /未产生新的研究候选/);
});
test('automatic precommit is bound to exact prior sealed report and remains explicitly shadow-only',()=>{
 const source=sealed(),proposal=proposeFromSealedResearch(args(source));
 const days=Array.from({length:36},(_,i)=>{
  const day=new Date(Date.UTC(2026,3,1+i)).toISOString().slice(0,10);
  const p={signalDay:day,capturedAt:Date.parse(day+'T03:00:00Z'),
   factors:defs,packFingerprint:pack};
  return {...p,fingerprint:hash(p)};
 });
 const nextDate=new Date(Date.UTC(2026,3,37)).toISOString().slice(0,10);
 const recorded=days.at(-1).capturedAt+60000;
 const entry=preregisterCandidate({features:days,
  candidateWeights:proposal.candidateWeights,acceptedWeights,
  registeredAt:recorded,packFingerprint:pack,
  parentAcceptedFingerprint:source.fingerprint,
  autoSourceFingerprint:source.fingerprint});
 assert.equal(entry.candidateOrigin,'sealed-historical-training-reliability-v1');
 assert.equal(entry.autoSourceFingerprint,source.fingerprint);
 const sorted=[...days.map(x=>({day:x.signalDay,featureFingerprint:x.fingerprint})),
  {day:nextDate,featureFingerprint:'1'.repeat(64)}];
 const status=verifyPreregisteredCandidate(entry,{
  sorted,ids:['a','b'],packFingerprint:pack,oldWeights:acceptedWeights,
  previousFingerprint:source.fingerprint,previousTrialFingerprint:null,
  freshTest:[{day:nextDate,featureCapturedAt:Date.parse(nextDate+'T03:00:00Z')}]});
 assert.equal(status.status,'candidate-committed-before-new-signal');
 const forged={...entry,autoSourceFingerprint:'f'.repeat(64)};
 const {fingerprint,...payload}=forged;forged.fingerprint=hash(payload);
 assert.throws(()=>verifyPreregisteredCandidate(forged,{
  sorted,ids:['a','b'],packFingerprint:pack,oldWeights:acceptedWeights,
  previousFingerprint:source.fingerprint,previousTrialFingerprint:null,
  freshTest:[{day:nextDate,featureCapturedAt:Date.parse(nextDate+'T03:00:00Z')}]}
 ),/血缘不一致/);
});
