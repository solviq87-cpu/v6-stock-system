'use strict';
/**
 * Single-day, read-only readiness for the existing sector H5 evidence chain.
 *
 * This gate never creates historical signals, fetches prices, repairs missing
 * data, publishes labels or hands any sample to a training/financial writer.
 * It distinguishes what a user can still freeze today from an irrecoverable
 * missing contemporaneous freeze on a past date.
 */
const {isDeepStrictEqual}=require('node:util');
const {aShareCalendarDate}=require('./a-share-calendar');
const {inspectSectorShadowEligibility}=require('./sector-shadow-learning-preflight');
const {freezeCohort}=require('./forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels}=require('./sector-shadow-h5-price-label');
const {replaySectorH5DailyEvidence}=require('./sector-h5-raw-evidence-replay');
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const validStamp=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const base={
 schemaVersion:1,mode:'sector-h5-daily-evidence-readiness-only',
 verifiedLive:false,providerLicenseIndependentlyVerified:false,
 externallyTimestampCertified:false,prospectiveCertified:false,
 outOfSampleValidated:false,canTrain:false,canTrade:false,
 canNotify:false,autoPromotion:false,weightsChanged:false,
 productionWeightsChanged:false,canWrite:false,
 readyForTraining:false,readyForTrading:false,allLabelsReplayed:false
};
const blocked=(reason)=>({...base,status:'blocked',reason,sectorStatuses:[]});
const info=(stage,reason,sectors=[])=>({...base,status:'incomplete',
 stage,reason,sectorStatuses:sectors});
const byCategoryCode=x=>x.category+'|'+x.code;
function inspectSectorH5DailyReadiness(entry,{tradeDates,asOf=Date.now()}={}){
 const snap=entry?.snapshot,membership=entry?.membership;
 const end=Date.parse(snap?.retrievedAt||'');
 const observed=entry?.preflightAsOf??end;
 if(!validStamp(asOf)||!validStamp(end)||end>asOf||
   !validStamp(observed)||observed<end||observed-end>300000||
   !dateOK(snap?.date)||aShareCalendarDate(observed)!==snap.date||
   !Array.isArray(tradeDates)||tradeDates.length<6||
   tradeDates.length>1200||
   tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=tradeDates[i-1]))||
   !Array.isArray(membership?.sectors)||membership.tradeDate!==snap.date)
  return blocked('invalid-quote-membership-clock-or-explicit-calendar');
 const index=tradeDates.indexOf(snap.date);
 if(index<0)return blocked('snapshot-day-not-in-calendar');
 const target=tradeDates[index+5]||null;
 if(!target)return info('await-explicit-h5-calendar','missing-fifth-forward-session');
 let preflight;
 try{preflight=inspectSectorShadowEligibility(snap,membership,{asOf:observed});}
 catch{return blocked('source-quality-recomputation-failed');}
 if(preflight.status!=='shadow-input-preview-unverified')
  return blocked('source-quality-blocked:'+String(preflight.reason||'unknown'));
 // No later "preflight recomputation" can replace the contemporaneous
 // serialized candidate. Recomputed preview only checks the submitted one.
 if(!entry?.preflight)
  return info(aShareCalendarDate(asOf)===snap.date?
   'freeze-today-candidate-required':'past-candidate-not-frozen',
   'no-original-same-day-frozen-preflight');
 if(!isDeepStrictEqual(entry.preflight,preflight))
  return blocked('frozen-preflight-differs-from-original-source');
 const s=preflight.shadowSample;
 const ranked=s.sectors.filter(x=>x.category==='industry'&&
  Number.isSafeInteger(x.rank)&&x.rank>0);
 if(ranked.length<3||ranked.length>100)return blocked('ranked-industry-count-invalid');
 const industries=entry.industries;
 if(industries!==undefined&&(!Array.isArray(industries)||industries.length>100))
  return blocked('invalid-or-excess-industry-inputs');
 const submitted=new Map();
 for(const record of industries||[]){
  if(typeof record?.sectorCode!=='string'||!record.sectorCode||
   submitted.has(record.sectorCode))
   return blocked('duplicate-or-invalid-industry-episode');
  submitted.set(record.sectorCode,record);
 }
 const required=new Set(ranked.map(x=>x.code));
 if(submitted.size>required.size||[...submitted.keys()].some(x=>!required.has(x)))
  return blocked('extra-nonfrozen-industry-episode');
 const usedMembers=new Set(),sectorStatuses=[],complete=[];
 let commonPriceFeed=null;
 for(const sector of ranked){
  const rows=membership.sectors.filter(x=>x?.category==='industry'&&x.code===sector.code);
  if(rows.length!==1)return blocked('missing-or-duplicate-industry-member-group');
  const members=rows[0].members;
  if(!Array.isArray(members)||members.length<5||members.length>500||
   rows[0].memberCount!==members.length||new Set(members).size!==members.length||
   members.some(x=>typeof x!=='string'||!/^\d{6}$/.test(x)))
   return blocked('full-member-freeze-capacity-or-identity-invalid');
  for(const member of members){
   if(usedMembers.has(member))return blocked('duplicate-stock-across-industries');
   usedMembers.add(member);
  }
  const item=submitted.get(sector.code);
  if(!item?.cohort){
   sectorStatuses.push({sectorCode:sector.code,status:
    aShareCalendarDate(asOf)===snap.date?
    'needs-same-day-cohort-freeze':'missing-cohort-cannot-backfill'});
   continue;
  }
  const cohort=item.cohort;
  if(!validStamp(cohort?.frozenAt)||cohort.frozenAt>asOf||
   aShareCalendarDate(cohort.frozenAt)!==snap.date||
   cohort.frozenAt<observed||cohort.frozenAt-observed>2*3600000||
   cohort.feed?.source!=='imported'||!Array.isArray(cohort.signals)||
   cohort.signals.length!==members.length)
   return blocked('invalid-or-late-frozen-industry-cohort');
  let computedCohort;
  try{computedCohort=freezeCohort({schemaVersion:1,
   feed:cohort.feed,signals:cohort.signals},{now:cohort.frozenAt});}
  catch{return blocked('cohort-fingerprint-or-structure-invalid');}
  if(!isDeepStrictEqual(cohort,computedCohort))
   return blocked('frozen-cohort-recomputation-conflict');
  const memberSet=new Set(members),signalSymbols=new Set();
  for(const signal of cohort.signals){
   if(!memberSet.has(signal.symbol)||signalSymbols.has(signal.symbol)||
     signal.system!=='manual'||signal.signalDate!==snap.date||
     signal.cohort!=='sector-shadow/industry/'+sector.code||
     !validStamp(signal.signalAt)||signal.signalAt<observed||
     signal.signalAt>cohort.frozenAt||
     cohort.frozenAt-signal.signalAt>300000)
    return blocked('frozen-member-signal-selection-or-time-invalid');
   signalSymbols.add(signal.symbol);
  }
  if(!item.market){
   sectorStatuses.push({sectorCode:sector.code,status:
    target>aShareCalendarDate(asOf)?'await-h5-price-market':'h5-price-evidence-missing',
    targetDate:target});
   continue;
  }
  const market=item.market;
  const baseIndex=market?.calendar?.indexOf(snap.date);
  if(!Array.isArray(market?.calendar)||baseIndex<0||
   !isDeepStrictEqual(market.calendar.slice(baseIndex,baseIndex+6),
    tradeDates.slice(index,index+6))||
   !dateOK(market.asOf)||!tradeDates.includes(market.asOf))
   return blocked('price-calendar-conflicts-with-imported-h5-sessions');
  const feed=market?.feed?.provider+'|'+market?.feed?.datasetId;
  if(commonPriceFeed!==null&&feed!==commonPriceFeed)
   return blocked('different-price-feed-between-ranked-industries');
  commonPriceFeed=feed;
  const observedLabel=evaluateSectorShadowH5PriceLabels(preflight,membership,
   cohort,market,{sectorCode:sector.code,now:asOf});
  if(observedLabel.status==='blocked')
   return blocked('h5-price-protocol-blocked:'+observedLabel.reason);
  if(observedLabel.targetDate!==target)
   return blocked('h5-price-target-differs-from-imported-calendar');
  if(observedLabel.status!=='gross-h5-label-observed-unverified'){
   sectorStatuses.push({sectorCode:sector.code,status:observedLabel.status,
    targetDate:target,observedMembers:observedLabel.observedMembers??0,
    memberCount:members.length});
   continue;
  }
  if(!item.label){
   sectorStatuses.push({sectorCode:sector.code,status:'needs-h5-label-review',
    targetDate:target,observedMembers:members.length,memberCount:members.length});
   continue;
  }
  if(!isDeepStrictEqual(item.label,observedLabel))
   return blocked('claimed-h5-label-conflicts-with-raw-bars');
  sectorStatuses.push({sectorCode:sector.code,status:'raw-h5-label-replayed',
   targetDate:target,memberCount:members.length});
  complete.push(item);
 }
 if(complete.length!==ranked.length)
  return info('evidence-incomplete-or-future-pending',
   'not-every-frozen-industry-has-a-verified-matured-h5-label',sectorStatuses);
 const check=replaySectorH5DailyEvidence({
  snapshot:snap,membership,preflight:entry.preflight,preflightAsOf:observed,
  industries:complete},{asOf});
 if(check.status!=='raw-replay-complete-unverified')
  return blocked('daily-full-replay-failed:'+String(check.reason||'unknown'));
 return {...base,status:'ready-for-history-audit-unverified',
  tradeDate:snap.date,targetDate:target,
  rankedIndustries:ranked.length,sectorStatuses,
  allLabelsReplayed:true,
  note:'仅表示某一信号日所有冻结行业H5价格标签内部重算一致；还需多天不重叠样本、独立时间与许可证据。绝不可自动训练/调权/成交'};
}
module.exports={inspectSectorH5DailyReadiness};