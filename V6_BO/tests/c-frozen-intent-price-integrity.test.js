'use strict';
// Isolated synthetic offline intent fixtures. Not market data or trading authority.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {simulatePaperIntents:simulate}=require('../src/core/paper-intent-simulator');
const {preflightPaperExecution:preflight}=require('../src/core/paper-execution-preflight');
const fp='a'.repeat(64),day='2026-11-27';
function fixture(){return {plan:{mode:'paper-order-intent-plan',canTrade:false,executed:false,datasetFingerprint:fp,
  intents:[{system:'fourteen',symbol:'600000',executionDate:day,side:'buy',status:'proposal-only',referencePrice:10,quantity:100}]},
  snapshot:{datasetFingerprint:fp,asOf:day,symbols:[{symbol:'600000',price:10,open:10,volume:100000,
    complete:true,stale:false,tradable:true,suspended:false,atUpperLimit:false,atLowerLimit:false}]},
  account:{cash:100000,positions:{},ledger:[]}};}
const run=(f,options)=>simulate(f.plan,f.snapshot,f.account,options);
function blocked(f,options){const before=JSON.stringify(f),r=run(f,options);assert.equal(r.fills.length,0);
  assert.equal(r.blocked.length,1);assert.equal(r.cash,f.account.cash);assert.deepEqual(r.positions,f.account.positions);
  assert.equal(r.ledger.length,0);assert.equal(JSON.stringify(f),before);assert.equal(r.canTrade,false);assert.equal(r.accountMutated,false);return r;}
for(const [name,open] of [['gap up',10.5],['gap down',9.6]])test('C EX11 '+name+' outside frozen range despite passing snapshot',()=>{
  const f=fixture();f.snapshot.symbols[0].open=open;assert.equal(preflight(f.plan,f.snapshot,f.account).passCount,1);
  assert.match(blocked(f).blocked[0].reason,/偏离计划/);
});
test('C EX11 slippage crosses original price band after both quote and open pass',()=>{
  const f=fixture();f.snapshot.symbols[0].open=10.29;assert.match(blocked(f,{slippageBps:20}).blocked[0].reason,/偏离计划/);
});
for(const [name,open] of [['missing',undefined],['null',null],['boolean',true]])test('C EX13 '+name+' open is not an execution price',()=>{
  const f=fixture();f.snapshot.symbols[0].open=open;if(name==='boolean'){f.snapshot.symbols[0].price=1;f.plan.intents[0].referencePrice=1;}
  assert.match(blocked(f).blocked[0].reason,/开盘价/);
});
test('C EX13 boolean volume cannot manufacture available liquidity',()=>{
  const f=fixture();f.snapshot.symbols[0].volume=true;assert.match(blocked(f,{maxParticipationPct:100}).blocked[0].reason,/成交量/);
});
test('C EX11 exactly 3 percent boundary retains the original inclusive range',()=>{
  for(const price of [9.7,10.3]){const f=fixture();Object.assign(f.snapshot.symbols[0],{price,open:price});
    assert.equal(preflight(f.plan,f.snapshot,f.account).passCount,1);const r=run(f,{slippageBps:0});assert.equal(r.fills.length,1);assert.equal(r.fills[0].price,price);}
});
test('C EX11 beyond original range stays blocked in preflight',()=>{
  for(const price of [9.69,10.31]){const f=fixture();Object.assign(f.snapshot.symbols[0],{price,open:price});assert.equal(preflight(f.plan,f.snapshot,f.account).passCount,0);blocked(f);}
});
test('C EX11 exact intent identity survives identical display fields',()=>{
  const f=fixture(),valid=f.plan.intents[0],rejected={...valid,referencePrice:11};f.plan.intents=[rejected,valid];
  const r=run(f);assert.equal(r.blocked.length,1);assert.equal(r.fills.length,1);
  const id=crypto.createHash('sha256').update(JSON.stringify({fingerprint:fp,intent:valid})).digest('hex');assert.equal(r.fills[0].intentId,id);
  assert.equal(r.ledger[0].intentId,id);assert.equal(r.canTrade,false);
});
test('C EX11 normal fill keeps fees and T+1 while not mutating original input',()=>{
  const f=fixture(),before=JSON.stringify(f),r=run(f);assert.equal(r.fills.length,1);assert.equal(r.fills[0].price,10.01);
  assert.ok(r.fills[0].fee>0);assert.match(r.fills[0].sellableDate,/T\+1/);assert.equal(JSON.stringify(f),before);
  assert.equal(r.executed,false);assert.equal(r.brokerConnected,false);
});
