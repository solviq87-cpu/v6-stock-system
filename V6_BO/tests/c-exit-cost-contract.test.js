'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {exitRisk}=require('../src/core/advanced-portfolio-evidence');
const now=Date.parse('2026-11-27T10:00:00+08:00');
const input=(quantity=300,sellable=quantity)=>({position:{symbol:'600000',quantity,sellable},
 quote:{code:'600000',price:10,quoteAt:now,receivedAt:now,quoteSource:'provider',canTrade:true},now,limitDown:false,suspended:false,
 prior:{date:'2026-11-26',source:'provider',dataVersion:'v1',availableAt:now-3600000,priceBasis:'unadjusted',evidenceKind:'historical',amount:100000,amountUnit:'CNY',volume:10000,volumeUnit:'shares'},maxParticipationPct:1,assumedExitBps:20});
test('C16.5 fixed-bps arithmetic remains available without claiming multi-session complete cost',()=>{
 const f=input(),before=JSON.stringify(f),r=exitRisk(f);
 assert.equal(r.conditionalSessions,3);assert.equal(r.estimatedExitCost,null);assert.equal(r.estimatedSellableExitCost,null);
 assert.equal(r.assumedWholeExitFriction,6);assert.equal(r.assumedSellableExitFriction,6);
 assert.equal(r.assumedExitBps,20);assert.equal(r.assumedFrictionBasis,'fixed-current-mark-and-explicit-bps-only');
 assert.equal(r.canTrade,false);assert.equal(r.writesAccount,false);assert.equal(r.guaranteedFill,false);assert.equal(JSON.stringify(f),before);
});
test('C16.5 partial mature lot has fixed-mark friction for its own scope only',()=>{
 const r=exitRisk(input(500,300));
 assert.equal(r.conditionalSellableSessions,3);assert.equal(r.estimatedSellableExitCost,null);assert.equal(r.estimatedExitCost,null);
 assert.equal(r.assumedSellableExitFriction,6);assert.equal(r.assumedWholeExitFriction,null);assert.equal(r.exitEstimateQuantity,300);
});
test('C16.5 one-session explicit bps retains existing conditional estimates and zero remains genuine zero',()=>{
 for(const [quantity,expected] of [[100,2],[0,0]]){
  const r=exitRisk(input(quantity));assert.equal(r.assumedWholeExitFriction,expected);
  assert.equal(r.assumedSellableExitFriction,expected);assert.equal(r.estimatedExitCost,expected);
 }
});
test('C16.5 invalid or absent bps never supplies a fictional scenario cost',()=>{
 for(const assumedExitBps of [undefined,null,-1,10001,Infinity,true]){
  const r=exitRisk({...input(),assumedExitBps});assert.equal(r.assumedSellableExitFriction,null);assert.equal(r.assumedWholeExitFriction,null);
  assert.equal(r.assumedExitBps,null);assert.equal(r.assumedFrictionBasis,null);assert.equal(r.estimatedExitCost,null);
 }
});
test('C16.5 stale price, no liquidity or locked quantity cannot get even a fixed-mark exit friction estimate',()=>{
 const f=input();
 for(const patch of [{suspended:true},{limitDown:true},{limitDown:null},{prior:null},{position:{...f.position,sellable:0}},
  {quote:{...f.quote,quoteAt:now-15001}},{quote:{...f.quote,canTrade:false}},{prior:{...f.prior,amountUnit:'USD'}}]){
  const r=exitRisk({...f,...patch});assert.equal(r.assumedSellableExitFriction,null);assert.equal(r.assumedWholeExitFriction,null);
  assert.equal(r.estimatedExitCost,null);assert.equal(r.guaranteedFill,false);
 }
});
