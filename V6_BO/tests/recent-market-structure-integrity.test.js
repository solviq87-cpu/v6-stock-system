'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeRecentStructure}=require('../src/core/market-breadth');
const T=Date.parse('2026-11-10T02:00:00Z');
const base={source:'isolated-clist-fixture',date:'2026-11-10',universeSize:5,retrievedAt:new Date(T).toISOString(),stocks:[-2,-1,0,1,8].map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,amount:10,vendorQuoteAt:T-i*1000}))};
const run=(patch={},minCoverage=0.8)=>summarizeRecentStructure({...base,...patch},minCoverage);
test('valid recent read-only snapshot retains original aggregate semantics',()=>{
 const s=run();assert.equal(s.observed,5);assert.equal(s.medianReturnPct,0);assert.equal(s.equalWeightReturnPct,1.2);assert.equal(s.upShare,0.4);assert.ok(Math.abs(s.turnoverHHI-0.2)<1e-12);assert.equal(s.canTrade,false);
});
test('explicit conflicting or artificial snapshot cannot populate recent market structure',()=>{
 for(const patch of [{sourceConflict:true},{simulated:true},{quoteStatus:'conflict'}]){const s=run(patch);assert.equal(s.observed,0);assert.equal(s.medianReturnPct,null);assert.equal(s.turnoverHHI,null);}
});
test('bad rows are excluded without inventing zero returns or full universe HHI',()=>{
 for(const patch of [{quoteSourceConflict:true},{simulated:true},{symbol:'999999'},{source:'other-source'},{limitUp:true,limitDown:true}]){
  const s=run({stocks:base.stocks.map((r,i)=>i===4?{...r,...patch}:r)});assert.equal(s.observed,4);assert.equal(s.medianReturnPct,-0.5);assert.equal(s.turnoverHHI,null);
 }
});
test('reversed or explicitly invalid acquisition start cannot be treated as valid',()=>{
 for(const startedAt of [new Date(T+1).toISOString(),'bad',null]){const s=run({startedAt});assert.equal(s.observed,0);assert.equal(s.upShare,null);}
 assert.equal(run({startedAt:new Date(T-4000).toISOString()}).observed,5);
});
test('an ambiguous or noncanonical receipt timestamp cannot grant recent coverage',()=>{
 for(const retrievedAt of ['2026-11-10T02:00:00Z','2026-11-10T10:00:00+08:00',T])assert.equal(run({retrievedAt}).observed,0);
});
test('invalid coverage threshold withholds results rather than bypassing the threshold',()=>{
 for(const min of [NaN,0,-1,Infinity,1.1,'0.8']){const s=run({},min);assert.equal(s.medianReturnPct,null);assert.equal(s.upShare,null);}
});
