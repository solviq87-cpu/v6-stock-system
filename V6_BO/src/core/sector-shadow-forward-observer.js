'use strict';
/**
 * Replay a frozen sector-shadow preview against later dated sector archives.
 * This reports descriptive 3/5-session breadth persistence ONLY, never a
 * future stock-return label, validated alpha, new model weight or order.
 */
const {aShareCalendarDate}=require('./a-share-calendar');
const {evaluateSectorRotation}=require('../strategy/sector-rotation-history');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const key=x=>x.category+'|'+x.code;
const minute=ms=>{const d=new Date(ms+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes();};
const safeScore=x=>finite(x)&&x>=0&&x<=100;
const safePct=x=>finite(x)&&x>=0&&x<=100;
const empty={schemaVersion:1,mode:'sector-shadow-forward-descriptive-only',
 labelsAvailable:false,returnsAvailable:false,outOfSampleValidated:false,
 canTrain:false,canTrade:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false};
const block=reason=>({...empty,status:'blocked',reason,threeSession:null,fiveSession:null});
function validArchive(r,s){
 const b=r?.data,study=b?.study,ms=r?.observedAt;
 return !!(r?.schemaVersion===1&&r.mode==='dated-sector-research-only'&&
  r.status==='imported-unverified'&&r.canTrade===false&&
  r.verifiedLive===false&&r.weightsChanged===false&&
  b?.status==='imported-unverified'&&b.canTrade===false&&
  b.verifiedLive===false&&b.weightsChanged===false&&
  b.rankingModified===false&&
  r.tradeDate===b.tradeDate&&r.tradeDate===study?.tradeDate&&
  study?.status==='imported-unverified'&&
  b.returnMethod==='equal-weight-constituents-proxy'&&
  b.benchmarkMethod==='equal-weight-valid-constituents-universe'&&
  study.returnMethod===b.returnMethod&&study.benchmarkMethod===b.benchmarkMethod&&
  b.quoteProvider===s.quoteSource&&b.membershipProvider===s.membershipSource&&
  b.classificationVersion===s.classificationVersion&&
  study.classificationVersion===s.classificationVersion&&
  Number.isSafeInteger(ms)&&ms>0&&b.observedAt===ms&&study.observedAt===ms&&
  aShareCalendarDate(ms)===r.tradeDate&&
  Number.isSafeInteger(b.membershipFrozenAt)&&b.membershipFrozenAt>0&&
  b.membershipFrozenAt<=ms&&aShareCalendarDate(b.membershipFrozenAt)===r.tradeDate&&
  safePct(b.marketQuoteCoveragePct)&&b.marketQuoteCoveragePct>=80&&
  Array.isArray(study.sectors)&&study.sectors.length<=300);
}
function observeSectorShadowForward(preflight,archives,{tradeDates,asOf=Date.now()}={}){
 const s=preflight?.shadowSample;
 if(preflight?.schemaVersion!==1||
   preflight.status!=='shadow-input-preview-unverified'||
   preflight.canTrain!==false||preflight.canTrade!==false||
   preflight.autoPromotion!==false||preflight.weightsChanged!==false||
   preflight.quality?.status!=='observed-unverified'||
   s?.schemaVersion!==1||s.mode!=='sector-shadow-candidate-not-training'||
   s.canTrain!==false||s.canTrade!==false||
   s.labelsAvailable!==false||s.outOfSampleValidated!==false||
   !dayOK(s.tradeDate)||s.tradeDate!==preflight.tradeDate||
   s.classificationVersion!==preflight.classificationVersion||
   typeof s.quoteSource!=='string'||!s.quoteSource||
   typeof s.membershipSource!=='string'||!s.membershipSource||
   !Number.isSafeInteger(s.observedAt)||s.observedAt<=0||
   aShareCalendarDate(s.observedAt)!==s.tradeDate||
   !Array.isArray(s.sectors)||s.sectors.length<3||s.sectors.length>300||
   !Number.isSafeInteger(asOf)||asOf<s.observedAt||
   !Array.isArray(tradeDates)||tradeDates.length<3||tradeDates.length>30||
   tradeDates.some((d,i)=>!dayOK(d)||(i>0&&d<=tradeDates[i-1]))||
   !Array.isArray(archives)||archives.length>30)
  return block('invalid-frozen-preview-calendar-or-clock');
 const index=tradeDates.indexOf(s.tradeDate);
 if(index<0||s.tradeDate>aShareCalendarDate(asOf))
  return block('signal-date-not-in-explicit-trading-calendar');
 const distinct=new Map();
 for(const sector of s.sectors){
  if(!['industry','concept'].includes(sector?.category)||
    typeof sector.code!=='string'||!sector.code||
    !Number.isSafeInteger(sector.rank)||sector.rank<1||
    !safeScore(sector.score)||!safePct(sector.upPct)||
    !safePct(sector.coveragePct)||sector.coveragePct<80||
    typeof sector.state!=='string'||!sector.state||
    distinct.has(key(sector)))
   return block('invalid-or-duplicate-frozen-sector');
  distinct.set(key(sector),sector);
 }
 const byDay=new Map();
 for(const r of archives){
  if(!dayOK(r?.tradeDate)||r.tradeDate<s.tradeDate||
    !tradeDates.includes(r.tradeDate)||byDay.has(r.tradeDate)||
    r.tradeDate>aShareCalendarDate(asOf))
   return block('duplicate-unlisted-or-future-archive');
  byDay.set(r.tradeDate,r);
 }
 const baseline=byDay.get(s.tradeDate);
 if(!baseline||!validArchive(baseline,s)||
   baseline.observedAt!==s.observedAt)
  return block('missing-or-mismatched-frozen-baseline-archive');
 const ranked=baseline.data.study.sectors.filter(x=>x?.rank!==null&&x?.rank!==undefined);
 if(ranked.length!==s.sectors.length||
   ranked.some(x=>{
    const y=distinct.get(key(x));
    return !y||y.score!==x.score||y.upPct!==x.upPct||
     y.coveragePct!==x.coveragePct||y.state!==x.state||y.rank!==x.rank;
   }))
  return block('candidate-does-not-match-baseline-archive');
 const observedDay=aShareCalendarDate(asOf);
 // Each forward slot must be a consecutive EXPLICIT trading session after
 // the signal day. There is no calendar-day substitution or future backfill.
 function horizon(n){
  const dates=tradeDates.slice(index+1,index+1+n);
  const pending=reason=>({status:'pending',sessions:n,calendarDates:dates,
   reason,observedSectors:0,sectors:[]});
  const rejected=reason=>({status:'blocked',sessions:n,calendarDates:dates,
   reason,observedSectors:0,sectors:[]});
  if(dates.length<n)return pending('explicit-future-calendar-too-short');
  if(dates.at(-1)>observedDay)return pending('future-trading-sessions-not-yet-observed');
  const missing=dates.filter(d=>!byDay.has(d));
  if(missing.length)return {...pending('missing-consecutive-daily-archives'),missingTradeDates:missing};
  const records=dates.map(d=>byDay.get(d));
  // A declared stable classification must not silently change members or
  // admit nonsensical future scores within the allegedly comparable window.
  const baselineMembers=new Map(baseline.data.study.sectors.map(x=>[key(x),x.memberCount]));
  for(const r of records){
   if(!validArchive(r,s)||r.observedAt<=baseline.observedAt||
     r.observedAt>asOf||Math.abs(minute(r.observedAt)-minute(s.observedAt))>30)
    return rejected('future-archive-provenance-or-time-conflict');
   const follow=new Map(r.data.study.sectors.map(x=>[key(x),x]));
   for(const frozen of s.sectors){
    const row=follow.get(key(frozen));
    if(!row||row.memberCount!==baselineMembers.get(key(frozen))||
      !safeScore(row.score)||!safePct(row.upPct)||
      !safePct(row.coveragePct)||row.coveragePct<80||
      !finite(row.changePct)||row.changePct< -100||row.changePct>100)
     return rejected('future-sector-membership-or-score-invalid');
   }
  }
  const study=evaluateSectorRotation(records,{tradeDates:dates,asOf});
  if(study.status!=='imported-unverified')
   return rejected('rotation-research-not-comparable:'+(study.reason||'unknown'));
  const projections=new Map(study.sectors.map(x=>[key(x),x]));
  const sectors=s.sectors.map(frozen=>{
   const found=projections.get(key(frozen));
   const window=found?.[n===3?'threeSession':'fiveSession'];
   if(window?.status!=='descriptive-unverified')
    return {category:frozen.category,code:frozen.code,
     status:'unknown',reason:window?.reason||'sector-identity-or-coverage-missing'};
   const latest=window.observations.at(-1);
   // Score and breadth are same-day proxies; these are NOT forward returns.
   return {category:frozen.category,code:frozen.code,
    status:'descriptive-observed-unverified',baselineScore:frozen.score,
    latestScore:latest.score,scoreChange:Number((latest.score-frozen.score).toFixed(3)),
    baselineUpPct:frozen.upPct,latestUpPct:latest.upPct,
    breadthChangePctPoints:Number((latest.upPct-frozen.upPct).toFixed(3)),
    futureStudyLabel:window.label,observedTradingDates:window.calendarDates};
  });
  const count=sectors.filter(x=>x.status==='descriptive-observed-unverified').length;
  return {status:count===sectors.length?'descriptive-observed-unverified':
   'partial-descriptive-unverified',sessions:n,calendarDates:dates,
   observedSectors:count,sectors};
 }
 const threeSession=horizon(3),fiveSession=horizon(5);
 if(threeSession.status==='blocked'||fiveSession.status==='blocked')
  return {...empty,status:'blocked',reason:'one-or-more-future-windows-invalid',
   tradeDate:s.tradeDate,threeSession,fiveSession};
 return {...empty,status:'research-observation-unverified',
  tradeDate:s.tradeDate,classificationVersion:s.classificationVersion,
  candidateObservedAt:s.observedAt,threeSession,fiveSession,
  note:'仅观察冻结行业分数及上涨广度在之后3/5个明确交易日的变化，不是未来股价收益标签；禁止据此训练、晋级、通知或交易'};
}
module.exports={observeSectorShadowForward};