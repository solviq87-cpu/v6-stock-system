'use strict';
// Read-only adjacent cross-section research. No new collection requests.
const {classifyQuoteTime, chinaMarketWindowHint}=require('./market-snapshot-quote-time');
const CODE=/^\d{6}$/;
const MIN_INTERVAL=30000, MAX_INTERVAL=300000, MAX_ROWS=15000;
const flags=['synthetic','simulated','mock','fixture','testSample','sourceConflict','quoteSourceConflict','conflict'];
const disputed=row=>flags.some(key=>row?.[key]===true)||row?.evidenceStatus==='conflict'||row?.quoteStatus==='conflict';
const chinaDate=ms=>new Date(ms+28800000).toISOString().slice(0,10);
const clock=value=>{
 if(typeof value!=='string')return null;
 const ms=Date.parse(value);
 return Number.isSafeInteger(ms)&&ms>=946684800000&&ms<4102444800000&&new Date(ms).toISOString()===value?ms:null;
};
function capture(snapshot,minCoverage){
 const asOf=clock(snapshot?.retrievedAt),startAt=clock(snapshot?.startedAt);
 const {date,source,universeSize,stocks}=snapshot||{};
 if(asOf===null||startAt===null||startAt>asOf||asOf-startAt>120000||date!==chinaDate(asOf)||date!==chinaDate(startAt)||
    typeof source!=='string'||!source.trim()||disputed(snapshot)||!Number.isSafeInteger(universeSize)||universeSize<1||universeSize>MAX_ROWS||
    !Array.isArray(stocks)||stocks.length>MAX_ROWS)return null;
 const session=chinaMarketWindowHint(asOf);
 if(!session.continuousTradingWindowHint||chinaMarketWindowHint(startAt).window!==session.window)return null;
 const counts=new Map();
 for(const row of stocks){
  const id=row?.code??row?.symbol;
  if(typeof id==='string'&&CODE.test(id))counts.set(id,(counts.get(id)||0)+1);
 }
 if(counts.size>universeSize)return null;
 const rows=new Map();
 for(const row of stocks){
  const id=row?.code??row?.symbol;
  if(counts.get(id)!==1||row.code!=null&&row.symbol!=null&&row.code!==row.symbol||
     row.source!=null&&row.source!==source||row.suspended===true||row.tradable===false||disputed(row)||
     !Number.isFinite(row.pctChange)||row.pctChange < -100||row.pctChange>100||row.limitUp===true&&row.limitDown===true)continue;
  const t=classifyQuoteTime(row,{requestDate:date,retrievedAt:asOf});
  if(t.quoteTimeStatus!=='recent-source-unverified'||chinaMarketWindowHint(t.quoteAt).window!==session.window)continue;
  rows.set(id,{up:row.pctChange>0,pct:row.pctChange,at:t.quoteAt});
 }
 if(!rows.size||rows.size/universeSize<minCoverage)return null;
 return {asOf,startAt,date,source,universeSize,window:session.window,minCoverage,rows};
}
const sameDomain=(a,b)=>a.date===b.date&&a.source===b.source&&a.universeSize===b.universeSize&&a.window===b.window&&a.minCoverage===b.minCoverage;
const sameMembers=(a,b)=>a.rows.size===b.rows.size&&[...a.rows.keys()].every(id=>b.rows.has(id));
function createRecentMarketExpansion(){
 let previous=null,lastCompletion=null;
 function observe(snapshot,minCoverage=0.8){
  const empty=(status,current=null,baseline=null)=>({mode:'adjacent-same-sample-expansion-v1',status,
    source:current?.source??null,date:current?.date??null,asOf:current?.asOf??null,baselineAt:baseline?.asOf??null,
    observed:current?.rows.size??null,universeSize:current?.universeSize??null,coverage:current?current.rows.size/current.universeSize:null,
    minCoverage:Number.isFinite(minCoverage)?minCoverage:null,sampleElapsedMs:null,previousUpShare:null,currentUpShare:null,enteredUp:null,leftUp:null,
    upShareDeltaPctPoints:null,upShareDeltaPctPointsPerMinute:null,exchangeCalendarVerified:false,canTrade:false,canNotify:false});
  if(!Number.isFinite(minCoverage)||minCoverage<=0||minCoverage>1){previous=null;return empty('invalid-coverage-policy');}
  const completion=clock(snapshot?.retrievedAt);
  if(completion===null){previous=null;return empty('invalid-snapshot');}
  // Delayed concurrent requests must not replace a more recent baseline.
  if(lastCompletion!==null&&completion<lastCompletion)return empty('out-of-order');
  const current=capture(snapshot,minCoverage);
  if(completion===lastCompletion){
   if(previous?.asOf===completion&&(!current||!sameDomain(previous,current)||!sameMembers(previous,current)||
      [...previous.rows].some(([id,r])=>r.at!==current.rows.get(id).at||r.pct!==current.rows.get(id).pct)))previous=null;
   return empty('repeated-completion',current);
  }
  if(!current){previous=null;return empty('invalid-snapshot');}
  lastCompletion=completion;
  if(!previous){previous=current;return empty('baseline-required',current);}
  const baseline=previous,elapsed=current.asOf-baseline.asOf;
  if(!sameDomain(baseline,current)||elapsed>MAX_INTERVAL){previous=current;return empty('baseline-reset',current);}
  if(!sameMembers(baseline,current)){previous=current;return empty('sample-changed',current);}
  if(current.startAt<baseline.asOf)return empty('overlapping-capture',current,baseline);
  // A backwards or contradictory original tick is not a new observation.
  let advanced=true;
  for(const [id,row] of current.rows){
   const old=baseline.rows.get(id);
   if(row.at<old.at||row.at===old.at&&row.pct!==old.pct){previous=null;return empty('disputed-quote',current,baseline);}
   if(row.at===old.at)advanced=false;
  }
  if(elapsed<MIN_INTERVAL)return empty('interval-too-short',current,baseline);
  if(!advanced)return empty('quotes-not-advanced',current,baseline);
  let before=0,after=0,enteredUp=0,leftUp=0;
  for(const [id,row] of current.rows){
   const old=baseline.rows.get(id);
   before+=Number(old.up);after+=Number(row.up);
   if(row.up&&!old.up)enteredUp++;
   if(!row.up&&old.up)leftUp++;
  }
  previous=current;
  const n=current.rows.size,delta=100*(after-before)/n;
  return {...empty('observed-unverified',current,baseline),sampleElapsedMs:elapsed,
    previousUpShare:before/n,currentUpShare:after/n,enteredUp,leftUp,
    upShareDeltaPctPoints:delta,upShareDeltaPctPointsPerMinute:delta/(elapsed/60000)};
 }
 return {observe};
}
module.exports={createRecentMarketExpansion};
