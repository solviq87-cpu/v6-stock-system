'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlanEntryBinding,assertPlanEntryBinding}=require('../src/core/paper-plan-entry-binding');
const day='2026-11-27',now=Date.parse(day+'T10:00:00+08:00'),symbol='600000';
function fixture(){
 const plan={id:'plan-00000000-0000-4000-8000-000000000001',code:symbol,intendedDate:day,decisionId:'a'.repeat(64)};
 const card={code:symbol,day,decisionId:'b'.repeat(64)};
 const book={revision:5,fingerprint:'c'.repeat(64)};
 const quote={symbol,tradeDate:day,price:10,quoteAt:now-1000,timestamp:now-1000,receivedAt:now-500,quoteSource:'tencent',canTrade:true,mode:'public-live-unverified',riskContext:{observedAt:now-1000,marks:{'600001':5}}};
 const trade={side:'买入',code:symbol,price:10,t:now,reason:'作战台计划['+plan.id+'] '+symbol+' · 原账户风控'};
 const binding=createPlanEntryBinding({plan,card,book,quote,now});return {plan,card,book,quote,trade,binding,now};
}
test('original plan binding is frozen and matches only the original book and quote',()=>{
 const f=fixture();assert.equal(Object.isFrozen(f.binding),true);assert.equal(f.binding.canAuthorize,false);
 assert.equal(assertPlanEntryBinding(f.binding,f),f.binding);
});
test('changed account revision or same-revision different fingerprint cannot inherit the earlier check',()=>{
 const f=fixture();for(const book of [{...f.book,revision:6},{...f.book,fingerprint:'d'.repeat(64)},null])assert.throws(()=>assertPlanEntryBinding(f.binding,{...f,book}),/重新确认/);
});
test('same price on another receipt, changed source, or changed risk marks cannot inherit a frozen observation',()=>{
 const f=fixture();for(const quote of [{...f.quote,quoteAt:now-200,timestamp:now-200,receivedAt:now-100},{...f.quote,quoteSource:'sina'},{...f.quote,price:10.01},{...f.quote,riskContext:{...f.quote.riskContext,marks:{'600001':6}}},{...f.quote,canTrade:false},{...f.quote,symbol:'600001'}])assert.throws(()=>assertPlanEntryBinding(f.binding,{...f,quote}),/重新确认/);
});
test('original quote age stays bounded by fifteen seconds rather than the binding creation clock',()=>{
 const f=fixture();assert.doesNotThrow(()=>assertPlanEntryBinding(f.binding,{...f,now:f.quote.quoteAt+15000}));
 assert.throws(()=>assertPlanEntryBinding(f.binding,{...f,now:f.quote.quoteAt+15001}),/重新确认/);
 assert.throws(()=>assertPlanEntryBinding(f.binding,{...f,now:now-1}),/重新确认/);
});
test('the actual incoming trade must retain the same security, plan reason, price, side and clock',()=>{
 const f=fixture();for(const patch of [{code:'600001'},{price:10.01},{side:'卖出'},{reason:'其他策略'},{t:now-1},{t:now+1}])assert.throws(()=>assertPlanEntryBinding(f.binding,{...f,trade:{...f.trade,...patch}}),/重新确认/);
});
test('a missing or inconsistent book or an ineligible original quote cannot create a binding',()=>{
 const f=fixture();for(const patch of [{book:null},{quote:{...f.quote,canTrade:false}},{quote:{...f.quote,receivedAt:now+1}},{card:{...f.card,code:'600002'}},{plan:{...f.plan,decisionId:null}}])assert.throws(()=>createPlanEntryBinding({...f,...patch}),/重新确认/);
});
