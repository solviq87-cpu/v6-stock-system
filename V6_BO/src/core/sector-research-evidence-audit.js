'use strict';
/** Read-only diagnostic for sector research evidence; never repairs missing data. */
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const {aShareCalendarDate}=require('./a-share-calendar');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function auditSectorResearchInputs(snapshot,membership,{asOf,maxQuoteAgeMs=300000}={}){
 const reasons=[],tally={total:0,fresh:0,stale:0,missingTime:0,invalidReturn:0,
  mixedSource:0,duplicateSymbol:0,unmapped:0,classified:0};
 const fail=reason=>({schemaVersion:1,status:'blocked',reasons:[reason],tally,
  canTrade:false,autoPromotion:false,weightsChanged:false});
 if(!snapshot||!Array.isArray(snapshot.stocks)||!Number.isInteger(snapshot.universeSize)||
  snapshot.universeSize<1||snapshot.stocks.length>10000||
  !membership||!Array.isArray(membership.sectors)||
  !Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<1000||maxQuoteAgeMs>300000)
  return fail('invalid-input-contract');
 const ended=Date.parse(snapshot.retrievedAt||''),clock=asOf??ended;
 if(!Number.isSafeInteger(clock)||!Number.isSafeInteger(ended)||clock<ended||
  clock-ended>600000||aShareCalendarDate(clock)!==snapshot.date||
  membership.tradeDate!==snapshot.date)
  return fail('inconsistent-snapshot-or-membership-date');
 const assigned=new Set();
 for(const sector of membership.sectors){
  if(!Array.isArray(sector?.members))return fail('malformed-sector-members');
  for(const symbol of sector.members)assigned.add(symbol);
 }
 const seen=new Set();tally.total=snapshot.stocks.length;
 for(const stock of snapshot.stocks){
  const symbol=stock?.code;
  if(typeof symbol!=='string'||!/^[0-9]{6}$/.test(symbol)||seen.has(symbol)){
   tally.duplicateSymbol++;continue;
  }
  seen.add(symbol);
  if(assigned.has(symbol))tally.classified++;else tally.unmapped++;
  if(stock.source!==undefined&&stock.source!==snapshot.source){
   tally.mixedSource++;continue;
  }
  const q=classifyQuoteTime(stock,{requestDate:snapshot.date,retrievedAt:clock,maxAgeMs:maxQuoteAgeMs});
  if(q.quoteTimeStatus!=='recent-source-unverified'){
   if(stock.vendorQuoteAt===undefined||stock.vendorQuoteAt===null)tally.missingTime++;
   else tally.stale++;
   continue;
  }
  if(!finite(stock.pctChange)||stock.pctChange< -100||stock.pctChange>100){
   tally.invalidReturn++;continue;
  }
  tally.fresh++;
 }
 const ratio=(x,d)=>d?Number((100*x/d).toFixed(3)):0;
 const metrics={snapshotCompletenessPct:ratio(tally.total,snapshot.universeSize),
  freshQuoteCoveragePct:ratio(tally.fresh,snapshot.universeSize),
  mappedStockCoveragePct:ratio(tally.classified,snapshot.universeSize),
  freshMappedCoveragePct:ratio(snapshot.stocks.filter(s=>
   seen.has(s?.code)&&assigned.has(s?.code)&&
   (s.source===undefined||s.source===snapshot.source)&&
   finite(s.pctChange)&&s.pctChange>=-100&&s.pctChange<=100&&
   classifyQuoteTime(s,{requestDate:snapshot.date,retrievedAt:clock,maxAgeMs:maxQuoteAgeMs})
    .quoteTimeStatus==='recent-source-unverified').length,snapshot.universeSize)};
 if(tally.duplicateSymbol)reasons.push('duplicate-or-invalid-symbol');
 if(tally.mixedSource)reasons.push('mixed-quote-providers');
 if(metrics.snapshotCompletenessPct<80)reasons.push('snapshot-incomplete');
 if(metrics.freshQuoteCoveragePct<80)reasons.push('fresh-quote-coverage-below-80');
 if(metrics.mappedStockCoveragePct<80)reasons.push('classification-coverage-below-80');
 if(metrics.freshMappedCoveragePct<80)reasons.push('fresh-classified-coverage-below-80');
 return {schemaVersion:1,status:reasons.length?'blocked':'observed-unverified',
  reasons,tally,metrics,quoteSource:snapshot.source,
  membershipSource:membership.provider,tradeDate:snapshot.date,
  canTrade:false,autoPromotion:false,weightsChanged:false,
  note:'诊断只统计已提供的逐股原始时点与冻结成分，不修复、不补零、不授权交易'};
}
module.exports={auditSectorResearchInputs};
