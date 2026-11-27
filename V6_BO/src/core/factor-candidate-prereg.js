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
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(x));
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/.test(id)&&
 !Object.hasOwn(Object.prototype,id)&&id!=='prototype';
const ownData=(row,key)=>{const d=Object.getOwnPropertyDescriptor(row,key);return !!d&&d.enumerable&&Object.hasOwn(d,'value');};
const exactKeys=(row,ids)=>plain(row)&&Reflect.ownKeys(row).length===ids.length&&ids.every(id=>ownData(row,id));
const validIds=ids=>Array.isArray(ids)&&ids.length>=2&&Array.from(ids).every(validId)&&new Set(ids).size===ids.length;
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function declaredDefinitions(defs,ids){
 if(!Array.isArray(defs)||defs.length!==ids.length||!validIds(ids)||
    Array.from(defs).some((d,i)=>!plain(d)||!ownData(d,'id')||!ownData(d,'baseWeight')||d.id!==ids[i]||!positive(d.baseWeight)))return null;
 return defs;
}
function canonicalDefinitions(ids,packFingerprint){
 if(packFingerprint!==hash(factorPack))return null;
 return ids.map(id=>{const f=factorPack.factors.find(x=>x.id===id);
  return f?{id,baseWeight:f.weight}:null;});
}
// Recheck the SAME bounded research policy when reading a sealed record.
// A content hash does not prove the candidate still satisfies that policy.
function weightsValid(candidate,accepted,ids,definitions=null){
 if(!validIds(ids)||!exactKeys(candidate,ids)||!exactKeys(accepted,ids)||
    definitions!==null&&!declaredDefinitions(definitions,ids))return false;
 if(![candidate,accepted].every(w=>Number.isFinite(ids.reduce((sum,id)=>sum+w[id],0)))||
    definitions!==null&&!Number.isFinite(definitions.reduce((sum,d)=>sum+d.baseWeight,0)))return false;
 return ids.every((id,i)=>{
  const c=candidate[id],a=accepted[id],base=definitions?.[i].baseWeight;
  if(!positive(c)||!positive(a)||c<a*.92-1e-7||c>a*1.08+1e-7)return false;
  if(base!==undefined&&(!positive(base*.5)||!positive(base*1.5)||
     a<base*.5||a>base*1.5||c<base*.5||c>base*1.5))return false;
  return true;
 });
}
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const timestamp=t=>Number.isSafeInteger(t)&&t>0&&t<8e15;
const validCapture=(day,t)=>date(day)&&timestamp(t)&&new Date(t+28800000).toISOString().slice(0,10)===day;
function sealedFeature(f){
 if(!plain(f)||!seal(f.fingerprint)||!validCapture(f.signalDay,f.capturedAt))return false;
 const {fingerprint,...payload}=f;
 try{return hash(payload)===fingerprint;}catch{return false;}
}
function bodyMatches(row,reg){
 const body=row.features;
 if(!plain(body)||body.signalDay!==row.day||body.capturedAt!==row.featureCapturedAt||body.packFingerprint!==reg.packFingerprint||
    !declaredDefinitions(body.factors,reg.factorIds))return false;
 const defs=body.factors.map(d=>({id:d.id,baseWeight:d.baseWeight}));
 const declared=reg.factorDefinitions?.map(d=>({id:d.id,baseWeight:d.baseWeight}));
 if(declared&&hash(defs)!==hash(declared))return false;
 try{return hash(body)===row.featureFingerprint;}catch{return false;}
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
 if(!plain(config)||Reflect.ownKeys(config).some(k=>typeof k!=='string'||!ownData(config,k))||config.schemaVersion!==1||config.mode!=='v6-fixed-shadow-seed-config-v1'||
    config.researchOnly!==true||config.canTrade!==false||config.seedPolicy!==SEED_POLICY||
    Object.keys(config).some(k=>!['schemaVersion','mode','researchOnly','canTrade','seedPolicy','factorIds'].includes(k))||
    !validIds(config.factorIds)||
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
 if(reg.mode!==SEED_MODE||reg.schemaVersion!==1||fingerprint!==hash(payload)||
    reg.candidateOrigin!=='fixed-pack-seed-v1'||reg.seedPolicy!==SEED_POLICY||
    reg.seedConfigFingerprint!==hash(reg.seedConfig)||reg.packFingerprint!==hash(factorPack)||
    !seal(reg.algorithmFingerprint)||
    !timestamp(reg.registeredAt)||!timestamp(reg.recordedAt)||reg.recordedAt<reg.registeredAt||
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
     (!validCapture(reg.latestFrozenSignalDay,reg.lastFrozenCapturedAt)||reg.registeredAt<reg.lastFrozenCapturedAt)))
  throw Error('固定种子预注册元信息或完整性无效');
 return definition;
}
function preregisterSeedCandidate({features=[],seedConfig,registeredAt}={}){
 const definition=seedDefinition(seedConfig),packFingerprint=hash(factorPack),recordedAt=Date.now();
 if(!Array.isArray(features)||features.length>400||
    !timestamp(registeredAt)||!timestamp(recordedAt)||recordedAt<registeredAt||recordedAt>registeredAt+60000)
  throw Error('固定种子预注册输入协议无效');
 const ordered=[...features].sort((a,b)=>String(a?.signalDay).localeCompare(String(b?.signalDay)));
 if(new Set(ordered.map(f=>f?.fingerprint)).size!==ordered.length||ordered.some((f,i)=>!sealedFeature(f)||
    f.packFingerprint!==packFingerprint||hash(f.factors)!==hash(definition.definitions)||
    !Number.isSafeInteger(f.capturedAt)||f.capturedAt<=0||f.capturedAt>registeredAt||
    (i>0&&ordered[i-1].signalDay===f.signalDay)))
  throw Error('固定种子真实冻结前缀或因子定义无效');
 const latest=ordered.at(-1),payload={schemaVersion:1,mode:SEED_MODE,
  candidateOrigin:'fixed-pack-seed-v1',seedPolicy:SEED_POLICY,seedConfig:{...seedConfig,factorIds:[...seedConfig.factorIds]},
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
    !timestamp(reg.registeredAt)||!timestamp(sealedAt)||sorted.length>400||
    prefix.length>=sorted.length||!freshTest.length||freshTest.length>sorted.length)
  return false;
 const seen=new Set(),byDay=new Map(),native=sorted.some(row=>row&&Object.hasOwn(row,'features'));
 for(let i=0;i<sorted.length;i++){
  const row=sorted[i];
  if(!validCapture(row?.day,row?.featureCapturedAt)||!seal(row.featureFingerprint)||seen.has(row.featureFingerprint)||
     (i>0&&sorted[i-1].day>=row.day)||native&&!bodyMatches(row,reg)||(i<prefix.length?
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
  candidateOrigin:reg.candidateOrigin,registrationClockEvidence:'recorded-wall-clock',
  featureBodyEvidence:sorted.some(row=>Object.hasOwn(row,'features'))?'matched-frozen-body':'fingerprint-references-only',
  canTrade:false,productionWeightsChanged:false};
}
function preregisterCandidate({features,candidateWeights,acceptedWeights,
 registeredAt,parentAcceptedFingerprint=null,parentTrialFingerprint=null,
 packFingerprint,autoSourceFingerprint=null}={}){
 if(!Array.isArray(features)||features.length<36||features.length>400||
    !timestamp(registeredAt)||!seal(packFingerprint)||
    !plain(candidateWeights)||!plain(acceptedWeights)||
    (autoSourceFingerprint!==null&&
     (!seal(autoSourceFingerprint)||![parentAcceptedFingerprint,parentTrialFingerprint].includes(autoSourceFingerprint))))
  throw Error('候选预注册输入协议无效');
 const ordered=[...features];
 if(ordered.some(x=>!date(x?.signalDay)))
  throw Error('候选预注册存在无效冻结信号日期');
 ordered.sort((a,b)=>a.signalDay.localeCompare(b.signalDay));
 const latest=ordered.at(-1);
 const defs=ordered[0]?.factors;
 const ids=Array.isArray(defs)?defs.map(x=>x?.id):null;
 const canonical=validIds(ids)?canonicalDefinitions(ids,packFingerprint):null;
 if(!validIds(ids)||!declaredDefinitions(defs,ids)||
    !weightsValid(candidateWeights,acceptedWeights,ids,defs)||
    (canonical!==null&&(!weightsValid(candidateWeights,acceptedWeights,ids,canonical)||
      defs.some((d,i)=>d.baseWeight!==canonical[i]?.baseWeight)))||
    new Set(ordered.map(f=>f.fingerprint)).size!==ordered.length||
    ordered.some((f,i)=>!date(f?.signalDay)||
     (i>0&&ordered[i-1].signalDay===f.signalDay)||
     !sealedFeature(f)||
     f.packFingerprint!==packFingerprint||
     hash(f.factors)!==hash(defs)||
     !Number.isSafeInteger(f.capturedAt)||f.capturedAt<=0||f.capturedAt>registeredAt))
  throw Error('候选预注册冻结样本、权重边界或完整性无效');
 const payload={schemaVersion:1,mode:'v6-shadow-candidate-prereg-v1',
  registeredAt,latestFrozenSignalDay:latest.signalDay,
  lastFrozenCapturedAt:latest.capturedAt,
  frozenPrefixFingerprints:ordered.map(x=>x.fingerprint),
  factorIds:ids,packFingerprint,algorithmFingerprint:currentResearchCodeFingerprint(),
  // Bind the absolute base envelope as part of new ordinary registrations.
  // Old records remain readable; the current pack supplies canonical bounds.
  factorDefinitions:defs.map(d=>({id:d.id,baseWeight:d.baseWeight})),
  acceptedWeights:{...acceptedWeights},candidateWeights:{...candidateWeights},
  parentAcceptedFingerprint,parentTrialFingerprint,
  ...(autoSourceFingerprint===null?{}:{
   candidateOrigin:'sealed-historical-training-reliability-v1',
   autoSourceFingerprint}),
  sealedBeforeFutureSignals:true,
  canTrade:false,productionWeightsChanged:false};
 return {...payload,fingerprint:hash(payload)};
}
function verifyPreregisteredCandidate(reg,{sorted,ids,packFingerprint,
 oldWeights,previousFingerprint,previousTrialFingerprint,freshTest}={}){
 if(!reg||typeof reg!=='object'||!Array.isArray(sorted)||
    !validIds(ids)||!Array.isArray(freshTest))
  throw Error('缺少不可变候选预注册，拒绝事后试验');
 if(reg.mode===SEED_MODE)return verifySeedCandidate(reg,{
  sorted,ids,packFingerprint,oldWeights,previousFingerprint,previousTrialFingerprint,freshTest});
 const {fingerprint,...payload}=reg;
 const first=freshTest[0],prefix=reg.frozenPrefixFingerprints;
 const canonical=canonicalDefinitions(ids,packFingerprint);
 const sealedDefinitions=Object.hasOwn(reg,'factorDefinitions')?declaredDefinitions(reg.factorDefinitions,ids):null;
 const envelope=canonical??sealedDefinitions;
 if(fingerprint!==hash(payload)||reg.mode!=='v6-shadow-candidate-prereg-v1'||
    reg.schemaVersion!==1||reg.canTrade!==false||
    reg.productionWeightsChanged!==false||
    reg.sealedBeforeFutureSignals!==true||
    reg.packFingerprint!==packFingerprint||
    reg.algorithmFingerprint!==currentResearchCodeFingerprint()||
    reg.parentAcceptedFingerprint!==(previousFingerprint||null)||
    reg.parentTrialFingerprint!==(previousTrialFingerprint||null)||
    (reg.candidateOrigin!==undefined&&(
     reg.candidateOrigin!=='sealed-historical-training-reliability-v1'||
     !/^[a-f0-9]{64}$/.test(reg.autoSourceFingerprint||'')||
     ![previousTrialFingerprint,previousFingerprint].includes(reg.autoSourceFingerprint)))||
    hash(reg.factorIds)!==hash(ids)||hash(reg.acceptedWeights)!==hash(oldWeights)||
    (Object.hasOwn(reg,'factorDefinitions')&&!sealedDefinitions)||
    (canonical!==null&&sealedDefinitions!==null&&hash(canonical)!==hash(sealedDefinitions))||
    !weightsValid(reg.candidateWeights,reg.acceptedWeights,ids,envelope)||
    !exactKeys(oldWeights,ids)||
    (reg.candidateOrigin===undefined&&Object.hasOwn(reg,'autoSourceFingerprint'))||
    !Array.isArray(prefix)||prefix.length<36||
    !matchesFrozenWindows(reg,sorted,freshTest,reg.registeredAt))
  throw Error('候选预注册时点、冻结前缀或模型血缘不一致，拒绝样本外验证');
 return {status:'candidate-committed-before-new-signal',
  registrationFingerprint:fingerprint,registeredAt:reg.registeredAt,
  frozenPrefixDays:prefix.length,holdoutFirstDay:first.day,registrationClockEvidence:'declared-registration-time',
  featureBodyEvidence:sorted.some(row=>Object.hasOwn(row,'features'))?'matched-frozen-body':'fingerprint-references-only',
  canTrade:false,productionWeightsChanged:false};
}
module.exports={preregisterCandidate,verifyPreregisteredCandidate,currentResearchCodeFingerprint,
 preregisterSeedCandidate,verifySeedRegistrationMetadata,SEED_MODE,SEED_POLICY};
