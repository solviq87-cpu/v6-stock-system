'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildSystemReadiness,PROTOCOL}=require('../src/core/system-readiness');
const now=Date.parse('2026-11-25T10:00:00+08:00');
const quote=(patch={})=>({price:10,quoteSource:'tencent',quoteAt:now-15000,receivedAt:now-100,canTrade:true,...patch});
const row=(result,id)=>result.components.find(x=>x.id===id);
test('readiness retains actual writer times, does not expose private details or create success on reads',()=>{
 const taskRows={trendScan:{ok:false,done:'fail',lastAttemptAt:now-20,lastSuccessAt:now-100,error:'secret /private/path'}};
 const input={now,version:'fixture',session:{trading:true},taskRows,risk:{lastObservedAt:now-100,lastError:'private password',accountChecks:{pool:now-10,pre:now-20},accountErrors:{pool:'private /tmp/account'}}};
 const before=structuredClone(input),a=buildSystemReadiness(input),b=buildSystemReadiness({...input,now:now+10});
 assert.equal(a.protocol,PROTOCOL);assert.equal(a.readOnly,true);assert.equal(a.canTrade,false);assert.equal(a.canNotify,false);assert.equal(a.writesAccount,false);
 assert.equal(row(a,'task/trendScan').status,'failed');assert.equal(row(a,'task/trendScan').lastSuccessAt,now-100);
 assert.equal(row(b,'task/trendScan').lastSuccessAt,now-100);assert.equal(row(a,'task/kbf').lastSuccessAt,null);
 assert.equal(row(a,'risk-observation').status,'failed');assert.equal(row(a,'risk-observation').lastSuccessAt,now-100);
 assert.doesNotMatch(JSON.stringify(a),/secret|private password|\/private\/path|\/tmp\/account/);assert.deepEqual(input,before);
 assert.ok(a.dependencies.every(d=>d.ready===false));
});
test('exact original quote age boundary, invalid reception, fake or readonly observations and closed snapshots stay distinct',()=>{
 const run=(quotes,trading=true)=>row(buildSystemReadiness({now,session:{trading},quoteRows:quotes}),'quotes');
 assert.equal(run([quote()]).status,'normal');assert.equal(run([quote()]).latestOriginalQuoteAt,now-15000);
 for(const q of [quote({quoteAt:now-15001}),quote({quoteAt:now+1}),quote({quoteAt:null}),quote({receivedAt:null}),quote({receivedAt:now+1}),quote({canTrade:false,readOnlyBackup:true}),quote({synthetic:true})]){
  const actual=run([q]);assert.equal(actual.status,'missing-data');assert.equal(actual.tradePermissionCertified,false);
 }
 const stale=run([quote({quoteAt:now-86400000})],false);assert.equal(stale.status,'historical-snapshot');assert.equal(stale.latestOriginalQuoteAt,now-86400000);
 assert.equal(run([]).status,'unverified');assert.equal(run([quote(),quote({quoteAt:null})]).coverage.universeCoverage,null);
});
test('shared worker diagnostic exposes fixed declarations without promising RSS, load or delivery',()=>{
 const worker={available:true,background:{maxWorkers:2,maxOldGenerationSizeMb:768,active:2,declaredOldGenerationSizeMb:576},
  risk:{maxWorkers:1,maxOldGenerationSizeMb:128,active:1,declaredOldGenerationSizeMb:128},jobs:[{secret:'must not escape'}]};
 const a=buildSystemReadiness({now,worker,notificationConfigured:true});
 assert.equal(row(a,'worker-budget').status,'normal');assert.equal(row(a,'worker-budget').lastSuccessAt,null);
 assert.equal(row(a,'worker-budget').productionLoadCertified,false);assert.equal(row(a,'worker-budget').processRssCertified,false);
 assert.equal(row(a,'notification').status,'unverified');assert.equal(row(a,'notification').deliveryCertified,false);
 assert.doesNotMatch(JSON.stringify(a),/must not escape/);
 worker.background.active=3;assert.equal(row(buildSystemReadiness({now,worker}),'worker-budget').status,'unverified');
});
test('replica, absent inputs, future writer times and insufficient samples cannot claim operational success',()=>{
 const r=buildSystemReadiness({now,replica:true,taskRows:{trendScan:{ok:true,done:'yield',lastAttemptAt:now+1,lastSuccessAt:now+1}},
  background:{lastResult:{status:'collected'},lastSuccessAt:now},plans:{status:'observing',lastSuccessAt:now},feedback:{status:'submitted',lastSuccessAt:now}});
 for(const id of ['risk-observation','plan-observer','history-financial','feedback'])assert.equal(row(r,id).status,'unconfigured');
 assert.equal(row(r,'task/trendScan').status,'unverified');assert.equal(row(r,'task/trendScan').lastAttemptAt,null);
});
