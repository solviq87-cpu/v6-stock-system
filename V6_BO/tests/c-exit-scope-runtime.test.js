'use strict';
// Full original read-only report chain; synthetic original fixture, no account or order writes.
const test=require('node:test'),assert=require('node:assert/strict');
const {accountExitDiagnostics}=require('../src/core/advanced-account-risk');
const {fixtures,day,priorDay}=require('./helpers/advanced-portfolio-fixture');
function mixed(){
 const f=fixtures(),position=f.book.account.positions['600000'],lot=position.lots[0];
 position.lots=[{...lot,quantity:400,cost:4000,buyDate:priorDay},{...lot,quantity:600,cost:6000,buyDate:day,sourceEventId:'opening-today-600000'}];
 return f;
}
function rows(f){
 const before=JSON.stringify(f),r=accountExitDiagnostics(f.book,f.input);
 assert.equal(JSON.stringify(f),before);assert.equal(r.canTrade,false);assert.equal(r.writesAccount,false);
 assert.equal(r.portfolioEvidence.mode,'original-account-portfolio-evidence');
 const position=r.positions.find(p=>p.symbol==='600000'),exit=r.portfolioEvidence.exits.find(p=>p.symbol==='600000');
 for(const key of ['conditionalSessions','estimatedExitCost','conditionalSellableSessions','estimatedSellableExitCost','exitEstimateQuantity','costReason'])assert.equal(position[key],exit[key],key);
 assert.equal(position.guaranteedFill,false);return {position,exit};
}
function blocked({position,exit}){for(const row of [position,exit]){assert.equal(row.conditionalSessions,null);assert.equal(row.estimatedExitCost,null);assert.equal(row.conditionalSellableSessions,null);assert.equal(row.estimatedSellableExitCost,null);assert.equal(row.exitEstimateQuantity,null);}}
test('C EX04 full T+1 holding reports unknown whole and subset exit through original diagnostic',()=>{
 const f=fixtures();f.book.account.positions['600000'].lots[0].buyDate=day;
 const r=rows(f);assert.equal(r.position.matureUnreserved,0);blocked(r);assert.equal(r.exit.restrictedQuantity,1000);
});
test('C EX39 partial T+1 holding retains subset-only estimate and quantity through original diagnostic',()=>{
 const r=rows(mixed());assert.equal(r.position.matureUnreserved,400);assert.equal(r.exit.restrictedQuantity,600);
 assert.equal(r.position.conditionalSessions,null);assert.equal(r.position.estimatedExitCost,null);
 assert.equal(r.position.conditionalSellableSessions,1);assert.equal(r.position.exitEstimateQuantity,400);
 assert.ok(r.position.estimatedSellableExitCost>0);assert.equal(r.position.costReason,'RESTRICTED_POSITION_EXIT_UNVERIFIED');
});
test('C EX39 closed or paused original account suppresses subset estimate',()=>{
 const closed=mixed();closed.input.marketOpen=false;closed.input.continuous=false;blocked(rows(closed));
 const paused=mixed();paused.book.legacy.enabled=false;blocked(rows(paused));
});
test('C EX39 limit down suppresses subset estimate through original diagnostic',()=>{
 const f=mixed();f.input.quotes['600000'].limitDown=true;const r=rows(f);blocked(r);assert.ok(r.position.alerts.some(a=>a.code==='LIMIT_DOWN'));
});
test('C EX39 all mature original holding preserves the previous complete capacity/cost projection',()=>{
 const r=rows(fixtures());assert.equal(r.position.conditionalSessions,1);assert.equal(r.position.conditionalSellableSessions,1);
 assert.equal(r.position.exitEstimateQuantity,1000);assert.ok(r.position.estimatedExitCost>0);
 assert.equal(r.position.estimatedExitCost,r.position.estimatedSellableExitCost);
});
