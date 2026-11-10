'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {preregisterCandidate,verifyPreregisteredCandidate,
 currentResearchCodeFingerprint}=require('../src/core/factor-candidate-prereg');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const packHash='a'.repeat(64);
const ids=['sector_heat','leader_strength'];
const defs=[{id:'sector_heat',baseWeight:1.3},
 {id:'leader_strength',baseWeight:1.3}];
const old={sector_heat:1.3,leader_strength:1.3};
const weights={sector_heat:1.35,leader_strength:1.25};
const features=n=>Array.from({length:n},(_,i)=>{
 const day=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
 const payload={signalDay:day,capturedAt:Date.parse(day+'T10:00:00Z'),
  factors:defs,packFingerprint:packHash};
 return {...payload,fingerprint:hash(payload)};
});
function scenario(){
 const frozen=features(36),future=features(37)[36];
 const registeredAt=frozen.at(-1).capturedAt+60000;
 const entry=preregisterCandidate({features:frozen,candidateWeights:weights,
  acceptedWeights:old,registeredAt,packFingerprint:packHash,
  parentAcceptedFingerprint:'p'.repeat(64),parentTrialFingerprint:null});
 const sorted=[...frozen,future].map(f=>({
  day:f.signalDay,featureFingerprint:f.fingerprint
 }));
 const context={sorted,ids,packFingerprint:packHash,oldWeights:old,
  previousFingerprint:'p'.repeat(64),previousTrialFingerprint:null,
  freshTest:[{day:future.signalDay,featureCapturedAt:future.capturedAt}]};
 return {entry,context,frozen,future,registeredAt};
}
test('a sealed exact candidate predating the first NEW frozen signal is independently checkable',()=>{
 const {entry,context}=scenario();
 assert.equal(entry.mode,'v6-shadow-candidate-prereg-v1');
 assert.equal(entry.sealedBeforeFutureSignals,true);
 assert.equal(entry.algorithmFingerprint,currentResearchCodeFingerprint());
 const status=verifyPreregisteredCandidate(entry,context);
 assert.equal(status.status,'candidate-committed-before-new-signal');
 assert.equal(status.holdoutFirstDay,context.freshTest[0].day);
 assert.equal(status.registrationFingerprint,entry.fingerprint);
 assert.equal(status.canTrade,false);
 assert.equal(status.productionWeightsChanged,false);
});
test('a post-signal timestamp cannot be retroactively dressed as preregistration',()=>{
 const {entry,context,future}=scenario();
 const forged={...entry,registeredAt:future.capturedAt+1000};
 const {fingerprint,...payload}=forged;
 forged.fingerprint=hash(payload);
 assert.throws(()=>verifyPreregisteredCandidate(forged,context),
  /预注册时点、冻结前缀或模型血缘不一致/);
});
test('tampered candidate, changed algorithm, changed prior trial and replaced frozen prefix fail closed',()=>{
 const {entry,context}=scenario();
 assert.throws(()=>verifyPreregisteredCandidate(
  {...entry,candidateWeights:{...entry.candidateWeights,sector_heat:1.49}},context),/不一致/);
 const policy={...entry,algorithmFingerprint:'f'.repeat(64)};
 const {fingerprint,...body}=policy;policy.fingerprint=hash(body);
 assert.throws(()=>verifyPreregisteredCandidate(policy,context),/不一致/);
 assert.throws(()=>verifyPreregisteredCandidate(entry,
  {...context,previousTrialFingerprint:'f'.repeat(64)}),/不一致/);
 const sorted=structuredClone(context.sorted);
 sorted[2].featureFingerprint='0'.repeat(64);
 assert.throws(()=>verifyPreregisteredCandidate(entry,{...context,sorted}),/不一致/);
});
test('unbounded or incomplete candidate weights and duplicate frozen signals are rejected before sealing',()=>{
 const {frozen,registeredAt}=scenario();
 assert.throws(()=>preregisterCandidate({features:frozen,
  candidateWeights:{sector_heat:2,leader_strength:1.3},
  acceptedWeights:old,registeredAt,packFingerprint:packHash}),/权重边界或完整性/);
 assert.throws(()=>preregisterCandidate({features:frozen,
  candidateWeights:{sector_heat:1.35},
  acceptedWeights:old,registeredAt,packFingerprint:packHash}),/权重边界或完整性/);
 const duplicate=structuredClone(frozen);
 duplicate[2]=duplicate[1];
 assert.throws(()=>preregisterCandidate({features:duplicate,
  candidateWeights:weights,acceptedWeights:old,registeredAt,packFingerprint:packHash}),
  /权重边界或完整性/);
});
