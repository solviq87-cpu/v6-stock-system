'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dashboardView}=require('../src/core/dashboard-view');
const now=Date.parse('2026-11-12T06:00:00Z');
function project({signals=[{code:'000001',type:'趋势票',ts:now-60000,price:9}],pool=[{code:'000001',price:10,quoteAt:now-1000,quoteSource:'tencent'}],logs=[],pushLast=null}={}){
 return dashboardView({stocksAt:now,candidatePool:pool,signals},null,now,{pushLog:logs,pushLast}).pushes.items[0];
}
const log=(ts,status,signalAt=now-60000)=>({ts,status,extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts:signalAt}]}});
test('old delivery and future delivery cannot acknowledge a new signal',()=>{
 for(const ts of [now-120000,now+1000])assert.equal(project({logs:[log(ts,'✅ 已送达')]}).stage,'triggered');
});
test('unknown delivery remains pending, and unrelated global receipt cannot acknowledge this stock',()=>{
 assert.equal(project({logs:[log(now-30000,'⚠️ 送达结果未知(私密)')]}).stage,'pending');
 assert.equal(project({pushLast:{sent:null,t:now,why:'another stock'}}).stage,'triggered');
});
test('current quote price and timestamp come from the same row',()=>{
 const item=project();assert.equal(item.price,10);assert.equal(item.quoteAt,now-1000);assert.equal(item.quoteSource,'tencent');
});
test('missing quote provenance is never filled from state reception time or signal trigger time',()=>{
 const item=project({pool:[]});assert.equal(item.price,9);assert.equal(item.quoteAt,null);assert.equal(item.quoteSource,'');
});
test('independent strategies are preserved in history and do not inflate repeat count',()=>{
 const item=project({signals:[{code:'000001',type:'趋势票',ts:now-60000},{code:'000001',type:'大单流入',ts:now-30000}]});
 assert.equal(item.duplicateSignalCount,0);assert.equal(item.signalHistory.length,2);
 assert.deepEqual(new Set(item.signalHistory.map(x=>x.triggerStrategy)),new Set(['趋势票','大单流入']));
});
test('delivery failure does not invalidate a recent market signal',()=>{
 const item=project({logs:[log(now-30000,'❌ 未送达')]});assert.equal(item.stage,'failed');assert.notEqual(item.signalValidity,'invalid');
});
test('old delivered signal is no longer active even when current candidate quote exists',()=>{
 const item=project({signals:[{code:'000001',type:'趋势票',ts:now-86400000}],logs:[log(now-86000000,'✅ 已送达',now-86400000)]});
 assert.equal(item.stage,'sent');assert.equal(item.signalValidity,'invalid');
});
test('missing or future signal time cannot establish active validity or delivery',()=>{
 for(const ts of [null,now+1000]){const item=project({signals:[{code:'000001',type:'趋势票',ts}],logs:[log(now,'✅ 已送达')]});assert.equal(item.signalValidity,'unknown');assert.notEqual(item.stage,'sent');}
});

test('same-code receipt for another strategy or legacy uncorrelated log stays history only',()=>{
 for(const record of [{ts:now,status:'✅ 已送达',extra:{codes:['000001']}},{...log(now,'✅ 已送达'),extra:{codes:['000001'],signalRefs:[{code:'000001',type:'大单流入',ts:now-60000}]}}]){
  const item=project({logs:[record]});assert.equal(item.stage,'triggered');assert.equal(item.pushHistory.length,1);
 }
});
test('candidate quote without provider time stays unknown despite current state timestamp',()=>{
 const item=project({signals:[],pool:[{code:'000001',price:10}]});assert.equal(item.quoteAt,null);
});
test('real batch sender persists exact signal references only for included rows, without external delivery',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const serverPath=require.resolve('../server.js'),src=fs.readFileSync(serverPath,'utf8');
 const productionRequire=require('node:module').createRequire(serverPath);
 const first={code:'000001',type:'趋势票',ts:now-60000},omitted={code:'000002',type:'大单流入',ts:now-50000};
 const originalRow={...first,name:'正常股票',price:9,quoteAt:first.ts-1000,receivedAt:first.ts,
  quoteSource:'vendor-original',quoteMode:'public-live-unverified',canNotify:true,volume:10000,amount:90000};
 const logs=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context={Date:Clock,require:productionRequire,INTRADAY:{buf:new Map([['first',originalRow],['omitted',omitted]]),parts:[],firstAt:now-60000},
  INTRADAY_MAX_ITEMS:1,ALERT_RANK:{},alertScore:()=>0,buildAlertsReport:()=> '000001',
  redactSecrets:x=>x,extractStockCodes:()=>['000001'],inManualPush:()=>false,isReplica:()=>true,
  pushLog:(status,title,data)=>logs.push({ts:now,status,title,...data}),console:{log(){}},sseSendEdit(){},_pushLast:null};
 vm.createContext(context);
 for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','freezeRecommendationRows',
  'recommendationSendOptions','prepareRecommendationDelivery','pushAll','flushIntraday']){
  const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}\n',start)+2;
  assert.ok(start>=0&&end>start);vm.runInContext(src.slice(start,end),context);
 }
 context.flushIntraday();
 assert.equal(logs.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(logs[0].extra.signalRefs)),[first]);
 assert.equal(context.INTRADAY.buf.size,0);
 assert.equal(project({logs}).stage,'failed');
});
