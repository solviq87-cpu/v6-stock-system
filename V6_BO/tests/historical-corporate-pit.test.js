'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateDataset,runValidatedBacktest}=require('../src/core/historical-validation');
const days=Array.from({length:41},(_,i)=>
 new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
function history(omitDate){
 const dates=days.filter(d=>d!==omitDate).slice(0,40);
 return {source:'imported',provider:'test-research',datasetId:'historical-pit-test',
  asOf:dates.at(-1),stocks:[{symbol:'600000',bars:dates.map(date=>({
   date,open:10,high:11,low:9,close:10,volume:10000}))}]};
}
function event(overrides={}){
 return {eventId:'pit-1',actionId:'corp-1',sourceRecordId:'source-1',
  symbol:'600000',kind:'cash-dividend',source:'imported',
  provider:'operator-fixture',effectiveDate:'2026-02-03',
  publishedAt:'2026-02-02T15:00:00+08:00',
  expectedQuantity:100,expectedCostBasis:1000,cashDelta:10,
  shareDelta:0,basisDelta:0,...overrides};
}
test('explicitly published pre-open company action remains eligible for historic dataset research',()=>{
 const data=history();data.settlements=[event()];
 assert.equal(validateDataset(data).stocks,1);
 const atOpen=history();
 atOpen.settlements=[event({publishedAt:'2026-02-03T09:30:00+08:00'})];
 assert.equal(validateDataset(atOpen).stocks,1);
});
test('after-open and post-effective publication cannot be backfilled into old returns',()=>{
 for(const timestamp of ['2026-02-03T09:30:01+08:00','2026-02-04T12:00:00+08:00']){
  const data=history();
  data.settlements=[event({publishedAt:timestamp})];
  assert.throws(()=>validateDataset(data),/尚未公布|前视/);
  assert.throws(()=>runValidatedBacktest(data),/尚未公布|前视/);
 }
});
test('imported settlement must have an actual daily session to avoid silently skipping cash or shares',()=>{
 const data=history('2026-02-03');
 data.settlements=[event()];
 assert.equal(data.stocks[0].bars.some(b=>b.date==='2026-02-03'),false);
 assert.throws(()=>validateDataset(data),/生效日缺少导入交易日K/);
});
test('event outside imported history cannot be smuggled in by asOf metadata',()=>{
 const data=history();
 data.asOf='2026-02-20';data.settlements=[event({
  effectiveDate:'2026-02-15',publishedAt:'2026-02-14T12:00:00+08:00'
 })];
 assert.throws(()=>validateDataset(data),/生效日缺少导入交易日K/);
});
test('cash records with impossible source chronology remain invalid instead of getting silent research entitlement',()=>{
 const data=history();
 data.settlements=[event({publishedAt:'2099-02-02T15:00:00+08:00'})];
 assert.throws(()=>validateDataset(data),/已知证据|尚未公布|前视/);
});
