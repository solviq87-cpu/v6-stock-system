'use strict';

// A typed view of existing backend evidence, never an execution authority.
// Legacy severity remains independent until an upstream rule supplies enough
// evidence for the four-level contract.
const VERSION='fayo-risk-state-20261126-v1';
const list=value=>Array.isArray(value)?value:[];
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=1200;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const unique=values=>[...new Set(values)];

function copyStateEvidence(row){
 const out={};
 for(const key of ['authorityEvidence','accumulationEvidence','actionEvidence','recoveryEvidence']){
  if(row?.[key]==null)continue;
  if(!plain(row[key])||Buffer.byteLength(JSON.stringify(row[key]))>16000)throw Error('风险状态证据格式或容量无效');
  out[key]=JSON.parse(JSON.stringify(row[key]));
 }
 for(const key of ['firstKnowableAt','dataAt'])if(row?.[key]===null||time(row?.[key]))out[key]=row[key];
 return out;
}

function accumulated(proof,now){
 if(!plain(proof)||!text(proof.ruleVersion)||!text(proof.windowVersion)||!time(proof.registeredAt)||
   !time(proof.windowStart)||!time(proof.windowEnd)||proof.registeredAt>proof.windowStart||
   proof.windowStart>=proof.windowEnd||proof.windowEnd>now||proof.validated!==true)return false;
 // Multiple indicators derived from one root/source are still one dimension.
 const dimensions=list(proof.dimensions).filter(row=>text(row?.dimensionId)&&text(row.rootCauseId)&&
   text(row.evidenceRef)&&time(row.knownAt)&&row.knownAt>=proof.windowStart&&row.knownAt<=proof.windowEnd);
 const independent=dimensions.some((left,index)=>dimensions.slice(index+1).some(right=>
   left.dimensionId!==right.dimensionId&&left.rootCauseId!==right.rootCauseId&&left.evidenceRef!==right.evidenceRef));
 const observations=list(proof.observations);
 const persistent=proof.persistentIncrease===true&&Number.isSafeInteger(proof.requiredObservations)&&proof.requiredObservations>=2&&
   Number.isSafeInteger(proof.observationCount)&&proof.observationCount>=proof.requiredObservations&&
   observations.length===proof.observationCount&&unique(observations.map(row=>row?.evidenceRef)).length===proof.observationCount&&
   observations.every((row,index)=>text(row?.evidenceRef)&&time(row.knownAt)&&row.knownAt>=proof.windowStart&&
     row.knownAt<=proof.windowEnd&&(index===0||row.knownAt>observations[index-1].knownAt));
 return independent||persistent;
}

function riskState(row,now){
 const raw=row.evidenceStatus,sourceKnown=time(row.sourceAt)&&row.sourceAt<=now;
 const authority=row.authorityEvidence;
 const authorityKnown=plain(authority)&&time(authority.observedAt)&&authority.observedAt<=now&&text(authority.source);
 const emergency=authorityKnown&&['authority-unavailable','quote-reader-failed'].includes(authority.kind)&&
   authority.detected===true&&row.status==='active';
 const ruleKnown=authorityKnown&&authority.kind==='effective-rule'&&authority.enabled===true&&
   authority.configurationStatus==='active'&&text(authority.ruleId)&&text(authority.ruleVersion);
 const ruleTriggered=ruleKnown&&authority.exceeded===true&&row.status==='active'&&raw==='available';
 const evidenceState=emergency?'complete':({available:'complete',partial:'partial',conflict:'conflict'})[raw]||'unverified';
 const dataAt=Object.hasOwn(row,'dataAt')?row.dataAt:row.sourceAt;
 const dataState=emergency?(authority.kind==='quote-reader-failed'?'interrupted':'missing'):
   raw==='stale'||row.priceDependent&&time(dataAt)&&now-dataAt>15000?'stale':
   raw==='missing'||!sourceKnown||!time(dataAt)||dataAt>now?'missing':'valid';
 const evaluable=emergency||sourceKnown&&dataState==='valid'&&['available','partial','conflict'].includes(raw);
 const assessmentState=row.status==='resolved'&&raw==='available'&&evaluable?'not-triggered':
   row.status==='active'&&evaluable?'risk-detected':'unable-to-assess';
 const riskLevel=assessmentState!=='risk-detected'?null:emergency?4:ruleTriggered?3:
   accumulated(row.accumulationEvidence,now)?2:1;
 const action=row.actionEvidence;
 const actionKnown=plain(action)&&time(action.checkedAt)&&action.checkedAt<=now&&now-action.checkedAt<=15000&&action.evidenceStatus==='available';
 const actionState=ruleTriggered?'blocked':actionKnown&&action.allowed===true?'allowed':
   actionKnown&&action.allowed===false?'blocked':'unconfirmed';
 const actionReasons=ruleTriggered?['原账户已启用规则限制新增风险；原允许的处置仍须逐项核验']:
   [text(action?.reason)?action.reason:'此记录没有当前原后端动作许可回执，提交时仍须重新核验'];
 const ruleVersion=ruleKnown?authority.ruleVersion:row.accumulationEvidence?.ruleVersion||row.references?.policyVersion||row.references?.strategyVersion||null;
 const firstKnowableAt=time(row.firstKnowableAt)&&row.firstKnowableAt<=now?row.firstKnowableAt:null;
 const missing=[];
 if(!sourceKnown)missing.push('original-evidence-time');
 if(firstKnowableAt===null)missing.push('first-knowable-time');
 if(!text(ruleVersion))missing.push('rule-version');
 if(!text(row.references?.inputVersion))missing.push('input-version');
 if(riskLevel===1&&['warning','critical'].includes(row.severity)&&!ruleTriggered)missing.push('validated-accumulation-window-or-effective-rule');
 if(!actionKnown&&!ruleTriggered)missing.push('current-action-permission');
 return {assessmentState,riskLevel,evidenceState,dataState,actionState,actionReasons,
  riskContract:{version:VERSION,ruleVersion:text(ruleVersion)?ruleVersion:null,
   inputVersion:text(row.references?.inputVersion)?row.references.inputVersion:null,
   ruleConfiguration:ruleKnown?'active':authority?.configurationStatus||'unverified',
   firstKnowableAt,sourceAt:sourceKnown?row.sourceAt:null,dataAt:time(dataAt)&&dataAt<=now?dataAt:null,
   configurationVerified:ruleKnown,parametersValidated:accumulated(row.accumulationEvidence,now),
   predictiveValue:'unverified',missing,
   scope:emergency?'account-or-data-chain':row.category,legacySeverity:row.severity,
   canAuthorize:false,probability:null}};
}

function lastValidRisk(rows,now){
 const usable=list(rows).filter(row=>row.evidenceState==='complete'&&
  (row.dataState==='valid'||row.riskLevel===4)&&row.assessmentState==='risk-detected'&&time(row.sourceAt)&&row.sourceAt<=now);
 if(!usable.length)return null;
 return {riskLevel:Math.max(...usable.map(row=>row.riskLevel||0)),sourceAt:Math.max(...usable.map(row=>row.sourceAt)),
  risks:JSON.parse(JSON.stringify(usable))};
}

function resolutionCheck(incoming,previous,now){
 const former=list(previous?.risks),oldTime=previous?.sourceAt??Math.max(0,...former.map(row=>time(row.sourceAt)?row.sourceAt:0));
 const rows=list(incoming.risks);
 if(!rows.length||rows.some(row=>row.assessmentState!=='not-triggered'||row.evidenceState!=='complete'||
   row.dataState!=='valid'||!time(row.sourceAt)||row.sourceAt<=oldTime||row.sourceAt>now))
  return {allowed:false,reason:'解除需要晚于上次有效风险的全新有效证据'};
 for(const row of former){
  const proof=row.authorityEvidence;
  if(['authority-unavailable','quote-reader-failed'].includes(proof?.kind)){
   const expected=proof.kind==='authority-unavailable'?'account-reconciled':'original-quotes-restored';
   if(!rows.some(next=>next.recoveryEvidence?.kind===expected&&next.recoveryEvidence.confirmed===true&&
     time(next.recoveryEvidence.checkedAt)&&next.recoveryEvidence.checkedAt>oldTime&&
     next.recoveryEvidence.checkedAt<=now&&text(next.recoveryEvidence.source)))
    return {allowed:false,reason:'尚缺对应原账户对账或原数据链恢复回执，其他行情恢复不能解除此事故'};
  }
  if(proof?.kind==='effective-rule'&&!rows.some(next=>next.authorityEvidence?.kind==='effective-rule'&&
    next.authorityEvidence.ruleId===proof.ruleId&&next.authorityEvidence.ruleVersion===proof.ruleVersion&&
    next.authorityEvidence.configurationStatus==='active'&&next.authorityEvidence.enabled===true&&next.authorityEvidence.exceeded===false))
   return {allowed:false,reason:'原生效规则尚无同版本重新核验通过的回执'};
 }
 return {allowed:true,reason:null};
}

function reductionCheck(incoming,previous,now){
 // Lowering a grade must not discard a still-unreconciled authority incident
 // or an installed restriction. Reuse the same evidence and recovery checks.
 return resolutionCheck({risks:list(incoming.risks).map(row=>({...row,
  assessmentState:row.assessmentState==='risk-detected'?'not-triggered':row.assessmentState}))},previous,now);
}

module.exports={VERSION,riskState,copyStateEvidence,lastValidRisk,resolutionCheck,reductionCheck,accumulated};
