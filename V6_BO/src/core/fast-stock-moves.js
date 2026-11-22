'use strict';

const {quoteUseEligibility}=require('./quote-observation-view');
const {aShareCalendarDate}=require('./a-share-calendar');
const WINDOW_MS=60000;
const MIN_GAP_MS=5000;
const THRESHOLD_PCT=1;

function phaseAt(at){
 const bj=new Date(at+28800000),m=bj.getUTCHours()*60+bj.getUTCMinutes();
 if(m>=555&&m<560)return 'auction-revocable';
 if(m>=560&&m<565)return 'auction-fixed';
 if(m>=570&&m<=690)return 'morning';
 if(m>=780&&m<897)return 'afternoon';
 return null;
}

function createFastStockMoves(){
 const history=new Map();
 function observe(codes,rows,now){
  const phase=phaseAt(now),tradeDate=aShareCalendarDate(now),observations=new Map(),seen=new Set(),duplicates=new Set();
  const requested=new Set(codes),items=[];
  let comparable=0;
  if(phase)for(const row of rows){
   if(!requested.has(row?.code))continue;
   if(seen.has(row.code)){duplicates.add(row.code);continue;}
   seen.add(row.code);
   const proof=quoteUseEligibility(row,now);
   if(proof.canNotify&&proof.tradeDate===tradeDate&&phaseAt(proof.quoteAt)===phase)observations.set(row.code,row);
  }
  for(const code of duplicates)observations.delete(code);
  for(const code of history.keys())if(!observations.has(code))history.delete(code);
  for(const [code,row] of observations){
   const {quoteAt,price,quoteSource}=row;
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
   items.push({code,name:name||code,price,pct:Number.isFinite(row.pct)?row.pct:null,
    risePct:Number(risePct.toFixed(3)),basePrice:base.price,baseAt:base.at,
    spanMs,quoteAt,vendorQuoteAt:quoteAt,receivedAt:row.receivedAt,quoteSource,canTrade:false,canNotify:false});
  }
  items.sort((a,b)=>b.risePct-a.risePct||b.quoteAt-a.quoteAt||a.code.localeCompare(b.code));
  return {tradeDate,phase,checkedAt:now,requested:requested.size,observed:observations.size,comparable,
   count:items.length,items:items.slice(0,20),windowSeconds:WINDOW_MS/1000,thresholdPct:THRESHOLD_PCT};
 }
 return observe;
}

module.exports={createFastStockMoves};
