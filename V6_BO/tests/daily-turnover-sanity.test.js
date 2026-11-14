'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessDailyTurnoverBar,TOLERANCE_BPS}=require('../src/core/daily-turnover-sanity');
const bar=more=>({low:9,high:11,volume:10000,amount:100000,...more});
test('unadjusted CNY/shares weighted price must be in raw high/low band',()=>{
 assert.equal(TOLERANCE_BPS,100);
 assert.equal(assessDailyTurnoverBar(bar()).status,'in-range');
 assert.equal(assessDailyTurnoverBar(bar({amount:111000})).status,'in-range');
 const high=assessDailyTurnoverBar(bar({amount:150000}));
 assert.equal(high.status,'outside-range');
 assert.ok(high.deviationBps>0);
 assert.equal(assessDailyTurnoverBar(bar({amount:100})).status,'outside-range');
});
test('zero trading is kept as zero and never assigned a fictional VWAP',()=>{
 assert.deepEqual(assessDailyTurnoverBar(bar({volume:0,amount:0})),
  {status:'no-trades',vwap:null,deviationBps:0});
 assert.equal(assessDailyTurnoverBar(bar({volume:0,amount:100})).status,'inconsistent-zero');
 assert.equal(assessDailyTurnoverBar(bar({volume:100,amount:0})).status,'inconsistent-zero');
});
test('unsafe, invalid and nonfinite amounts/volumes do not pass',()=>{
 for(const extra of [{volume:10.5},{volume:Infinity},{volume:-1},
  {amount:NaN},{amount:-1},{low:0},{low:15,high:11},{high:Infinity}]){
  assert.equal(assessDailyTurnoverBar(bar(extra)).status,'invalid-values');
 }
});
