'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditMarketData:audit,reconcileDailyCloseEvidence:reconcile}=require('../src/core/market-data-quality');
const DAY='2026-11-27',close=Date.parse(DAY+'T15:00:00+08:00'),decisionAt=close+1200000;
const dates=Array.from({length:32},(_,i)=>new Date(Date.parse(DAY+'T00:00:00Z')-(31-i)*86400000).toISOString().slice(0,10));
const stock=code=>({code,corporateActionsVerified:true,bars:dates.map(date=>({date,open:10,high:11,low:9,close:10,volume:1000}))});
const row=(code,patch={})=>({code,latestPrice:10,vendorQuoteAt:close,volumeLots:10,...patch});
function fixture(){
 const history={source:'imported',provider:'eastmoney-public-history',datasetId:'daily-original-v1',asOf:DAY,
  priceAdjustment:{mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'},volumeUnit:'shares',stocks:[stock('600000'),stock('000001')]};
 const snapshot={source:'eastmoney-clist-unverified-live',verifiedLive:false,date:DAY,universeSize:5000,
  startedAt:new Date(close).toISOString(),retrievedAt:new Date(close+60000).toISOString(),stocks:[row('600000'),row('000001')]};
 const historyReceipt={status:'available-research-snapshot',data:history,decisionAt,archiveHash:'a'.repeat(64),dataVersion:'b'.repeat(64),
  receivedAt:close+600000,availableAt:close+610000,researchOnly:true,canTrade:false,canNotify:false};
 return {history,options:{snapshot,historyReceipt,decisionAt}};
}
const run=f=>reconcile(f.history,f.options);
test('D60 original quality audit compares supplied close evidence and preserves existing behavior without it',()=>{
 const f=fixture(),before=JSON.stringify(f),r=audit(f.history,{closingEvidence:f.options}),c=r.closingReconciliation;
 assert.equal(c.status,'within-declared-tolerance-unverified');assert.equal(c.expectedSymbols,2);assert.equal(c.comparedSymbols,2);
 assert.equal(c.withinToleranceSymbols,2);assert.equal(c.sourceRelationship,'catalogued-same-upstream');
 assert.equal(c.snapshotDeclaredUniverseSize,5000);assert.equal(c.wholeMarketCertified,false);
 assert.equal(c.volumeCompared,false);assert.equal(c.canTrade,false);assert.equal(c.archiveReceiptIndependentlyVerified,false);
 assert.equal(JSON.stringify(f),before);assert.equal(r.reviewReady,true);assert.equal(audit(f.history).closingReconciliation,undefined);
});
test('D60 missing quote preserves denominator and blocks requested quality review',()=>{
 const f=fixture();f.options.snapshot.stocks.pop();const c=run(f);
 assert.equal(c.status,'partial-or-unknown');assert.equal(c.expectedSymbols,2);assert.equal(c.comparedSymbols,1);
 assert.equal(c.unknownSymbols,1);assert.equal(c.items[1].reason,'missing-closing-quote');
 const r=audit(f.history,{closingEvidence:f.options});assert.equal(r.reviewReady,false);
 assert.equal(r.issues.some(i=>i.code==='CLOSING_RECONCILIATION_UNRESOLVED'),true);
});
test('D60 price discrepancy remains visible without rewriting quote or daily bar',()=>{
 const f=fixture();f.options.snapshot.stocks[0].latestPrice=11;const c=run(f);
 assert.equal(c.status,'discrepancy-review-required');assert.equal(c.discrepantSymbols,1);
 assert.equal(c.items[0].priceDifferenceBps,909.0909);assert.equal(f.history.stocks[0].bars.at(-1).close,10);
 assert.equal(f.options.snapshot.stocks[0].latestPrice,11);assert.equal(audit(f.history,{closingEvidence:f.options}).reviewReady,false);
});
test('D60 preclose, late, future or coerced capture is not a closing observation',()=>{
 for(const edit of [s=>s.startedAt=new Date(close-1).toISOString(),s=>s.startedAt=[s.startedAt],
  s=>s.retrievedAt=new Date(close+600001).toISOString(),s=>s.retrievedAt=new Date(close-1).toISOString(),
  s=>delete s.startedAt,s=>s.verifiedLive=true,s=>s.source='synthetic']){
  const f=fixture();edit(f.options.snapshot);assert.equal(run(f).status,'blocked');
 }
});
test('D60 old quote, inconsistent clocks, aliases, identity, basis or suspension remains unknown',()=>{
 for(const patch of [{vendorQuoteAt:close-1},{vendorQuoteAt:close+60001},{quoteAt:close-1},{receivedAt:close-1},
  {symbol:'600001'},{provider:'tencent'},{source:'other'},{priceBasis:'qfq'},{fixture:true},{price:11},{volumeLots:0}]){
  const f=fixture();Object.assign(f.options.snapshot.stocks[0],patch);const r=run(f);
  assert.equal(r.comparedSymbols,1);assert.equal(r.unknownSymbols,1);assert.equal(r.items[0].status,'unknown');
 }
});
test('D60 incomplete, future or mismatched historical receipt cannot authorize a comparison',()=>{
 for(const edit of [f=>delete f.options.historyReceipt,f=>f.options.historyReceipt.receivedAt=close+599999,
  f=>f.options.historyReceipt.availableAt=decisionAt+1,f=>f.options.historyReceipt.decisionAt=decisionAt+1,
  f=>f.options.historyReceipt.data={...f.history,datasetId:'other'},f=>f.options.historyReceipt.dataVersion='fake',
  f=>f.options.historyReceipt.canTrade=true,f=>f.history.priceAdjustment.mode='qfq',f=>f.history.provider='ecb']){
  const f=fixture();edit(f);assert.equal(run(f).status,'blocked');
 }
});
test('D60 duplicate and malformed snapshot security identity fail closed',()=>{
 for(const bad of [row('600000'),row(600002),undefined]){
  const f=fixture();f.options.snapshot.stocks.push(bad);assert.equal(run(f).status,'blocked');
 }
});
test('D60 catalogue-declared distinct upstream does not prove independence',()=>{
 const f=fixture();f.history.provider='baostock';f.history.priceAdjustment.provider='baostock';
 const c=run(f);assert.equal(c.status,'within-declared-tolerance-unverified');
 assert.equal(c.sourceRelationship,'catalogued-distinct-upstream-unverified');assert.equal(c.independenceVerified,false);
});
test('D60 invalid historical time, suspension or conflicting provider cannot be laundered by equal prices',()=>{
 for(const patch of [{volume:0},{suspended:true},{provider:'other'},{observedAt:close+599999},{sourceConflict:true}]){
  const f=fixture();Object.assign(f.history.stocks[0].bars.at(-1),patch);const c=run(f);
  assert.equal(c.comparedSymbols,1);assert.equal(c.unknownSymbols,1);
 }
});
test('D60 exact tolerance controls the verdict without display rounding',()=>{
 const f=fixture();f.options.priceToleranceBps=0;f.options.snapshot.stocks[0].latestPrice=10.00001;
 assert.equal(run(f).status,'discrepancy-review-required');f.options.priceToleranceBps=-1;assert.equal(run(f).status,'blocked');
});
