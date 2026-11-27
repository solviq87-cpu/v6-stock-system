'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileAccountSnapshot:reconcile,assertAccountReconciliation:assertReconciled,pendingBuyOrderBudget:budget}=require('../src/core/account-safety-state');
const day='2026-11-27';
const policy={version:'fee-v1',feeBps:0,minFee:5,sellTaxBps:0};
function order(id,patch={},statePatch={},events=[]){
 return {order:{orderId:id,symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:day,...patch},state:{terminal:false,remainingQuantity:100,...statePatch},events};
}
function book(orders={},patch={}){return {revision:1,feePolicy:{...policy},account:{cash:10000,positions:{},events:[],eventHashes:{}},orders,...patch};}
function restricted(report){
 assert.equal(report.status,'restricted');assert.equal(report.internallyConsistent,true);
 assert.equal(report.newExposureAllowed,false);assert.equal(report.reservedCash,null);
 assert.ok(report.reasonCodes.includes('PENDING_BUY_BUDGET_UNKNOWN'));
 assert.equal(report.canTrade,false);assert.equal(report.writesAccount,false);
}
test('all known active buy budgets sum exactly; terminal orders do not reserve cash',()=>{
 const b=book({a:order('a'),b:order('b',{limitPrice:20}),c:order('c',{}, {terminal:true,remainingQuantity:0})});
 const before=JSON.stringify(b),r=reconcile(b,{tradeDate:day});
 assert.equal(r.status,'consistent');assert.equal(r.newExposureAllowed,true);assert.equal(r.reservedCash,3010);
 assert.equal(r.completeExternalReconciliation,false);assert.equal(JSON.stringify(b),before);
});
test('one failed budget cannot project the other orders as a complete frozen cash total',()=>{
 const b=book({good:order('good'),bad:order('bad',{limitPrice:null})});
 const before=JSON.stringify(b);restricted(reconcile(b));restricted(assertReconciled(b));
 assert.equal(JSON.stringify(b),before);
});
test('when no active buy fee can be determined the reported amount is unknown rather than zero',()=>{
 const b=book({a:order('a'),b:order('b')},{feeSchedules:[{...policy,effectiveFrom:day,knownAt:day+'T10:00:00+08:00'}]});
 restricted(reconcile(b,{tradeDate:day}));
 // A terminal order no longer needs a future fee estimate. This is a fixture,
 // not an account mutation or evidence of actual cancellation execution.
 b.orders.a.state={terminal:true,remainingQuantity:0};b.orders.b.state={terminal:true,remainingQuantity:0};
 const r=reconcile(b,{tradeDate:day});assert.equal(r.reservedCash,0);assert.equal(r.newExposureAllowed,true);
});
test('negative incremental commission from contradictory old fee totals is not a frozen cash credit',()=>{
 const b=book({}, {feePolicy:{...policy,commissionScope:'order-day'}});
 const prior={type:'fill',date:day,feeEvidence:{version:policy.version,gross:1000,commission:5,tax:0,transfer:0,total:100}};
 const item=order('x',{}, {},[prior]);
 assert.throws(()=>budget(b,item,day),/冻结预算不可计算/);
 prior.feeEvidence.total=5;assert.equal(budget(b,item,day),1000);
 assert.equal(budget(b,order('x'),day),1005);
});
test('unknown cash cannot pass the original reconciliation as a healthy account',()=>{
 for(const cash of [null,undefined,'10000',NaN,Infinity,-1]){
  const b=book();b.account.cash=cash;const r=reconcile(b);
  assert.equal(r.status,'mismatch');assert.equal(r.internallyConsistent,false);assert.equal(r.newExposureAllowed,false);
  assert.equal(r.reservedCash,null);assert.ok(r.reasonCodes.includes('INVALID_ACCOUNT_STRUCTURE'));
  assert.throws(()=>assertReconciled(b),/INVALID_ACCOUNT_STRUCTURE/);
 }
});
test('unrecognizable order directions or rows cannot yield a complete reservation estimate',()=>{
 for(const bad of [order('bad',{side:'unknown'}),order('bad',{}, {},[null]),null,order('bad',{}, {remainingQuantity:'100'})]){
  const r=reconcile(book({good:order('good'),bad}));
  assert.equal(r.status,'mismatch');assert.equal(r.newExposureAllowed,false);assert.equal(r.reservedCash,null);
  assert.ok(r.reasonCodes.includes('INVALID_ORDER_IDENTITY'));
 }
});
test('sum whose monetary rounding overflows is restricted and not serialized as a false known amount',()=>{
 const b=book({a:order('a',{limitPrice:9e303}),b:order('b',{limitPrice:9e303})});b.account.cash=1e307;
 restricted(reconcile(b));
});
test('fully known but excessive reservations retain their amount and restriction',()=>{
 const b=book({a:order('a',{limitPrice:200})});const r=reconcile(b);
 assert.equal(r.status,'restricted');assert.equal(r.internallyConsistent,true);assert.equal(r.newExposureAllowed,false);
 assert.equal(r.reservedCash,20005);assert.ok(r.reasonCodes.includes('PENDING_CASH_RESERVATION_MISMATCH'));
 assert.equal(assertReconciled(b).reservedCash,20005);
});
