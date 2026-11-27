'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcilePaperAccount:reconcile}=require('../src/core/paper-account-reconciliation');
const empty=()=>({initialCash:0,trades:[],account:{cash:0,realized:0,positions:{}}});
const buy=(t,id)=>({t,side:'BUY',code:'600001',shares:1,amount:10,fee:0,...id});
const pair=(first,second)=>({initialCash:100,trades:[buy(1,first),buy(2,second)],account:{cash:80,realized:0,positions:{'600001':{shares:2,basis:20}}}});
function rejected(x){const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.ok(r.errors.length);return r;}
test('non-enumerable unexpected own holdings cannot disappear from reconciliation',()=>{
 const x=empty();Object.defineProperty(x.account.positions,'600001',{value:{shares:1,basis:10}});
 const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,true);assert.equal(r.positions.actualSymbols,1);assert.equal(r.positions.differences[0].shareDiff,-1);
});
test('non-enumerable matching own holding remains fully reconciled and counted',()=>{
 const x=pair({tradeId:'a'},{tradeId:'b'});const p=x.account.positions['600001'];x.account.positions={};Object.defineProperty(x.account.positions,'600001',{value:p});
 const r=reconcile(x);assert.equal(r.ok,true);assert.equal(r.positions.actualSymbols,1);
});
test('symbol-keyed holdings are unknown, not an empty account',()=>{
 const x=empty();x.account.positions[Symbol('600001')]={shares:1,basis:10};rejected(x);
});
test('record classification never invokes own or inherited Symbol.toStringTag getters',()=>{
 for(const target of ['input','account','positions','trade','holding'])for(const inherited of [false,true]){
  const x=pair({tradeId:'a'},{tradeId:'b'});let calls=0;
  const v=target==='input'?x:target==='account'?x.account:target==='positions'?x.account.positions:target==='trade'?x.trades[0]:x.account.positions['600001'];
  const tag=inherited?{}:v;Object.defineProperty(tag,Symbol.toStringTag,{get(){calls++;throw Error('getter must never execute');}});if(inherited)Object.setPrototypeOf(v,tag);
  rejected(x);assert.equal(calls,0);
 }
});
test('different nonempty trade ID aliases cannot certify a settlement',()=>{
 const r=rejected(pair({tradeId:'a',trade_id:'b'},{tradeId:'c'}));assert.equal(r.invalidTrades,1);
});
test('blank leading identity cannot hide a duplicate under a legacy alias',()=>{
 const r=rejected(pair({tradeId:'',trade_id:'same'},{tradeId:'same'}));assert.equal(r.invalidTrades,1);
});
test('malformed lower-priority identity cannot hide behind a valid ID',()=>{
 for(const value of [false,[],{}])assert.equal(rejected(pair({tradeId:'a',id:value},{tradeId:'b'})).invalidTrades,1);
});
test('accessor identity is rejected without invocation',()=>{
 const x=pair({tradeId:'a'},{tradeId:'b'});let calls=0;Object.defineProperty(x.trades[0],'id',{get(){calls++;throw Error('getter');}});
 rejected(x);assert.equal(calls,0);
});
test('optional legacy IDs, null fallback and matching numeric-string aliases remain compatible',()=>{
 for(const [a,b] of [[{},{}],[{tradeId:null,trade_id:'a'},{id:'b'}],[{tradeId:1,trade_id:'1',id:' 1 '},{tradeId:2,id:'2'}],[{tradeId:''},{trade_id:null}]])assert.equal(reconcile(pair(a,b)).ok,true);
});
test('tagged fake ordinary records cannot certify an empty snapshot',()=>{
 const x=empty();x.account.positions=new Date(0);Object.defineProperty(x.account.positions,Symbol.toStringTag,{value:'Object'});rejected(x);
});
