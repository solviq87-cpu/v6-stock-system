'use strict';
// Read only the original intelligence center's ADMITTED daily records and
// normalized calendars. A configured plan is a declaration, not a signed trial.
const {createHash}=require('node:crypto');
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const instant=x=>time(x)?x:typeof x==='string'&&/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&time(Date.parse(x))?Date.parse(x):null;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const zones={CN:'Asia/Shanghai',HK:'Asia/Hong_Kong',US:'America/New_York'};
const localDay=(at,m)=>{if(!time(at)||!zones[m])return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:zones[m],year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');};
function calendar(c,m){
 if(c?.status!=='observed'||!Array.isArray(c.days)||c.days.length<2||c.days.length>4096||!c.days.every((d,i)=>day(d)&&(!i||d>c.days[i-1]))||typeof c.source!=='string'||!c.source||!time(c.knownAtMs))return null;
 const rows=c.days.map(d=>{const open=m==='CN'?Date.parse(d+'T09:30:00+08:00'):instant(c.openAtByDay?.[d]),close=m==='CN'?Date.parse(d+'T15:00:00+08:00'):instant(c.closeAtByDay?.[d]);return {date:d,open,close};});
 return rows.every((r,i)=>time(r.open)&&time(r.close)&&r.open<r.close&&localDay(r.open,m)===r.date&&localDay(r.close,m)===r.date&&(!i||rows[i-1].close<r.open))?rows:null;
}
function edgeKnown(c,a,b,cutoff){
 if(c.knownAtMs>=cutoff)return false;
 if(c.nextEvidenceByDay==null)return true;
 const e=c.nextEvidenceByDay[a];return e?.nextTradingDay===b&&time(instant(e.knownAt))&&time(instant(e.recordKnownAt))&&instant(e.knownAt)<=instant(e.recordKnownAt)&&instant(e.recordKnownAt)<cutoff;
}
function reviewCrossMarketLead({plan,calendars={},admitted=[],asOf}={}){
 const empty={mode:'fixed-foreign-close-to-cn-session-v1',status:'not-configured',reason:null,planFingerprint:null,lagForeignSessions:1,training:null,holdouts:[],unknownRows:[],leadingConfirmed:false,preregistered:false,canTrade:false,canNotify:false};
 if(!plan)return empty;
 const bad=reason=>({...empty,status:'unknown',reason});
 const validSeries=(s,markets)=>s&&markets.includes(s.market)&&typeof s.code==='string'&&/^[A-Za-z0-9.:-]{1,48}$/.test(s.code)&&typeof s.source==='string'&&s.source.length>0&&/^[A-Z]{3}$/.test(s.currency||'');
 if(!time(asOf)||!time(plan.registeredAt)||plan.registeredAt>asOf||!validSeries(plan.leader,['HK','US'])||!validSeries(plan.target,['CN'])||plan.target.currency!=='CNY'||![plan.trainStart,plan.trainEnd,plan.testStart,plan.testEnd].every(day)||!(plan.trainStart<=plan.trainEnd&&plan.trainEnd<plan.testStart&&plan.testStart<plan.testEnd)||!Array.isArray(admitted)||admitted.length>20000)return bad('invalid-declared-plan');
 const fc=calendars[plan.leader.market],cc=calendars.CN,F=calendar(fc,plan.leader.market),C=calendar(cc,'CN');
 if(!F||!C)return bad('explicit-session-calendar-unavailable');
 const train=C.filter(r=>r.date>=plan.trainStart&&r.date<=plan.trainEnd),test=C.filter(r=>r.date>=plan.testStart&&r.date<=plan.testEnd);
 if(train.length<20||test.length<20||train.at(-1).close>=plan.registeredAt||test[0].open<=plan.registeredAt||test.at(-1).close>asOf)return bad('fixed-disjoint-windows-not-mature-or-insufficient');
 const wanted=[plan.leader,plan.target],maps=wanted.map(s=>{const m=new Map();for(const r of admitted){if(r?.market!==s.market||r.code!==s.code)continue;if(m.has(r.day))m.set(r.day,null);else m.set(r.day,r);}return m;});
 const known=(r,session,s,cutoff)=>r&&r.day===session.date&&r.market===s.market&&r.code===s.code&&r.source===s.source&&r.currency===s.currency&&r.adjustment==='hfq'&&r.suspended!==true&&r.canTrade===false&&Array.isArray(r.supportingSources)&&new Set(r.supportingSources).size>=2&&time(r.consensusKnownAt)&&r.consensusKnownAt>=session.close&&r.consensusKnownAt<cutoff&&finite(r.open)&&r.open>0&&finite(r.close)&&r.close>0;
 const used=new Set(),unknownRows=[];let j=0;
 function evaluate(days,cutoff){const pairs=[];for(const cn of days){
  while(j+1<F.length&&F[j+1].close<cn.open)j++;
  const end=F[j],previous=F[j-1],target=maps[1].get(cn.date),targetIndex=C.indexOf(cn);
  const reject=reason=>unknownRows.push({targetDate:cn.date,reason});
  if(!previous||end.close>=cn.open||cn.open-end.close>7*86400000||!edgeKnown(fc,previous.date,end.date,cn.open)||cc.knownAtMs>=cn.open||cc.nextEvidenceByDay!=null&&(!targetIndex||!edgeKnown(cc,C[targetIndex-1].date,cn.date,cn.open))){reject('calendar-or-prior-session-unavailable');continue;}
  if(used.has(end.date)){reject('foreign-session-already-used');continue;}
  // Reserve the session even if a bar is missing. A later China day cannot
  // turn a missing original comparison into a selected favorable pair.
  used.add(end.date);
  const a=maps[0].get(previous.date),b=maps[0].get(end.date);
  if(!known(a,previous,plan.leader,cn.open)||!known(b,end,plan.leader,cn.open)||!known(target,cn,plan.target,cutoff)){reject('original-price-or-receipt-unavailable');continue;}
  const direction=Math.sign(b.close-a.close),outcome=Math.sign(target.close-target.open);
  pairs.push({targetDate:cn.date,foreignDate:end.date,previousForeignDate:previous.date,signalKnownAt:Math.max(a.consensusKnownAt,b.consensusKnownAt),targetOpenAt:cn.open,targetCloseAt:cn.close,targetKnownAt:target.consensusKnownAt,direction,outcome});
 }return pairs;}
 const training=evaluate(train,plan.registeredAt),trainingDecided=training.filter(r=>r.outcome!==0);
 const votes=trainingDecided.reduce((n,r)=>n+r.outcome,0),baseline=Math.sign(votes);
 const mid=Math.floor(test.length/2),testWindows=[test.slice(0,mid),test.slice(mid)],holdouts=[];
 for(const window of testWindows){const pairs=evaluate(window,asOf+1),decided=pairs.filter(r=>r.direction!==0&&r.outcome!==0&&baseline!==0),same=decided.filter(r=>r.direction===r.outcome).length,base=decided.filter(r=>r.outcome===baseline).length;
  const sufficient=training.length>=Math.ceil(.8*train.length)&&trainingDecided.length>=15&&baseline!==0&&decided.length>=Math.max(8,Math.ceil(.8*window.length));
  holdouts.push({from:window[0].date,through:window.at(-1).date,attempted:window.length,paired:pairs.length,decided:decided.length,abstained:pairs.length-decided.length,missing:window.length-pairs.length,leaderMatches:sufficient?same:null,baselineMatches:sufficient?base:null,deltaMatchRate:sufficient?(same-base)/decided.length:null,pairs});}
 const comparable=holdouts.every(x=>x.deltaMatchRate!==null);
 return {...empty,status:comparable?'descriptive-holdout-comparison':'insufficient-comparable-samples',planFingerprint:hash(plan),calendarFingerprint:hash([fc,cc]),training:{attempted:train.length,paired:training.length,decided:trainingDecided.length,baselineDirection:baseline||null,pairs:training},holdouts,unknownRows,relationshipReversal:comparable?(holdouts[0].deltaMatchRate>0&&holdouts[1].deltaMatchRate<0||holdouts[0].deltaMatchRate<0&&holdouts[1].deltaMatchRate>0):null};
}
module.exports={reviewCrossMarketLead};
