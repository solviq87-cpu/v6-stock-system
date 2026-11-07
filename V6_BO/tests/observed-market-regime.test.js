'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyObservedMarket}=require('../src/core/observed-market-regime');
const snapshot={date:'2026-11-05',source:'licensed-market',universeSize:4,stocks:[
 {code:'000001',pctChange:2},{code:'000002',pctChange:1},{code:'000003',pctChange:-1},{code:'000004',pctChange:0}]};
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
const opts={asOf:'2026-11-05T12:00:00Z',scores,scoreSource:'independent-index',scoreDate:'2026-11-05'};
test('classifies sourced observed breadth with independently dated scores',()=>{
 const r=classifyObservedMarket(snapshot,opts);assert.equal(r.usable,true);assert.equal(r.breadth.breadthScore,50);
 assert.ok(r.weights.trend>0);assert.equal(r.inputs.breadth,50);assert.equal(r.scoreSource,'independent-index');
});
test('insufficient coverage blocks regime and weights',()=>{
 const r=classifyObservedMarket({...snapshot,universeSize:20},opts);assert.equal(r.usable,false);assert.equal(r.weights,null);assert.equal(r.regime,null);
});
test('missing scores do not silently default to neutral',()=>{
 const r=classifyObservedMarket(snapshot,{...opts,scores:{...scores,riskScore:undefined}});
 assert.equal(r.usable,false);assert.match(r.reason,/riskScore/);
});
test('rejects score source or trading-date mismatch',()=>{
 assert.equal(classifyObservedMarket(snapshot,{...opts,scoreDate:'2026-11-04'}).usable,false);
 assert.equal(classifyObservedMarket(snapshot,{...opts,scoreSource:''}).usable,false);
});
test('rejects out-of-range score rather than clipping it silently',()=>{
 const r=classifyObservedMarket(snapshot,{...opts,scores:{...scores,indexTrendScore:110}});
 assert.equal(r.usable,false);assert.match(r.reason,/indexTrendScore/);
});
