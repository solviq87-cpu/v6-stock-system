'use strict';

const {quoteUseEligibility}=require('./quote-observation-view');
const {aShareCalendarDate}=require('./a-share-calendar');
const WINDOW_MS=60000;
const MIN_GAP_MS=5000;
const THRESHOLD_PCT=1;
const RECENT_MS=180000;

function phaseAt(at){
 const bj=new Date(at+28800000),m=bj.getUTCHours()*60+bj.getUTCMinutes();
 if(m>=555&&m<560)return 'auction-revocable';
 if(m>=560&&m<565)return 'auction-fixed';
 if(m>=570&&m<=690)return 'morning';
 if(m>=780&&m<897)return 'afternoon';
 return null;
}

function createFastStockMoves(){
 const history=new Map(),recent=new Map(),sessions=new Map();
 let day='',lastCheckedAt=null;
 function observe(codes,rows,now,{startedAt=now,failed=false}={}){
  const phase=phaseAt(now),tradeDate=aShareCalendarDate(now),observations=new Map(),seen=new Set(),duplicates=new Set();
  const requested=new Set(codes),items=[];
  // A regressed local clock cannot retain observations or counts from its future.
  if(day!==tradeDate||lastCheckedAt!==null&&now<lastCheckedAt){
   history.clear();recent.clear();sessions.clear();day=tradeDate;
  }
  lastCheckedAt=now;
  let comparable=0;
  if(phase)for(const row of rows){
   if(!requested.has(row?.code))continue;
   const proof=quoteUseEligibility(row,now);
   // An exact-source correction to either endpoint invalidates that clue.
   // Inspect even duplicate rows; ordinary missing/failed data or another
   // supplier's quote does not retroactively disprove a recorded observation.
   const contradicted=(at,price)=>row.quoteAt===at&&
    (proof.missingReason==='conflicting-quote-evidence'||proof.canNotify&&row.price!==price);
   const prior=recent.get(row.code),window=history.get(row.code);
   if(prior&&prior.quoteSource===row.quoteSource&&
      (contradicted(prior.quoteAt,prior.price)||contradicted(prior.baseAt,prior.basePrice))){
    recent.delete(row.code);history.delete(row.code);
   }else if(window&&window.source===row.quoteSource&&window.points.some(p=>contradicted(p.at,p.price))){
    history.delete(row.code);
   }
   if(seen.has(row.code)){duplicates.add(row.code);continue;}
   seen.add(row.code);
   if(proof.canNotify&&proof.tradeDate===tradeDate&&phaseAt(proof.quoteAt)===phase)observations.set(row.code,row);
  }
  for(const code of duplicates)observations.delete(code);
  for(const code of history.keys())if(!observations.has(code))history.delete(code);
  const agesBySource=new Map();
  for(const [code,row] of observations){
   const {quoteAt,price,quoteSource}=row;
   if(!agesBySource.has(quoteSource))agesBySource.set(quoteSource,[]);
   agesBySource.get(quoteSource).push(now-quoteAt);
   const recorded=history.get(code),latest=recorded?.points.at(-1);
   const same=recorded?.tradeDate===tradeDate&&recorded.phase===phase&&recorded.source===quoteSource;
   // A provenance change, backward clock, conflicting same-timestamp observation,
   // or missed symbol starts a new comparison window.
   let points=same&&(latest.at<quoteAt||latest.at===quoteAt&&latest.price===price)?recorded.points:[];
   points=points.filter(point=>quoteAt-point.at<=WINDOW_MS);
   if(points.at(-1)?.at!==quoteAt)points.push({at:quoteAt,price});
   const rawName=typeof row.name==='string'?row.name.trim():'';
   const name=rawName&&rawName!==code?rawName:(same?recorded.name:null);
   history.set(code,{tradeDate,phase,source:quoteSource,points,name});
   // A drop early in the window can hide a short rebound if the oldest quote
   // is the only baseline. Use the lowest eligible quote; ties use the latest.
   let base=null;
   for(const point of points){
    if(quoteAt-point.at<MIN_GAP_MS)break;
    if(!base||point.price<=base.price)base=point;
   }
   if(!base)continue;
   const spanMs=quoteAt-base.at;
   comparable++;
   const risePct=(price/base.price-1)*100;
   if(!Number.isFinite(risePct)||risePct+1e-10<THRESHOLD_PCT)continue;
   const item={code,name:name||code,price,pct:Number.isFinite(row.pct)?row.pct:null,
    risePct:Number(risePct.toFixed(3)),basePrice:base.price,baseAt:base.at,
    spanMs,quoteAt,vendorQuoteAt:quoteAt,receivedAt:row.receivedAt,quoteSource,canTrade:false,canNotify:false};
   items.push(item);
   const previous=recent.get(code);
   // Repeated delivery of an unchanged supplier timestamp cannot extend retention.
   if(previous?.quoteAt!==quoteAt||previous?.phase!==phase)recent.set(code,{...item,phase,detectedAt:now});
  }
  items.sort((a,b)=>b.risePct-a.risePct||b.quoteAt-a.quoteAt||a.code.localeCompare(b.code));
  for(const [code,item] of recent)if(!requested.has(code)||item.phase!==phase||now-item.detectedAt>=RECENT_MS)recent.delete(code);
  const currentCodes=new Set(items.map(item=>item.code));
  const recentItems=[...recent.values()].filter(item=>!currentCodes.has(item.code))
   .sort((a,b)=>b.detectedAt-a.detectedAt||a.code.localeCompare(b.code)).slice(0,20);
  if(phase){
   const old=sessions.get(phase)||{phase,rounds:0,requested:0,observed:0,comparable:0,failedRounds:0};
   sessions.set(phase,{phase,rounds:old.rounds+1,requested:old.requested+requested.size,
    observed:old.observed+observations.size,comparable:old.comparable+comparable,
    failedRounds:old.failedRounds+Number(failed),checkedAt:now});
  }
  const sources=[...agesBySource].map(([source,ages])=>{
   ages.sort((a,b)=>a-b);
   return {source,observed:ages.length,medianAgeMs:ages[Math.ceil(ages.length*0.5)-1],
    p95AgeMs:ages[Math.ceil(ages.length*0.95)-1]};
  });
  return {tradeDate,phase,checkedAt:now,requested:requested.size,observed:observations.size,comparable,
   count:items.length,items:items.slice(0,20),recentItems,sources,fetchMs:Math.max(0,now-startedAt),
   failed,sessionTotals:[...sessions.values()],windowSeconds:WINDOW_MS/1000,thresholdPct:THRESHOLD_PCT};
 }
 return observe;
}

module.exports={createFastStockMoves};
