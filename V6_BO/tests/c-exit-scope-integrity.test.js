'use strict';
// Deterministic evidence, not actual market prices, holdings or order authority.
const test=require('node:test'),assert=require('node:assert/strict');
const {exitRisk}=require('../src/core/advanced-portfolio-evidence');
const day='2026-11-27',now=Date.parse(day+'T10:00:00+08:00');
const input=(quantity=300,sellable=quantity)=>({position:{symbol:'600000',quantity,sellable},
 quote:{code:'600000',price:10,quoteAt:now,receivedAt:now,quoteSource:'provider',canTrade:true},now,limitDown:false,suspended:false,
 prior:{date:'2026-11-26',source:'provider',dataVersion:'v1',availableAt:now-3600000,priceBasis:'unadjusted',evidenceKind:'historical',amount:100000,volume:10000,volumeUnit:'shares'},maxParticipationPct:1,assumedExitBps:20});
function unknownWhole(result){assert.equal(result.conditionalSessions,null);assert.equal(result.estimatedExitCost,null);assert.equal(result.guaranteedFill,false);assert.equal(result.canTrade,false);assert.equal(result.writesAccount,false);}
function unknownSubset(result){assert.equal(result.conditionalSellableSessions,null);assert.equal(result.estimatedSellableExitCost,null);assert.equal(result.exitEstimateQuantity,null);}
test('C EX04 all positive holdings locked cannot report zero sessions or zero exit cost',()=>{const r=exitRisk(input(300,0));unknownWhole(r);unknownSubset(r);assert.equal(r.restrictedQuantity,300);assert.ok(r.alerts.some(a=>a.code==='SELLABLE_RESTRICTED'));});
test('C EX39 partial sellable subset cannot certify whole holding exit',()=>{const f=input(300,100),before=JSON.stringify(f),r=exitRisk(f);unknownWhole(r);assert.equal(r.conditionalSellableSessions,1);assert.equal(r.estimatedSellableExitCost,2);assert.equal(r.exitEstimateQuantity,100);assert.equal(r.restrictedQuantity,200);assert.equal(JSON.stringify(f),before);});
test('C EX39 subset multi-session estimate stays separate from whole holding',()=>{const r=exitRisk(input(500,300));unknownWhole(r);assert.equal(r.conditionalSellableSessions,3);assert.equal(r.estimatedSellableExitCost,6);assert.equal(r.exitEstimateQuantity,300);assert.equal(r.historicalDailyShares,100);});
test('C EX04 restriction cannot improve whole-position exit evidence',()=>{const f=input(300);assert.equal(exitRisk(f).conditionalSessions,3);for(const sellable of [299,200,100,0])unknownWhole(exitRisk({...f,position:{...f.position,sellable}}));});
test('C EX39 no price-capacity estimate for suspended, limit-down or unknown status',()=>{for(const extra of [{limitDown:true},{suspended:true},{limitDown:null},{suspended:null}]){const r=exitRisk({...input(300,100),...extra});unknownWhole(r);unknownSubset(r);}});
test('C EX39 stale, future, wrong-symbol and observation-only quotes retain unknown exit',()=>{const f=input(300,100);for(const extra of [{quoteAt:now-15001},{quoteAt:now+1},{code:'600001'},{canTrade:false}]){const r=exitRisk({...f,quote:{...f.quote,...extra}});unknownWhole(r);unknownSubset(r);}});
test('C EX39 missing liquidity, no capacity or invalid participation retain unknown exit',()=>{const f=input(300,100);for(const extra of [{prior:null},{prior:{...f.prior,volume:1,amount:10}},{maxParticipationPct:null}]){const r=exitRisk({...f,...extra});unknownWhole(r);unknownSubset(r);}});
test('C EX39 all mature holding retains original capacity and costs, without execution permission',()=>{const r=exitRisk(input(300));assert.equal(r.conditionalSessions,3);assert.equal(r.estimatedExitCost,6);assert.equal(r.guaranteedFill,false);assert.equal(r.canTrade,false);assert.equal(r.writesAccount,false);});
test('C EX39 real zero holding remains distinct from a locked holding',()=>{const r=exitRisk(input(0,0));assert.equal(r.conditionalSessions,0);assert.equal(r.estimatedExitCost,0);assert.equal(r.restrictedQuantity,0);});
test('C EX39 invalid quantities stay unknown',()=>{for(const [quantity,sellable] of [[300,301],[300,-1],[300,null],[300,true],[300,1.5]])assert.equal(exitRisk(input(quantity,sellable)).status,'unknown');});
