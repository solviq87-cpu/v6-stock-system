'use strict';
/**
 * Optional STRICT prospective candidate commitment.
 * A candidate must be committed BEFORE the earliest new frozen signal being
 * used to test it. Merely hashing an already evaluated candidate is NOT a
 * preregistration.
 */
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const factorPack=require('../../strategies/extended-factor-pack.json');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SEED_MODE='v6-shadow-candidate-seed-prereg-v1';
const SEED_POLICY='pack-order-alternating-two-percent-v1';
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
// The model receipt binds the exact research proposal, not merely the model name.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const validIds=ids=>Array.isArray(ids)&&ids.length>=2&&ids.length<=100&&new Set(ids).size===ids.length&&
 Array.from(ids).every(id=>typeof id==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id));
const weightMap=(w,ids)=>record(w)&&Object.keys(w).length===ids.length&&ids.every(id=>Object.hasOwn(w,id)&&Number.isFinite(w[id])&&w[id]>0);
function modelCandidateBinding({autoSourceFingerprint,packFingerprint,latestFrozenSignalDay,factorDefinitionsFingerprint,factorIds,acceptedWeights,candidateWeights}){
 return hash({autoSourceFingerprint,packFingerprint,latestFrozenSignalDay,factorDefinitionsFingerprint,factorIds,
  acceptedWeights:factorIds.map(id=>acceptedWeights[id]),candidateWeights:factorIds.map(id=>candidateWeights[id])});
}
function verifyModelCandidateProvenance(reg){
 const p=reg?.modelProvenance,ids=reg?.factorIds,review=p?.outputReview;
 const code=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'local-model-learning-proposer.js'))).digest('hex');
 if(!record(p)||p.method!=='ollama-native-structured'||typeof p.modelName!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(p.modelName)||
    p.algorithmFingerprint!==code||!['digest','requestFingerprint','responseFingerprint','candidateBindingFingerprint'].every(k=>seal(p[k]))||
    !record(p.hypothesis)||p.hypothesis.label!=='model-hypothesis'||typeof p.hypothesis.rationale!=='string'||p.hypothesis.rationale.length>120||
    Object.hasOwn(p,'dictionaryVersion')!==Object.hasOwn(p,'dictionaryFingerprint')||
    (Object.hasOwn(p,'dictionaryVersion')&&(typeof p.dictionaryVersion!=='string'||!p.dictionaryVersion||p.dictionaryVersion.length>160||!seal(p.dictionaryFingerprint)))||
    !record(review)||!['structured-reference-interval','legacy-envelope-only'].includes(review.policy)||
    !['rationaleVerified','sourceAuthenticated','trainingEligible','autoPromotion'].every(k=>review[k]===false)||
    !seal(reg.autoSourceFingerprint)||!seal(reg.packFingerprint)||!date(reg.latestFrozenSignalDay)||!seal(reg.factorDefinitionsFingerprint)||
    !validIds(ids)||!weightMap(reg.acceptedWeights,ids)||!weightMap(reg.candidateWeights,ids)||
    p.candidateBindingFingerprint!==modelCandidateBinding(reg))
  throw Error('本地模型候选来源、权重绑定或代码指纹无效');
 return true;
}
function verifyUnchangedModelReview(receipt,{cacheKey,sourceFingerprint,sourceLastObservationDay,latestFrozenSignalDay,packFingerprint,factorDefinitionsFingerprint,factorIds,acceptedWeights,modelName,digest,now=Date.now()}={}){
 const {fingerprint,...body}=receipt||{};
 if(!record(receipt)||!seal(fingerprint)||fingerprint!==hash(body)||receipt.schemaVersion!==1||
    receipt.mode!=='v6-local-model-review-v1'||receipt.cacheKey!==cacheKey||receipt.sourceFingerprint!==sourceFingerprint||
    receipt.status!=='model-retained-unchanged'||receipt.canTrade!==false||receipt.productionWeightsChanged!==false||
    !date(receipt.latestFrozenSignalDay)||!date(sourceLastObservationDay)||!date(latestFrozenSignalDay)||
    receipt.latestFrozenSignalDay<sourceLastObservationDay||receipt.latestFrozenSignalDay>latestFrozenSignalDay||
    !Number.isSafeInteger(now)||!Number.isSafeInteger(receipt.reviewedAt)||receipt.reviewedAt<=0||receipt.reviewedAt>now||
    receipt.reviewedAt<Date.parse(receipt.latestFrozenSignalDay+'T00:00:00+08:00')||
    receipt.modelProvenance?.modelName!==modelName||receipt.modelProvenance?.digest!==digest)
  throw Error('本地模型复核档案完整性无效');
 return verifyModelCandidateProvenance({autoSourceFingerprint:sourceFingerprint,packFingerprint,
  latestFrozenSignalDay:receipt.latestFrozenSignalDay,factorDefinitionsFingerprint,factorIds,acceptedWeights,
  candidateWeights:acceptedWeights,modelProvenance:receipt.modelProvenance});
}
const policyFiles=[
 'factor-shadow-evolution.js','factor-learning-reliability.js',
 'factor-redundancy.js','factor-marginal-contribution.js',
 'factor-model-comparison.js','factor-global-trial-budget.js',
 'factor-candidate-prereg.js','factor-shadow-candidate-proposer.js','local-model-learning-proposer.js',
 'factor-maturity-manifest.js','factor-daily-research-cycle.js',
 '../../scripts/factor-shadow-worker.js'
];
function currentResearchCodeFingerprint(){
 return hash(policyFiles.map(file=>[file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));
}
// This policy is deliberately fixed before any result exists. Its direction
// follows pack order, never a ranking, feature score, or historical return.
function seedDefinition(config){
 if(!config||config.schemaVersion!==1||config.mode!=='v6-fixed-shadow-seed-config-v1'||
    config.researchOnly!==true||config.canTrade!==false||config.seedPolicy!==SEED_POLICY||
    Object.keys(config).some(k=>!['schemaVersion','mode','researchOnly','canTrade','seedPolicy','factorIds'].includes(k))||
    !Array.isArray(config.factorIds)||config.factorIds.length<2||
    new Set(config.factorIds).size!==config.factorIds.length||
    config.factorIds.some(id=>!factorPack.factors.some(f=>f.id===id)))
  throw Error('固定种子配置协议无效，禁止外部权重或结果选择');
 const definitions=factorPack.factors.filter(f=>config.factorIds.includes(f.id))
  .map(f=>({id:f.id,field:f.field,baseWeight:f.weight,group:f.group}));
 const acceptedWeights=Object.fromEntries(definitions.map(f=>[f.id,f.baseWeight]));
 const candidateWeights=Object.fromEntries(definitions.map((f,i)=>
  [f.id,+(f.baseWeight*(i%2===0?1.02:.98)).toFixed(8)]));
 return {definitions,acceptedWeights,candidateWeights};
}
function verifySeedRegistrationMetadata(reg){
 const {fingerprint,...payload}=reg||{};
 const definition=seedDefinition(reg?.seedConfig);
 const prefix=reg.frozenPrefixFingerprints;
 if(reg.mode!==SEED_MODE||reg.schemaVersion!==1||fingerprint!==hash(payload)||Object.hasOwn(reg,'modelProvenance')||
    reg.candidateOrigin!=='fixed-pack-seed-v1'||reg.seedPolicy!==SEED_POLICY||
    reg.seedConfigFingerprint!==hash(reg.seedConfig)||reg.packFingerprint!==hash(factorPack)||
    !seal(reg.algorithmFingerprint)||
    !Number.isSafeInteger(reg.registeredAt)||reg.registeredAt<=0||
    !Number.isSafeInteger(reg.recordedAt)||reg.recordedAt<reg.registeredAt||
    reg.recordedAt>reg.registeredAt+60000||
    reg.parentAcceptedFingerprint!==null||reg.parentTrialFingerprint!==null||
    reg.canTrade!==false||reg.productionWeightsChanged!==false||reg.sealedBeforeFutureSignals!==true||
    hash(reg.factorDefinitions)!==hash(definition.definitions)||
    hash(reg.factorIds)!==hash(definition.definitions.map(f=>f.id))||
    hash(reg.acceptedWeights)!==hash(definition.acceptedWeights)||
    hash(reg.candidateWeights)!==hash(definition.candidateWeights)||
    !Array.isArray(prefix)||prefix.length>400||prefix.some(fp=>!seal(fp))||
    new Set(prefix).size!==prefix.length||
    (prefix.length===0?(reg.latestFrozenSignalDay!==null||reg.lastFrozenCapturedAt!==null):
     (!date(reg.latestFrozenSignalDay)||!Number.isSafeInteger(reg.lastFrozenCapturedAt)||
      reg.lastFrozenCapturedAt<=0||reg.registeredAt<reg.lastFrozenCapturedAt)))
  throw Error('固定种子预注册元信息或完整性无效');
 return definition;
}
function preregisterSeedCandidate({features=[],seedConfig,registeredAt}={}){
 const definition=seedDefinition(seedConfig),packFingerprint=hash(factorPack),recordedAt=Date.now();
 if(!Array.isArray(features)||features.length>400||
    !Number.isSafeInteger(registeredAt)||registeredAt<=0||
    !Number.isSafeInteger(recordedAt)||recordedAt<registeredAt||recordedAt>registeredAt+60000)
  throw Error('固定种子预注册输入协议无效');
 const ordered=[...features].sort((a,b)=>String(a?.signalDay).localeCompare(String(b?.signalDay)));
 if(ordered.some((f,i)=>!date(f?.signalDay)||!seal(f.fingerprint)||
    f.packFingerprint!==packFingerprint||hash(f.factors)!==hash(definition.definitions)||
    !Number.isSafeInteger(f.capturedAt)||f.capturedAt<=0||f.capturedAt>registeredAt||
    (i>0&&ordered[i-1].signalDay===f.signalDay)))
  throw Error('固定种子真实冻结前缀或因子定义无效');
 const latest=ordered.at(-1),payload={schemaVersion:1,mode:SEED_MODE,
  candidateOrigin:'fixed-pack-seed-v1',seedPolicy:SEED_POLICY,seedConfig,
  seedConfigFingerprint:hash(seedConfig),registeredAt,recordedAt,
  latestFrozenSignalDay:latest?.signalDay??null,lastFrozenCapturedAt:latest?.capturedAt??null,
  frozenPrefixFingerprints:ordered.map(f=>f.fingerprint),
  factorDefinitions:definition.definitions,factorIds:definition.definitions.map(f=>f.id),
  packFingerprint,algorithmFingerprint:currentResearchCodeFingerprint(),
  acceptedWeights:definition.acceptedWeights,candidateWeights:definition.candidateWeights,
  parentAcceptedFingerprint:null,parentTrialFingerprint:null,sealedBeforeFutureSignals:true,
  canTrade:false,productionWeightsChanged:false};
 const entry={...payload,fingerprint:hash(payload)};
 verifySeedRegistrationMetadata(entry);
 return entry;
}
// The same frozen prefix and actual capture receipts must support every
// tested day, not merely the first supplied holdout row. A valid SHA seals
// the registration's contents; it does not establish that a caller's
// independently supplied sample list matches those frozen observations.
function matchesFrozenWindows(reg,sorted,freshTest,sealedAt){
 const prefix=reg.frozenPrefixFingerprints;
 if(!Array.isArray(prefix)||!Array.isArray(sorted)||!Array.isArray(freshTest)||
    !Number.isSafeInteger(sealedAt)||sealedAt<=0||sorted.length>400||
    prefix.length>=sorted.length||!freshTest.length||freshTest.length>sorted.length)
  return false;
 const seen=new Set(),byDay=new Map();
 for(let i=0;i<sorted.length;i++){
  const row=sorted[i];
  if(!date(row?.day)||!seal(row.featureFingerprint)||seen.has(row.featureFingerprint)||
     (i>0&&sorted[i-1].day>=row.day)||!Number.isSafeInteger(row.featureCapturedAt)||
     row.featureCapturedAt<=0||(i<prefix.length?
      row.featureFingerprint!==prefix[i]||row.featureCapturedAt>reg.registeredAt:
      row.featureCapturedAt<=sealedAt))return false;
  seen.add(row.featureFingerprint);byDay.set(row.day,{row,index:i});
 }
 const edge=sorted[prefix.length-1];
 if(reg.latestFrozenSignalDay!==(edge?.day??null)||
    reg.lastFrozenCapturedAt!==(edge?.featureCapturedAt??null))return false;
 let previousDay=null;
 for(const sample of freshTest){
  const match=byDay.get(sample?.day);
  if(!match||match.index<prefix.length||
     sample.featureCapturedAt!==match.row.featureCapturedAt||
     (Object.hasOwn(sample,'featureFingerprint')&&sample.featureFingerprint!==match.row.featureFingerprint)||
     (previousDay!==null&&sample.day<=previousDay))return false;
  previousDay=sample.day;
 }
 return true;
}
function verifySeedCandidate(reg,{sorted,ids,packFingerprint,oldWeights,
 previousFingerprint,previousTrialFingerprint,freshTest}={}){
 verifySeedRegistrationMetadata(reg);
 const prefix=reg.frozenPrefixFingerprints,first=freshTest[0],
  sealedAt=Math.max(reg.registeredAt,reg.recordedAt);
 if(reg.algorithmFingerprint!==currentResearchCodeFingerprint()||
    reg.packFingerprint!==packFingerprint||previousFingerprint||previousTrialFingerprint||
    hash(reg.factorIds)!==hash(ids)||hash(reg.acceptedWeights)!==hash(oldWeights)||
    !matchesFrozenWindows(reg,sorted,freshTest,sealedAt))
  throw Error('固定种子预注册时点、冻结前缀或模型血缘不一致');
 return {status:'candidate-committed-before-new-signal',registrationFingerprint:reg.fingerprint,
  registeredAt:reg.registeredAt,recordedAt:reg.recordedAt,frozenPrefixDays:prefix.length,holdoutFirstDay:first.day,
  candidateOrigin:reg.candidateOrigin,canTrade:false,productionWeightsChanged:false};
}
function preregisterCandidate({features,candidateWeights,acceptedWeights,
 registeredAt,parentAcceptedFingerprint=null,parentTrialFingerprint=null,
 packFingerprint,autoSourceFingerprint=null,modelProvenance}={}){
 if(!Array.isArray(features)||features.length<36||features.length>400||
    !Number.isSafeInteger(registeredAt)||registeredAt<=0||
    !/^[0-9a-f]{64}$/.test(packFingerprint||'')||
    typeof candidateWeights!=='object'||!candidateWeights||
    typeof acceptedWeights!=='object'||!acceptedWeights||
    (autoSourceFingerprint!==null&&(!seal(autoSourceFingerprint)||autoSourceFingerprint!==(parentTrialFingerprint??parentAcceptedFingerprint)))||
    (modelProvenance!==undefined&&autoSourceFingerprint===null))
  throw Error('候选预注册输入协议无效');
 const ordered=[...features];
 if(ordered.some(x=>!date(x?.signalDay)))
  throw Error('候选预注册存在无效冻结信号日期');
 ordered.sort((a,b)=>a.signalDay.localeCompare(b.signalDay));
 const latest=ordered.at(-1);
 const ids=ordered[0]?.factors?.map(x=>x.id);
 if(!validIds(ids)||!weightMap(candidateWeights,ids)||!weightMap(acceptedWeights,ids)||
    new Set(ordered.map(f=>f.fingerprint)).size!==ordered.length||
    ordered.some((f,i)=>!date(f?.signalDay)||
     (i>0&&ordered[i-1].signalDay===f.signalDay)||
     !/^[0-9a-f]{64}$/.test(f?.fingerprint||'')||
     f.packFingerprint!==packFingerprint||
     hash(f.factors)!==hash(ordered[0].factors)||
     !Number.isSafeInteger(f.capturedAt)||f.capturedAt<=0||f.capturedAt>registeredAt)||
    ids.some(id=>{
     const candidate=candidateWeights[id],accepted=acceptedWeights[id],
      base=ordered[0].factors.find(x=>x.id===id)?.baseWeight;
     return !Number.isFinite(candidate)||!Number.isFinite(accepted)||
      !Number.isFinite(base)||base<=0||!Number.isFinite(base*1.5)||base*.5<=0||
      accepted<base*.5||accepted>base*1.5||candidate<base*.5||candidate>base*1.5||
      candidate<accepted*.92-1e-7||candidate>accepted*1.08+1e-7;
    }))
  throw Error('候选预注册冻结样本、权重边界或完整性无效');
 const payload={schemaVersion:1,mode:'v6-shadow-candidate-prereg-v1',
  registeredAt,latestFrozenSignalDay:latest.signalDay,
  lastFrozenCapturedAt:latest.capturedAt,
  frozenPrefixFingerprints:ordered.map(x=>x.fingerprint),
  factorIds:ids,packFingerprint,algorithmFingerprint:currentResearchCodeFingerprint(),
  acceptedWeights,candidateWeights,
  parentAcceptedFingerprint,parentTrialFingerprint,
  ...(autoSourceFingerprint===null?{}:{
   candidateOrigin:'sealed-historical-training-reliability-v1',
   autoSourceFingerprint}),
  ...(modelProvenance===undefined?{}:{factorDefinitionsFingerprint:hash(ordered[0].factors),modelProvenance}),
  sealedBeforeFutureSignals:true,
  canTrade:false,productionWeightsChanged:false};
 if(modelProvenance!==undefined)verifyModelCandidateProvenance(payload);
 return structuredClone({...payload,fingerprint:hash(payload)});
}
function verifyPreregisteredCandidate(reg,{sorted,ids,packFingerprint,
 oldWeights,previousFingerprint,previousTrialFingerprint,freshTest}={}){
 if(!reg||typeof reg!=='object'||!Array.isArray(sorted)||
    !Array.isArray(ids)||!Array.isArray(freshTest))
  throw Error('缺少不可变候选预注册，拒绝事后试验');
 if(reg.mode===SEED_MODE)return verifySeedCandidate(reg,{
  sorted,ids,packFingerprint,oldWeights,previousFingerprint,previousTrialFingerprint,freshTest});
 const {fingerprint,...payload}=reg;
 const first=freshTest[0],prefix=reg.frozenPrefixFingerprints;
 if(fingerprint!==hash(payload)||reg.mode!=='v6-shadow-candidate-prereg-v1'||
    reg.schemaVersion!==1||reg.canTrade!==false||
    reg.productionWeightsChanged!==false||
    reg.sealedBeforeFutureSignals!==true||
    reg.packFingerprint!==packFingerprint||
    reg.algorithmFingerprint!==currentResearchCodeFingerprint()||
    reg.parentAcceptedFingerprint!==(previousFingerprint||null)||
    reg.parentTrialFingerprint!==(previousTrialFingerprint||null)||
    (Object.hasOwn(reg,'candidateOrigin')!==Object.hasOwn(reg,'autoSourceFingerprint'))||
    (reg.candidateOrigin!==undefined&&(
     reg.candidateOrigin!=='sealed-historical-training-reliability-v1'||
     !seal(reg.autoSourceFingerprint)||reg.autoSourceFingerprint!==(previousTrialFingerprint??previousFingerprint)))||
    hash(reg.factorIds)!==hash(ids)||hash(reg.acceptedWeights)!==hash(oldWeights)||
    !Array.isArray(prefix)||prefix.length<36||
    !matchesFrozenWindows(reg,sorted,freshTest,reg.registeredAt)||
    !validIds(ids)||!weightMap(reg.acceptedWeights,ids)||!weightMap(reg.candidateWeights,ids)||
    ids.some(id=>reg.candidateWeights[id]<oldWeights[id]*.92-1e-7||reg.candidateWeights[id]>oldWeights[id]*1.08+1e-7))
  throw Error('候选预注册时点、冻结前缀或模型血缘不一致，拒绝样本外验证');
 if(Object.hasOwn(reg,'modelProvenance'))verifyModelCandidateProvenance(reg);
 return {status:'candidate-committed-before-new-signal',
  registrationFingerprint:fingerprint,registeredAt:reg.registeredAt,
  frozenPrefixDays:prefix.length,holdoutFirstDay:first.day,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={preregisterCandidate,verifyPreregisteredCandidate,currentResearchCodeFingerprint,
 preregisterSeedCandidate,verifySeedRegistrationMetadata,SEED_MODE,SEED_POLICY,
 modelCandidateBinding,verifyModelCandidateProvenance,verifyUnchangedModelReview};
