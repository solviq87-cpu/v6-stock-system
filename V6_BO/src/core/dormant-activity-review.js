'use strict';
// One fixed daily capture from the existing frozen turnover study. No new
// fetch, persistent store, ranking, lifecycle promotion or trading permission.
const {createHash}=require('node:crypto');
const {classifyQuoteTime,snapshotCaptureWindow}=require('./market-snapshot-quote-time');
const {readResearchCalendar}=require('./research-calendar-source');
const SLOT=174,DAYS=20,TOTAL=DAYS+2,MIN_PEERS=10,MIN_AMOUNT=1000000,MAX_ROWS=15000;
const SOURCE='eastmoney-clist-unverified-live',UNIT='provider-CNY-unverified';
const code=x=>typeof x==='string'&&/^(?:60|68|00|30)\d{4}$/.test(x);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const quoteFingerprint=s=>hash(s.stocks.map(r=>[r?.code,r?.vendorQuoteAt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
const minute=t=>Math.floor((t+28800000)%86400000/60000);
const round=x=>+x.toFixed(8);
const median=a=>{const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);return s.length%2?s[i]:s[i-1]/2+s[i]/2;};
const bad=x=>['synthetic','simulated','mock','fixture','testSample','sourceConflict','quoteSourceConflict','conflict','suspended'].some(k=>x?.[k]===true)||x?.tradable===false||x?.quoteStatus==='conflict'||x?.evidenceStatus==='conflict';
function freeze(snapshot,end){
 const rows=[],seen=new Set();let attempted=0;
 for(const r of snapshot.stocks){
  if(!code(r?.code))continue;
  if(seen.has(r.code))return null;seen.add(r.code);attempted++;
  const t=classifyQuoteTime(r,{requestDate:snapshot.date,retrievedAt:end});
  if(bad(r)||r.symbol!=null&&r.symbol!==r.code||r.source!=null&&r.source!==SOURCE||t.quoteTimeStatus!=='recent-source-unverified'||Math.floor(minute(t.quoteAt)/5)!==SLOT||!positive(r.amount)||!positive(r.floatMarketValue)||r.floatMarketValue<1e8||r.floatMarketValue>1e14)continue;
  const value=r.amount/r.floatMarketValue;if(!positive(value)||value>10)continue;
  rows.push({code:r.code,at:t.quoteAt,minute:minute(t.quoteAt),amount:r.amount,cap:r.floatMarketValue,value,band:Math.floor(Math.log2(r.floatMarketValue/1e9))});
 }
 if(attempted<MIN_PEERS||rows.length/attempted<.8)return null;
 const grouped=new Map();rows.sort((a,b)=>a.code.localeCompare(b.code));
 for(const row of rows){const group=grouped.get(row.band)||[];group.push(row);grouped.set(row.band,group);}
 const groups=new Map();
 for(const [band,g] of grouped){if(g.length<MIN_PEERS)continue;
  const sorted=[...g].sort((a,b)=>a.value-b.value||a.code.localeCompare(b.code));
  const position=new Map(sorted.map((r,i)=>[r.code,i])),mid=Math.floor((g.length-1)/2);
  const peer=r=>{const i=position.get(r.code),at=j=>sorted[j+(j>=i?1:0)].value;return (g.length-1)%2?at(mid):at(mid-1)/2+at(mid)/2;};
  groups.set(band,{codes:g.map(r=>r.code),fingerprint:hash(g.map(r=>[r.code,r.minute])),ratios:Float64Array.from(g,r=>r.value),peers:Float64Array.from(g,peer),amounts:Float64Array.from(g,r=>r.amount),caps:Float64Array.from(g,r=>r.cap)});
 }
 return {date:snapshot.date,end,attempted,observed:rows.length,groups,quoteFingerprint:quoteFingerprint(snapshot),fingerprint:hash(rows.map(r=>[r.code,r.at,r.amount,r.cap]))};
}
function createDormantActivityReview({calendarReader=readResearchCalendar}={}){
 const history=new Map();let watermark=0;
 const remember=(date,value)=>{history.set(date,value);while(history.size>TOTAL)history.delete(history.keys().next().value);};
 function observe(snapshot,crowding,{asOf=Date.now()}={}){
  const base={mode:'fixed-slot-dormant-activity-v1',status:'unknown',reason:null,slot:'14:30–14:34 Asia/Shanghai',baselineDaysRequired:DAYS,confirmationDaysRequired:2,referenceDays:0,attempted:0,evaluated:0,unknown:0,matched:0,singleDayOnly:0,rows:[],dates:[],calendarHash:null,source:SOURCE,unit:UNIT,thresholds:{priorDormantDays:15,priorPeerRatioMax:.5,ownMedianMultiple:2,peerMedianMultiple:1.5,minimumAmountCny:MIN_AMOUNT,minimumCohortSize:MIN_PEERS,minimumCoverage:.8},marketImpactVerified:false,independentValueVerified:false,calendarExternallyVerified:false,canTrade:false,canNotify:false};
  const fail=(reason,extra={})=>({...base,reason,...extra});
  const {originalRetrievedAt:end,startedAt:start,invalidStart}=snapshotCaptureWindow(snapshot);
  if(!Number.isSafeInteger(asOf)||!Number.isSafeInteger(end)||!Number.isSafeInteger(start)||invalidStart||end>asOf||end<watermark||asOf-end>90000||end-start>120000||snapshot.source!==SOURCE||snapshot.sourceCoverage?.monetaryUnit!==UNIT||bad(snapshot)||!Array.isArray(snapshot.stocks)||snapshot.stocks.length!==snapshot.universeSize||snapshot.stocks.length>MAX_ROWS||Math.floor(minute(start)/5)!==SLOT||Math.floor(minute(end)/5)!==SLOT)return fail('fixed-slot-evidence-unavailable');
  const date=snapshot.date;
  if(typeof date!=='string'||date!==new Date(end+28800000).toISOString().slice(0,10))return fail('invalid-date');
  watermark=end;
  if(crowding?.status==='disputed-slot'){remember(date,null);return fail('disputed-slot');}
  if(crowding?.mode!=='same-slot-turnover-hhi-v1'||!['observed-unverified','insufficient-history','slot-already-frozen'].includes(crowding.status)||crowding.date!==date||crowding.source!==SOURCE||crowding.monetaryUnit!==UNIT||crowding.slot!==SLOT||crowding.asOf!==end||crowding.startedAt!==start||crowding.universeSize!==snapshot.stocks.length||crowding.canTrade!==false||crowding.canNotify!==false)return fail('original-frozen-turnover-gate-unavailable');
  const cal=calendarReader({asOf:start}),known=Date.parse(cal?.metadata?.knowledgeAvailableAt??''),calendarHash=cal?.metadata?.sha256;
  if(cal?.status!=='available'||!Number.isFinite(known)||known>start||!/^[a-f0-9]{64}$/.test(calendarHash||'')||!['SSE','SZSE'].every(e=>cal.metadata.supportedExchanges?.includes(e))||!Array.isArray(cal.tradeDates)||cal.tradeDates.length>1000||!cal.tradeDates.every((d,i)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&(!i||d>cal.tradeDates[i-1])))return fail('point-in-time-calendar-unavailable');
  const index=cal.tradeDates.indexOf(date);if(index<0)return fail('not-an-observed-session');
  const dates=cal.tradeDates.slice(Math.max(0,index-TOTAL+1),index+1);
  for(const d of history.keys())if(!dates.includes(d))history.delete(d);
  if(history.has(date)&&history.get(date)===null)return fail('disputed-slot');
  const current=freeze(snapshot,end),previous=history.get(date);
  if(previous&&previous.quoteFingerprint===quoteFingerprint(snapshot)&&(!current||previous.fingerprint!==current.fingerprint)){remember(date,null);return fail('conflicting-cap-or-amount');}
  if(crowding.status==='slot-already-frozen')return fail('slot-already-frozen');
  if(!current)return fail('float-cap-or-peer-coverage-unavailable');
  if(previous&&(previous.end!==end||previous.fingerprint!==current.fingerprint||previous.calendarHash!==calendarHash)){remember(date,null);return fail('conflicting-frozen-observation');}
  current.calendarHash=calendarHash;if(!previous)remember(date,current);
  const samples=dates.map(d=>history.get(d));
  const referenceDays=samples.slice(0,-1).filter(s=>s?.calendarHash===calendarHash).length;
  const ctx={attempted:current.attempted,unknown:current.attempted,observed:current.observed,referenceDays,dates,calendarHash,observationAt:end};
  if(dates.length!==TOTAL||samples.some(s=>!s||s.calendarHash!==calendarHash))return fail('missing-consecutive-frozen-sessions',ctx);
  const rows=[];let evaluated=0,matched=0,singleDayOnly=0;
  for(const [band,g] of current.groups){const gs=samples.map(s=>s.groups.get(band));
   if(gs.some(x=>!x||x.fingerprint!==g.fingerprint))continue;
   for(let i=0;i<g.codes.length;i++){
    const prior=gs.slice(0,DAYS),own=median(prior.map(x=>x.ratios[i]));
    if(!positive(own)||gs.some(x=>!positive(x.peers[i])))continue;
    evaluated++;
    const dormantDays=prior.filter(x=>x.ratios[i]<=.5*x.peers[i]).length;
    const active=x=>x.amounts[i]>=MIN_AMOUNT&&x.ratios[i]>=2*own&&x.ratios[i]>=1.5*x.peers[i];
    if(dormantDays<15||!active(gs.at(-1)))continue;
    if(!active(gs.at(-2))){singleDayOnly++;continue;}
    matched++;
    if(rows.length<20)rows.push({symbol:g.codes[i],cohortSize:g.codes.length,cohortFingerprint:g.fingerprint,dormantDays,priorMedian:round(own),confirmation:gs.slice(-2).map((x,j)=>({date:dates[DAYS+j],amountCny:x.amounts[i],floatMarketValueCny:x.caps[i],amountToFloatCap:round(x.ratios[i]),peerMedian:round(x.peers[i])})),canTrade:false,canNotify:false});
   }
  }
  rows.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  return {...base,...ctx,status:evaluated?'descriptive-observation':'unknown',reason:evaluated?null:'same-size-cohorts-unavailable',evaluated,unknown:current.attempted-evaluated,matched,singleDayOnly,rows,truncated:matched>rows.length,scope:'two consecutive observed calendar sessions; amount/float-cap proxy, not actual share turnover or future return'};
 }
 return {observe};
}
module.exports={createDormantActivityReview};
