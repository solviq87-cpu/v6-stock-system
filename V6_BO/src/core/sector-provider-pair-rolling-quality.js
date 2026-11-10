'use strict';
/**
 * Offline pair-level LONGITUDINAL diagnostics using immutable frozen episodes.
 * It deliberately cannot identify the guilty provider, rank vendors for
 * execution, certify authorization, or promote any research to model training.
 */
const {aShareCalendarDate}=require('./a-share-calendar');
const {auditSectorDualSource}=require('./sector-dual-adjusted-source-audit');
const {HORIZONS}=require('./sector-frozen-forward-prices');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const timeOK=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const safe={canTrade:false,canTrain:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false,outOfSampleValidated:false,
 labelsAvailable:false,netReturnsAvailable:false,verifiedLive:false,
 sourceLicenseIndependentlyVerified:false,providersIndependentlyVerified:false,
 approvedSourceForTrading:null};
const block=reason=>({schemaVersion:1,mode:'sector-provider-pair-rolling-quality-research',
 status:'blocked',reason,horizons:[],...safe});
const pct=(n,d)=>d?Number((100*n/d).toFixed(3)):null;
// A same-day horizon is not mature merely because its calendar date has begun.
// For research-quality coverage, wait until 15:15 China Standard Time.
const maturityAt=day=>Date.parse(day+'T15:15:00+08:00');
function validPolicy(p){
 return p?.schemaVersion===1&&p.mode==='preregistered-sector-provider-pair-quality'&&
  timeOK(p.registeredAt)&&
  Number.isSafeInteger(p.minMaturedSessions)&&p.minMaturedSessions>=3&&
  p.minMaturedSessions<=30&&
  Number.isSafeInteger(p.maxDisagreementRatePct)&&p.maxDisagreementRatePct>=0&&
  p.maxDisagreementRatePct<=50&&
  Number.isSafeInteger(p.maxNonComparableRatePct)&&p.maxNonComparableRatePct>=0&&
  p.maxNonComparableRatePct<=50;
}
function auditSectorPairQuality({episodes,expectedSignalDates,tradeDates,
 policy,asOf=Date.now()}={}){
 if(!timeOK(asOf)||!validPolicy(policy)||policy.registeredAt>asOf||
  !Array.isArray(tradeDates)||tradeDates.length<22||tradeDates.length>2500||
  tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=tradeDates[i-1]))||
  !Array.isArray(expectedSignalDates)||expectedSignalDates.length<1||
  expectedSignalDates.length>90||
  expectedSignalDates.some((d,i)=>!dateOK(d)||(i>0&&d<=expectedSignalDates[i-1])||
    !tradeDates.includes(d)||d>aShareCalendarDate(asOf))||
  !Array.isArray(episodes)||episodes.length>90)
  return block('invalid-preregistered-policy-calendar-or-clock');
 // Operator-registered expected signal days must precede outcomes; raw records
 // alone would silently omit failed/unavailable days and inflate reliability.
 const first=expectedSignalDates[0];
 if(policy.registeredAt>Date.parse(first+'T09:30:00+08:00'))
  return block('quality-policy-registered-after-first-expected-signal');
 const expected=new Set(expectedSignalDates),episodeByDay=new Map();
 let pair=null;
 for(const episode of episodes){
  const date=episode?.primary?.cohort?.tradeDate;
  if(!expected.has(date)||episodeByDay.has(date))
   return block('duplicate-or-unexpected-cohort-date');
  if(episode?.asOf>asOf||!timeOK(episode?.asOf))
   return block('future-or-invalid-episode-observation-time');
  const report=auditSectorDualSource(episode);
  if(report.status==='blocked'||report.tradeDate!==date)
   return block('invalid-unreplayable-dual-source-episode');
  // These identity fields must be stable across dates. A change means a
  // different study, not an improvement/degradation of the same supplier pair.
  const current=JSON.stringify({
   source:episode.primary.cohort.source,
   membershipProvider:episode.primary.cohort.membershipProvider,
   classificationVersion:episode.primary.cohort.classificationVersion,
   primaryAdjustedProvider:report.primaryAdjustedProvider,
   secondaryAdjustedProvider:report.secondaryAdjustedProvider,
   primaryIndexProvider:report.primaryIndexProvider,
   secondaryIndexProvider:report.secondaryIndexProvider,
   indexCode:report.indexCode,
   maxStockReturnDifferenceBps:report.maxStockReturnDifferenceBps,
   maxIndexReturnDifferenceBps:report.maxIndexReturnDifferenceBps
  });
  if(pair!==null&&pair!==current)
   return block('provider-pair-classification-or-comparison-policy-changed');
  pair=current;
  episodeByDay.set(date,report);
 }
 const observedDate=aShareCalendarDate(asOf);
 const horizonReports=HORIZONS.map((h,i)=>{
  const out={sessions:h,expectedSignalDays:expectedSignalDates.length,
   notMaturedSignalDays:0,maturedSignalDays:0,
   missingEpisodeDays:[],pendingAfterMaturityDays:[],
   unknownOrPartialDays:[],partialDisagreementDays:[],
   disagreementDays:[],agreeDays:[],
   comparedSectorCount:0,disagreeingSectorCount:0,unknownSectorCount:0,
   maxObservedStockGapBps:null,maxObservedIndexGapBps:null,
   comparableRatePct:null,disagreementRatePct:null,
   nonComparableRatePct:null,status:'insufficient-evidence'};
  let maxStock=null,maxIndex=null;
  for(const date of expectedSignalDates){
   const pos=tradeDates.indexOf(date),target=tradeDates[pos+h]||null;
   if(!target||target>observedDate||asOf<maturityAt(target)){
    out.notMaturedSignalDays++;continue;
   }
   out.maturedSignalDays++;
   const report=episodeByDay.get(date);
   if(!report){out.missingEpisodeDays.push(date);continue;}
   const row=report.horizons[i];
   if(!row||row.sessions!==h||row.targetDate!==target)
    return {blocked:'episode-target-date-conflict'};
   if(row.status==='pending'){
    out.pendingAfterMaturityDays.push(date);continue;
   }
   if(row.status==='unknown'||row.status==='partial-or-unknown'){
    out.unknownOrPartialDays.push(date);continue;
   }
   if(row.status!=='disagreement'&&
      row.status!=='supplier-agreement-unverified')
    return {blocked:'unexpected-dual-source-window-status'};
   if(!Array.isArray(row.sectors)||row.sectors.length===0||
     row.comparedSectors!==row.agreedSectors+row.disagreeingSectors||
     row.sectors.length!==row.comparedSectors+row.unknownSectors)
    return {blocked:'inconsistent-sector-comparison-counts'};
   out.comparedSectorCount+=row.comparedSectors;
   out.disagreeingSectorCount+=row.disagreeingSectors;
   out.unknownSectorCount+=row.unknownSectors;
   if(finite(row.indexReturnDifferenceBps))
    maxIndex=maxIndex===null?row.indexReturnDifferenceBps:
     Math.max(maxIndex,row.indexReturnDifferenceBps);
   for(const s of row.sectors||[]){
    if(finite(s.maxStockReturnDifferenceBps))
     maxStock=maxStock===null?s.maxStockReturnDifferenceBps:
      Math.max(maxStock,s.maxStockReturnDifferenceBps);
   }
   // Partial comparisons are NOT complete days even if one known sector disagreed.
   // Preserve that disagreement as an alarm without inflating comparable coverage.
   if(row.unknownSectors>0){
    out.unknownOrPartialDays.push(date);
    if(row.disagreeingSectors>0)out.partialDisagreementDays.push(date);
   }else if(row.status==='disagreement')out.disagreementDays.push(date);
   else out.agreeDays.push(date);
  }
  const comparable=out.agreeDays.length+out.disagreementDays.length;
  const missing=out.maturedSignalDays-comparable;
  out.comparableRatePct=pct(comparable,out.maturedSignalDays);
  out.disagreementRatePct=pct(out.disagreementDays.length,comparable);
  out.nonComparableRatePct=pct(missing,out.maturedSignalDays);
  out.maxObservedStockGapBps=maxStock;
  out.maxObservedIndexGapBps=maxIndex;
  if(out.maturedSignalDays<policy.minMaturedSessions)
   out.status='insufficient-matured-signal-days';
  else if(out.nonComparableRatePct>policy.maxNonComparableRatePct)
   out.status='watch-coverage-or-stale-data';
  else if(out.disagreementRatePct===null)
   out.status='insufficient-comparable-episodes';
  else if(out.partialDisagreementDays.length>0)
   out.status='watch-partial-evidence-with-observed-disagreement';
  else if(out.disagreementRatePct>policy.maxDisagreementRatePct)
   out.status='watch-cross-source-disagreement';
  else out.status='descriptive-low-disagreement-unverified';
  return out;
 });
 const bad=horizonReports.find(x=>x.blocked);
 if(bad)return block(bad.blocked);
 const alerts=horizonReports.filter(x=>x.status.startsWith('watch'));
 const insufficient=horizonReports.filter(x=>x.status.startsWith('insufficient'));
 const identity=pair===null?null:JSON.parse(pair);
 return {schemaVersion:1,mode:'sector-provider-pair-rolling-quality-research',
  status:alerts.length?'pair-quality-watch-unverified':
   insufficient.length?'insufficient-evidence':'pair-quality-reviewed-unverified',
  asOf,identity,registeredQualityPolicyAt:policy.registeredAt,
  expectedSignalDayCount:expectedSignalDates.length,
  receivedEpisodeCount:episodes.length,
  minMaturedSessions:policy.minMaturedSessions,
  maxDisagreementRatePct:policy.maxDisagreementRatePct,
  maxNonComparableRatePct:policy.maxNonComparableRatePct,
  maturityRule:'target-session-15:15-Asia-Shanghai',
  horizons:horizonReports,...safe,
  note:'逐信号日审核双供应商盘中复权数据的相对收益分歧、指数分歧和缺失率；仅评价这一对声明不同的数据源，不判断哪一家有错。逐1/5/20交易日成熟，缺档不作为正常，未成熟不作为失败；无许可、复权真实性、独立性或交易认证'};
}
module.exports={auditSectorPairQuality};
