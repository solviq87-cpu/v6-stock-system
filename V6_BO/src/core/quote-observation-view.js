'use strict';
const validObservationTime=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15;
const providerFamily=v=>typeof v==='string'?(/^(eastmoney|tencent|sina|ths)(?:$|[-_:])/i.exec(v.trim())?.[1]?.toLowerCase()||null):null;
function conflictingQuoteIdentity(row){
 const source=providerFamily(row?.quoteSource),alias=providerFamily(row?.source);
 // A generic source may describe a separate funds stream or strategy, rather than a price.
 return !!(row?.quoteProvider!=null&&(typeof row.quoteProvider!=='string'||!row.quoteProvider.trim()||
   (providerFamily(row.quoteProvider)||row.quoteProvider.trim())!==(source||(typeof row?.quoteSource==='string'?row.quoteSource.trim():null)))||
   source&&alias&&source!==alias&&row?.source!==row?.fundsSource);
}
// A conflict is not an eligible original observation, even if its timestamp is fresh.
function explicitQuoteConflict(row){
 return conflictingQuoteIdentity(row)||row?.sourceConflict===true||row?.conflict===true||row?.evidenceStatus==='conflict'||row?.quoteStatus==='conflict';
}
// Describe this exact row; borrowing another price's timestamp would invent provenance.
function quoteObservationView(row,now=Date.now()){
 if(!Number.isFinite(now)||now<=0)throw Error('报价视图时钟无效');
 const quoteAt=Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0&&row.quoteAt<=8e15?row.quoteAt:null;
 const quoteSource=typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const price=typeof row?.price==='number'&&Number.isFinite(row.price)&&row.price>0?row.price:null;
 const quoteAgeMs=quoteAt!==null&&quoteAt<=now?now-quoteAt:null;
 let quoteStatus=price===null||!quoteSource||quoteAt===null?'unknown':quoteAt>now?'future':quoteAgeMs>15000?'stale':'recent-unverified';
 const receivedAt=validObservationTime(row?.receivedAt)?row.receivedAt:null;
 const invalidReceipt=row?.receivedAt!=null&&receivedAt===null;
 if(invalidReceipt)quoteStatus='unknown';
 if(quoteAt!==null&&receivedAt!==null&&(quoteAt>receivedAt||receivedAt>now))quoteStatus='future';
 const mode=typeof (row?.quoteMode||row?.mode)==='string'?String(row.quoteMode||row.mode).slice(0,80):'public-unverified';
 const tradeDate=quoteAt!==null?new Date(quoteAt+28800000).toISOString().slice(0,10):/^\d{4}-\d{2}-\d{2}$/.test(row?.tradeDate||'')?row.tradeDate:null;
 const conflicting=explicitQuoteConflict(row)||(quoteAt!==null&&row?.tradeDate!=null&&row.tradeDate!==tradeDate);
 if(conflicting)quoteStatus='unknown';
 const missingReason=conflicting?'conflicting-quote-evidence':price===null?'invalid-price':!quoteSource?'missing-source':quoteAt===null?'missing-original-time':quoteAt>now?'future-original-time':invalidReceipt||receivedAt!==null&&(receivedAt>now||quoteAt>receivedAt)?'invalid-reception-time':quoteStatus==='stale'?'stale-original-time':receivedAt===null?'missing-received-time':null;
 return {quoteAt,quoteSource:quoteSource||null,source:quoteSource||null,receivedAt,tradeDate,mode,
   quoteAgeMs,quoteStatus,freshness:quoteStatus,missingReason,canTrade:false,canNotify:false,verifiedLive:false};
}
// Explicit observation/simulation sources cannot enter automatic execution.
// This predicate alone does not certify timing or grant use permissions.
// A preferred display alias must not erase an explicit negative mode.
function quoteModesAllowUse(row){
 return [row?.quoteMode,row?.mode].every(mode=>mode==null||
  typeof mode==='string'&&!/simulat|research|cost|carried|histor|import|fixture|mock|test|synthetic/i.test(mode));
}
function quoteSourceAllowsUse(row){
 const source=typeof row?.quoteSource==='string'?row.quoteSource:'';
 return row?.canTrade!==false&&quoteModesAllowUse(row)&&
   !/simulat|readOnlyBackup/i.test(source)&&!/(?:^|[-_:/\.\s])(?:import(?:ed)?|fixture|mock|test|synthetic)(?:$|[-_:/\.\s])/i.test(source)&&
   !['simulated','readOnlyBackup','imported','fixture','mock','synthetic'].some(flag=>row?.[flag]===true)&&
   row?.tradable!==false&&row?.suspended!==true;
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
 const quoteAt=validPrice&&Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0&&row.quoteAt<=8e15?row.quoteAt:null;
 const source=validPrice&&typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const receivedAt=validObservationTime(row?.receivedAt)?row.receivedAt:null;
 const flags=Object.fromEntries(['simulated','readOnlyBackup','imported','fixture','mock','synthetic','tradable','suspended']
   .filter(flag=>typeof row?.[flag]==='boolean').map(flag=>[flag,row[flag]]));
 const blockedMode=!quoteModesAllowUse(row);
 return {quoteAt,quoteSource:source||null,receivedAt,...(row?.canTrade===false||blockedMode||row?.receivedAt!=null&&receivedAt===null?{canTrade:false}:{}),
   ...flags,...(explicitQuoteConflict(row)||row?.tradeDate!=null&&typeof row.tradeDate!=='string'?{sourceConflict:true}:{}),
   ...(typeof (row?.quoteMode||row?.mode)==='string'?{quoteMode:row.quoteMode||row.mode}:{}),
   ...(typeof row?.mode==='string'&&typeof row?.quoteMode==='string'&&row.mode!==row.quoteMode?{mode:row.mode}:{}),
   ...(typeof row?.tradeDate==='string'?{tradeDate:row.tradeDate}:{}),
   ...(blockedMode||row?.receivedAt!=null&&receivedAt===null?{canNotify:false}:typeof row?.canNotify==='boolean'?{canNotify:row.canNotify}:{})};
}
function fundsObservationView(row,now=Date.now()){
 if(!validObservationTime(now))throw Error('资金视图时钟无效');
 const value=typeof row?.mainInflow==='number'&&Number.isFinite(row.mainInflow)?row.mainInflow:null;
 const aliases=[row?.fundsSource,row?.upstream,...(row?.source===row?.quoteSource&&row?.fundsSource!=null?[]:[row?.source])].filter(v=>v!=null&&v!=='');
 const source=aliases.find(v=>typeof v==='string'&&v.trim())?.trim()||null;
 const identities=aliases.map(v=>typeof v==='string'?v.trim():null);
 const identityConflict=identities.some(v=>!v||v!==source);
 const unitAliases=[row?.fundsUnit,row?.unit].filter(v=>v!=null&&v!=='');
 const unit=unitAliases[0]??null;
 const amountAliases=[row?.mainInflowYuan,row?.netInflowYuan].filter(v=>v!=null);
 const rawAt=row?.fundsSourceTimestamp??row?.sourceTimestamp;
 const quoteAt=validObservationTime(rawAt)?rawAt:null;
 const rawReceived=row?.fundsRetrievedAt??row?.retrievedAt;
 const receivedAt=validObservationTime(rawReceived)?rawReceived:null;
 const day=at=>new Date(at+28800000).toISOString().slice(0,10);
 const tradeDate=quoteAt===null?null:day(quoteAt);
 const conflict=identityConflict||row?.fundsSourceConflict===true||row?.fundsConflict===true||
   unitAliases.some(v=>v!==unit)||amountAliases.some(v=>typeof v!=='number'||!Number.isFinite(v)||v!==value)||
   row?.fundsSourceTimestamp!=null&&row?.sourceTimestamp!=null&&row.fundsSourceTimestamp!==row.sourceTimestamp||
   row?.fundsRetrievedAt!=null&&row?.retrievedAt!=null&&row.fundsRetrievedAt!==row.retrievedAt||
   tradeDate!==null&&row?.fundsTradeDate!=null&&row.fundsTradeDate!==tradeDate;
 let freshness='unknown',missingReason=null;
 if(conflict)missingReason='conflicting-funds-evidence';
 else if(value===null)missingReason='missing-funds';
 else if(!source)missingReason='missing-source';
 else if(quoteAt===null)missingReason='missing-original-funds-time';
 else if(quoteAt>now){freshness='future';missingReason='future-original-time';}
 else if(rawReceived!=null&&receivedAt===null||receivedAt!==null&&(receivedAt>now||receivedAt<quoteAt)){
   freshness='future';missingReason='invalid-reception-time';
 }else if(now-quoteAt>15000){freshness='stale';missingReason='stale-original-time';}
 else if(receivedAt===null)missingReason='missing-received-time';
 else freshness='recent-unverified';
 const unsupportedSource=!!source&&/simulat|mock|fixture|synthetic|(?:^|[-_:/\.\s])(?:test|import(?:ed)?|demo)(?:$|[-_:/\.\s])/i.test(source)||
  ['simulated','mock','fixture','synthetic','imported','fundsSynthetic'].some(k=>row?.[k]===true);
 // A historical amount remains displayable; only the separately qualified
 // value can be consumed as current funds analysis. Never convert missing to 0.
 const analysisMissingReason=missingReason||(unit!=='CNY'?'unknown-or-invalid-funds-unit':
   unsupportedSource?'observation-only-funds-source':
   !['vendor-order-size-estimate','vendor-active-order-estimate'].includes(row?.fundsMethod)?'unknown-funds-method':
   tradeDate!==day(now)?'different-trade-date':null);
 return {value,source,quoteAt,receivedAt,tradeDate,mode:row?.fundsMethod||'unverified-funds',unit,freshness,
   missingReason,analysisValue:analysisMissingReason===null?value:null,analysisEligible:analysisMissingReason===null,analysisMissingReason,
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
 const finality=date?require('./a-share-calendar').assessDailyBarFinality(date,{observedAt:receivedAt,now}):null;
 const metadataValid=require('./kline-source-continuity').dailyKlineMetadataValid(snapshot);
 const learningEligible=!!(finality?.usable&&receivedAt!==null&&metadataValid&&source&&snapshot?.adjust==='qfq'&&!future);
 const missingReason=!last?'missing-bars':!source?'missing-source':!date?'missing-bar-date':future?'future-bar-date':receivedAt>now?'future-received-time':targetDate&&date<targetDate?'source-behind-target':null;
 return {source,quoteAt:null,receivedAt,tradeDate:date,mode:'historical-bars',frequency:'1d',
   priceBasis:snapshot?.adjust||snapshot?.adjustment||snapshot?.priceBasis||'unverified',cacheLayer,
   dailyFinality:finality?.status??'unknown',dailyBarFinalityUsable:finality?.usable===true,learningEligible,
   cacheAt:Number.isFinite(cacheAt)&&cacheAt>0?cacheAt:null,lastAttemptAt:Number.isFinite(lastAttemptAt)&&lastAttemptAt>0?lastAttemptAt:null,targetDate:targetDate||null,
   freshness:!last||!source||!date?'unknown':future||receivedAt>now?'future':targetDate&&date<targetDate?'source-lagging':'dated-bars',missingReason,
   canTrade:false,canNotify:false,verifiedLive:false};
}
function valuationObservation(state,code,price,position,provided,now=Date.now()){
 if(provided){
   const cached=state?.lastPx?.get?.(code);
   if(cached&&cached.p===price&&now-cached.t<180000&&cached.quoteAt<=now&&now-cached.quoteAt<=15000){
     // The cache is the selected valuation observation. Do not rebuild a
     // reduced row that drops explicit conflict or trade-date provenance.
     return {...quoteObservationView({...cached,price,quoteMode:cached.quoteMode||cached.mode||'public-live-unverified'},now),valuationKind:'observed-price'};
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
