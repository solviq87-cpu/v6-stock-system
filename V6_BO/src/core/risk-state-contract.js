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
 const emergencyDetected=authorityKnown&&['authority-unavailable','quote-reader-failed'].includes(authority.kind)&&authority.detected===true;
 const emergency=emergencyDetected&&row.status==='active';
 const ruleKnown=authorityKnown&&authority.kind==='effective-rule'&&authority.enabled===true&&
   authority.configurationStatus==='active'&&text(authority.ruleId)&&text(authority.ruleVersion);
 const authorityClear=authority==null||authorityKnown&&(
   authority.kind==='effective-rule'&&ruleKnown&&authority.exceeded===false||
   ['authority-unavailable','quote-reader-failed'].includes(authority.kind)&&authority.detected===false);
 const ruleBreach=ruleKnown&&authority.exceeded===true;
 const ruleTriggered=ruleBreach&&row.status==='active'&&raw==='available';
 const evidenceState=emergency?'complete':({available:'complete',partial:'partial',conflict:'conflict'})[raw]||'unverified';
 const dataAt=Object.hasOwn(row,'dataAt')?row.dataAt:row.sourceAt;
 const dataState=emergencyDetected?(authority.kind==='quote-reader-failed'?'interrupted':'missing'):
   raw==='stale'||row.priceDependent&&time(dataAt)&&now-dataAt>15000?'stale':
   raw==='missing'||!sourceKnown||!time(dataAt)||dataAt>now?'missing':'valid';
 const evaluable=emergency||sourceKnown&&dataState==='valid'&&['available','partial','conflict'].includes(raw);
 const assessmentState=row.status==='resolved'&&authorityClear&&!ruleBreach&&!emergencyDetected&&raw==='available'&&evaluable?'not-triggered':
   row.status==='active'&&evaluable?'risk-detected':'unable-to-assess';
 const riskLevel=assessmentState!=='risk-detected'?null:emergency?4:ruleTriggered?3:
   accumulated(row.accumulationEvidence,now)?2:1;
 const action=row.actionEvidence;
 const actionKnown=plain(action)&&time(action.checkedAt)&&action.checkedAt<=now&&now-action.checkedAt<=15000&&action.evidenceStatus==='available';
 const priceActionCurrent=!row.priceDependent||raw==='available'&&dataState==='valid'&&sourceKnown&&
   now-row.sourceAt<=15000&&actionKnown&&action.checkedAt>=Math.max(row.sourceAt,dataAt)&&
   (action.quoteAt==null||action.quoteAt===dataAt);
 const actionState=ruleBreach&&raw==='available'?'blocked':actionKnown&&action.allowed===true&&!emergencyDetected&&priceActionCurrent?'allowed':
   actionKnown&&action.allowed===false?'blocked':'unconfirmed';
 const actionReasons=ruleBreach&&raw==='available'?['原账户已启用规则限制新增风险；原允许的处置仍须逐项核验']:
   actionKnown&&action.allowed===true&&!priceActionCurrent?['动作回执与当前有效原价格证据未同时核验；不能把旧价或异步回执显示为当前允许']:
   [text(action?.reason)?action.reason:'此记录没有当前原后端动作许可回执，提交时仍须重新核验'];
 const ruleVersion=ruleKnown?authority.ruleVersion:row.accumulationEvidence?.ruleVersion||row.references?.policyVersion||row.references?.strategyVersion||null;
 const firstKnowableAt=time(row.firstKnowableAt)&&row.firstKnowableAt<=now?row.firstKnowableAt:null;
 const missing=[];
 if(!sourceKnown)missing.push('original-evidence-time');
 if(firstKnowableAt===null)missing.push('first-knowable-time');
 if(!text(ruleVersion))missing.push('rule-version');
 if(!text(row.references?.inputVersion))missing.push('input-version');
 if(riskLevel===1&&['warning','critical'].includes(row.severity)&&!ruleTriggered)missing.push('validated-accumulation-window-or-effective-rule');
 if((!actionKnown||action?.allowed===true&&!priceActionCurrent)&&!ruleTriggered)missing.push('current-action-permission');
 if(row.status==='resolved'&&!authorityClear)missing.push('valid-authority-clearance');
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

// A fresh wrapper row cannot renew or change the source of its authority receipt.
function freshRecoveryReceipt(receipt,at,next,proof,oldTime,now){
 return plain(receipt)&&text(proof.source)&&receipt.source===proof.source&&time(at)&&
   at>oldTime&&(!time(proof.observedAt)||at>proof.observedAt)&&at>=next.sourceAt&&at<=now;
}

const planOf=row=>row?.references?.planId??row?.planId??null;
const lotOf=row=>row?.references?.entryEventId??row?.entryEventId??null;
function sameRecoveryScope(next,former){
 return (!text(former.rootCauseId)||next.rootCauseId===former.rootCauseId)&&
   (!text(former.object?.type)||next.object?.type===former.object.type)&&
   (!text(former.object?.id)||next.object?.id===former.object.id)&&
   (!text(planOf(former))||planOf(next)===planOf(former))&&
   (!text(lotOf(former))||lotOf(next)===lotOf(former))&&
   (!text(planOf(former))||!text(former.references?.kind)||next.references?.kind===former.references.kind);
}
// Keep unresolved scope identity separate from the last complete risk grade.
// Unknown evidence can carry an obligation to recover but cannot create a grade.
function recoveryScopeKey(row){
 const a=row.authorityEvidence||{};
 return JSON.stringify([row.id??null,row.rootCauseId??null,row.object?.type??null,row.object?.id??null,
   a.kind??null,a.source??null,a.ruleId??null,a.ruleVersion??null,planOf(row),lotOf(row),
   text(planOf(row))?row.references?.kind??null:null]);
}
function completeRisk(row){
 return row.assessmentState==='risk-detected'&&row.evidenceState==='complete'&&
   (row.dataState==='valid'||row.riskLevel===4)&&time(row.sourceAt);
}
function obligationAt(row,observedAt){
 return completeRisk(row)?Math.max(row.sourceAt,time(row.riskContract?.dataAt)?row.riskContract.dataAt:0):observedAt;
}
function pendingRecoveryScopes(group){
 if(Array.isArray(group?.pendingRecovery))return group.pendingRecovery;
 if(!group||group.status==='resolved')return [];
 // Legacy records have no independent scope ledger. Reconstruct from retained
 // and current rows at their recorded times, never at a new read's wall clock.
 const entries=new Map(),at=group.lastSeenAt||group.firstSeenAt||group.resolutionBaselineAt;
 for(const row of [...list(group.lastValidRisk?.risks),...list(group.risks).filter(r=>r.status!=='resolved')]){
   const k=recoveryScopeKey(row),old=entries.get(k);
   const baseline=obligationAt(row,at);
   if(!old||completeRisk(row)&&(!completeRisk(old.row)||row.sourceAt>old.row.sourceAt))
     entries.set(k,{row,at:Math.max(time(baseline)?baseline:0,old?.at||0,time(group.resolutionBaselineAt)?group.resolutionBaselineAt:0)||null});
 }
 return [...entries.values()];
}
function recoveryBaseline(group){
 const pending=pendingRecoveryScopes(group);
 return {risks:pending.map(x=>x.row),sourceAt:Math.max(0,...pending.map(x=>time(x.at)?x.at:0))||null,
   riskLevel:group?.lastValidRisk?.riskLevel??group?.riskLevel??null};
}
// Clearance attempts are assessed against the prior obligations before any
// update. A rejected clearance is not a new adverse observation.
function updatePendingRecovery(group,observed,now,{closed=false,replace=false,clearanceAttempts=[]}={}){
 if(closed)return [];
 const previous=replace?[]:pendingRecoveryScopes(group),pending=new Map(previous.map(x=>[recoveryScopeKey(x.row),x]));
 for(const [key,item] of pending){
   if(list(observed).some(row=>row.status==='resolved'&&resolutionCheck({risks:[row]},{risks:[item.row],sourceAt:item.at},now).allowed))
     pending.delete(key);
 }
 for(const row of list(observed)){
   if(row.status==='resolved'||clearanceAttempts.includes(row.id))continue;
   const key=recoveryScopeKey(row),old=pending.get(key),at=obligationAt(row,now);
   if(!old){pending.set(key,{row,at});continue;}
   if(!completeRisk(row))continue;
   if(completeRisk(old.row)&&(row.sourceAt<old.row.sourceAt||
     row.riskLevel<old.row.riskLevel&&!reductionCheck({risks:[row]},{risks:[old.row],sourceAt:old.at,riskLevel:old.row.riskLevel},now).allowed))continue;
   pending.set(key,{row,at:Math.max(at,old.at)});
 }
 // If a full-clearance attempt failed the aggregate check, retain a baseline
 // even if individual receipts could otherwise remove every obligation.
 return pending.size?[...pending.values()]:previous;
}
function resolutionCheck(incoming,previous,now){
 const former=list(previous?.risks),oldTime=Math.max(time(previous?.sourceAt)?previous.sourceAt:0,
   ...former.map(row=>time(row?.sourceAt)?row.sourceAt:0));
 if(!time(now)||!former.length||former.some(row=>!plain(row))||!time(oldTime)||oldTime>now)
  return {allowed:false,reason:'缺少有效的原风险证据和解除时间基线'};
 const rows=list(incoming?.risks);
 if(!rows.length||rows.some(row=>row.assessmentState!=='not-triggered'||row.evidenceState!=='complete'||
   row.dataState!=='valid'||!time(row.sourceAt)||row.sourceAt<=oldTime||row.sourceAt>now||
   !time(row.riskContract?.dataAt??row.dataAt??row.sourceAt)||(row.riskContract?.dataAt??row.dataAt??row.sourceAt)<=oldTime||
   (row.riskContract?.dataAt??row.dataAt??row.sourceAt)>now))
  return {allowed:false,reason:'解除需要晚于上次有效风险的全新有效证据'};
 for(const row of former){
  const matching=rows.filter(next=>sameRecoveryScope(next,row));
  if(!matching.length)return {allowed:false,reason:'缺少同一原风险根因与对象的恢复证据'};
  const proof=row.authorityEvidence;
  if(['authority-unavailable','quote-reader-failed'].includes(proof?.kind)){
   const expected=proof.kind==='authority-unavailable'?'account-reconciled':'original-quotes-restored';
   if(!matching.some(next=>next.recoveryEvidence?.kind===expected&&next.recoveryEvidence.confirmed===true&&
     freshRecoveryReceipt(next.recoveryEvidence,next.recoveryEvidence.checkedAt,next,proof,oldTime,now)))
    return {allowed:false,reason:'尚缺对应原账户对账或原数据链恢复回执，其他行情恢复不能解除此事故'};
  }
  if(proof?.kind==='effective-rule'&&!matching.some(next=>next.authorityEvidence?.kind==='effective-rule'&&
    next.authorityEvidence.ruleId===proof.ruleId&&next.authorityEvidence.ruleVersion===proof.ruleVersion&&
    next.authorityEvidence.configurationStatus==='active'&&next.authorityEvidence.enabled===true&&next.authorityEvidence.exceeded===false&&
    freshRecoveryReceipt(next.authorityEvidence,next.authorityEvidence.observedAt,next,proof,oldTime,now)))
   return {allowed:false,reason:'原生效规则尚无同版本重新核验通过的回执'};
 }
 return {allowed:true,reason:null};
}

function reductionCheck(incoming,previous,now){
 // Lowering a grade must not discard a still-unreconciled authority incident
 // or an installed restriction. Reuse the same evidence and recovery checks.
 const rows=list(incoming?.risks),oldLevel=previous?.riskLevel??Math.max(0,...list(previous?.risks).map(row=>row?.riskLevel||0));
 const active=rows.filter(row=>row?.assessmentState==='risk-detected');
 if(![2,3,4].includes(oldLevel)||!active.length||active.some(row=>![1,2,3,4].includes(row.riskLevel)||row.riskLevel>=oldLevel))
  return {allowed:false,reason:'风险降级必须保留真实的较低有效风险等级'};
 return resolutionCheck({risks:rows.map(row=>({...row,
  assessmentState:row.assessmentState==='risk-detected'?'not-triggered':row.assessmentState}))},previous,now);
}

module.exports={VERSION,riskState,copyStateEvidence,lastValidRisk,resolutionCheck,reductionCheck,accumulated,recoveryScopeKey,pendingRecoveryScopes,recoveryBaseline,updatePendingRecovery};
