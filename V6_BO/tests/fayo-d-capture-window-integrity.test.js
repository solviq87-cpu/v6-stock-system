'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditSnapshotQuoteTimes:audit}=require('../src/core/market-snapshot-quote-time');
const at=Date.parse('2026-11-26T10:00:00+08:00'),day='2026-11-26';
const stamp=t=>new Date(t).toISOString();
const market=startedAt=>({date:day,startedAt,retrievedAt:stamp(at),stocks:[{code:'600001',vendorQuoteAt:at-1000}]});
test('explicitly malformed scan start cannot substantiate a recent source observation',()=>{
 for(const start of [null,'2026-11-26T01:59:59','2026-02-30T01:59:59.000Z',123]){
  const r=audit(market(start),{asOf:at});assert.equal(r.recentSourceTimeCount,0);assert.equal(r.counts['invalid-capture-window'],1);assert.equal(r.canTrade,false);
 }
});
test('scan start later than recorded completion is contradictory, even on later audit',()=>{
 const r=audit(market(stamp(at+1)),{asOf:at+1000});assert.equal(r.recentSourceTimeCount,0);assert.equal(r.receiptTimeStatus,'invalid-capture-window');
});
test('legacy no-start and valid capture windows remain compatible',()=>{
 for(const start of [undefined,stamp(at-2000)]){const r=audit(market(start),{asOf:at});assert.equal(r.recentSourceTimeCount,1);assert.equal(r.canTrade,false);}
});
test('duplicate and stale observations retain the stricter original classifications',()=>{
 const x=market(stamp(at-200000));x.stocks.push({code:'600001',vendorQuoteAt:at-2000},{code:'600002',vendorQuoteAt:at-90001});const r=audit(x,{asOf:at});assert.equal(r.counts['duplicate-symbol'],2);assert.equal(r.counts['stale-source-time'],1);assert.equal(r.recentSourceTimeCount,0);
});
