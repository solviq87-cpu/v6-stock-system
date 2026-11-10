'use strict';
/**
 * Read-only comparison of frozen, dated sector-breadth research archives.
 * Explicit trading sessions and like-for-like classification are REQUIRED:
 * calendar-day adjacency is not A-share trading-session adjacency.
 */
const {aShareCalendarDate}=require('../core/a-share-calendar');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const round=x=>Number(x.toFixed(3));
const acceptable=new Set(['imported-unverified','partial-evidence']);
function evaluateSectorRotation(records,{tradeDates,asOf=Date.now()}={}){
 const empty={schemaVersion:1,mode:'research-only',status:'unknown',
  scope:'explicit-calendar-and-imported-archives-only',tradeDates:[],
  sectors:[],evaluatedThreeSession:0,evaluatedFiveSession:0,
  verifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false,
  autoPromotion:false,rankingModified:false,
  note:'仅比较同来源、同分类版本、同时间段的历史板块研究快照；3/5仅指显式交易日历中的连续观测，无实时/收益/资金流认证'};
 const fail=reason=>({...empty,reason});
 if(!Array.isArray(tradeDates)||tradeDates.length<3||tradeDates.length>30||
  tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=tradeDates[i-1]))||
  !Array.isArray(records)||records.length>30||
  !Number.isSafeInteger(asOf)||asOf<=0||
  tradeDates.at(-1)>aShareCalendarDate(asOf))
  return fail('invalid-explicit-trading-calendar-or-clock');
 const dates=tradeDates.slice(-5),byDay=new Map();
 for(const record of records){
  const day=record?.tradeDate;
  if(!dateOK(day)||!tradeDates.includes(day)||byDay.has(day))
   return fail('duplicate-or-unlisted-daily-archive');
  byDay.set(day,record);
 }
 const latest=byDay.get(dates.at(-1));
 if(!latest)return {...empty,tradeDates:dates,reason:'latest-session-archive-missing'};
 const validArchive=(r,day)=>{
  const b=r?.data,study=b?.study;
  return !!(r&&r.schemaVersion===1&&r.mode==='dated-sector-research-only'&&
   r.status==='imported-unverified'&&r.canTrade===false&&r.verifiedLive===false&&
   b?.status==='imported-unverified'&&b.canTrade===false&&b.verifiedLive===false&&
   b.weightsChanged===false&&b.rankingModified===false&&
   r.tradeDate===day&&b.tradeDate===day&&study?.tradeDate===day&&
   study.status==='imported-unverified'&&
   b.returnMethod==='equal-weight-constituents-proxy'&&
   b.benchmarkMethod==='equal-weight-valid-constituents-universe'&&
   study.returnMethod===b.returnMethod&&study.benchmarkMethod===b.benchmarkMethod&&
   typeof b.quoteProvider==='string'&&b.quoteProvider.length>0&&
   typeof b.membershipProvider==='string'&&b.membershipProvider.length>0&&
   typeof b.classificationVersion==='string'&&b.classificationVersion.length>0&&
   Number.isSafeInteger(r.observedAt)&&r.observedAt>0&&
   r.observedAt<=asOf&&b.observedAt===r.observedAt&&
   study.observedAt===r.observedAt&&aShareCalendarDate(r.observedAt)===day&&
   Number.isSafeInteger(b.membershipFrozenAt)&&b.membershipFrozenAt>0&&
   b.membershipFrozenAt<=r.observedAt&&
   finite(b.marketQuoteCoveragePct)&&b.marketQuoteCoveragePct>=80&&b.marketQuoteCoveragePct<=100&&
   Array.isArray(study.sectors)&&study.sectors.length<=300);
 };
 for(const [day,r] of byDay)if(!validArchive(r,day))
  return {...empty,tradeDates:dates,reason:'invalid-archived-market-evidence:'+day};
 const first=latest.data,identity=x=>x.data.quoteProvider+'|'+x.data.membershipProvider;
 if([...byDay.values()].some(x=>identity(x)!==identity(latest)))
  return {...empty,tradeDates:dates,reason:'cross-provider-archives-not-comparable'};
 const localMinute=ms=>{const d=new Date(ms+8*3600000);
  return d.getUTCHours()*60+d.getUTCMinutes();};
 const clockMinute=localMinute(latest.observedAt);
 if([...byDay.values()].some(x=>Math.abs(localMinute(x.observedAt)-clockMinute)>30))
  return {...empty,tradeDates:dates,reason:'intraday-snapshot-times-not-aligned'};
 const maps=new Map();
 for(const [day,r] of byDay){
  const dayMap=new Map();
  for(const s of r.data.study.sectors){
   const key=s?.category+'|'+s?.code;
   if(!['industry','concept'].includes(s?.category)||
    typeof s.code!=='string'||!s.code||typeof s.name!=='string'||!s.name||
    dayMap.has(key))return {...empty,tradeDates:dates,reason:'invalid-sector-identity:'+day};
   dayMap.set(key,s);
  }
  maps.set(day,dayMap);
 }
 function horizon(key,reference,n){
  const window=tradeDates.slice(-n),out={status:'unknown',sessions:n,
   calendarDates:window,reason:null,observations:[]};
  if(window.length!==n){out.reason='explicit-calendar-too-short';return out;}
  for(const d of window){
   const r=byDay.get(d),s=maps.get(d)?.get(key);
   if(!r||!s||!acceptable.has(s.status)||!finite(s.score)||
    !finite(s.upPct)||!finite(s.changePct)||!Number.isSafeInteger(s.memberCount)||
    !Number.isSafeInteger(s.observedStocks)||s.observedStocks<5||
    s.observedStocks/s.memberCount<.8||s.name!==reference.name){
    out.reason='missing-or-invalid-matched-sector-session';return out;
   }
   if(r.data.classificationVersion!==latest.data.classificationVersion||
    s.memberCount!==reference.memberCount){
    out.reason='membership-version-or-size-changed';return out;
   }
   out.observations.push({tradeDate:d,score:s.score,upPct:s.upPct,
    changePct:s.changePct,state:s.state,memberCount:s.memberCount,
    sampleRank:s.rank??null,rankDenominator:s.rankDenominator??null,
    originalObservedAt:r.observedAt});
  }
  const observations=out.observations,a=observations[0],b=observations.at(-1);
  out.status='descriptive-unverified';
  out.scoreChange=round(b.score-a.score);
  out.breadthChangePctPoints=round(b.upPct-a.upPct);
  out.meanScore=round(observations.reduce((sum,s)=>sum+s.score,0)/n);
  if(n===3){
   out.label=observations.every(s=>s.score>=65&&s.upPct>=60&&s.state==='broad-strength')?
    'three-session-broad-strength':
    b.state!=='leader-concentrated'&&b.score>=60&&out.scoreChange>=10&&out.breadthChangePctPoints>=10?
    'three-session-warming':
    out.scoreChange<=-12&&out.breadthChangePctPoints<=-15?
    'three-session-cooling':'three-session-mixed';
  }else out.label=observations.every(s=>s.score>=65&&s.upPct>=60&&s.state==='broad-strength')?
   'five-session-broad-strength':'five-session-mixed';
  return out;
 }
 const current=first.study.sectors.filter(s=>
  ['industry','concept'].includes(s?.category)&&acceptable.has(s.status)&&
  finite(s.score)&&finite(s.upPct)&&finite(s.coveragePct)&&s.coveragePct>=80);
 const sectors=current.map(s=>{
  const key=s.category+'|'+s.code,three=horizon(key,s,3),five=horizon(key,s,5);
  return {category:s.category,code:s.code,name:s.name,
   latestScore:s.score,latestUpPct:s.upPct,latestState:s.state,
   snapshotTime:latest.observedAt,threeSession:three,fiveSession:five};
 }).sort((a,b)=>b.latestScore-a.latestScore||a.category.localeCompare(b.category)||
   a.code.localeCompare(b.code));
 return {...empty,status:'imported-unverified',tradeDates:dates,
  tradeDate:latest.tradeDate,observedAt:latest.observedAt,
  marketProvider:first.quoteProvider,membershipProvider:first.membershipProvider,
  classificationVersion:first.classificationVersion,
  alignedTimeOfDayMinute:clockMinute,
  sectors,evaluatedThreeSession:sectors.filter(x=>x.threeSession.status==='descriptive-unverified').length,
  evaluatedFiveSession:sectors.filter(x=>x.fiveSession.status==='descriptive-unverified').length,
  reason:'historical-thresholds-not-validated'};
}
module.exports={evaluateSectorRotation};
