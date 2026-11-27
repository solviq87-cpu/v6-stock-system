'use strict';
/** Internal shadow policy. The declared evidence and pass flags are not
 * authenticated A/C receipts. This module cannot authorize orders or pushes. */
const {createHash}=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {researchInstant}=require('./observed-market-timing');
const {chinaMarketWindowHint}=require('./market-snapshot-quote-time');
const VERSION='shadow-policy-v1';
const FAMILIES=Object.freeze(['trend-breakout','pullback-repair','shortline-continuation','core-strength','low-position','oversold-rebound','defensive','rotation']);
const MATRIX=Object.freeze({
 'rising-participation':['trend-breakout','pullback-repair'],
 'rising-pullback':['pullback-repair','defensive'],
 'rising-narrow-watch':['core-strength','defensive'],
 'downtrend-narrow-watch':['core-strength','defensive'],
 'downtrend-rebound':['oversold-rebound','defensive'],
 'downtrend-recovery':['pullback-repair','oversold-rebound','defensive'],
 'downtrend-decline':['defensive'],
 'mixed-watch':['rotation','defensive']
});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const flags={canTrade:false,canNotify:false,canOpenRisk:false,autoPromotion:false,weightsChanged:false};
function sessionEnd(t){
 const hint=chinaMarketWindowHint(t).window;
 const day=aShareCalendarDate(t);
 return hint==='morning-continuous-window'?Date.parse(day+'T11:30:00+08:00'):
  hint==='afternoon-continuous-window'?Date.parse(day+'T14:57:00+08:00'):null;
}
function chooseEnvironment(axes){
 const {long,medium}=axes.trend,rel=axes.structure.indexRelation,majority=axes.structure.majority;
 if(long==='up'&&rel==='index-up-majority-down')return 'rising-narrow-watch';
 if(long==='down'&&rel==='index-up-majority-down')return 'downtrend-narrow-watch';
 if(long==='up'&&medium==='up'&&majority==='majority-up'&&rel==='index-up-majority-up')return 'rising-participation';
 if(long==='up'&&medium==='up'&&majority==='majority-down')return 'rising-pullback';
 if(long==='down'&&majority==='majority-up')return medium==='up'?'downtrend-recovery':'downtrend-rebound';
 if(long==='down'&&majority==='majority-down')return 'downtrend-decline';
 return 'mixed-watch';
}
function describeResearchPolicy(snapshot,timing,axes,legacyRegime,scoreSource){
 const base={schemaVersion:1,version:VERSION,mode:'shadow-only',status:'blocked',policyId:null,
  tradeDate:snapshot?.date??null,asOf:timing?.marketAsOf??null,decisionAt:timing?.decisionAt??null,
  expiresAt:null,environment:'unknown',pushType:'data-review',eligibleResearchFamilies:[],
  candidateBudget:null,riskBudgetCeiling:null,calibrated:false,certified:false,...flags};
 const finish=(fields)=>{
  const body={...base,...fields};
  // Identifies this policy projection, not a signature or raw-data archive.
  body.policyId=createHash('sha256').update(JSON.stringify({body,source:snapshot?.source??null,scoreSource:scoreSource??null,axes:axes??null,legacyRegime:legacyRegime??null})).digest('hex');
  return body;
 };
 const block=(reason,pushType='data-review')=>finish({reason,pushType});
 const t=researchInstant(timing?.marketAsOf),now=researchInstant(timing?.decisionAt);
 if(t===null||now===null||now<t||timing.status!=='declared-aligned'||axes?.historicalAtDecision||aShareCalendarDate(now)!==snapshot.date)
  return block('market-time-unknown-or-historical');
 const end=sessionEnd(t);
 if(end===null||sessionEnd(now)!==end)return block('outside-same-continuous-session');
 if(legacyRegime==='risk_off')return block('legacy-defensive-regime','risk-review');
 if(axes?.trend?.status!=='declared-unverified'||axes?.structure?.status!=='declared-unverified'||axes?.sentiment?.status!=='declared-unverified'||
  !['up','down','flat','mixed'].includes(axes.trend.long)||!['up','down','flat','mixed'].includes(axes.trend.medium)||axes.structure.indexRelation==='unknown')
  return block('required-market-axes-incomplete');
 const stamps=snapshot.stocks.map(r=>researchInstant(r.vendorQuoteAt));
 if(!stamps.length||stamps.some(s=>s===null||s>t))return block('original-quote-clock-unavailable');
 // Do not extend original quote freshness by starting a new policy clock.
 const expiresAt=stamps.reduce((expiry,stamp)=>Math.min(expiry,stamp+90000),Math.min(t+90000,end));
 if(now>=expiresAt)return block('market-evidence-expired');
 const environment=chooseEnvironment(axes);
 const families=[...MATRIX[environment]];
 return finish({status:'research-only',reason:'uncalibrated-research-matrix',environment,expiresAt,
  pushType:environment==='downtrend-decline'?'risk-review':'research-review',eligibleResearchFamilies:families,
  disabledResearchFamilies:FAMILIES.filter(f=>!families.includes(f))});
}
/** Optional, purely descriptive candidate comparison within the same policy.
 * A/C pass declarations and mature historical summaries are not authorizations. */
function reviewPolicyCandidate(policy,candidate,asOf){
 const base={status:'blocked',code:typeof candidate?.code==='string'?candidate.code:null,
  family:typeof candidate?.family==='string'?candidate.family:null,policyId:policy?.policyId??null,
  absoluteNetReturnPct:null,relativeReturnPct:null,certified:false,...flags};
 const fail=(reason,extra={})=>({...base,...extra,reason});
 if(candidate?.gates?.cStatus==='blocked'||candidate?.gates?.aStatus==='blocked')return fail('upstream-hard-gate-veto');
 const now=researchInstant(asOf);
 if(policy?.status!=='research-only'||policy.version!==VERSION||!Array.isArray(policy.eligibleResearchFamilies)||
  researchInstant(policy.decisionAt)===null||researchInstant(policy.expiresAt)===null||researchInstant(policy.asOf)===null||
  typeof policy.policyId!=='string'||!(/^[a-f0-9]{64}$/).test(policy.policyId)||
  now===null||now<policy.decisionAt||now>=policy.expiresAt||aShareCalendarDate(now)!==policy.tradeDate)
  return fail('policy-unavailable-or-expired');
 if(!candidate||!/^\d{6}$/.test(candidate.code??'')||typeof candidate.code!=='string'||!FAMILIES.includes(candidate.family))return fail('candidate-identity-invalid');
 const gate=candidate.gates;
 if(gate?.simulated===true||gate?.aStatus!=='pass'||gate?.cStatus!=='pass'||gate.code!==candidate.code||gate.policyId!==policy.policyId||researchInstant(gate.asOf)!==policy.asOf||
  !text(gate.aEvidenceId)||!text(gate.cEvidenceId))return fail('upstream-hard-gates-unconfirmed');
 const gateKnown=researchInstant(gate.knownAt);
 if(gateKnown===null||gateKnown<policy.asOf||gateKnown>now)return fail('upstream-hard-gate-clock-invalid');
 if(!policy.eligibleResearchFamilies.includes(candidate.family))return fail('opportunity-family-not-in-policy');
 const e=candidate.history,known=researchInstant(e?.knownAt);
 if(e?.simulated===true||e?.status!=='descriptive-unverified'||e.afterCost!==true||e.environment!==policy.environment||e.family!==candidate.family||
  !text(e.source)||!text(e.evidenceId)||!dayOK(e.throughDate)||e.throughDate>=policy.tradeDate||known===null||known>policy.asOf||known<Date.parse(e.throughDate+'T15:10:00+08:00')||
  !Number.isSafeInteger(e.sampleDays)||e.sampleDays<=0||!finite(e.meanNetReturnPct)||e.meanNetReturnPct< -100)
  return fail('absolute-after-cost-history-unconfirmed');
 const metrics={absoluteNetReturnPct:e.meanNetReturnPct,relativeReturnPct:finite(e.meanRelativeReturnPct)&&text(e.benchmarkId)?e.meanRelativeReturnPct:null};
 if(e.meanNetReturnPct<=0)return fail('nonpositive-absolute-net-return',metrics);
 if(metrics.relativeReturnPct===null||metrics.relativeReturnPct<=0)return fail('relative-edge-unconfirmed-or-nonpositive',metrics);
 return {...base,...metrics,status:'research-observation',reason:'positive-descriptive-history-not-validated-edge',sampleDays:e.sampleDays};
}
// Shared read-only matrix lookup for the temporal research reducer.
function researchPolicyFamilies(environment){
 return typeof environment==='string'&&Object.hasOwn(MATRIX,environment)?[...MATRIX[environment]]:null;
}
module.exports={describeResearchPolicy,reviewPolicyCandidate,researchPolicyFamilies,sessionEnd,RESEARCH_POLICY_VERSION:VERSION};
