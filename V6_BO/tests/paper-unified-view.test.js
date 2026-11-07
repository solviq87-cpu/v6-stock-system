'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectPaperAccount } = require('../src/core/paper-unified-view');
const fixture = () => ({cash: 98995,realized:0,positions:{'600000':{code:'600000',shares:100,basis:1005}},trades:[{t:1730781000000,side:'买入',code:'600000',shares:100,price:10,amount:1000,fee:5,pnl:null}]});
const view = (a=fixture(), extra={})=>projectPaperAccount(a,{accountId:'pool',initialCash:100000,audit:{ok:true},...extra});
test('authoritative projection preserves cash, position and fee without mutation',()=>{
 const a=fixture(), before=JSON.stringify(a), v=view(a);
 assert.equal(v.accounting.cash,98995);assert.equal(v.accounting.positions[0].basis,1005);
 assert.equal(v.events[0].type,'FILL_RECORDED');assert.equal(v.events[0].fee,5);
 assert.equal(v.canSubmitOrders,false);assert.equal(v.historicalOrdersAvailable,false);
 assert.equal(JSON.stringify(a),before);
});
test('restarted projection yields stable event identifiers',()=>assert.deepEqual(view().events,view().events));
test('replica is never labelled authoritative',()=>assert.equal(view(fixture(),{replica:true}).authoritative,false));
test('incomplete history does not falsely pass audit',()=>assert.equal(view(fixture(),{audit:{ok:false,incomplete:true}}).accounting.auditStatus,'incomplete'));
test('partial fill and cancellation cannot be fabricated from historical fills',()=>{
 const v=view();assert.equal(v.events.length,1);assert.equal(v.events[0].orderId,null);
 assert.equal(v.events.some(e=>e.type==='ORDER_CANCELLED'),false);
});
test('invalid trade fails closed',()=>{const a=fixture();delete a.trades[0].fee;assert.throws(()=>view(a),/不完整/);});
test('invalid position fails closed',()=>{const a=fixture();a.positions['600000'].shares=-1;assert.throws(()=>view(a),/不完整/);});
test('account type must be recognized',()=>assert.throws(()=>projectPaperAccount(fixture(),{accountId:'other',initialCash:100000}),/标识/));
