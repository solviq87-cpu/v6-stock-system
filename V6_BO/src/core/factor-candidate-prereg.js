'use strict';
/**
 * Optional STRICT prospective candidate commitment.
 * A candidate must be committed BEFORE the earliest new frozen signal being
 * used to test it. Merely hashing an already evaluated candidate is NOT a
 * preregistration.
 */
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const policyFiles=[
 'factor-shadow-evolution.js','factor-learning-reliability.js',
 'factor-redundancy.js','factor-marginal-contribution.js',
 'factor-model-comparison.js','factor-global-trial-budget.js',
 'factor-candidate-prereg.js','factor-shadow-candidate-proposer.js'
];
function currentResearchCodeFingerprint(){
 return hash(policyFiles.map(file=>[file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));
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
module.exports={preregisterCandidate,verifyPreregisteredCandidate,currentResearchCodeFingerprint};
