'use strict';
// Describe this exact row; borrowing another price's timestamp would invent provenance.
function quoteObservationView(row,now=Date.now()){
 if(!Number.isFinite(now)||now<=0)throw Error('报价视图时钟无效');
 const quoteAt=Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0&&row.quoteAt<=8e15?row.quoteAt:null;
 const quoteSource=typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const price=typeof row?.price==='number'&&Number.isFinite(row.price)&&row.price>0?row.price:null;
 const quoteAgeMs=quoteAt!==null&&quoteAt<=now?now-quoteAt:null;
 let quoteStatus=price===null||!quoteSource||quoteAt===null?'unknown':quoteAt>now?'future':quoteAgeMs>15000?'stale':'recent-unverified';
 const receivedAt=Number.isSafeInteger(row?.receivedAt)&&row.receivedAt>0?row.receivedAt:null;
 if(quoteAt!==null&&receivedAt!==null&&(quoteAt>receivedAt||receivedAt>now))quoteStatus='future';
 const mode=typeof (row?.quoteMode||row?.mode)==='string'?String(row.quoteMode||row.mode).slice(0,80):'public-unverified';
 const tradeDate=quoteAt!==null?new Date(quoteAt+28800000).toISOString().slice(0,10):/^\d{4}-\d{2}-\d{2}$/.test(row?.tradeDate||'')?row.tradeDate:null;
 const missingReason=price===null?'invalid-price':!quoteSource?'missing-source':quoteAt===null?'missing-original-time':quoteAt>now?'future-original-time':receivedAt!==null&&(receivedAt>now||quoteAt>receivedAt)?'invalid-reception-time':quoteStatus==='stale'?'stale-original-time':receivedAt===null?'missing-received-time':null;
 return {quoteAt,quoteSource:quoteSource||null,source:quoteSource||null,receivedAt,tradeDate,mode,
   quoteAgeMs,quoteStatus,freshness:quoteStatus,missingReason,canTrade:false,canNotify:false,verifiedLive:false};
}
// Explicit observation/simulation sources cannot enter automatic execution.
// This predicate alone does not certify timing or grant use permissions.
function quoteSourceAllowsUse(row){
 const mode=typeof (row?.quoteMode||row?.mode)==='string'?String(row.quoteMode||row.mode):'';
 return row?.canTrade!==false&&!/simulat|research|cost|carried|histor/i.test(mode)&&
   !/simulat|readOnlyBackup/i.test(row?.quoteSource||'')&&row?.simulated!==true&&
   row?.readOnlyBackup!==true&&row?.tradable!==false&&row?.suspended!==true;
}
// Use gates consume this exact row. Display projections never grant permissions.
function quoteUseEligibility(row,now=Date.now()){
 const view=quoteObservationView(row,now);
 const day=at=>new Date(at+28800000).toISOString().slice(0,10);
 const eligible=view.quoteStatus==='recent-unverified'&&view.missingReason===null&&
   view.receivedAt!==null&&day(view.quoteAt)===day(now)&&
   quoteSourceAllowsUse(row);
 const missingReason=view.missingReason||(view.quoteAt!==null&&day(view.quoteAt)!==day(now)?'different-trade-date':
   !eligible?'observation-only-source':row?.canTrade===false||row?.canNotify===false?'use-disabled-by-source':null);
 return {...view,missingReason,canTrade:eligible&&row?.canTrade===true,
   canNotify:eligible&&row?.canTrade!==false&&row?.canNotify!==false&&(row?.canNotify===true||row?.canTrade===true)};
}
// Call while copying this row's price, before it becomes a scored pool row.
// Never look up a different snapshot by code or grant execution permission.
function quoteSnapshotFields(row){
 const validPrice=typeof row?.price==='number'&&Number.isFinite(row.price)&&row.price>0;
 const quoteAt=validPrice&&Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0?row.quoteAt:null;
 const source=validPrice&&typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const receivedAt=Number.isSafeInteger(row?.receivedAt)&&row.receivedAt>0?row.receivedAt:null;
 return {quoteAt,quoteSource:source||null,receivedAt,...(row?.canTrade===false?{canTrade:false}:{}),
   ...(typeof row?.quoteMode==='string'?{quoteMode:row.quoteMode}:{}),
   ...(typeof row?.tradeDate==='string'?{tradeDate:row.tradeDate}:{}),
   ...(typeof row?.canNotify==='boolean'?{canNotify:row.canNotify}:{})};
}
function fundsObservationView(row,now=Date.now()){
 const value=typeof row?.mainInflow==='number'&&Number.isFinite(row.mainInflow)?row.mainInflow:null;
 const source=row?.fundsSource||row?.upstream||row?.source||null;
 const rawAt=row?.fundsSourceTimestamp??row?.sourceTimestamp;
 const quoteAt=Number.isSafeInteger(rawAt)&&rawAt>0&&rawAt<=8e15?rawAt:null;
 const rawReceived=row?.fundsRetrievedAt??row?.retrievedAt;
 const receivedAt=Number.isSafeInteger(rawReceived)&&rawReceived>0?rawReceived:null;
 const freshness=value===null||!source||quoteAt===null?'unknown':quoteAt>now?'future':now-quoteAt>15000?'stale':'recent-unverified';
 return {value,source,quoteAt,receivedAt,tradeDate:quoteAt?new Date(quoteAt+28800000).toISOString().slice(0,10):null,
   mode:row?.fundsMethod||'unverified-funds',unit:row?.fundsUnit||row?.unit||null,freshness,
   missingReason:value===null?'missing-funds':!source?'missing-source':quoteAt===null?'missing-original-funds-time':freshness==='future'?'future-original-time':freshness==='stale'?'stale-original-time':null,
   canTrade:false,canNotify:false,verifiedLive:false};
}
function klineObservation(snapshot,rows,{targetDate='',cacheLayer='unknown',cacheAt=null,lastAttemptAt=null,now=Date.now()}={}){
 const last=Array.isArray(rows)&&rows.length?rows[rows.length-1]:null;
 const rawDate=typeof last?.date==='string'?last.date:null;
 const parsed=/^\d{4}-\d{2}-\d{2}$/.test(rawDate||'')?Date.parse(rawDate+'T00:00:00Z'):NaN;
 const date=Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===rawDate?rawDate:null;
 const source=typeof snapshot?.src==='string'?snapshot.src:typeof snapshot?.source==='string'?snapshot.source:null;
 const receivedAt=Number.isSafeInteger(snapshot?.receivedAt)&&snapshot.receivedAt>0?snapshot.receivedAt:null;
 const future=date&&date>new Date(now+28800000).toISOString().slice(0,10);
 const missingReason=!last?'missing-bars':!source?'missing-source':!date?'missing-bar-date':future?'future-bar-date':receivedAt>now?'future-received-time':targetDate&&date<targetDate?'source-behind-target':null;
 return {source,quoteAt:null,receivedAt,tradeDate:date,mode:'historical-bars',frequency:'1d',
   priceBasis:snapshot?.adjust||snapshot?.adjustment||'unverified',cacheLayer,
   cacheAt:Number.isFinite(cacheAt)&&cacheAt>0?cacheAt:null,lastAttemptAt:Number.isFinite(lastAttemptAt)&&lastAttemptAt>0?lastAttemptAt:null,targetDate:targetDate||null,
   freshness:!last||!source||!date?'unknown':future||receivedAt>now?'future':targetDate&&date<targetDate?'source-lagging':'dated-bars',missingReason,
   canTrade:false,canNotify:false,verifiedLive:false};
}
function valuationObservation(state,code,price,position,provided,now=Date.now()){
 if(provided){
   const cached=state?.lastPx?.get?.(code);
   if(cached&&cached.p===price&&now-cached.t<180000&&cached.quoteAt<=now&&now-cached.quoteAt<=15000){
     return {...quoteObservationView({price,quoteAt:cached.quoteAt,receivedAt:cached.receivedAt??null,
       quoteSource:cached.quoteSource,quoteMode:cached.mode||'public-live-unverified'},now),valuationKind:'observed-price'};
   }
   for(const rows of [state?.candidatePool,state?.trendPool,state?.stocks]){
     const row=Array.isArray(rows)?[...rows].reverse().find(row=>row?.code===code&&row.price===price):null;
     if(row)return {...quoteObservationView(row,now),valuationKind:'observed-price'};
   }
   return {...quoteObservationView({price},now),valuationKind:'unattributed-mark'};
 }
 const carried=typeof position?.lastPrice==='number'&&position.lastPrice>0;
 const kind=carried?'carried-mark':'cost-basis';
 return {...quoteObservationView({price,quoteSource:carried?'position-last-price':'position-cost',quoteMode:kind},now),
   valuationKind:kind,missingReason:carried?'last-mark-time-unavailable':'cost-basis-fallback'};
}
module.exports={quoteObservationView,quoteSnapshotFields,quoteSourceAllowsUse,quoteUseEligibility,fundsObservationView,klineObservation,valuationObservation};
