'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcilePaperAccount:reconcile}=require('../src/core/paper-account-reconciliation');
const empty=()=>({initialCash:0,trades:[],account:{cash:0,realized:0,positions:{}}});
const buy=()=>({initialCash:100,trades:[{t:1,side:'BUY',code:'600001',shares:1,amount:10,fee:0}],account:{cash:90,realized:0,positions:{'600001':{shares:1,basis:10}}}});
function rejects(x){const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.ok(r.errors.length);return r;}
function finiteReport(x){if(typeof x==='number')assert.ok(Number.isFinite(x));else if(x&&typeof x==='object')Object.values(x).forEach(finiteReport);}
test('explicit missing or conflicting quantity aliases cannot certify a holding',()=>{
 for(const p of [{shares:null,qty:0,basis:0},{shares:0,qty:100,basis:0},{shares:undefined,qty:0,basis:0}]){const x=empty();x.account.positions['600001']=p;const r=rejects(x);assert.equal(r.positions.differences[0].actualShares,null);assert.equal(r.positions.differences[0].shareDiff,null);}
});
test('explicit missing or conflicting basis aliases cannot certify a holding',()=>{
 for(const p of [{shares:0,basis:null,costBasis:0},{shares:0,basis:0,costBasis:100},{shares:0,basis:undefined,costBasis:0}]){const x=empty();x.account.positions['600001']=p;const r=rejects(x);assert.equal(r.positions.differences[0].actualBasis,null);assert.equal(r.positions.differences[0].basisDiff,null);}
});
test('legacy alternative fields and numerically identical aliases stay compatible',()=>{
 for(const p of [{qty:'1',costBasis:'10'},{shares:1,qty:'1',basis:10,costBasis:'10'}]){const x=buy();x.account.positions['600001']=p;const before=JSON.stringify(x);assert.equal(reconcile(x).ok,true);assert.equal(JSON.stringify(x),before);}
});
test('sparse trade history reports an invalid row without throwing',()=>{
 const x=empty();x.trades=new Array(1);assert.equal(rejects(x).invalidTrades,1);
});
test('unsafe initial and actual monetary evidence cannot certify a complete account',()=>{
 const a=empty();a.initialCash=Number.MAX_VALUE;a.account.cash=Number.MAX_VALUE;finiteReport(rejects(a));
 for(const key of ['cash','realized']){const x=empty();x.account[key]=Number.MAX_VALUE;const r=rejects(x);assert.equal(r[key].actual,null);assert.equal(r[key].diff,null);finiteReport(r);}
});
test('unsafe trade amount or fee is rejected rather than producing infinite replay figures',()=>{
 for(const key of ['amount','fee']){const x=buy();x.trades[0][key]=Number.MAX_VALUE;finiteReport(rejects(x));}
});
test('individually representable amounts cannot overflow the combined cash or basis arithmetic',()=>{
 const x=buy();x.initialCash=80000000000000;x.trades[0].amount=60000000000000;x.trades[0].fee=60000000000000;
 const r=rejects(x);assert.equal(r.cash.rebuilt,null);assert.equal(r.cash.diff,null);finiteReport(r);
});
test('unsafe aggregate holding quantity is rejected even when individual trades are integers',()=>{
 const x=empty();x.initialCash=2;x.trades=[{t:1,side:'BUY',code:'600001',shares:Number.MAX_SAFE_INTEGER,amount:1,fee:0},{t:2,side:'BUY',code:'600001',shares:2,amount:1,fee:0}];x.account={cash:0,realized:0,positions:{'600001':{shares:Number.MAX_SAFE_INTEGER,basis:2}}};finiteReport(rejects(x));
});
test('non-record holding containers cannot masquerade as an empty account',()=>{
 for(const p of [new Date(0),new Map(),new Set()]){const x=empty();x.account.positions=p;rejects(x);}
});
test('non-scalar stock identity or direction cannot be coerced into a valid trade',()=>{
 for(const patch of [{code:['600001']},{side:['BUY']},{code:{toString:()=> '600001'}}]){const x=buy();Object.assign(x.trades[0],patch);assert.equal(rejects(x).invalidTrades,1);}
 const x=buy();x.trades[0].code=600001;assert.equal(reconcile(x).ok,true);
});
test('holding evidence must come from own fields, not inherited values or getters',()=>{
 const x=buy();x.account.positions['600001']=Object.create({shares:1,basis:10});rejects(x);
 const y=buy();const p={basis:10};Object.defineProperty(p,'shares',{enumerable:true,get(){throw Error('getter must not execute');}});y.account.positions['600001']=p;rejects(y);
});
test('a missing own holding is still a genuine mismatch without invoking inherited getters',()=>{
 const x=buy();const proto=Object.defineProperty({},'600001',{get(){throw Error('inherited getter must not execute');}});x.account.positions=Object.create(proto);const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,true);assert.equal(r.positions.differences[0].actualShares,0);assert.equal(r.positions.differences[0].shareDiff,1);
});
test('explicit negative actual cash cannot be certified by the comparison tolerance',()=>{
 const x=empty();x.account.cash=-0.01;rejects(x);
});
