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
const policyFiles=[
 'factor-shadow-evolution.js','factor-learning-reliability.js',
 'factor-redundancy.js','factor-marginal-contribution.js',
 'factor-model-comparison.js','factor-global-trial-budget.js',
 'factor-candidate-prereg.js','factor-shadow-candidate-proposer.js',
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
 if(reg.mode!==SEED_MODE||reg.schemaVersion!==1||fingerprint!==hash(payload)||
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
function verifySeedCandidate(reg,{sorted,ids,packFingerprint,oldWeights,
 previousFingerprint,previousTrialFingerprint,freshTest}={}){
 verifySeedRegistrationMetadata(reg);
 const prefix=reg.frozenPrefixFingerprints,edge=sorted[prefix.length-1],first=freshTest[0],
  sealedAt=Math.max(reg.registeredAt,reg.recordedAt);
 if(reg.algorithmFingerprint!==currentResearchCodeFingerprint()||
    reg.packFingerprint!==packFingerprint||previousFingerprint||previousTrialFingerprint||
    hash(reg.factorIds)!==hash(ids)||hash(reg.acceptedWeights)!==hash(oldWeights)||
    prefix.length>=sorted.length||prefix.some((fp,i)=>fp!==sorted[i].featureFingerprint)||
    (prefix.length>0&&(reg.latestFrozenSignalDay!==edge.day||reg.lastFrozenCapturedAt!==edge.featureCapturedAt))||
    sorted.slice(prefix.length).some(f=>!Number.isSafeInteger(f.featureCapturedAt)||f.featureCapturedAt<=sealedAt)||
    !first||!Number.isSafeInteger(first.featureCapturedAt)||first.featureCapturedAt<=sealedAt||
    (reg.latestFrozenSignalDay!==null&&first.day<=reg.latestFrozenSignalDay))
  throw Error('固定种子预注册时点、冻结前缀或模型血缘不一致');
 return {status:'candidate-committed-before-new-signal',registrationFingerprint:reg.fingerprint,
  registeredAt:reg.registeredAt,recordedAt:reg.recordedAt,frozenPrefixDays:prefix.length,holdoutFirstDay:first.day,
  candidateOrigin:reg.candidateOrigin,canTrade:false,productionWeightsChanged:false};
}
function preregisterCandidate({features,candidateWeights,acceptedWeights,
 registeredAt,parentAcceptedFingerprint=null,parentTrialFingerprint=null,
 packFingerprint,autoSourceFingerprint=null}={}){
 if(!Array.isArray(features)||features.length<36||features.length>400||
    !Number.isSafeInteger(registeredAt)||registeredAt<=0||
    !/^[0-9a-f]{64}$/.test(packFingerprint||'')||
    typeof candidateWeights!=='object'||!candidateWeights||
    typeof acceptedWeights!=='object'||!acceptedWeights||
    (autoSourceFingerprint!==null&&
     !/^[a-f0-9]{64}$/.test(autoSourceFingerprint)))
  throw Error('候选预注册输入协议无效');
 const ordered=[...features];
 if(ordered.some(x=>!date(x?.signalDay)))
  throw Error('候选预注册存在无效冻结信号日期');
 ordered.sort((a,b)=>a.signalDay.localeCompare(b.signalDay));
 const latest=ordered.at(-1);
 const ids=ordered[0]?.factors?.map(x=>x.id);
 if(!Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||
    Object.keys(candidateWeights).length!==ids.length||
    Object.keys(acceptedWeights).length!==ids.length||
    ordered.some((f,i)=>!date(f?.signalDay)||
     (i>0&&ordered[i-1].signalDay===f.signalDay)||
     !/^[0-9a-f]{64}$/.test(f?.fingerprint||'')||
     f.packFingerprint!==packFingerprint||
     hash(f.factors)!==hash(ordered[0].factors)||
     !Number.isSafeInteger(f.capturedAt)||f.capturedAt>registeredAt)||
    ids.some(id=>{
     const candidate=candidateWeights[id],accepted=acceptedWeights[id],
      base=ordered[0].factors.find(x=>x.id===id)?.baseWeight;
     return !Number.isFinite(candidate)||!Number.isFinite(accepted)||
      !Number.isFinite(base)||candidate<=0||accepted<=0||
      candidate<base*.5||candidate>base*1.5||
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
  sealedBeforeFutureSignals:true,
  canTrade:false,productionWeightsChanged:false};
 return {...payload,fingerprint:hash(payload)};
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
    (reg.candidateOrigin!==undefined&&(
     reg.candidateOrigin!=='sealed-historical-training-reliability-v1'||
     !/^[a-f0-9]{64}$/.test(reg.autoSourceFingerprint||'')||
     ![previousTrialFingerprint,previousFingerprint].includes(reg.autoSourceFingerprint)))||
    hash(reg.factorIds)!==hash(ids)||hash(reg.acceptedWeights)!==hash(oldWeights)||
    !Array.isArray(prefix)||prefix.length<36||prefix.length>=sorted.length||
    prefix.some((f,i)=>f!==sorted[i].featureFingerprint)||
    !date(reg.latestFrozenSignalDay)||
    reg.latestFrozenSignalDay!==sorted[prefix.length-1].day||
    !Number.isSafeInteger(reg.registeredAt)||!Number.isSafeInteger(reg.lastFrozenCapturedAt)||
    reg.registeredAt<reg.lastFrozenCapturedAt||
    !first||first.day<=reg.latestFrozenSignalDay||
    !Number.isSafeInteger(first.featureCapturedAt)||
    reg.registeredAt>=first.featureCapturedAt||
    ids.some(id=>!Number.isFinite(reg.candidateWeights?.[id])||
     reg.candidateWeights[id]<=0))
  throw Error('候选预注册时点、冻结前缀或模型血缘不一致，拒绝样本外验证');
 return {status:'candidate-committed-before-new-signal',
  registrationFingerprint:fingerprint,registeredAt:reg.registeredAt,
  frozenPrefixDays:prefix.length,holdoutFirstDay:first.day,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={preregisterCandidate,verifyPreregisteredCandidate,currentResearchCodeFingerprint,
 preregisterSeedCandidate,verifySeedRegistrationMetadata,SEED_MODE,SEED_POLICY};
