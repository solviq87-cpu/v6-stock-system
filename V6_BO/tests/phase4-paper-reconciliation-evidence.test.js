'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcilePaperAccount:reconcile}=require('../src/core/paper-account-reconciliation');
function empty(){return {initialCash:0,trades:[],account:{cash:0,realized:0,positions:{}}};}
function buy({shares=1,amount=10,fee=0}={}){
 return {initialCash:100,trades:[{t:1,side:'buy',code:'600001',shares,amount,fee}],account:{cash:100-amount-fee,realized:0,positions:{'600001':{shares,basis:amount+fee}}}};
}
const unknownZero=[null,'','  ',false,[],[0],{}];
test('explicit zero balances and legacy numeric strings remain valid',()=>{
 assert.equal(reconcile(empty()).ok,true);
 const x=buy({shares:100,amount:10,fee:5});
 x.initialCash='100';Object.assign(x.trades[0],{shares:'100',amount:'10',fee:'5'});
 x.account.cash='85';x.account.realized='0';x.account.positions['600001']={qty:'100',costBasis:'15'};
 const before=JSON.stringify(x),r=reconcile(x);
 assert.equal(r.ok,true);assert.equal(r.complete,true);assert.equal(JSON.stringify(x),before);
});
test('unknown initial capital must not be converted to an empty zero account',()=>{
 for(const value of [...unknownZero,undefined]){
  const x=empty();x.initialCash=value;const r=reconcile(x);
  assert.equal(r.ok,false,String(value));assert.equal(r.complete,false);
  assert.ok(r.errors.some(e=>e.includes('initialCash')));
 }
});
test('unknown actual cash cannot be certified as zero cash',()=>{
 for(const value of [...unknownZero,undefined]){
  const x=empty();x.account.cash=value;const r=reconcile(x);
  assert.equal(r.ok,false,String(value));assert.equal(r.complete,false);
  assert.equal(r.cash.actual,null);assert.equal(r.cash.diff,null);
 }
});
test('unknown realized profit cannot be certified as breakeven',()=>{
 for(const value of [...unknownZero,undefined]){
  const x=empty();x.account.realized=value;const r=reconcile(x);
  assert.equal(r.ok,false,String(value));assert.equal(r.complete,false);
  assert.equal(r.realized.actual,null);assert.equal(r.realized.diff,null);
 }
});
test('non-scalar trade quantities cannot be converted into actual filled shares',()=>{
 for(const value of [true,[1],{valueOf:()=>1}]){
  const x=buy();x.trades[0].shares=value;const r=reconcile(x);
  assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.invalidTrades,1);
 }
});
test('non-scalar trade amount or fee cannot fabricate a complete settlement',()=>{
 for(const value of [true,[1],{valueOf:()=>1}]){
  const x=buy({amount:1});x.trades[0].amount=value;const r=reconcile(x);
  assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.invalidTrades,1);
 }
 for(const value of [[],[0],{valueOf:()=>0},false]){
  const x=buy();x.trades[0].fee=value;const r=reconcile(x);
  assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.missingFee,1);
 }
});
test('a malformed explicit position does not become a legitimate zero holding or zero cost basis',()=>{
 for(const p of [null,false,[],{}, {shares:null,basis:0},{shares:0,basis:''},{shares:[0],basis:0},{shares:0,basis:[0]}]){
  const x=empty();x.account.positions['600001']=p;const r=reconcile(x);
  assert.equal(r.ok,false);assert.equal(r.complete,false);
  assert.equal(r.positions.differences.length,1);
  const d=r.positions.differences[0];
  assert.ok(d.actualShares===null||d.actualBasis===null);
  if(d.actualShares===null)assert.equal(d.shareDiff,null);
  if(d.actualBasis===null)assert.equal(d.basisDiff,null);
 }
});
test('known differences and absent holding keys remain distinct from unknown position values',()=>{
 const x=buy();delete x.account.positions['600001'];let r=reconcile(x);
 assert.equal(r.ok,false);assert.equal(r.complete,true);assert.equal(r.positions.differences[0].actualShares,0);
 x.account.positions['600001']={shares:0,basis:0};r=reconcile(x);
 assert.equal(r.ok,false);assert.equal(r.complete,true);assert.equal(r.positions.differences[0].shareDiff,1);
 const zero=empty();zero.account.positions['600001']={shares:0,basis:0};assert.equal(reconcile(zero).ok,true);
});
