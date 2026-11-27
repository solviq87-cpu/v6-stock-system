'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {joinObservedCandidates:join}=require('../src/core/live-candidate-bridge');
const {auditSnapshotQuoteTimes:audit}=require('../src/core/market-snapshot-quote-time');
const {assessCandidateEvidence:assess}=require('../src/core/research-risk-gate');
const day='2026-11-26',now=Date.parse(day+'T10:00:00+08:00'),source='eastmoney-clist-unverified-live';
const stamp=t=>new Date(t).toISOString();
const candidate={code:'600001',finalScore:72},breadth={usable:true,date:day,source};
const snapshot=()=>({date:day,source,startedAt:stamp(now-2000),retrievedAt:stamp(now),stocks:[{code:candidate.code,pctChange:3,vendorQuoteAt:now-1000}]});
const view=(s,asOf=now)=>join(s,breadth,[candidate],{asOf});
const status=(s,asOf=now)=>view(s,asOf).items[0].quoteTimeStatus;
const risk=(s,r)=>assess(s,breadth,{usable:true},[candidate],r,{requireOriginalQuoteTime:true}).items[0];
test('01 later query cannot rehabilitate quote that was in the future at receipt',()=>{
 const s=snapshot();s.stocks[0].vendorQuoteAt=now+500;
 assert.equal(status(s,now+1000),'future');assert.equal(view(s,now+1000).items[0].quoteAt,now+500);
});
test('02 missing receipt remains unknown even with an explicit query clock',()=>{
 const s=snapshot();delete s.retrievedAt;assert.equal(status(s),'receipt-time-unknown');
});
test('03 null original receipt remains unknown rather than substituted',()=>{
 const s=snapshot();s.retrievedAt=null;assert.equal(status(s),'receipt-time-unknown');
});
test('04 receipt without timezone cannot authorize the intersection',()=>{
 const s=snapshot();s.retrievedAt='2026-11-26T02:00:00';assert.equal(view(s).usable,false);
});
test('05 receipt using normalized impossible calendar date is rejected',()=>{
 const s=snapshot();s.retrievedAt='2026-02-30T02:00:00.000Z';assert.equal(view(s).usable,false);
});
test('06 noncanonical offset receipt cannot disagree with strict snapshot audit',()=>{
 const s=snapshot();s.retrievedAt='2026-11-26T10:00:00.000+08:00';assert.equal(view(s).usable,false);
});
test('07 receipt represented by numeric coercion is rejected',()=>{
 const s=snapshot();s.retrievedAt=2026;assert.equal(view(s).usable,false);
});
test('08 null scan start is explicit invalid window, not legacy absence',()=>{
 const s=snapshot();s.startedAt=null;assert.equal(status(s),'invalid-capture-window');
});
test('09 timezone-free scan start cannot support a recent observation',()=>{
 const s=snapshot();s.startedAt='2026-11-26T01:59:59';assert.equal(status(s),'invalid-capture-window');
});
test('10 start after receipt stays invalid even after a later query',()=>{
 const s=snapshot();s.startedAt=stamp(now+500);assert.equal(status(s,now+1000),'invalid-capture-window');
});
test('11 invalid query clock cannot throw or expose a recent quote',()=>{
 const s=snapshot(),r=view(s,Number.MAX_SAFE_INTEGER);assert.equal(r.quoteTimeReadyCount,0);assert.equal(r.items[0].quoteTimeStatus,'unknown');
});
test('12 downstream research gate cannot claim complete evidence for future-at-receipt quote',()=>{
 const s=snapshot();s.stocks[0].vendorQuoteAt=now+500;const r=view(s,now+1000);
 assert.equal(risk(s,r).evidenceReady,false);assert.equal(risk(s,r).canTrade,false);
});
test('13 absent legacy start remains compatible when receipt is canonical',()=>{
 const s=snapshot();delete s.startedAt;assert.equal(status(s),'recent-source-unverified');assert.equal(risk(s,view(s)).evidenceReady,true);
});
test('14 valid receipt preserves fresh boundary, original source time and unchanged score',()=>{
 const s=snapshot();s.stocks[0].vendorQuoteAt=now-90000;const before=JSON.stringify(s),r=view(s);
 assert.equal(r.quoteTimeReadyCount,1);assert.equal(r.items[0].quoteAt,now-90000);assert.equal(r.items[0].candidateScore,72);assert.equal(r.items[0].canTrade,false);assert.equal(JSON.stringify(s),before);
});
test('15 stale status outranks invalid capture window, consistent with source audit',()=>{
 const s=snapshot();s.startedAt=null;s.stocks[0].vendorQuoteAt=now-90001;
 assert.equal(status(s),'stale-source-time');assert.equal(audit(s,{asOf:now}).counts['stale-source-time'],1);
});
test('16 future receipt is never exposed and audit keeps it not-yet-observed',()=>{
 const s=snapshot();s.retrievedAt=stamp(now+1000);assert.equal(view(s).usable,false);assert.equal(audit(s,{asOf:now}).receiptTimeStatus,'not-yet-observed');
});
