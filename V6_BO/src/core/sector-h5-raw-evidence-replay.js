'use strict';
/**
 * Opt-in, raw-evidence replay before the fixed H5 research scorecard.
 * Every candidate and member label must be reproducible from the original
 * same-day quote/membership and the frozen cohort + dated price bars.
 * This validates internal consistency only; it is NOT an independent feed,
 * timestamp, legal-license or prospective-research certification.
 */
const {isDeepStrictEqual}=require('node:util');
const {inspectSectorShadowEligibility}=require('./sector-shadow-learning-preflight');
const {evaluateSectorShadowH5PriceLabels}=require('./sector-shadow-h5-price-label');
const {evaluateSectorH5WalkForward}=require('./sector-h5-walkforward-cost-audit');
const guarded={
 schemaVersion:1,mode:'sector-h5-raw-evidence-replay-audit',
 rawEvidenceReplayed:false,externallyTimestampCertified:false,
 providerLicenseIndependentlyVerified:false,prospectiveCertified:false,
 outOfSampleValidated:false,eligibleForResearchPromotion:false,
 canTrain:false,canTrade:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false
};
const fail=reason=>({...guarded,status:'blocked',reason,folds:null});
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const codeOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{2,30}$/.test(x);
/**
 * A day is complete only if *every ranked industry* has a matching raw
 * membership, a separately frozen full-member signal cohort and price bars.
 * All claimed outputs are checked field-for-field against recomputed outputs.
 */
function replaySectorH5DailyEvidence(entry,{asOf=Date.now()}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||!entry||
   typeof entry!=='object'||Array.isArray(entry))
  return fail('invalid-replay-clock-or-input');
 const {snapshot,membership,preflight,preflightAsOf,industries}=entry;
 const end=Date.parse(snapshot?.retrievedAt||'');
 const clock=preflightAsOf===undefined?end:preflightAsOf;
 if(!Number.isSafeInteger(end)||end<=0||end>asOf||
   !Number.isSafeInteger(clock)||clock<end||clock-end>300000||
   !dateOK(snapshot?.date)||!Array.isArray(industries)||
   industries.length<3||industries.length>100||
   !Array.isArray(preflight?.shadowSample?.sectors)||
   preflight?.shadowSample?.tradeDate!==snapshot.date||
   membership?.tradeDate!==snapshot.date)
  return fail('incomplete-same-day-candidate-and-replay-contract');
 let candidate;
 try{candidate=inspectSectorShadowEligibility(snapshot,membership,{asOf:clock});}
 catch{return fail('frozen-sector-candidate-recomputation-threw');}
 if(candidate.status!=='shadow-input-preview-unverified'||
   !isDeepStrictEqual(preflight,candidate))
  return fail('frozen-sector-candidate-differs-from-original-quote-and-membership');
 const expected=preflight.shadowSample.sectors.filter(s=>s?.category==='industry'&&
  Number.isSafeInteger(s.rank)&&s.rank>0);
 if(expected.length!==industries.length)return fail('missing-or-extra-ranked-industry-episode');
 const byCode=new Map();
 for(const item of industries){
  const code=item?.sectorCode;
  if(!codeOK(code)||byCode.has(code)||!item?.cohort||
    !item?.market||!item?.label)
   return fail('invalid-or-duplicate-sector-episode');
  byCode.set(code,item);
 }
 const usedStocks=new Set(),usedCohorts=new Set(),replayed=[];
 for(const sector of expected){
  const piece=byCode.get(sector.code);
  if(!piece)return fail('ranked-industry-has-no-raw-episode');
  const members=membership.sectors.filter(s=>s?.category==='industry'&&
   s.code===sector.code);
  if(members.length!==1||!Array.isArray(members[0].members))
   return fail('missing-unique-original-industry-membership');
  for(const stock of members[0].members){
   if(usedStocks.has(stock))
    return fail('industry-membership-double-counts-a-symbol');
   usedStocks.add(stock);
  }
  let calculated;
  try{
   calculated=evaluateSectorShadowH5PriceLabels(preflight,membership,
    piece.cohort,piece.market,{sectorCode:sector.code,now:asOf});
  }catch{
   return fail('unreplayable-cohort-or-price-input');
  }
  if(calculated.status!=='gross-h5-label-observed-unverified'||
    calculated.labelsAvailable!==true)
   return fail('sector-h5-not-completely-mature-or-replay-blocked');
  if(!isDeepStrictEqual(piece.label,calculated))
   return fail('claimed-h5-label-differs-from-replayed-raw-prices');
  if(usedCohorts.has(calculated.cohortFingerprint))
   return fail('duplicated-frozen-cohort-in-industry-cross-section');
  usedCohorts.add(calculated.cohortFingerprint);
  replayed.push(calculated);
 }
 return {...guarded,status:'raw-replay-complete-unverified',
  rawEvidenceReplayed:true,tradeDate:snapshot.date,sectorCount:replayed.length,
  entry:{preflight,labels:replayed},
  note:'已用同日原报价/分类与冻结信号/未来未复权日K重新计算每份H5行业标签；仍非外部可信时间戳或数据供应商认证'};
}
/**
 * Read-only, no-write companion to #108's legacy label-level audit.
 * The older scorer may still accept self-reported labels; consumers needing
 * price-lineage assurance MUST call this replay wrapper instead.
 */
function evaluateReplayedSectorH5WalkForward(entries,options={}){
 if(!Array.isArray(entries)||entries.length<24||entries.length>80||
   !Number.isSafeInteger(options.asOf)||options.asOf<=0)
  return fail('invalid-replay-window-or-research-clock');
 const verified=[];
 for(const item of entries){
  const result=replaySectorH5DailyEvidence(item,{asOf:options.asOf});
  if(result.status!=='raw-replay-complete-unverified')
   return fail('daily-replay-blocked:'+result.reason);
  verified.push(result.entry);
 }
 const audit=evaluateSectorH5WalkForward(verified,options);
 if(audit.status!=='descriptive-walk-forward-unverified')
  return fail('fixed-walkforward-blocked:'+String(audit.reason||'unknown'));
 return {...audit,...guarded,
  status:'raw-replayed-descriptive-audit-unverified',
  rawEvidenceReplayed:true,
  note:'全部行业标签先以原始冻结信号与原始价格重新推算，再作不可重叠H5固定规则研究。未独立验证来源/时间戳/回测收益/成本，不允许自动学习或交易'};
}
module.exports={replaySectorH5DailyEvidence,evaluateReplayedSectorH5WalkForward};