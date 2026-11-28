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
const validMemberHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function evaluateSectorRotation(records,{tradeDates,asOf=Date.now()}={}){
 const empty={schemaVersion:1,mode:'research-only',status:'unknown',
  scope:'explicit-calendar-and-imported-archives-only',tradeDates:[],
  sectors:[],evaluatedThreeSession:0,evaluatedFiveSession:0,leadingSectorReplay:[],
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
  const memberHashes=new Set();let memberHashesKnown=0;
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
   if(s.memberSetHash!==undefined){
    if(!validMemberHash(s.memberSetHash)){out.reason='invalid-membership-identity';return out;}
    memberHashes.add(s.memberSetHash);memberHashesKnown++;
    if(memberHashes.size>1){out.reason='membership-identity-changed';return out;}
   }
   out.observations.push({tradeDate:d,score:s.score,upPct:s.upPct,
    changePct:s.changePct,state:s.state,memberCount:s.memberCount,
    sampleRank:s.rank??null,rankDenominator:s.rankDenominator??null,
    originalObservedAt:r.observedAt});
  }
  const observations=out.observations,a=observations[0],b=observations.at(-1);
  out.status='descriptive-unverified';
  out.membershipIdentityStatus=memberHashesKnown===n?'matching-frozen-set':'legacy-or-incomplete-set-evidence';
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
 // Replay only a descriptive handover of the leading broad sector within
 // the same imported, fully observed category. Do not equate a rank with
 // the real market's mainline, or compare overlapping concept/industry sets.
 function replayPair(from,to,category){
  const a=byDay.get(from),b=byDay.get(to);
  const base={from,to,category,status:'unknown',previous:null,current:null,changed:null,
   scope:'same-frozen-imported-sector-population-only',canTrade:false,canNotify:false};
  const reject=reason=>({...base,reason});
  if(!a||!b)return reject('adjacent-session-archive-missing');
  if(a.data.classificationVersion!==b.data.classificationVersion||
     localMinute(a.observedAt)!==localMinute(b.observedAt))
   return reject('classification-or-observation-minute-changed');
  const ar=[...maps.get(from).values()].filter(s=>s.category===category);
  const br=[...maps.get(to).values()].filter(s=>s.category===category);
  if(ar.length<3||ar.length!==br.length)return reject('comparable-category-population-missing');
  const complete=(rows)=>rows.every(s=>acceptable.has(s.status)&&finite(s.score)&&s.score>=0&&s.score<=100&&
   finite(s.upPct)&&s.upPct>=0&&s.upPct<=100&&finite(s.changePct)&&s.changePct>=-100&&s.changePct<=100&&
   Number.isSafeInteger(s.memberCount)&&s.memberCount>=5&&s.memberCount<=10000&&s.observedStocks===s.memberCount&&
   s.coveragePct===100&&validMemberHash(s.memberSetHash)&&
   (s.status==='partial-evidence'?s.limitUpCount===null:Number.isSafeInteger(s.limitUpCount)&&s.limitUpCount>=0&&s.limitUpCount<=s.memberCount)&&
   Number.isSafeInteger(s.rank)&&s.rank>=1&&
   s.rank<=rows.length&&s.rankDenominator===rows.length)&&new Set(rows.map(s=>s.rank)).size===rows.length;
  if(!complete(ar)||!complete(br))return reject('full-population-or-membership-identity-unavailable');
  if([...ar,...br].some(s=>s.status!==ar[0].status))return reject('score-component-coverage-changed');
  const lookup=new Map(br.map(s=>[s.code,s]));
  if(ar.some(s=>{const t=lookup.get(s.code);return !t||s.name!==t.name||s.memberCount!==t.memberCount||s.memberSetHash!==t.memberSetHash;}))
   return reject('frozen-sector-population-changed');
  const leader=rows=>{
   const best=Math.max(...rows.map(s=>s.score)),top=rows.filter(s=>s.score===best);
   return top.length===1&&top[0].rank===1&&top[0].state==='broad-strength'?top[0]:null;
  };
  const before=leader(ar),after=leader(br);
  if(!before||!after)return reject('unique-broad-leader-unavailable');
  const view=(s,r)=>({code:s.code,name:s.name,score:s.score,upPct:s.upPct,observedAt:r.observedAt,memberSetHash:s.memberSetHash});
  return {...base,status:'descriptive-unverified',previous:view(before,a),current:view(after,b),
   changed:before.code!==after.code,reason:before.code!==after.code?'observed-leading-sector-switch':'same-observed-leading-sector'};
 }
 const leadingSectorReplay=[];
 for(let i=1;i<dates.length;i++)for(const category of ['industry','concept'])
  leadingSectorReplay.push(replayPair(dates[i-1],dates[i],category));
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
  sectors,leadingSectorReplay,evaluatedThreeSession:sectors.filter(x=>x.threeSession.status==='descriptive-unverified').length,
  evaluatedFiveSession:sectors.filter(x=>x.fiveSession.status==='descriptive-unverified').length,
  reason:'historical-thresholds-not-validated'};
}
module.exports={evaluateSectorRotation};
