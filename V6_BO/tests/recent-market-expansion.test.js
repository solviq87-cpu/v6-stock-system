'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRecentMarketExpansion}=require('../src/core/recent-market-expansion');
const t=Date.parse('2026-11-05T10:00:00+08:00');
const make=(at,changes=[1,-1,0,-2],patch={})=>({date:'2026-11-05',source:'eastmoney-clist-unverified-live',universeSize:4,
 startedAt:new Date(at-1000).toISOString(),retrievedAt:new Date(at).toISOString(),
 stocks:changes.map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,vendorQuoteAt:at-2000-i*1000})),...patch});
const tracker=()=>createRecentMarketExpansion();
const later=(x=60000)=>make(t+x,[1,2,-1,3]);
function seed(r=tracker()){assert.equal(r.observe(make(t)).status,'baseline-required');return r;}
function unavailable(x,status){assert.equal(x.status,status);assert.equal(x.upShareDeltaPctPointsPerMinute,null);assert.equal(x.canTrade,false);assert.equal(x.canNotify,false);}
test('same observed members measure expansion and contraction with explicit sample time',()=>{
 const r=seed(),v=r.observe(later());
 assert.equal(v.status,'observed-unverified');assert.equal(v.observed,4);assert.equal(v.coverage,1);
 assert.equal(v.previousUpShare,0.25);assert.equal(v.currentUpShare,0.75);
 assert.equal(v.enteredUp,2);assert.equal(v.leftUp,0);assert.equal(v.sampleElapsedMs,60000);
 assert.equal(v.upShareDeltaPctPoints,50);assert.equal(v.upShareDeltaPctPointsPerMinute,50);
 assert.equal(v.exchangeCalendarVerified,false);assert.equal(v.canTrade,false);assert.equal(v.canNotify,false);
 const q=r.observe(make(t+180000,[-1,0,0,3]));assert.equal(q.enteredUp,0);assert.equal(q.leftUp,2);assert.equal(q.upShareDeltaPctPointsPerMinute,-25);
});
test('cold start and short interval preserve the original comparison clock',()=>{
 const r=seed();unavailable(r.observe(later(10000)),'interval-too-short');
 const q=r.observe(later());assert.equal(q.baselineAt,t);assert.equal(q.sampleElapsedMs,60000);
});
test('cache replay never creates expansion or refreshes baseline',()=>{
 const r=seed(),replay=later();replay.stocks=make(t).stocks;
 unavailable(r.observe(replay),'quotes-not-advanced');
 unavailable(r.observe(replay),'repeated-completion');
 const q=r.observe(later(120000));assert.equal(q.baselineAt,t);assert.equal(q.upShareDeltaPctPointsPerMinute,25);
});
test('same completion conflict and same-original-time price correction invalidate baseline',()=>{
 let r=seed();unavailable(r.observe(make(t,[1,1,0,-2])),'repeated-completion');unavailable(r.observe(later()),'baseline-required');
 r=seed();const x=later();x.stocks[0]={...make(t).stocks[0],pctChange:2};unavailable(r.observe(x),'disputed-quote');
 unavailable(r.observe(later(120000)),'baseline-required');
});
test('late concurrent response and overlapping captures do not replace baseline',()=>{
 const r=seed();unavailable(r.observe(make(t-60000)),'out-of-order');
 const x=later();x.startedAt=new Date(t-1).toISOString();unavailable(r.observe(x),'overlapping-capture');
 assert.equal(r.observe(later(120000)).baselineAt,t);
});
test('source, day, policy and sample gaps require a new baseline',()=>{
 let r=seed();unavailable(r.observe({...later(),source:'other-provider'}),'baseline-reset');
 r=seed();unavailable(r.observe(later(360000)),'baseline-reset');
 r=seed();unavailable(r.observe(later(),1),'baseline-reset');
 r=seed();unavailable(r.observe(make(t+86400000,[1,2,-1,3],{date:'2026-11-06'})),'baseline-reset');
});
test('lunch, weekend and pre-open source quotes cannot bridge sessions',()=>{
 const r=tracker(),am=Date.parse('2026-11-05T11:29:00+08:00'),pm=Date.parse('2026-11-05T13:01:00+08:00');
 unavailable(r.observe(make(am)),'baseline-required');
 unavailable(r.observe(make(pm)),'baseline-reset');
 const weekend=Date.parse('2026-11-07T10:00:00+08:00');unavailable(r.observe(make(weekend,[1,2,-1,3],{date:'2026-11-07'})),'invalid-snapshot');
 const open=Date.parse('2026-11-09T09:30:00+08:00');unavailable(r.observe(make(open,[1,2,-1,3],{date:'2026-11-09',startedAt:new Date(open).toISOString()})),'invalid-snapshot');
});
test('same denominator but changed securities cannot manufacture expansion',()=>{
 const r=seed(),x=later();x.stocks[0].code='000099';unavailable(r.observe(x),'sample-changed');
});
test('unknown, future, stale, conflicting, duplicated, and mismatched source rows fail coverage',()=>{
 for(const mutate of [x=>delete x.stocks[0].vendorQuoteAt,x=>x.stocks[0].vendorQuoteAt=t+60001,
   x=>x.stocks[0].vendorQuoteAt=t-90000,x=>x.stocks[0].sourceConflict=true,x=>x.stocks.push({...x.stocks[0]}),
   x=>x.stocks[0].source='other',x=>x.stocks[0].symbol='000999',x=>x.stocks[0].suspended=true]){
  const r=seed(),x=later();mutate(x);unavailable(r.observe(x),'invalid-snapshot');
  unavailable(r.observe(later(120000)),'baseline-required');
 }
});
test('coverage is for identical qualified subset and no false full-market claim',()=>{
 const r=tracker(),a=make(t),b=later();a.universeSize=b.universeSize=5;
 unavailable(r.observe(a),'baseline-required');const v=r.observe(b);
 assert.equal(v.status,'observed-unverified');assert.equal(v.observed,4);assert.equal(v.universeSize,5);assert.equal(v.coverage,0.8);
});
test('malformed clocks, coverage policy and mutated external snapshots fail safely',()=>{
 const r=seed();unavailable(r.observe({...later(),startedAt:'invalid'}),'invalid-snapshot');
 unavailable(r.observe(later(120000),NaN),'invalid-coverage-policy');
 const q=tracker(),a=make(t);q.observe(a);a.stocks[0].pctChange=-1;
 assert.equal(q.observe(later()).previousUpShare,0.25);
});

test('invalid far-future metadata cannot poison the valid completion watermark',()=>{
 const r=seed();unavailable(r.observe({...later(),retrievedAt:'2099-01-01T00:00:00.000Z'}),'invalid-snapshot');
 unavailable(r.observe(later(120000)),'baseline-required');
 assert.equal(r.observe(later(180000)).status,'observed-unverified');
});
