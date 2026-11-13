'use strict';
/**
 * Locally prospective registration of sector provider-pair quality studies.
 *
 * The OS clock, SHA256 and filesystem are NOT external timestamp attestation.
 * Research-only, no learning promotion, auto provider switch, or trading.
 */
const crypto=require('node:crypto');
const {auditSectorPairQuality}=require('./sector-provider-pair-rolling-quality');
const {aShareCalendarDate}=require('./a-share-calendar');
const canonical=x=>Array.isArray(x)?x.map(canonical):
 x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const validTime=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const safeText=s=>typeof s==='string'&&s.length>=2&&s.length<=120&&
 /^[A-Za-z0-9:._-]+$/.test(s);
const safe={canTrade:false,canTrain:false,canNotify:false,autoPromotion:false,
 outOfSampleValidated:false,productionWeightsChanged:false,
 sourceLicenseIndependentlyVerified:false,externallyTimestampCertified:false,
 prospectiveCertified:false,independentlyAudited:false};
const block=(reason)=>({schemaVersion:1,
 mode:'sector-pair-prospective-local-registration-gate',
 status:'blocked',reason,...safe});
const IDENTITY_FIELDS=Object.freeze([
 'source','membershipProvider','classificationVersion',
 'primaryAdjustedProvider','secondaryAdjustedProvider',
 'primaryIndexProvider','secondaryIndexProvider','indexCode',
 'maxStockReturnDifferenceBps','maxIndexReturnDifferenceBps'
]);
const QUALITY_FIELDS=Object.freeze([
 'minMaturedSessions','maxDisagreementRatePct','maxNonComparableRatePct'
]);
const EVIDENCE_FIELDS=Object.freeze([
 'schemaVersion','mode','source','asOf','tradeDates',
 'expectedSignalDates','policy','episodes'
]);
function validDates(calendar,scheduled){
 return Array.isArray(calendar)&&calendar.length>=22&&calendar.length<=2500&&
  calendar.every((d,i)=>validDay(d)&&(i===0||calendar[i-1]<d))&&
  Array.isArray(scheduled)&&scheduled.length>=1&&scheduled.length<=90&&
  scheduled.every((d,i)=>validDay(d)&&(i===0||scheduled[i-1]<d)&&
   calendar.includes(d));
}
function validQuality(q){
 return q?.schemaVersion===1&&
  q.mode==='preregistered-sector-provider-pair-quality'&&
  Object.keys(q).sort().join(',')===
   ['schemaVersion','mode',...QUALITY_FIELDS].sort().join(',')&&
  Number.isSafeInteger(q.minMaturedSessions)&&
  q.minMaturedSessions>=3&&q.minMaturedSessions<=30&&
  Number.isSafeInteger(q.maxDisagreementRatePct)&&
  q.maxDisagreementRatePct>=0&&q.maxDisagreementRatePct<=50&&
  Number.isSafeInteger(q.maxNonComparableRatePct)&&
  q.maxNonComparableRatePct>=0&&q.maxNonComparableRatePct<=50;
}
function validIdentity(id){
 return id&&typeof id==='object'&&!Array.isArray(id)&&
  Object.keys(id).sort().join(',')===IDENTITY_FIELDS.slice().sort().join(',')&&
  IDENTITY_FIELDS.slice(0,8).every(k=>safeText(id[k]))&&
  id.primaryAdjustedProvider!==id.secondaryAdjustedProvider&&
  id.primaryIndexProvider!==id.secondaryIndexProvider&&
  Number.isSafeInteger(id.maxStockReturnDifferenceBps)&&
  id.maxStockReturnDifferenceBps>=1&&id.maxStockReturnDifferenceBps<=100&&
  Number.isSafeInteger(id.maxIndexReturnDifferenceBps)&&
  id.maxIndexReturnDifferenceBps>=1&&id.maxIndexReturnDifferenceBps<=100;
}
function validPlan(plan){
 return plan?.schemaVersion===1&&
  plan.mode==='sector-pair-prospective-registration-plan'&&
  plan.source==='operator-declared'&&
  Object.keys(plan).sort().join(',')===
   ['schemaVersion','mode','source','studyId','tradeDates',
    'expectedSignalDates','policy','identity'].sort().join(',')&&
  safeText(plan.studyId)&&validDates(plan.tradeDates,plan.expectedSignalDates)&&
  validQuality(plan.policy)&&validIdentity(plan.identity);
}
function prepareSectorPairRegistration(plan,{now=Date.now()}={}){
 if(!validTime(now)||!validPlan(plan))
  return block('invalid-plan-or-registration-clock');
 const first=plan.expectedSignalDates[0];
 const cutoff=Date.parse(first+'T09:30:00+08:00');
 if(now>=cutoff||aShareCalendarDate(now)>first)
  return block('registration-must-precede-first-expected-session-09-30');
 const receipt={schemaVersion:1,mode:'sector-pair-locally-preregistered-receipt',
  studyId:plan.studyId,registeredAt:now,registrationSource:'local-operator-clock-unattested',
  sourcePlanSha256:sha(plan),
  tradeDates:plan.tradeDates.slice(),expectedSignalDates:plan.expectedSignalDates.slice(),
  identity:Object.fromEntries(IDENTITY_FIELDS.map(k=>[k,plan.identity[k]])),
  policy:{...plan.policy,registeredAt:now},
  ...safe};
 return {status:'locally-registered-unverified',
  receipt:{...receipt,integrity:sha(receipt)},...safe};
}
function verifySectorPairRegistration(receipt,{asOf=Date.now()}={}){
 if(!receipt||!validTime(asOf)||!validTime(receipt.registeredAt)||
  receipt.registeredAt>asOf||
  receipt.schemaVersion!==1||
  receipt.mode!=='sector-pair-locally-preregistered-receipt'||
  receipt.registrationSource!=='local-operator-clock-unattested'||
  !safeText(receipt.studyId)||
  !/^[0-9a-f]{64}$/.test(receipt.sourcePlanSha256||'')||
  !validDates(receipt.tradeDates,receipt.expectedSignalDates)||
  !validIdentity(receipt.identity)||
  !validQuality(Object.fromEntries(Object.entries(receipt.policy||{})
   .filter(([k])=>k!=='registeredAt')))||
  receipt.policy?.registeredAt!==receipt.registeredAt||
  Object.keys(receipt).sort().join(',')!==
   ['schemaVersion','mode','studyId','registeredAt','registrationSource',
    'sourcePlanSha256','tradeDates','expectedSignalDates','identity',
    'policy','integrity',...Object.keys(safe)].sort().join(',')||
  !Object.entries(safe).every(([k,v])=>receipt[k]===v))
  return block('invalid-or-rewritten-local-registration-receipt');
 const {integrity,...body}=receipt;
 if(typeof integrity!=='string'||!/^[a-f0-9]{64}$/.test(integrity)||
  integrity!==sha(body))
  return block('registration-hash-mismatch');
 if(receipt.registeredAt>=
  Date.parse(receipt.expectedSignalDates[0]+'T09:30:00+08:00'))
  return block('historical-registration-after-first-session-cutoff');
 return {status:'local-receipt-integrity-only',studyId:receipt.studyId,
  registeredAt:receipt.registeredAt,receiptIntegrity:integrity,...safe};
}
function verifyRegisteredSectorPairEvidence(receipt,evidence,{now=Date.now()}={}){
 const status=verifySectorPairRegistration(receipt,{asOf:now});
 if(status.status==='blocked')return status;
 if(evidence?.schemaVersion!==1||
  !evidence||typeof evidence!=='object'||Array.isArray(evidence)||
  Object.keys(evidence).sort().join(',')!==
   EVIDENCE_FIELDS.slice().sort().join(',')||
  evidence.mode!=='sector-provider-pair-quality-imported-input'||
  evidence.source!=='imported'||!validTime(evidence.asOf)||
  evidence.asOf>now||evidence.asOf<receipt.registeredAt||
  !Array.isArray(evidence.tradeDates)||!Array.isArray(evidence.expectedSignalDates)||
  sha(evidence.tradeDates)!==sha(receipt.tradeDates)||
  sha(evidence.expectedSignalDates)!==sha(receipt.expectedSignalDates)||
  !Array.isArray(evidence.episodes))
  return block('evidence-calendar-scheduled-dates-or-clock-mismatches-locked-receipt');
 const expectedPolicy=receipt.policy;
 if(!evidence.policy||typeof evidence.policy!=='object'||
   Array.isArray(evidence.policy)||sha(evidence.policy)!==sha(expectedPolicy))
  return block('evidence-policy-differs-from-precommitted-quality-thresholds');
 for(const episode of evidence.episodes){
  const f=episode?.primary?.cohort;
  if(!f||!validTime(f.frozenAt)||f.frozenAt<receipt.registeredAt||
   !episode.policy||episode.policy.maxStockReturnDifferenceBps!==
     receipt.identity.maxStockReturnDifferenceBps||
   episode.policy.maxIndexReturnDifferenceBps!==
     receipt.identity.maxIndexReturnDifferenceBps)
   return block('retrospective-frozen-signal-or-undeclared-dual-source-tolerance');
 }
 // Re-run all original frozen-quote / company action / adjusted-source checks.
 const quality=auditSectorPairQuality({episodes:evidence.episodes,
  tradeDates:receipt.tradeDates,
  expectedSignalDates:receipt.expectedSignalDates,
  policy:receipt.policy,asOf:evidence.asOf});
 if(quality.status==='blocked')
  return block('underlying-pair-quality-audit-failed:'+quality.reason);
 if(quality.identity!==null&&sha(quality.identity)!==sha(receipt.identity))
  return block('supplier-pair-identity-or-sector-classification-drift');
 return {schemaVersion:1,mode:'sector-pair-registered-quality-review-only',
  status:quality.status,
  studyId:receipt.studyId,registeredAt:receipt.registeredAt,
  receiptIntegrity:receipt.integrity,asOf:evidence.asOf,
  quality,expectedSignalDays:receipt.expectedSignalDates.length,
  receivedEpisodeCount:evidence.episodes.length,
  localReceiptMatched:true,...safe,
  note:'登记回执只证明本地按当前输入/时间字段的完整性；可检测日历、缺档、阈值和数据商身份不一致，但无法防系统时钟回拨、离线删除整套登记证据或独立证实历史前瞻性。禁止模型训练或模拟/真实交易'};
}
module.exports={prepareSectorPairRegistration,verifySectorPairRegistration,
 verifyRegisteredSectorPairEvidence};
