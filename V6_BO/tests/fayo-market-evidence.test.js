'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const modulePath=path.resolve(__dirname,'../public/nova/market-evidence.js');
const api=import('data:text/javascript;base64,'+fs.readFileSync(modulePath).toString('base64'));
const now=Date.parse('2026-11-15T12:00:00Z');

function leadershipState(firstSeals=['092500','093002','094000','103000','130000'],{totalCount=firstSeals.length,day='2026-11-13'}={}){
 const {mergeLimitReviewPools}=require('../src/core/limit-review-pool');
 const receivedAt=Date.parse(day+'T15:05:00+08:00');
 const poolEvidence={source:'em',scope:'eastmoney-limit-up-pool',tradeDate:day,receivedAt};
 const eastmoneyRows=firstSeals.map((firstSeal,index)=>({src:'em',code:String(600101+index),name:'合成股票'+index,
  sector:'合成材料',tradeDate:day,sourceTradeDate:day,firstSeal,poolEvidence}));
 const cls={status:'available',complete:true,tradeDate:day,receivedAt,totalCount:2,fetchedCount:2,uniqueCount:2,
  items:[eastmoneyRows[0],eastmoneyRows[1]].map(row=>({...row,src:'cls',sector:'另一题材',receivedAt}))};
 const result=mergeLimitReviewPools({eastmoneyRows,eastmoneyMeta:{totalCount,receivedAt},cls,tradeDate:day});
 return {ztReviewPool:result.rows,ztReviewPoolMeta:result.meta};
}

test('同业带动性比较同一东方财富涨停批次的首封，财联社只核对同日收录',async()=>{
 const {sectorLeadershipEvidence}=await api;
 const state=leadershipState();
 const read=sectorLeadershipEvidence(state,now);
 const early=read({code:'600101',poolDay:'20261113',sector:'另一个候选主题'});
 assert.equal(early.status,'early-spread');
 assert.equal(early.industry,'合成材料');
 assert.equal(early.firstSeal,'09:25:00');
 assert.equal(early.peerCount,4);
 assert.equal(early.timedCount,4);
 assert.deepEqual(early.later.map(peer=>peer.firstSeal),['09:30:02','09:40:00','10:30:00','13:00:00']);
 assert.equal(early.crossListed,true);
 assert.equal(early.crossListedPeers,1);
 const after=read({code:'600102',vendorQuoteAt:Date.parse('2026-11-13T07:00:00Z')});
 assert.equal(after.status,'following');
 assert.equal(after.earlierCount,1);
 assert.equal(read({code:'600111',poolDay:'20261113'}).status,'pending');
 assert.equal(read({code:'600101',poolDay:'2026-11-12'}).status,'pending');
 assert.equal(read({code:'600101',poolDay:'20261113',tradeDate:'2026-11-12'}).status,'pending');
 state.ztReviewPool[1].clsObservation.receivedAt-=60000;
 assert.equal(sectorLeadershipEvidence(state,now)({code:'600101',poolDay:'20261113'}).crossListedPeers,0);
 const cls=state.ztReviewPoolMeta.sources.find(item=>item.source==='cls');
 cls.status='retained';
 const withoutCls=sectorLeadershipEvidence(state,now)({code:'600101',poolDay:'20261113'});
 assert.equal(withoutCls.status,'early-spread');
 assert.equal(withoutCls.crossListed,null);
});

test('带动性区分同秒、覆盖不足、旧批次及缺失时点，剔除自身和其他行业',async()=>{
 const {sectorLeadershipEvidence}=await api;
 const stock={code:'600101',poolDay:'20261113'};
 const read=state=>sectorLeadershipEvidence(state,now)(stock);
 const tied=read(leadershipState(['093000','093000','094000','100000','102000','110000']));
 assert.equal(tied.status,'tied');
 assert.equal(tied.tiedCount,1);
 assert.equal(tied.later.length,4);
 const narrow=leadershipState();
 narrow.ztReviewPool[1].sector='其他行业';
 assert.equal(read(narrow).status,'early-limited');
 assert.equal(read(narrow).peerCount,3);
 const partial=read(leadershipState(undefined,{totalCount:7}));
 assert.equal(partial.status,'pending');
 assert.equal(partial.later.length,4);
 const missing=read(leadershipState(['092500','093002','000000','120000','130000','096000']));
 assert.equal(missing.status,'pending');
 assert.equal(missing.timedCount,2);
 assert.equal(missing.peerCount,5);
 const stale=leadershipState();
 stale.ztReviewPool[1].sourceStatuses.eastmoney='retained';
 stale.ztReviewPool[2].poolEvidence={...stale.ztReviewPool[2].poolEvidence,receivedAt:stale.ztReviewPool[2].poolEvidence.receivedAt-60000};
 assert.equal(read(stale).status,'pending');
 assert.deepEqual(read(stale).later.map(peer=>peer.code),['600104','600105']);
 const duplicate=leadershipState();
 duplicate.ztReviewPool.push(duplicate.ztReviewPool[0]);
 assert.equal(read(duplicate).status,'pending');
 const future=leadershipState();
 assert.equal(sectorLeadershipEvidence(future,Date.parse('2026-11-13T10:00:00+08:00'))(stock).status,'pending');
});
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
 const review={status:'independently-verified',action:'buy',asOf:'2026-11-19',source:'v6-research',evidence:['dated-record'],
  symbol:'600519',quoteAt:ts-15000,reviewedAt:ts-500};
 const first={code:'600519',name:'当日有证据样本',score:63,quoteAt:ts-15000,vendorQuoteAt:ts-15000,
  receivedAt:ts-1000,quoteStatus:'recent-unverified',quoteSource:'eastmoney',decisionReview:review,aboveMa5:true,
  issuerEvidence:{events:[{category:'risk-clue',title:'风险公告标题（正文待核验）',publishedAt:'2026-11-18T06:00:00Z'},
   {category:'strength-clue',title:'利好标题线索',publishedAt:'2026-11-18T06:00:00Z'}]}};
 const state={trading:true,snapshotFieldDays:{dashboard:'20261119'},dashboard:{verifiedLive:true,snapshotDay:'20261119',
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
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,status:'unverified'}}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,verifiedLive:false}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,vendorQuoteAt:undefined,quoteAt:ts-1000,receivedAt:ts}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,vendorQuoteAt:undefined,quoteTimestamp:ts-1000}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,vendorQuoteAt:ts-3600000,quoteAt:ts-1000}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,receivedAt:undefined}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,receivedAt:ts+1000}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,receivedAt:ts-15001}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,quoteAt:ts-1000}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,quoteStatus:'stale'}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,quoteSource:'readOnlyBackup'}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,quoteMode:'historical-bars'}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,simulated:true}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,symbol:'000001'}}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,quoteAt:ts-1000}}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,reviewedAt:ts+1000}}]}},time:ts},
  {state:{...state,dashboard:{...state.dashboard,rows:[{...first,decisionReview:{...review,evidence:[null,'']}}]}},time:ts}
 ];
 for(const item of cases)assert.equal(projectDecisionBrief(item.state,{now:item.time}).counts.buy,0,
  'stale, future, mismatched, unknown or unverified rows must remain watch only');
 const legacy=projectDecisionBrief({...state,dashboard:{...state.dashboard,rows:[{
  ...first,vendorQuoteAt:undefined,quoteAt:ts-1000,quoteTimestamp:ts-1000,receivedAt:ts
 }]}},{now:ts});
 assert.equal(legacy.items[0].quoteAt,null,'ambiguous server time must not be displayed as original vendor time');
 assert.equal(legacy.counts.watch,1);
 // Shanghai midnight, despite being less than 15 seconds old, is not the same market day.
 const midnight=Date.parse('2026-11-19T16:00:00Z');
 const nearMidnight={...first,quoteAt:midnight-1000,vendorQuoteAt:midnight-1000,receivedAt:midnight-500,
  decisionReview:{...review,quoteAt:midnight-1000,reviewedAt:midnight-500}};
 const crossDay=projectDecisionBrief({...state,dashboard:{...state.dashboard,rows:[nearMidnight]}},{now:midnight});
 assert.equal(crossDay.counts.watch,1,'a stale wrapper day cannot promote a quote after Shanghai midnight');
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
