'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const modulePath=path.resolve(__dirname,'../public/nova/market-evidence.js');
const api=import('data:text/javascript;base64,'+fs.readFileSync(modulePath).toString('base64'));
const now=Date.parse('2026-11-15T12:00:00Z');
const candle=(date,close,volume=100)=>({date,open:close,high:close+1,low:close-1,close,volume});

test('native candles reject invalid/future sessions and prices without inventing zero volume',async()=>{
 const {normalizeCandles}=await api;
 const rows=[candle('2026-11-13',10),candle('2026-11-12',9,-1),candle('2026-11-16',11),candle('2026-02-30',9),
  {...candle('2026-11-11',8),low:9}, {...candle('2026-11-10',7),close:'7'}, {...candle('2026-11-09',6),high:NaN},candle('2026-11-13',999,9000)];
 const before=JSON.stringify(rows),result=normalizeCandles(rows,{now});
 assert.deepEqual(result,[{date:'2026-11-12',open:9,high:10,low:8,close:9,volume:null},{date:'2026-11-13',open:10,high:11,low:9,close:10,volume:100}]);
 assert.equal(JSON.stringify(rows),before,'validation never mutates provider rows');
 assert.deepEqual(normalizeCandles(null,{now}),[]);
});

test('native monthly/yearly aggregation uses original sessions and propagates missing volume',async()=>{
 const {aggregateCandles}=await api;
 const rows=[candle('2025-12-31',8,10),candle('2026-01-02',10,20),candle('2026-01-30',12,30),candle('2026-02-02',14,null),candle('2026-01-30',999,9999)];
 const month=aggregateCandles(rows,'month',{now});
 assert.deepEqual(month[1],{period:'2026-01',date:'2026-01-30',open:10,high:13,low:9,close:12,volume:50,sessions:2});
 const year=aggregateCandles(rows,'year',{now});
 assert.deepEqual(year[1],{period:'2026',date:'2026-02-02',open:10,high:15,low:9,close:14,volume:null,sessions:3});
 assert.throws(()=>aggregateCandles(rows,'week',{now}),/不支持/);
});

test('native moving averages require a full warmup and never read future sessions',async()=>{
 const {movingAverages}=await api;
 const rows=[candle('2026-11-09',10),candle('2026-11-10',20),candle('2026-11-11',30),candle('2026-11-12',40),candle('2026-11-13',50),candle('2026-11-16',999)];
 assert.deepEqual(movingAverages(rows,5,{now}).map(row=>row.value),[null,null,null,null,30]);
 assert.throws(()=>movingAverages(rows,0,{now}),/均线周期/);
 assert.deepEqual(movingAverages(rows,20,{now}).map(row=>row.value),[null,null,null,null,null]);
});

test('native evidence never turns numeric overflow into drawable market values',async()=>{
 const {aggregateCandles,movingAverages}=await api;
 const rows=['2026-11-09','2026-11-10','2026-11-11'].map(date=>({date,open:1e308,high:1e308,low:1e308,close:1e308,volume:1e308}));
 assert.equal(aggregateCandles(rows,'month',{now})[0].volume,null);
 assert.equal(movingAverages(rows,3,{now})[2].value,1e308);
});

function tracking(){return {schemaVersion:1,mode:'forward-signal-price-observation',canTrade:false,verifiedLive:false,prospectiveCertified:false,executionSimulated:false,
 asOf:'2026-11-13',cohortFingerprint:'a'.repeat(64),marketFingerprint:'b'.repeat(64),records:[{symbol:'600519',signalDate:'2026-11-06',signalId:'frozen-1',baselineClose:100,system:'fourteen',cohort:'first-capture',windows:[
 {tradingDays:1,status:'observed',targetDate:'2026-11-09',priceReturnPct:2},
 {tradingDays:5,status:'observed',targetDate:'2026-11-13',priceReturnPct:4},
 {tradingDays:20,status:'pending',targetDate:'2026-12-04',priceReturnPct:99},
 {tradingDays:60,status:'missing-or-suspended',targetDate:null,priceReturnPct:99}]}]};}

test('native tracking is bound to exact stock and protocol; bad sources never expose return numbers',async()=>{
 const {projectForwardTracking}=await api;
 const sample=tracking(),result=projectForwardTracking(sample,'600519',{now});
 assert.equal(result.state,'available');assert.equal(result.observed,2);assert.equal(result.unresolved,2);
 assert.deepEqual(result.entries[0].windows.map(row=>row.pct),[2,4,null,null]);
 assert.equal(projectForwardTracking(sample,'000001',{now}).state,'missing');
 for(const broken of [{...sample,mode:'dashboard-current-pct'},{...sample,canTrade:true},{...sample,executionSimulated:true},{...sample,asOf:'2026-11-16'},{...sample,marketFingerprint:'missing'}]){
  const invalid=projectForwardTracking(broken,'600519',{now});assert.equal(invalid.state,'invalid');assert.deepEqual(invalid.entries,[]);
 }
});

test('native tracking keeps unknown statuses unknown and deduplicates repeated frozen signals',async()=>{
 const {projectForwardTracking}=await api;
 const sample=tracking();sample.records.push(structuredClone(sample.records[0]));
 sample.records[0].windows[0].targetDate='2026-11-06';sample.records[0].windows[1].priceReturnPct=-100;
 const result=projectForwardTracking(sample,'600519',{now});
 assert.equal(result.totalSignals,1);assert.equal(result.observed,0);
 assert.deepEqual(result.entries[0].windows.map(row=>row.pct),[null,null,null,null]);
 assert.equal(result.entries[0].windows[0].state,'unknown');assert.equal(result.entries[0].windows[1].state,'unknown');
});

test('decision brief accepts only exact original time and explicit independently verified research labels',async()=>{
 const {projectDecisionBrief}=await api;
 const ts=Date.parse('2026-11-19T05:00:00Z');
 const review={status:'independently-verified',action:'buy',asOf:'2026-11-19',source:'v6-research',evidence:['dated-record']};
 const first={code:'600519',name:'当日有证据样本',score:63,quoteAt:ts-15000,quoteSource:'eastmoney',decisionReview:review,aboveMa5:true,
  issuerEvidence:{events:[{category:'risk-clue',title:'风险公告标题（正文待核验）',publishedAt:'2026-11-18T06:00:00Z'},
   {category:'strength-clue',title:'利好标题线索',publishedAt:'2026-11-18T06:00:00Z'}]}};
 const state={trading:true,snapshotFieldDays:{dashboard:'20261119'},dashboard:{snapshotDay:'20261119',
  rows:[first,{code:'600519',name:'同股重复行'},null,
   {code:'000001',name:'未来报价',score:NaN,quoteAt:ts+3000,action:'sell'}]}};
 const value=projectDecisionBrief(state,{now:ts});
 assert.equal(value.total,2);assert.deepEqual(value.counts,{buy:1,watch:1,sell:0});
 assert.equal(value.items[0].quoteAt,first.quoteAt);
 assert.match(value.items[0].positives.join('；'),/利好标题线索/);
 assert.match(value.items[0].risks.join('；'),/风险公告标题/);
 assert.equal(value.items[1].score,null);
 assert.match(value.items[1].quoteStatus,/异常时点/);
 const cases=[
  {state:{...state,trading:false},time:ts},
  {state:{...state,snapshotFieldDays:{dashboard:'20261118'}},time:ts},
  {state,time:ts+1},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,poolDay:'20261118'}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,vendorQuoteAt:NaN}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,status:'unverified'}}]}},time:ts}
 ];
 for(const item of cases)assert.equal(projectDecisionBrief(item.state,{now:item.time}).counts.buy,0,
  'stale, future, mismatched, unknown or unverified rows must remain watch only');
 assert.equal(first.quoteAt,ts-15000,'the source object and timestamps stay untouched');
});

test('decision brief does not fabricate risk-free results, market breadth or buy calls from score alone',async()=>{
 const {projectDecisionBrief}=await api,ts=Date.parse('2026-11-19T05:00:00Z');
 assert.deepEqual(projectDecisionBrief({trading:true,dashboard:{rows:[]}},{now:ts}).counts,{buy:0,watch:0,sell:0});
 const sample={trading:true,dashboard:{snapshotDay:'20261119',rows:[
  {code:'600001',name:'高评分但缺核验',score:95,quoteAt:ts-1000,quoteSource:'eastmoney',
   action:'buy',aboveMa5:true,mainInflow:888888888,issuerEvidence:{events:[null,{category:'strength-clue',title:'无时间不能使用'}]}}
 ]}};
 const result=projectDecisionBrief(sample,{now:ts});
 assert.deepEqual(result.counts,{buy:0,watch:1,sell:0});
 assert.match(result.items[0].risks.join('；'),/零风险/);
 assert.doesNotMatch(result.items[0].positives.join('；'),/资金流入|无时间不能使用/);
 assert.equal(result.items[0].score,95);
 assert.equal(result.marketDay,'2026-11-19');
});
