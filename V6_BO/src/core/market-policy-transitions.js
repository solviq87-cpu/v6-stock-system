'use strict';
/** B-group internal shadow replay. No scheduler, persistence, notifications,
 * real A/C gate authorization, production weights or orders. */
const {createHash}=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {researchInstant}=require('./observed-market-timing');
const {researchPolicyFamilies,sessionEnd,RESEARCH_POLICY_VERSION}=require('./market-research-policy');
const LIMITS=Object.freeze({switchCount:2,recoveryCount:3,minObservationGapMs:15000,
 minimumDwellMs:60000,recoverySpanMs:60000,reviewCooldownMs:120000,maxEvents:2048});
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,autoPromotion:false,weightsChanged:false,certified:false});
const stamp=x=>Number.isSafeInteger(x)&&researchInstant(x)!==null;
const id=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const label=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function readPolicy(p,t){
 const bad=reason=>({kind:'data',reason,marketAt:null,decisionAt:null,policyId:null,expiresAt:null,key:null,environment:null,families:[]});
 if(!p||p.version!==RESEARCH_POLICY_VERSION||p.mode!=='shadow-only'||!id(p.policyId)||Object.keys(FLAGS).some(k=>p[k]!==false))return bad('policy-unavailable-or-invalid');
 if(p.status==='blocked'){
  const marketAt=stamp(p.asOf)&&stamp(p.decisionAt)&&p.asOf<=p.decisionAt&&p.decisionAt<=t&&p.tradeDate===aShareCalendarDate(p.asOf)?p.asOf:null;
  return {...bad(p.pushType==='risk-review'?'market-risk-review':'market-policy-blocked'),kind:p.pushType==='risk-review'?'risk':'data',policyId:p.policyId,marketAt,decisionAt:marketAt===null?null:p.decisionAt};
 }
 const expected=researchPolicyFamilies(p.environment),end=stamp(p.asOf)?sessionEnd(p.asOf):null;
 if(p.status!=='research-only'||!expected||!Array.isArray(p.eligibleResearchFamilies)||p.eligibleResearchFamilies.length!==expected.length||
  expected.some((f,i)=>p.eligibleResearchFamilies[i]!==f)||!stamp(p.asOf)||!stamp(p.decisionAt)||!stamp(p.expiresAt)||
  p.asOf>p.decisionAt||p.decisionAt>t||p.expiresAt<=p.decisionAt||p.expiresAt>p.asOf+90000||end===null||p.expiresAt>end||
  p.tradeDate!==aShareCalendarDate(p.asOf)||
  p.pushType!==(p.environment==='downtrend-decline'?'risk-review':'research-review'))return bad('policy-clock-or-matrix-invalid');
 const meta={marketAt:p.asOf,decisionAt:p.decisionAt,policyId:p.policyId,expiresAt:p.expiresAt,key:p.environment,environment:p.environment,families:expected};
 if(t>=p.expiresAt||p.tradeDate!==aShareCalendarDate(t)||sessionEnd(t)!==end)return {...bad('market-policy-expired'),...meta,kind:'data'};
 if(p.pushType==='risk-review')return {...meta,kind:'risk',reason:'market-risk-review'};
 return {...meta,kind:'healthy',reason:null};
}
function readGates(g,p,t){
 if(g?.aStatus==='blocked'||g?.cStatus==='blocked')return 'risk';
 if(!g||g.simulated===true||g.aStatus!=='pass'||g.cStatus!=='pass'||g.policyId!==p.policyId||
  !label(g.aEvidenceId)||!label(g.cEvidenceId)||!stamp(g.knownAt)||p.decisionAt===null||g.knownAt<p.decisionAt||g.knownAt>t)return 'data';
 return 'clear';
}
const severity=s=>s==='risk-blocked'?3:s==='data-blocked'?2:0;
const empty=(reason)=>({status:'data-blocked',reason,policyId:null,marketAt:null,expiresAt:null,observedEnvironment:null,
 confirmedEnvironment:null,eligibleResearchFamilies:[],confirmationCount:0,requiredConfirmations:null,riskLatched:true,...FLAGS});
/** Replay chronological arrival records {recordedAt,policy,risk}. Pass declarations
 * in risk are unverified. Late rows are reported, never spliced into history. */
function replayResearchPolicyTransitions(events,{asOf}={}){
 const base={schemaVersion:1,mode:'shadow-policy-replay',limits:{...LIMITS},history:[],rejected:[],current:empty('no-current-observation'),...FLAGS};
 if(!stamp(asOf)||!Array.isArray(events)||events.length>LIMITS.maxEvents)return {...base,current:empty('invalid-replay-input-or-clock')};
 const history=[],rejected=[];
 let stable=null,lastConfirmedAt=null,pending=null,latched=false,highWater=null,highKey=null,highExpiry=null;
 let lastArrival=null,lastInputHash=null,lastExpiry=null,lastHint=null,integrityError=false;
 let current=base.current;
 const reject=(i,reason)=>rejected.push({index:i,reason});
 for(let i=0;i<events.length;i++){
  const e=events[i],t=e?.recordedAt;
  if(!stamp(t)){reject(i,'invalid-arrival-clock');integrityError=true;continue;}
  if(t>asOf){reject(i,'future-arrival');continue;}
  const p=readPolicy(e.policy,t),gate=readGates(e.risk,p,t);
  const gateEvidence={status:gate,aStatus:['pass','blocked'].includes(e.risk?.aStatus)?e.risk.aStatus:'unknown',
   cStatus:['pass','blocked'].includes(e.risk?.cStatus)?e.risk.cStatus:'unknown',
   aEvidenceId:label(e.risk?.aEvidenceId)?e.risk.aEvidenceId:null,cEvidenceId:label(e.risk?.cEvidenceId)?e.risk.cEvidenceId:null,
   knownAt:stamp(e.risk?.knownAt)?e.risk.knownAt:null,policyId:id(e.risk?.policyId)?e.risk.policyId:null,certified:false};
  const inputHash=hash({t,p,gateEvidence});
  if(lastArrival!==null&&t<lastArrival){reject(i,'late-arrival');continue;}
  if(t===lastArrival){reject(i,inputHash===lastInputHash?'duplicate-arrival':'conflicting-arrival');if(inputHash!==lastInputHash)integrityError=true;continue;}
  lastArrival=t;lastInputHash=inputHash;
  const explicitRisk=gate==='risk'||p.kind==='risk';
  if(!explicitRisk&&p.marketAt!==null&&highWater!==null&&p.marketAt<highWater){reject(i,'late-market-observation');continue;}
  const previous=current;
  const newer=p.marketAt!==null&&(highWater===null||p.marketAt>highWater);
  const sameCutoff=p.marketAt!==null&&p.marketAt===highWater;
  const conflict=sameCutoff&&highKey!==null&&p.key!==highKey;
  if(newer){highWater=p.marketAt;highKey=p.key;highExpiry=p.expiresAt;}
  else if(sameCutoff&&stamp(p.expiresAt)&&stamp(highExpiry))highExpiry=Math.min(highExpiry,p.expiresAt);
  const expiry=sameCutoff?highExpiry:p.expiresAt;
  if(lastExpiry!==null&&t>=lastExpiry){pending=null;latched=true;}
  let status,reason,count=0,required=null,families=[];
  if(explicitRisk||conflict||p.kind!=='healthy'||gate!=='clear'||integrityError||!stamp(expiry)||t>=expiry){
   latched=true;pending=null;
   status=explicitRisk?'risk-blocked':'data-blocked';
   reason=gate==='risk'?'upstream-veto-declared':p.kind==='risk'?p.reason:conflict?'same-cutoff-policy-conflict':integrityError?'replay-input-integrity-conflict':p.kind!=='healthy'?p.reason:gate!=='clear'?'upstream-gates-unconfirmed':'market-policy-expired';
  }else{
   const recovery=latched;
   required=recovery?LIMITS.recoveryCount:LIMITS.switchCount;
   if(!recovery&&stable===p.key){pending=null;status='research-only';reason='confirmed-policy-unchanged';families=[...p.families];}
   else{
    if(pending?.key!==p.key)pending={key:p.key,count:0,first:null,last:null};
    let counted=false;
    if(newer&&(pending.last===null||p.marketAt-pending.last>=LIMITS.minObservationGapMs)){
     pending.count++;pending.first??=p.marketAt;pending.last=p.marketAt;counted=true;
    }
    count=pending.count;
    const span=pending.first===null?0:pending.last-pending.first;
    const dwellOK=lastConfirmedAt===null||t-lastConfirmedAt>=LIMITS.minimumDwellMs;
    if(counted&&count>=required&&(recovery?span>=LIMITS.recoverySpanMs:dwellOK)){
     stable=p.key;lastConfirmedAt=t;latched=false;pending=null;status='research-only';reason=recovery?'recovery-confirmed':'switch-confirmed';families=[...p.families];
    }else{status=recovery?'recovering':'confirming';reason=recovery?'recovery-evidence-pending':'switch-evidence-pending';}
   }
  }
  lastExpiry=stamp(expiry)?expiry:null;
  current={status,reason,policyId:p.policyId,marketAt:p.marketAt,expiresAt:lastExpiry,observedEnvironment:p.environment,
   confirmedEnvironment:stable,eligibleResearchFamilies:families,confirmationCount:count,requiredConfirmations:required,riskLatched:latched,...FLAGS};
  // These are replay review hints, not actual notification instructions.
  const level=severity(status),escalation=level>severity(previous.status);
  const reviewKey=level?status+':'+reason:status==='research-only'?'stable:'+stable:null;
  let reviewHint='none';
  if(reviewKey!==null&&(escalation||lastHint?.key!==reviewKey)&&
   (escalation||lastHint===null||t-lastHint.at>=LIMITS.reviewCooldownMs)){
   reviewHint=level===3?'risk-review':level===2?'data-review':'policy-review';lastHint={key:reviewKey,at:t};
  }
  const record={sequence:history.length+1,recordedAt:t,...current,eligibleResearchFamilies:[...families],
   observedResearchFamilies:[...p.families],gateEvidence,reviewHint,
   change:{fromStatus:previous.status,toStatus:status,fromEnvironment:previous.confirmedEnvironment,toEnvironment:stable,
    addedFamilies:families.filter(f=>!previous.eligibleResearchFamilies.includes(f)),removedFamilies:previous.eligibleResearchFamilies.filter(f=>!families.includes(f))},
   previousHash:history.at(-1)?.recordHash??null};
  history.push({...record,recordHash:hash(record)});
 }
 // Evaluation expiry does not rewrite or append to accepted historical records.
 if(integrityError)current={...current,status:'data-blocked',reason:'replay-input-integrity-conflict',eligibleResearchFamilies:[],riskLatched:true};
 else if(stamp(current.expiresAt)&&asOf>=current.expiresAt&&['research-only','confirming','recovering'].includes(current.status))
  current={...current,status:'data-blocked',reason:'policy-expired-at-evaluation',eligibleResearchFamilies:[],riskLatched:true};
 return {...base,history,rejected,current};
}
module.exports={replayResearchPolicyTransitions};
