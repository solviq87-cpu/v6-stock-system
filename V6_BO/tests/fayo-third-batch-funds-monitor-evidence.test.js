'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const view=require('../src/core/quote-observation-view');
const {createRequire}=require('node:module'),serverPath=require.resolve('../server.js'),src=fs.readFileSync(serverPath,'utf8');
const ctx=vm.createContext({require:createRequire(serverPath)});
vm.runInContext(src.slice(src.indexOf('function fundsNumber('),src.indexOf('const { analyzeShortline }')),ctx);
const at=Date.parse('2026-11-26T10:00:00+08:00');
const sample=(i=0,patch={})=>({mainInflow:i*10,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',
 fundsRetrievedAt:at+i*5000,fundsSourceTimestamp:null,...patch});
test('unknown vendor time stays unknown but the bounded cumulative estimate has a separate receipt basis',()=>{
 const r=view.fundsObservationView(sample(),at);
 assert.equal(r.analysisValue,null);assert.equal(r.receiptAnalysisValue,0);
 assert.equal(r.receiptBasis,'local-receipt-only');assert.equal(r.verifiedLive,false);
 const h=Array.from({length:12},(_,i)=>ctx.fundsHistoryObservation(sample(i),at+i*5000));
 assert.equal(ctx.fundsWindowDelta(h,12),110);
});
test('bad source, unit, amount or missing clock cannot join the real funds monitor history',()=>{
 for(const patch of [{fundsUnit:null},{fundsUnit:'USD'},{unit:'USD'},{upstream:'sina'},{fundsSource:'synthetic'},{fixture:true},
  {fundsConflict:true},{mainInflowYuan:900},{fundsRetrievedAt:null},{fundsRetrievedAt:at+100000},{fundsRetrievedAt:at-16000},
  {fundsSourceTimestamp:'bad'},{fundsSourceTimestamp:at-15001},{fundsTradeDate:'2026-11-25'}]){
  const h=Array.from({length:12},(_,i)=>ctx.fundsHistoryObservation(sample(i,i===6?patch:{}),at+i*5000));
  assert.equal(ctx.fundsWindowDelta(h,12),null,JSON.stringify(patch));
 }
});
test('old stored funds traces cannot masquerade as qualified new observations',()=>{
 const old=Array.from({length:12},(_,i)=>({t:at+i*5000,mainInflow:i*10,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsRetrievedAt:at+i*5000,fundsSourceTimestamp:null}));
 assert.equal(ctx.fundsWindowDelta(old,12),null);
});
