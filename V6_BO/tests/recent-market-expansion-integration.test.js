'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {researchLiveMarket}=require('../src/core/live-market-research');
const {createRecentMarketExpansion}=require('../src/core/recent-market-expansion');
const t=Date.parse('2026-11-05T10:00:00+08:00');
const snap=(at,changes)=>({date:'2026-11-05',source:'eastmoney-clist-unverified-live',universeSize:4,pages:1,
 startedAt:new Date(at-1000).toISOString(),retrievedAt:new Date(at).toISOString(),
 stocks:changes.map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,vendorQuoteAt:at-2000,amount:100}))});
test('original research entry consumes two existing captures once each without ranking or execution changes',async()=>{
 const expansionTracker=createRecentMarketExpansion();let calls=0;
 const read=(at,changes)=>researchLiveMarket({now:at,expansionTracker,fetchSnapshot:async()=>{calls++;return snap(at,changes);}});
 const a=await read(t,[1,-1,0,-1]),b=await read(t+60000,[1,1,1,-1]);
 assert.equal(calls,2);assert.equal(a.marketExpansion.status,'baseline-required');
 assert.equal(b.marketExpansion.status,'observed-unverified');assert.equal(b.marketExpansion.upShareDeltaPctPoints,50);
 assert.equal(b.recentStructure.upShare,0.75);assert.equal(b.rankingModified,false);assert.equal(b.verifiedLive,false);
 assert.equal(b.marketExpansion.canTrade,false);assert.equal(b.marketExpansion.canNotify,false);
});
test('injected readers do not share the live baseline and cannot lower comparison coverage',async()=>{
 const read=(at,changes,opts={})=>researchLiveMarket({now:at,fetchSnapshot:async()=>snap(at,changes),...opts});
 assert.equal((await read(t,[1,-1,0,-1])).marketExpansion.status,'baseline-required');
 assert.equal((await read(t+60000,[1,1,1,-1])).marketExpansion.status,'baseline-required');
 const q=await read(t,[1,-1,0],{minCoverage:0.5});
 assert.equal(q.marketExpansion.status,'invalid-snapshot');assert.equal(q.marketExpansion.minCoverage,0.8);
});
