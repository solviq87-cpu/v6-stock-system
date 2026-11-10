'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditSectorResearchInputs:audit}=require('../src/core/sector-research-evidence-audit');
const now=Date.parse('2026-11-10T10:30:00+08:00');
function sample(){
 const stocks=Array.from({length:15},(_,i)=>({
  code:String(600001+i),pctChange:i%2?2:-1,vendorQuoteAt:now-10000}));
 return {snapshot:{date:'2026-11-10',source:'eastmoney-clist-unverified-live',
  retrievedAt:new Date(now).toISOString(),universeSize:15,stocks},
  membership:{tradeDate:'2026-11-10',provider:'baostock:query_stock_industry',
   sectors:[{members:stocks.map(s=>s.code)}]}};
}
test('complete fresh mapped universe is diagnostic only and never promotes',()=>{
 const x=sample(),copy=structuredClone(x),r=audit(x.snapshot,x.membership);
 assert.equal(r.status,'observed-unverified');assert.equal(r.metrics.freshMappedCoveragePct,100);
 assert.equal(r.canTrade,false);assert.equal(r.autoPromotion,false);
 assert.deepEqual(x,copy);
});
test('old original quote time is not repaired by recent retrieval time',()=>{
 const x=sample();x.snapshot.stocks.slice(0,4).forEach(s=>s.vendorQuoteAt=now-900000);
 const r=audit(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');assert.equal(r.tally.stale,4);
 assert.ok(r.reasons.includes('fresh-quote-coverage-below-80'));
});
test('missing membership and absent quote time remain missing, not zero',()=>{
 const x=sample();x.membership.sectors[0].members.splice(0,4);
 x.snapshot.stocks[0].vendorQuoteAt=null;
 const r=audit(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');assert.equal(r.tally.missingTime,1);
 assert.ok(r.reasons.includes('classification-coverage-below-80'));
});
test('duplicate and mixed provider evidence fail closed',()=>{
 const x=sample();x.snapshot.stocks[0].source='different-provider';
 x.snapshot.stocks[1].code=x.snapshot.stocks[0].code;
 const r=audit(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');
 assert.ok(r.reasons.includes('mixed-quote-providers'));
 assert.ok(r.reasons.includes('duplicate-or-invalid-symbol'));
});
test('date mismatch and future clock are rejected',()=>{
 const x=sample();x.membership.tradeDate='2026-11-09';
 assert.equal(audit(x.snapshot,x.membership).status,'blocked');
 x.membership.tradeDate='2026-11-10';
 assert.equal(audit(x.snapshot,x.membership,{asOf:now-1}).status,'blocked');
});
