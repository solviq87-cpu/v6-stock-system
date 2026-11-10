'use strict';
/**
 * Research-only, full-membership H5 price-label bridge.
 *
 * Reuses the existing forward-signal-observer to recompute, from raw dated
 * unadjusted close bars, each independently frozen member's gross H5 return.
 * No forecast, OOS validation, automated training, model change or execution.
 */
const {evaluateForward}=require('./forward-signal-observer');
const {aShareCalendarDate}=require('./a-share-calendar');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const symbolOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const cutoff=d=>Date.parse(d+'T16:00:00+08:00');
const round=x=>Number(x.toFixed(6));
const common={
 schemaVersion:1,mode:'sector-shadow-gross-h5-price-label-research',
 returnBasis:'signal-day-close-to-h5-close-unadjusted-gross',
 priceSourceAuthorized:false,prospectiveCertified:false,
 outOfSampleValidated:false,autoPromotion:false,canTrain:false,
 canTrade:false,canNotify:false,weightsChanged:false,
 productionWeightsChanged:false
};
const blocked=reason=>({...common,status:'blocked',reason,
 labelsAvailable:false,records:[],grossMeanReturnPct:null});
function evaluateSectorShadowH5PriceLabels(preflight,membership,cohort,market,
 {sectorCategory='industry',sectorCode,now=Date.now()}={}){
 const shadow=preflight?.shadowSample;
 if(!Number.isSafeInteger(now)||now<=0||!shadow||
   preflight.schemaVersion!==1||preflight.status!=='shadow-input-preview-unverified'||
   preflight.canTrain!==false||preflight.canTrade!==false||
   preflight.autoPromotion!==false||preflight.weightsChanged!==false||
   preflight.quality?.status!=='observed-unverified'||
   shadow.schemaVersion!==1||shadow.mode!=='sector-shadow-candidate-not-training'||
   shadow.canTrain!==false||shadow.canTrade!==false||
   shadow.labelsAvailable!==false||shadow.outOfSampleValidated!==false||
   !dateOK(shadow.tradeDate)||shadow.tradeDate!==preflight.tradeDate||
   shadow.classificationVersion!==preflight.classificationVersion||
   !Number.isSafeInteger(shadow.observedAt)||shadow.observedAt<=0||
   aShareCalendarDate(shadow.observedAt)!==shadow.tradeDate||
   !Array.isArray(shadow.sectors)||shadow.sectors.length<3||
   shadow.sectors.length>300||
   !finite(shadow.marketQuoteCoveragePct)||shadow.marketQuoteCoveragePct<80||
   shadow.marketQuoteCoveragePct>100||
   sectorCategory!=='industry'||typeof sectorCode!=='string'||
   !/^[A-Za-z0-9_-]{2,30}$/.test(sectorCode))
  return blocked('invalid-frozen-shadow-input');
 const selected=shadow.sectors.filter(s=>s?.category===sectorCategory&&s.code===sectorCode);
 if(selected.length!==1||!Number.isSafeInteger(selected[0].rank)||
   selected[0].rank<1||!finite(selected[0].score)||selected[0].score<0||
   selected[0].score>100)
  return blocked('selected-industry-not-in-frozen-ranking');
 if(membership?.schemaVersion!==1||membership.source!=='imported'||
   membership.provider!==shadow.membershipSource||
   membership.classificationVersion!==shadow.classificationVersion||
   membership.tradeDate!==shadow.tradeDate||
   !Number.isSafeInteger(membership.observedAt)||
   membership.observedAt<=0||membership.observedAt>shadow.observedAt||
   !Array.isArray(membership.sectors)||membership.sectors.length>300)
  return blocked('member-provenance-or-version-conflict');
 const matches=membership.sectors.filter(s=>s?.category===sectorCategory&&s.code===sectorCode);
 if(matches.length!==1)return blocked('missing-or-duplicate-frozen-industry');
 const members=matches[0]?.members;
 if(!Array.isArray(members)||members.length<5||members.length>500||
   matches[0].memberCount!==members.length||
   new Set(members).size!==members.length||members.some(s=>!symbolOK(s)))
  return blocked('invalid-or-over-limit-full-membership');
 const required=new Set(members);
 // Only a complete, unchanged member universe is eligible. A smaller
 // handpicked subset cannot masquerade as the sector's forward outcome.
 if(cohort?.schemaVersion!==1||cohort.mode!=='frozen-forward-signal-cohort'||
   cohort.feed?.source!=='imported'||cohort.canTrade!==false||
   cohort.prospectiveCertified!==false||
   !Number.isSafeInteger(cohort.frozenAt)||cohort.frozenAt>now||
   aShareCalendarDate(cohort.frozenAt)!==shadow.tradeDate||
   cohort.frozenAt<cutoff(shadow.tradeDate)||
   cohort.frozenAt-shadow.observedAt>2*3600000||
   !Array.isArray(cohort.signals)||cohort.signals.length!==required.size)
  return blocked('unfrozen-retrospective-or-incomplete-cohort');
 const targetCohort='sector-shadow/'+sectorCategory+'/'+sectorCode;
 const seen=new Set();
 for(const signal of cohort.signals){
  if(!required.has(signal?.symbol)||seen.has(signal.symbol)||
    signal.signalDate!==shadow.tradeDate||signal.system!=='manual'||
    signal.cohort!==targetCohort||!finite(signal.signalAt)||
    signal.signalAt<cutoff(shadow.tradeDate)||
    signal.signalAt<shadow.observedAt||
    signal.signalAt>cohort.frozenAt||
    cohort.frozenAt-signal.signalAt>5*60000)
   return blocked('member-selection-or-signal-time-invalid');
  seen.add(signal.symbol);
 }
 if(market?.schemaVersion!==1||market.feed?.source!=='imported'||
   market.feed?.priceBasis!=='unadjusted'||
   !Array.isArray(market.stocks)||market.stocks.length!==required.size||
   !Array.isArray(market.calendar)||market.calendar.length>10000)
  return blocked('invalid-or-partial-forward-market-input');
 const stockIds=new Set();
 for(const stock of market.stocks){
  if(!required.has(stock?.symbol)||stockIds.has(stock.symbol))
   return blocked('forward-market-does-not-match-frozen-members');
  stockIds.add(stock.symbol);
 }
 // evaluateForward checks the frozen cohort fingerprint, immutable signal-day
 // closes, source/dataset identity, explicit calendar, future-data exclusion,
 // suspensions, zero volume, and corporate-action windows.
 let report;
 try{report=evaluateForward(cohort,market,{now});}
 catch{return blocked('forward-cohort-or-price-protocol-rejected');}
 if(report.feed?.source!=='imported'||report.cohortFingerprint!==cohort.fingerprint||
   report.prospectiveCertified!==false||report.canTrade!==false)
  return blocked('forward-report-evidence-inconsistent');
 const dayIndex=market.calendar.indexOf(shadow.tradeDate);
 if(dayIndex<0)return blocked('frozen-date-absent-from-explicit-calendar');
 const targetDate=market.calendar[dayIndex+5]||null;
 const base={...common,tradeDate:shadow.tradeDate,sectorCategory,sectorCode,
  classificationVersion:shadow.classificationVersion,
  scoreAtFreeze:selected[0].score,memberCount:required.size,
  cohortFingerprint:cohort.fingerprint,marketFingerprint:report.marketFingerprint,
  featureQuoteSource:shadow.quoteSource,
  priceFeed:{provider:report.feed.provider,datasetId:report.feed.datasetId,
   priceBasis:report.feed.priceBasis,source:report.feed.source},
  targetDate,observedAt:market.observedAt};
 if(!targetDate)return {...base,status:'pending-calendar',labelsAvailable:false,
  records:[],grossMeanReturnPct:null,reason:'explicit-calendar-h5-unavailable'};
 if(market.asOf<targetDate)return {...base,status:'pending-future-session',
  labelsAvailable:false,records:[],grossMeanReturnPct:null,
  reason:'future-h5-close-not-yet-available'};
 const records=[];
 for(const r of report.records){
  const w=r.windows.find(x=>x.tradingDays===5);
  if(!w||w.targetDate!==targetDate||
     !['observed','missing-or-suspended','corporate-action-unresolved'].includes(w.status))
   return blocked('h5-window-not-mature-or-unsupported-status');
  records.push({signalId:r.signalId,symbol:r.symbol,tradeDate:r.signalDate,
   targetDate,status:w.status,priceReturnPct:w.status==='observed'?
    round(w.priceReturnPct):null});
 }
 const complete=records.every(r=>r.status==='observed');
 const observed=records.filter(r=>r.status==='observed').map(r=>r.priceReturnPct);
 const coveragePct=round(observed.length*100/required.size);
 const sorted=[...observed].sort((a,b)=>a-b);
 const mean=complete?round(observed.reduce((a,b)=>a+b,0)/observed.length):null;
 const median=complete?round(sorted.length%2?sorted[Math.floor(sorted.length/2)]:
  (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):null;
 return {...base,status:complete?'gross-h5-label-observed-unverified':'partial-h5-evidence',
  labelsAvailable:complete,observedMembers:observed.length,
  coveragePct,grossMeanReturnPct:mean,grossMedianReturnPct:median,
  records,reason:complete?null:'incomplete-h5-member-price-or-corporate-action',
  note:'仅全体冻结行业成员均有5交易日合格未复权收盘价时公布等权毛收益标签；非可成交净收益，未独立核实采集许可/真实前瞻性，绝不允许直接训练或交易'};
}
module.exports={evaluateSectorShadowH5PriceLabels};