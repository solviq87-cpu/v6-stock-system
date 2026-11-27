'use strict';
/** Independent research axes layered onto the existing observed-market entry.
 * No market certification, regime promotion, trading or policy execution. */
const {aShareCalendarDate,assessDailyBarFinality}=require('./a-share-calendar');
const {researchInstant}=require('./observed-market-timing');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const INDEX_CODES=Object.freeze(['000001.SH','399001.SZ','399006.SZ']);
const str=x=>typeof x==='string'&&x.trim().length>0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const known=(x,k)=>x?.[k]!==undefined&&x[k]!==null;
const incompatible=(x,expected)=>Object.entries(expected).some(([k,v])=>known(x,k)&&x[k]!==v);
const unknown=reason=>({status:'unknown',reason});
const declared=fields=>({status:'declared-unverified',reason:null,...fields});
const direction=values=>values.every(v=>v>0)?'up':values.every(v=>v<0)?'down':values.every(v=>v===0)?'flat':'mixed';
function describeTrend(history,tradeDate,cutoff){
 const fail=reason=>({...unknown(reason),medium:'unknown',long:'unknown',throughDate:null,indices:[],calendarSource:null});
 if(!history||typeof history!=='object'||Array.isArray(history)||history.simulated===true)return fail('prior-index-history-unavailable');
 const dates=history.calendar?.tradeDates,calendarKnown=researchInstant(history.calendar?.knownAt);
 // Freeze exactly 61 prior completed sessions plus the current session. Dates
 // and completeness are declared by the caller, not certified by this helper.
 if(history.calendar?.simulated===true||!str(history.calendar?.source)||!str(history.calendar?.evidenceId)||calendarKnown===null||calendarKnown>cutoff||
  !Array.isArray(dates)||dates.length!==62||dates.at(-1)!==tradeDate||
  dates.some((d,i)=>!dateOK(d)||(i>0&&d<=dates[i-1])))return fail('calendar-window-invalid-or-not-known');
 if(!Array.isArray(history.indices)||history.indices.length!==INDEX_CODES.length||
  new Set(history.indices.map(s=>s?.indexCode)).size!==INDEX_CODES.length||
  history.indices.some(s=>!INDEX_CODES.includes(s?.indexCode)))return fail('fixed-core-index-set-incomplete-or-duplicated');
 const rows=[];
 for(const indexCode of INDEX_CODES){
  const series=history.indices.find(s=>s.indexCode===indexCode),bars=series.bars;
  if(!str(series.source)||!str(series.evidenceId)||series.priceMethod!=='index-close'||
    !Array.isArray(bars)||bars.length!==61||series.simulated===true)
   return fail('index-series-invalid-'+indexCode);
  const closes=[];
  for(let i=0;i<bars.length;i++){
   const bar=bars[i],date=dates[i],observed=researchInstant(bar?.observedAt),available=researchInstant(bar?.knownAt);
   if(!bar||bar.date!==date||bar.final!==true||bar.simulated===true||
    incompatible(bar,{indexCode,source:series.source,priceMethod:series.priceMethod})||
    !finite(bar.close)||bar.close<=0||observed===null||available===null||observed>available||available>cutoff||
    !assessDailyBarFinality(date,{observedAt:observed,now:cutoff}).usable)
    return fail('index-bar-invalid-or-not-known-'+indexCode);
   closes.push(bar.close);
  }
  const last=closes.at(-1),r20=100*(last/closes[40]-1),r60=100*(last/closes[0]-1);
  const daily=closes.slice(41).map((v,i)=>100*(v/closes[i+40]-1));
  const mean=daily.reduce((s,v)=>s+v,0)/daily.length;
  const vol=Math.sqrt(daily.reduce((s,v)=>s+(v-mean)**2,0)/(daily.length-1));
  if(![r20,r60,vol,...daily].every(finite))return fail('index-return-overflow-'+indexCode);
  rows.push({indexCode,source:series.source,evidenceId:series.evidenceId,return20Pct:r20,return60Pct:r60,realizedDailyVolatility20Pct:vol});
 }
 return declared({medium:direction(rows.map(r=>r.return20Pct)),long:direction(rows.map(r=>r.return60Pct)),
  throughDate:dates[60],calendarSource:history.calendar.source,calendarEvidenceId:history.calendar.evidenceId,
  indices:rows,
  directionMethod:'three-core-index-close-return-sign-consensus-20-60',calendarCertified:false});
}
function describeFast(snapshot,breadth,timing,indexParticipation){
 const fail=reason=>({structure:{...unknown(reason),label:'unknown',majority:'unknown',concentration:null},
  sentiment:{...unknown(reason),label:'unknown',limitUp:null,limitDown:null}});
 const p=breadth.participation,cutoff=timing.marketAsOf;
 if(snapshot.simulated===true||snapshot.returnWindow!=='session-to-date'||timing.status!=='declared-aligned'||researchInstant(cutoff)===null||
    !['partial-declared','complete-declared'].includes(p?.status)||breadth.observed/snapshot.universeSize<.8||
    snapshot.stocks.length!==breadth.observed||snapshot.stocks.some(row=>row.simulated===true||
      classifyQuoteTime(row,{requestDate:snapshot.date,retrievedAt:cutoff}).quoteTimeStatus!=='recent-source-unverified'))
  return fail('current-participation-window-or-coverage-unavailable');
 const relation=indexParticipation?.status==='declared-unverified'?indexParticipation.relation:'unknown';
 const label=relation==='index-up-majority-down'?'narrow-index-rise':relation==='index-down-majority-up'?'index-weak-broad-support':
  p.majority==='majority-up'?'majority-advance':p.majority==='majority-down'?'majority-decline':p.majority==='no-majority'?'mixed-participation':'unknown';
 const structure={status:label==='unknown'?'unknown':'declared-unverified',reason:label==='unknown'?'missing-rows-could-change-majority':null,
  label,majority:p.majority,indexRelation:relation,sampleMedianPct:p.sampleMedianPct,upShareBounds:p.upShareBounds,downShareBounds:p.downShareBounds,
  concentration:p.concentration.status==='declared-unverified'?p.concentration:null};
 const sentimentUnknown={...unknown('complete-consistent-limit-flags-required'),label:'unknown',limitUp:null,limitDown:null};
 // A reported imbalance is not an emotional phase, fear probability, or
 // evidence of capital flows; incomplete flags cannot mean zero limits.
 if(breadth.observed!==snapshot.universeSize||snapshot.stocks.some(r=>
  typeof r.limitUp!=='boolean'||typeof r.limitDown!=='boolean'||(r.limitUp&&r.limitDown)||
  (r.limitUp&&r.pctChange<=0)||(r.limitDown&&r.pctChange>=0)))return {structure,sentiment:sentimentUnknown};
 const up=breadth.limitUp,down=breadth.limitDown;
 return {structure,sentiment:declared({label:up>down?'positive-limit-imbalance':down>up?'negative-limit-imbalance':'balanced-limit-counts',limitUp:up,limitDown:down})};
}
function describeMarketAxes(snapshot,breadth,timing,indexParticipation,history){
 const cutoff=timing.marketAsOf;
 const trend=snapshot.simulated!==true&&timing.status==='declared-aligned'&&researchInstant(cutoff)!==null&&aShareCalendarDate(cutoff)===snapshot.date?
  describeTrend(history,snapshot.date,cutoff):{...unknown('market-cutoff-unconfirmed'),medium:'unknown',long:'unknown',throughDate:null,indices:[],calendarSource:null};
 const {structure,sentiment}=describeFast(snapshot,breadth,timing,indexParticipation);
 const long=trend.long,medium=trend.medium,majority=structure.majority;
 let reading='unknown';
 if(long==='down'&&structure.label==='narrow-index-rise')reading='downtrend-narrow-index-rise';
 else if(long==='down'&&majority==='majority-up')reading=medium==='up'?'downtrend-recovery-watch':'downtrend-majority-rebound';
 else if(long==='up'&&majority==='majority-down')reading=medium==='down'?'uptrend-deterioration-watch':'uptrend-majority-pullback';
 else if(long==='up'&&majority==='majority-up')reading='uptrend-majority-advance';
 else if(long==='down'&&majority==='majority-down')reading='downtrend-majority-decline';
 // Without historical structure and emotional transitions no bull/bear,
 // crowding, turning-point or sentiment-phase label is promoted.
 const status=[trend,structure,sentiment].some(x=>x.status==='declared-unverified')?'partial-declared':'unknown';
 return {schemaVersion:1,mode:'shadow-market-axes',status,tradeDate:snapshot.date,asOf:cutoff,decisionAt:timing.decisionAt,
  historicalAtDecision:aShareCalendarDate(timing.decisionAt)!==snapshot.date,trend,structure,sentiment,
  phase:{...unknown('historical-emotional-transitions-unavailable'),label:'unknown'},reading,
  bullBear:'unknown',crowding:'unknown',reversalConfirmed:false,calibrated:false,certified:false,canTrade:false,canNotify:false,weightsChanged:false};
}
module.exports={describeMarketAxes};
