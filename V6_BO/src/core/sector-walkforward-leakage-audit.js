'use strict';
/**
 * Read-only audit of sector frozen raw-price episodes.
 * Temporal separation does NOT certify adjusted/net returns, live provenance,
 * independent benchmark, statistical significance or model promotability.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const HORIZONS=[1,5,20];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const timeOK=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const identity=x=>x.category+'|'+x.code;
const flags={canTrade:false,canTrain:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false,
 outOfSampleValidated:false,labelsAvailable:false,netReturnsAvailable:false,
 verifiedLive:false,statisticalSignificanceCertified:false};
const blocked=reason=>({schemaVersion:1,mode:'sector-walkforward-leakage-audit-only',
 status:'blocked',reason,...flags});
function assertFrozen(f,asOf){
 if(!f||typeof f!=='object'||!timeOK(asOf))return false;
 const {fingerprint,...payload}=f;
 if(typeof fingerprint!=='string'||fingerprint!==hash(payload)||
  f.schemaVersion!==1||f.mode!=='sector-frozen-raw-quote-price-cohort'||
  !dateOK(f.tradeDate)||!timeOK(f.observedAt)||!timeOK(f.frozenAt)||
  aShareCalendarDate(f.observedAt)!==f.tradeDate||
  aShareCalendarDate(f.frozenAt)!==f.tradeDate||
  f.frozenAt<f.observedAt||f.frozenAt-f.observedAt>600000||
  f.frozenAt>asOf||
  !/^[a-f0-9]{64}$/.test(f.snapshotFingerprint||'')||
  !/^[a-f0-9]{64}$/.test(f.membershipFingerprint||'')||
  typeof f.source!=='string'||!f.source||
  typeof f.classificationVersion!=='string'||!f.classificationVersion||
  typeof f.membershipProvider!=='string'||!f.membershipProvider||
  f.priceBasis!=='unadjusted-intraday-provider-raw-quote'||
  f.sectorReturnMethod!=='equal-weight-frozen-constituent-gross-price-change'||
  f.prospectiveCertified!==false||
  f.canTrain!==false||f.canTrade!==false||f.weightsChanged!==false||
  f.outOfSampleValidated!==false||f.labelsAvailable!==false||
  f.netReturnsAvailable!==false||
  !Array.isArray(f.sectors)||f.sectors.length<3||f.sectors.length>300)
  return false;
 const seen=new Set();
 for(const s of f.sectors){
  if(!['industry','concept'].includes(s?.category)||
   typeof s.code!=='string'||!/^[A-Za-z0-9_-]{2,30}$/.test(s.code)||
   seen.has(identity(s))||!Number.isSafeInteger(s.rank)||s.rank<1||
   !numeric(s.score)||s.score<0||s.score>100||
   !Array.isArray(s.members)||s.members.length<5||s.members.length>10000||
   !numeric(s.baselinePriceCoveragePct)||s.baselinePriceCoveragePct<0||
   s.baselinePriceCoveragePct>100)return false;
  seen.add(identity(s));
  const symbols=new Set();
  for(const m of s.members){
   if(!m||typeof m.symbol!=='string'||!/^\d{6}$/.test(m.symbol)||
    symbols.has(m.symbol)||((m.baselinePrice===null)!==(m.baselineQuoteAt===null))||
    (m.baselinePrice!==null&&(!numeric(m.baselinePrice)||m.baselinePrice<=0))||
    (m.baselineQuoteAt!==null&&(!timeOK(m.baselineQuoteAt)||
      m.baselineQuoteAt>f.observedAt||f.observedAt-m.baselineQuoteAt>300000||
      aShareCalendarDate(m.baselineQuoteAt)!==f.tradeDate)))return false;
   symbols.add(m.symbol);
  }
 }
 return true;
}
function inspectObservation(f,r,calendar,asOf){
 if(!r||r.schemaVersion!==1||
  r.mode!=='sector-frozen-forward-gross-price-observation'||
  r.status!=='research-observation-unverified'||
  r.tradeDate!==f.tradeDate||r.frozenFingerprint!==f.fingerprint||
  r.classificationVersion!==f.classificationVersion||
  r.source!==f.source||r.priceBasis!==f.priceBasis||
  r.returnMethod!==f.sectorReturnMethod||
  r.corporateActionEvidence!=='operator-imported-unverified'||
  !timeOK(r.asOf)||r.asOf<f.frozenAt||r.asOf>asOf||
  !Object.entries(flags).filter(([k])=>k!=='productionWeightsChanged'&&
    k!=='statisticalSignificanceCertified').every(([k,v])=>r[k]===v)||
  !Array.isArray(r.horizons)||r.horizons.length!==3)
  return false;
 const baseIndex=calendar.indexOf(f.tradeDate),seen=new Set(f.sectors.map(identity));
 for(let i=0;i<HORIZONS.length;i++){
  const h=r.horizons[i],distance=HORIZONS[i],target=calendar[baseIndex+distance]||null;
  if(h?.sessions!==distance||h.targetDate!==target||
   !['pending','unknown','partial-or-unknown',
     'descriptive-raw-price-observed-unverified'].includes(h.status)||
   !Number.isSafeInteger(h.observedSectorCount)||h.observedSectorCount<0||
   !Array.isArray(h.sectors)||h.sectors.length>f.sectors.length)return false;
  if(h.status==='pending'||h.status==='unknown'){
   if(h.observedSectorCount!==0||h.sectors.length!==0)return false;
   continue;
  }
  if(!target||target>aShareCalendarDate(r.asOf)||
    h.sectors.length!==f.sectors.length)return false;
  const covered=new Set();let count=0;
  for(const s of h.sectors){
   if(!['industry','concept'].includes(s?.category)||
    !seen.has(identity(s))||covered.has(identity(s)))return false;
   covered.add(identity(s));
   const original=f.sectors.find(x=>identity(x)===identity(s));
   if(s.baselineRank!==original.rank||s.memberCount!==original.members.length||
    s.benchmarkReturnPct!==null||s.netReturnPct!==null||
    !Number.isSafeInteger(s.observedMembers)||s.observedMembers<0||
    s.observedMembers>original.members.length)return false;
   if(s.status==='descriptive-raw-price-observed-unverified'){
    if(!numeric(s.grossRawPriceReturnPct)||s.grossRawPriceReturnPct< -90||
      s.grossRawPriceReturnPct>500||
      s.observedMembers!==original.members.length)return false;
    count++;
   }else if(s.status!=='unknown'||s.grossRawPriceReturnPct!==null||
     s.observedMembers!==0)return false;
  }
  if(count!==h.observedSectorCount||
    (h.status==='descriptive-raw-price-observed-unverified')!==(count===f.sectors.length))
   return false;
 }
 return true;
}
function newStats(){
 return {episodes:0,fullTwentyDayEpisodes:0,
  horizonStats:HORIZONS.map(sessions=>({sessions,fullEpisodes:0,
   observedSectors:0,pendingEpisodes:0,unknownEpisodes:0,
   descriptiveGrossRawReturnMeanPct:null})),grossSums:[0,0,0]};
}
function accumulate(stats,episode){
 stats.episodes++;
 if(episode.observation.horizons[2].status==='descriptive-raw-price-observed-unverified')
  stats.fullTwentyDayEpisodes++;
 for(let i=0;i<HORIZONS.length;i++){
  const h=episode.observation.horizons[i],s=stats.horizonStats[i];
  if(h.status==='pending')s.pendingEpisodes++;
  if(h.status==='unknown'||h.status==='partial-or-unknown')s.unknownEpisodes++;
  if(h.status==='descriptive-raw-price-observed-unverified')s.fullEpisodes++;
  for(const x of h.sectors){
   if(x.status==='descriptive-raw-price-observed-unverified'){
    s.observedSectors++;stats.grossSums[i]+=x.grossRawPriceReturnPct;
   }
  }
 }
}
function finalizeStats(s){
 const out={episodes:s.episodes,fullTwentyDayEpisodes:s.fullTwentyDayEpisodes,
  horizonStats:s.horizonStats.map((h,i)=>({...h,
   descriptiveGrossRawReturnMeanPct:h.observedSectors?
    Number((s.grossSums[i]/h.observedSectors).toFixed(5)):null}))};
 return out;
}
function auditSectorWalkForward(episodes,{tradeDates,trainEnd,validationStart,
 validationEnd,asOf=Date.now()}={}){
 if(!timeOK(asOf)||!Array.isArray(tradeDates)||tradeDates.length<22||
  tradeDates.length>2500||
  tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=tradeDates[i-1]))||
  ![trainEnd,validationStart,validationEnd].every(dateOK))
  return blocked('invalid-explicit-calendar-or-boundaries');
 const trainIndex=tradeDates.indexOf(trainEnd),
  validationIndex=tradeDates.indexOf(validationStart),
  valEndIndex=tradeDates.indexOf(validationEnd);
 if(trainIndex<0||validationIndex<=trainIndex||
   valEndIndex<validationIndex||validationEnd>aShareCalendarDate(asOf))
  return blocked('invalid-chronological-train-validation-split');
 if(!Array.isArray(episodes)||episodes.length>2500)
  return blocked('invalid-episode-list');
 const train=newStats(),validation=newStats(),seen=new Set(),seenDates=new Set();
 const exclusion={purgedTwentyDayOverlap:0,trainObservedTooLate:0,
  pendingOrIncompleteTrainTwentyDay:0,outsideDeclaredWindows:0,
  embargoGap:0,validationNotYetMature:0};
 const splitCutoff=Date.parse(validationStart+'T00:00:00+08:00');
 for(const e of episodes){
  const f=e?.frozen,r=e?.observation;
  if(!assertFrozen(f,asOf)||!inspectObservation(f,r,tradeDates,asOf))
   return blocked('unverified-tampered-or-uncomparable-price-episode');
  if(seen.has(f.fingerprint)||seenDates.has(f.tradeDate)||
   !tradeDates.includes(f.tradeDate))
   return blocked('duplicate-or-unlisted-frozen-signal-day');
  seen.add(f.fingerprint);seenDates.add(f.tradeDate);
  const index=tradeDates.indexOf(f.tradeDate);
  if(index<=trainIndex){
   // Every training input must have its full 20-session target strictly before
   // validation starts. This is a purge, not just a post-hoc report filter.
   if(index+20>=validationIndex){
    exclusion.purgedTwentyDayOverlap++;continue;
   }
   if(r.asOf>=splitCutoff){
    exclusion.trainObservedTooLate++;continue;
   }
   if(r.horizons[2].status!=='descriptive-raw-price-observed-unverified'){
    exclusion.pendingOrIncompleteTrainTwentyDay++;continue;
   }
   accumulate(train,e);
  }else if(index>=validationIndex&&index<=valEndIndex){
   accumulate(validation,e);
   if(r.horizons[2].status!=='descriptive-raw-price-observed-unverified')
    exclusion.validationNotYetMature++;
  }else if(index<validationIndex){
   exclusion.embargoGap++;
  }else exclusion.outsideDeclaredWindows++;
 }
 const trainStats=finalizeStats(train),validationStats=finalizeStats(validation);
 const chronologicalSeparationAudited=true;
 const completeValidationSamples=validationStats.fullTwentyDayEpisodes;
 return {schemaVersion:1,mode:'sector-walkforward-leakage-audit-only',
  status:'chronological-audit-unverified',trainEnd,validationStart,validationEnd,
  asOf,maximumHorizonSessions:20,explicitCalendarLength:tradeDates.length,
  train:trainStats,validation:validationStats,exclusion,
  chronologicalSeparationAudited,
  sufficientResearchEvidence:false,
  readyForIndependentBenchmarkAndAdjustedPriceReview:
   trainStats.fullTwentyDayEpisodes>0&&completeValidationSamples>0,
  ...flags,
  note:'只读的时间切分、20交易日禁穿越与样本覆盖审核；平均值仅为未复权同日时段毛价格变化，不是调整后净收益、真实样本外优势、可训练标签或自动晋级许可'};
}
module.exports={auditSectorWalkForward,HORIZONS};
