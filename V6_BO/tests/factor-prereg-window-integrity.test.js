'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {preregisterCandidate,preregisterSeedCandidate,verifyPreregisteredCandidate,SEED_POLICY}=require('../src/core/factor-candidate-prereg');
const pack=require('../strategies/extended-factor-pack.json');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ids=['sector_heat','leader_strength'],packFingerprint=hash(pack);
const defs=pack.factors.filter(f=>ids.includes(f.id)).map(f=>({id:f.id,field:f.field,baseWeight:f.weight,group:f.group}));
const weights=Object.fromEntries(defs.map(f=>[f.id,f.baseWeight]));
const candidateWeights=Object.fromEntries(defs.map((f,i)=>[f.id,+(f.baseWeight*(i===0?1.02:.98)).toFixed(8)]));
function features(n){
 return Array.from({length:n},(_,i)=>{
  const signalDay=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
  const p={signalDay,capturedAt:Date.parse(signalDay+'T08:00:00Z'),factors:defs,packFingerprint};
  return {...p,fingerprint:hash(p)};
 });
}
const seal=x=>{const {fingerprint,...body}=x;return {...body,fingerprint:hash(body)};};
const project=f=>({day:f.signalDay,featureFingerprint:f.fingerprint,featureCapturedAt:f.capturedAt});
function ordinary(){
 const frozen=features(42),prefix=frozen.slice(0,36),registeredAt=prefix.at(-1).capturedAt+1000;
 const reg=preregisterCandidate({features:prefix,candidateWeights,acceptedWeights:weights,registeredAt,packFingerprint});
 const sorted=frozen.map(project),freshTest=sorted.slice(36).map(({day,featureCapturedAt})=>({day,featureCapturedAt}));
 return {reg,context:{sorted,ids,packFingerprint,oldWeights:weights,previousFingerprint:null,previousTrialFingerprint:null,freshTest},prefix,registeredAt};
}
const verify=({reg,context})=>verifyPreregisteredCandidate(reg,context);
test('ordinary registration accepts an ordered verified subset of the new frozen dates',()=>{
 const x=ordinary();
 x.context.freshTest=x.context.freshTest.filter((_,i)=>i!==1);
 const before=JSON.stringify(x),r=verify(x);
 assert.equal(r.status,'candidate-committed-before-new-signal');
 assert.equal(r.holdoutFirstDay,x.context.freshTest[0].day);
 assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
 assert.equal(JSON.stringify(x),before);
});
test('every holdout day must match a new frozen receipt, not only its first member',()=>{
 for(const change of [
  c=>{c.freshTest[1].day='2026-11-30';},
  c=>{c.freshTest[1].featureCapturedAt--;},
  c=>{c.freshTest[1]={...c.sorted[1]};},
  c=>{c.freshTest[1]={...c.freshTest[0]};},
  c=>{[c.freshTest[1],c.freshTest[2]]=[c.freshTest[2],c.freshTest[1]];},
  c=>{c.freshTest[1].featureFingerprint='0'.repeat(64);}
 ]){
  const x=ordinary();change(x.context);assert.throws(()=>verify(x),/时点、冻结前缀或模型血缘不一致/);
 }
});
test('the declared frozen edge receipt must equal the actual capture time, even after resealing',()=>{
 const x=ordinary();x.reg=seal({...x.reg,lastFrozenCapturedAt:x.reg.lastFrozenCapturedAt-1});
 assert.throws(()=>verify(x),/时点、冻结前缀或模型血缘不一致/);
});
test('ordinary registration must not admit unseen records captured before its seal or registered records captured afterwards',()=>{
 for(const index of [0,38]){
  const x=ordinary();
  x.context.sorted[index].featureCapturedAt=x.reg.registeredAt+(index===0?1:-1);
  assert.throws(()=>verify(x),/时点、冻结前缀或模型血缘不一致/);
 }
});
test('duplicate fingerprint or nonpositive capturedAt cannot be sealed as a normal frozen prefix',()=>{
 for(const change of [f=>{f[1].fingerprint=f[0].fingerprint;},f=>{f[0].capturedAt=0;}]){
  const {prefix,registeredAt}=ordinary();change(prefix);
  assert.throws(()=>preregisterCandidate({features:prefix,candidateWeights,acceptedWeights:weights,registeredAt,packFingerprint}),/权重边界或完整性/);
 }
});
test('seed and ordinary verification share full holdout membership checks',()=>{
 const registeredAt=Date.now();
 const reg=preregisterSeedCandidate({registeredAt,seedConfig:{schemaVersion:1,mode:'v6-fixed-shadow-seed-config-v1',researchOnly:true,canTrade:false,seedPolicy:SEED_POLICY,factorIds:ids}});
 const first=new Date(reg.recordedAt+86400000).toISOString().slice(0,10);
 const second=new Date(reg.recordedAt+2*86400000).toISOString().slice(0,10);
 const sorted=[first,second].map((day,i)=>({day,featureCapturedAt:Date.parse(day+'T16:00:00Z'),featureFingerprint:hash('seed-'+i)}));
 const context={sorted,ids,packFingerprint,oldWeights:weights,previousFingerprint:null,previousTrialFingerprint:null,freshTest:sorted.map(x=>({...x}))};
 assert.equal(verify({reg,context}).status,'candidate-committed-before-new-signal');
 context.freshTest[1].featureCapturedAt++;
 assert.throws(()=>verify({reg,context}),/固定种子预注册时点/);
});

test('resealed out-of-policy candidate cannot pass verification before opening holdout outcomes',()=>{
 for(const change of [w=>{w.sector_heat=2;},w=>{w.sector_heat=1.3*1.081;},
  w=>{w.sector_heat=1.3*.919;},w=>{w.extra=1;}]){
  const x=ordinary(),w={...x.reg.candidateWeights};change(w);
  x.reg=seal({...x.reg,candidateWeights:w});assert.throws(()=>verify(x),/时点、冻结前缀或模型血缘不一致/);
 }
});
test('registered base envelope is tied to the actual factor pack, not invented definitions',()=>{
 const x=ordinary();
 const bad=structuredClone(x.prefix);
 for(const f of bad)f.factors=f.factors.map(d=>({...d,baseWeight:d.baseWeight*2}));
 const doubled=Object.fromEntries(defs.map(d=>[d.id,d.baseWeight*2]));
 assert.throws(()=>preregisterCandidate({features:bad,candidateWeights:doubled,acceptedWeights:doubled,
  registeredAt:x.registeredAt,packFingerprint}),/权重边界或完整性/);
 const forged=structuredClone(x.reg);
 forged.factorDefinitions=defs.map(d=>({id:d.id,baseWeight:d.baseWeight*2}));
 assert.throws(()=>verify({reg:seal(forged),context:x.context}),/时点、冻结前缀或模型血缘不一致/);
});
test('candidate and accepted parent weights both obey the original absolute range',()=>{
 const x=ordinary(),d=defs[0];
 const accepted={...weights,[d.id]:d.baseWeight*1.55},candidate={...weights,[d.id]:d.baseWeight*1.45};
 assert.throws(()=>preregisterCandidate({features:x.prefix,candidateWeights:candidate,acceptedWeights:accepted,
  registeredAt:x.registeredAt,packFingerprint}),/权重边界或完整性/);
 const reg=seal({...x.reg,acceptedWeights:accepted,candidateWeights:candidate});
 assert.throws(()=>verifyPreregisteredCandidate(reg,{...x.context,oldWeights:accepted}),/时点、冻结前缀或模型血缘不一致/);
});
test('weight arrays and inherited entries cannot be accepted as exact candidate dictionaries',()=>{
 const x=ordinary(),fake=Object.assign([],candidateWeights);
 assert.throws(()=>preregisterCandidate({features:x.prefix,candidateWeights:fake,acceptedWeights:weights,
  registeredAt:x.registeredAt,packFingerprint}),/输入协议无效|权重边界/);
 const inherited=Object.create({[ids[0]]:candidateWeights[ids[0]]});
 inherited[ids[1]]=candidateWeights[ids[1]];inherited.unrelated=1;
 assert.throws(()=>preregisterCandidate({features:x.prefix,candidateWeights:inherited,acceptedWeights:weights,
  registeredAt:x.registeredAt,packFingerprint}),/输入协议无效|权重边界/);
});
test('a registered candidate cannot claim an automatic source without its explicit origin',()=>{
 const x=ordinary();
 x.reg=seal({...x.reg,autoSourceFingerprint:'b'.repeat(64)});
 assert.throws(()=>verify(x),/时点、冻结前缀或模型血缘不一致/);
});
test('ordinary registration preserves detached original weights and exact base definitions',()=>{
 const x=ordinary(),candidate={...candidateWeights},accepted={...weights};
 const reg=preregisterCandidate({features:x.prefix,candidateWeights:candidate,acceptedWeights:accepted,
  registeredAt:x.registeredAt,packFingerprint});
 candidate[ids[0]]=999;accepted[ids[0]]=999;
 assert.equal(reg.candidateWeights[ids[0]],candidateWeights[ids[0]]);
 assert.equal(reg.acceptedWeights[ids[0]],weights[ids[0]]);
 assert.deepEqual(reg.factorDefinitions,defs.map(d=>({id:d.id,baseWeight:d.baseWeight})));
 assert.equal(verify({reg,context:x.context}).status,'candidate-committed-before-new-signal');
});
test('legacy ordinary record without explicit definitions still checks canonical and step limits',()=>{
 const x=ordinary(),reg={...x.reg};delete reg.factorDefinitions;
 const legacy=seal(reg);
 assert.equal(verify({reg:legacy,context:x.context}).status,'candidate-committed-before-new-signal');
 const bad=seal({...legacy,candidateWeights:{...legacy.candidateWeights,[ids[0]]:99}});
 assert.throws(()=>verify({reg:bad,context:x.context}),/时点、冻结前缀或模型血缘不一致/);
});

function modelReceipt(x,accepted,candidate){
 const {modelCandidateBinding}=require('../src/core/factor-candidate-prereg');
 const fs=require('node:fs'),path=require('node:path');
 const source='b'.repeat(64),review={policy:'structured-reference-interval',rationaleVerified:false,sourceAuthenticated:false,trainingEligible:false,autoPromotion:false};
 return {modelName:'synthetic-combined:1',digest:'c'.repeat(64),method:'ollama-native-structured',
  algorithmFingerprint:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../src/core/local-model-learning-proposer.js'))).digest('hex'),
  requestFingerprint:'d'.repeat(64),responseFingerprint:'e'.repeat(64),hypothesis:{label:'model-hypothesis',rationale:'synthetic fixture'},outputReview:review,
  candidateBindingFingerprint:modelCandidateBinding({autoSourceFingerprint:source,packFingerprint:x.context.packFingerprint,latestFrozenSignalDay:x.prefix.at(-1).signalDay,
   factorDefinitionsFingerprint:hash(x.prefix[0].factors),factorIds:ids,acceptedWeights:accepted,candidateWeights:candidate})};
}
function modelRegistration(x){
 const source='b'.repeat(64);
 const args={features:x.prefix,candidateWeights,acceptedWeights:weights,registeredAt:x.registeredAt,
  packFingerprint,parentAcceptedFingerprint:source,autoSourceFingerprint:source,modelProvenance:modelReceipt(x,weights,candidateWeights)};
 return {args,reg:preregisterCandidate(args),context:{...x.context,previousFingerprint:source}};
}
test('combined A40 and #417 preserve sealed base definitions and model provenance together',()=>{
 const x=ordinary(),m=modelRegistration(x);
 assert.deepEqual(m.reg.factorDefinitions,defs.map(d=>({id:d.id,baseWeight:d.baseWeight})));
 assert.equal(m.reg.factorDefinitionsFingerprint,hash(defs));
 assert.equal(verifyPreregisteredCandidate(m.reg,m.context).canTrade,false);
 assert.deepEqual(m.reg.modelProvenance,m.args.modelProvenance);
});
test('a newly sealed model receipt cannot override canonical absolute weights',()=>{
 const x=ordinary(),m=modelRegistration(x),accepted={...weights,[ids[0]]:defs[0].baseWeight*1.51},candidate={...accepted};
 const forged=seal({...m.reg,acceptedWeights:accepted,candidateWeights:candidate,modelProvenance:modelReceipt(x,accepted,candidate)});
 assert.throws(()=>verifyPreregisteredCandidate(forged,{...m.context,oldWeights:accepted}),/时点、冻结前缀或模型血缘不一致/);
});
test('model receipt and definition digest cannot be independently removed from the sealed record',()=>{
 const x=ordinary(),m=modelRegistration(x);
 for(const key of ['modelProvenance','factorDefinitionsFingerprint']){
  const forged=structuredClone(m.reg);delete forged[key];
  assert.throws(()=>verifyPreregisteredCandidate(seal(forged),m.context),/时点、冻结前缀或模型血缘不一致/);
 }
});
test('valid canonical weight bounds do not bypass the sealed model-output binding',()=>{
 const x=ordinary(),m=modelRegistration(x);
 const forged=seal({...m.reg,candidateWeights:{...m.reg.candidateWeights,[ids[0]]:weights[ids[0]]}});
 assert.throws(()=>verifyPreregisteredCandidate(forged,m.context),/权重绑定/);
});

const verifyPending=(x,reg=x.reg,sorted=x.context.sorted.slice(0,36))=>{
 const {verifyPendingCandidateRegistration}=require('../src/core/factor-candidate-prereg');
 return verifyPendingCandidateRegistration(reg,{...x.context,sorted,freshTest:[]});
};
test('waiting registration shares the full prospective metadata and weight gate without opening a holdout',()=>{
 const x=ordinary(),r=verifyPending(x);
 assert.equal(r.status,'candidate-waiting-verified');assert.equal(r.canTrade,false);
 assert.equal(Object.hasOwn(r,'holdoutFirstDay'),false);
 assert.equal(verifyPending(x,x.reg,x.context.sorted).status,'candidate-waiting-verified');
 assert.throws(()=>verifyPreregisteredCandidate(x.reg,{...x.context,sorted:x.context.sorted.slice(0,36),freshTest:[]}),/模型血缘不一致/);
});
test('waiting cannot conceal a resealed invalid weight or factor envelope',()=>{
 const x=ordinary();
 for(const reg of [seal({...x.reg,candidateWeights:{...x.reg.candidateWeights,[ids[0]]:99}}),
  seal({...x.reg,factorDefinitions:defs.map(d=>({id:d.id,baseWeight:d.baseWeight*2}))}),
  seal({...x.reg,canTrade:true}),seal({...x.reg,autoSourceFingerprint:'b'.repeat(64)})]){
  assert.throws(()=>verifyPending(x,reg),/模型血缘不一致/);
 }
});
test('waiting cannot conceal a replaced historical capture time or a capture outside the registered prefix',()=>{
 const x=ordinary(),early=x.context.sorted.slice(0,36).map(r=>({...r}));early[0].featureCapturedAt=x.reg.registeredAt+1;
 assert.throws(()=>verifyPending(x,x.reg,early),/模型血缘不一致/);
 const late=x.context.sorted.map(r=>({...r}));late[36].featureCapturedAt=x.reg.registeredAt;
 assert.throws(()=>verifyPending(x,x.reg,late),/模型血缘不一致/);
 assert.throws(()=>verifyPending(x,x.reg,x.context.sorted.slice(0,35)),/模型血缘不一致/);
});
test('waiting model archive still checks the actual model response binding',()=>{
 const x=ordinary(),m=modelRegistration(x);const y={...x,reg:m.reg,context:m.context};
 assert.equal(verifyPending(y).status,'candidate-waiting-verified');
 assert.throws(()=>verifyPending(y,seal({...m.reg,candidateWeights:{...m.reg.candidateWeights,[ids[0]]:weights[ids[0]]}})),/权重绑定/);
});
test('waiting seed keeps its original registration cutoff and is not counted as a holdout',()=>{
 const {verifyPendingCandidateRegistration}=require('../src/core/factor-candidate-prereg');
 const now=Date.now(),reg=preregisterSeedCandidate({registeredAt:now,seedConfig:{schemaVersion:1,mode:'v6-fixed-shadow-seed-config-v1',researchOnly:true,canTrade:false,seedPolicy:SEED_POLICY,factorIds:ids}});
 const context={sorted:[],ids,packFingerprint,oldWeights:weights,previousFingerprint:null,previousTrialFingerprint:null};
 assert.equal(verifyPendingCandidateRegistration(reg,context).status,'candidate-waiting-verified');
 const day=new Date(now+86400000).toISOString().slice(0,10);
 assert.throws(()=>verifyPendingCandidateRegistration(reg,{...context,sorted:[{day,featureCapturedAt:reg.recordedAt,featureFingerprint:hash('too early')}]}),/固定种子预注册时点/);
 assert.throws(()=>verifyPreregisteredCandidate(reg,{...context,freshTest:[]}),/固定种子预注册时点/);
});
