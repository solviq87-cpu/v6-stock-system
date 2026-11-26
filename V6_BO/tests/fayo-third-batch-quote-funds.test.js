'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quoteObservationView,quoteUseEligibility,quoteSnapshotFields,fundsObservationView}=require('../src/core/quote-observation-view');
const now=Date.parse('2026-11-26T10:00:00+08:00');
const funds={mainInflow:0,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',fundsSourceTimestamp:now-1000,fundsRetrievedAt:now};
test('current funds analysis preserves actual zero and negative amounts without authorizing trading',()=>{
 for(const value of [0,-100,100]){const result=fundsObservationView({...funds,mainInflow:value},now);assert.equal(result.analysisValue,value);assert.equal(result.analysisEligible,true);assert.equal(result.canTrade,false);}
});
test('funds aliases, units and amounts must agree; unknown and historical data are not current inputs',()=>{
 for(const patch of [{upstream:'sina'},{source:'sina'},{fundsUnit:'USD'},{unit:'USD'},{fundsUnit:null},{fundsMethod:null},{mainInflow:null},{mainInflow:Infinity},{mainInflow:true},{mainInflowYuan:1},{sourceTimestamp:now-2000},{retrievedAt:now-100},{fundsRetrievedAt:'bad'},{fundsSourceTimestamp:now-15001},{fundsSourceTimestamp:null},{fixture:true},{fundsSource:'synthetic-feed'}]){
  const r=fundsObservationView({...funds,...patch},now);assert.equal(r.analysisEligible,false,JSON.stringify(patch));assert.equal(r.analysisValue,null);
 }
 const historical=fundsObservationView({...funds,fundsSourceTimestamp:now-60000},now);assert.equal(historical.value,0);assert.equal(historical.freshness,'stale');
});
test('separately identified quote and funds providers are not confused',()=>{
 const result=fundsObservationView({...funds,fundsSource:'ths',quoteSource:'tencent',source:'tencent'},now);
 assert.equal(result.analysisValue,0);assert.equal(result.source,'ths');
});
test('explicit provider conflicts and malformed reception survive the quote snapshot boundary',()=>{
 const row={price:10,quoteSource:'tencent',quoteAt:now-1000,receivedAt:now,canTrade:true,canNotify:true};
 for(const patch of [{source:'sina'},{quoteProvider:'sina'},{receivedAt:'bad'},{receivedAt:9e15}]){
  const bad={...row,...patch},projected={price:row.price,...quoteSnapshotFields(bad)};
  assert.equal(quoteUseEligibility(bad,now).canTrade,false);
  assert.equal(quoteUseEligibility(projected,now).canTrade,false);
 }
 assert.equal(quoteObservationView({...row,source:'tencent'},now).quoteStatus,'recent-unverified');
});
