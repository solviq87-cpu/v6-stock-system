'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {researchLiveMarket}=require('../src/core/live-market-research');
const {createTurnoverCrowding}=require('../src/core/turnover-crowding');
const times=[];for(let t=Date.parse('2026-09-01T10:02:00+08:00');times.length<21;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))times.push(t);
function snap(at,amounts=[25,25,25,25]){return {date:new Date(at+28800000).toISOString().slice(0,10),source:'eastmoney-clist-unverified-live',universeSize:4,pages:1,
 startedAt:new Date(at-10000).toISOString(),retrievedAt:new Date(at).toISOString(),sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},
 stocks:amounts.map((amount,i)=>({code:String(i+1).padStart(6,'0'),amount,pctChange:1,vendorQuoteAt:at-2000}))};}
test('existing research entry adds crowding to one-fetch snapshots while preserving static HHI and permissions',async()=>{
 const crowdingTracker=createTurnoverCrowding();let calls=0;
 const read=(at,amounts)=>researchLiveMarket({now:at,crowdingTracker,fetchSnapshot:async()=>{calls++;return snap(at,amounts);}});
 for(const at of times.slice(0,20))await read(at);
 const v=await read(times[20],[0,0,0,100]);assert.equal(calls,21);
 assert.equal(v.turnoverCrowding.empiricalPercentile,100);assert.equal(v.turnoverCrowding.currentHHI,v.recentStructure.turnoverHHI);
 assert.equal(v.rankingModified,false);assert.equal(v.verifiedLive,false);assert.equal(v.turnoverCrowding.canTrade,false);assert.equal(v.turnoverCrowding.canNotify,false);
});
test('injected readers do not share the production or each other historical baseline',async()=>{
 for(const at of times){const v=await researchLiveMarket({now:at,fetchSnapshot:async()=>snap(at)});assert.equal(v.turnoverCrowding.referenceDays,0);}
});

test('F40 original one-fetch research consumer publishes full and incomplete liquidity coverage',async()=>{
 const tracker=createTurnoverCrowding();let calls=0;
 for(const at of times.slice(0,20))await researchLiveMarket({now:at,crowdingTracker:tracker,fetchSnapshot:async()=>{calls++;return snap(at);}});
 const at=times[20],full=await researchLiveMarket({now:at,crowdingTracker:tracker,fetchSnapshot:async()=>{calls++;return snap(at,[10,10,10,10]);}});
 assert.equal(full.turnoverCrowding.liquidity.comparableDays,20);assert.equal(full.turnoverCrowding.liquidity.currentAmount,40);
 const missing=snap(at+1000);missing.stocks.pop();const result=await researchLiveMarket({now:at+1000,crowdingTracker:tracker,fetchSnapshot:async()=>{calls++;return missing;}});
 assert.equal(calls,22);assert.equal(result.turnoverCrowding.liquidity.validSecurities,3);assert.equal(result.turnoverCrowding.liquidity.relativeChangePct,null);assert.equal(result.rankingModified,false);
});
