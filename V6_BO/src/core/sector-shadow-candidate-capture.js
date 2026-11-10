'use strict';
/**
 * Pure, same-day-only preparation of an immutable sector-shadow candidate.
 * No file IO, price feed call, member signal, price label or training.
 * An input-provided clock is NOT an independently trusted time attestation.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {inspectSectorShadowEligibility}=require('./sector-shadow-learning-preflight');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validMs=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const base={schemaVersion:1,mode:'sector-shadow-sameday-candidate-freeze-preflight',
 canTrain:false,canTrade:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false,
 prospectiveCertified:false,verifiedLive:false,providerLicenseIndependentlyVerified:false,
 externallyTimestampCertified:false,canCreatePriceCohort:false};
const reject=reason=>({...base,status:'blocked',reason,capture:null});
function prepareSectorShadowCandidateCapture(snapshot,membership,{now=Date.now()}={}){
 const sampledAt=Date.parse(snapshot?.retrievedAt||'');
 if(!validMs(now)||!validMs(sampledAt)||!dayOK(snapshot?.date)||
   !membership||membership.tradeDate!==snapshot.date||
   sampledAt>now||now-sampledAt>300000||
   aShareCalendarDate(now)!==snapshot.date||
   aShareCalendarDate(sampledAt)!==snapshot.date||
   // Signal-day close must already have passed. Intraday quote snapshots
   // are not eligible to masquerade as end-of-day research evidence.
   sampledAt<Date.parse(snapshot.date+'T15:00:00+08:00')||
   sampledAt>Date.parse(snapshot.date+'T16:00:00+08:00'))
  return reject('requires-fresh-same-day-operator-observation-within-five-minutes');
 let preflight;
 try{preflight=inspectSectorShadowEligibility(snapshot,membership,{asOf:sampledAt});}
 catch{return reject('preflight-source-or-structure-rejected');}
 if(preflight.status!=='shadow-input-preview-unverified')
  return reject('sector-quality-gate-rejected:'+String(preflight.reason||'unknown'));
 const shadow=preflight.shadowSample,industries=shadow?.sectors?.filter(s=>
  s.category==='industry'&&Number.isSafeInteger(s.rank)&&s.rank>0);
 if(!Array.isArray(industries)||industries.length<3||industries.length>100||
   industries.some(x=>!Number.isSafeInteger(x.memberCount)||x.memberCount<5||
    x.memberCount>500||typeof x.memberSha256!=='string'||
    !/^[a-f0-9]{64}$/.test(x.memberSha256)))
  return reject('h5-industry-full-member-freeze-capacity-not-met');
 const entry={snapshot,membership,preflightAsOf:sampledAt,
  preflight,industries:[]};
 const capture={schemaVersion:1,
  mode:'sector-h5-single-day-readiness-input-unverified',
  candidateCapturedAt:now,
  entry,
  captureStage:'same-day-sector-candidate-only-not-stock-price-cohorts',
  canTrade:false,canTrain:false,canNotify:false,weightsChanged:false,
  prospectiveCertified:false,externallyTimestampCertified:false,
  providerLicenseIndependentlyVerified:false};
 return {...base,status:'candidate-freeze-prepared-unverified',
  tradeDate:snapshot.date,rankedIndustries:industries.length,
  capture,
  note:'仅冻结当日板块预检与原始成员身份；没有冻结5交易日股票价格信号，也未认证可靠外部时间戳'};
}
module.exports={prepareSectorShadowCandidateCapture,hash};