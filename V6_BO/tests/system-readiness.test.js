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

test('explicit source conflicts cannot certify current or closed-session observations',()=>{
 for(const flag of [{sourceConflict:true},{conflict:true},{evidenceStatus:'conflict'},{quoteStatus:'conflict'}]){
  for(const trading of [true,false]){
   const input={now,session:{trading},quoteRows:[quote(flag)]};
   const actual=row(buildSystemReadiness(input),'quotes');
   assert.equal(actual.status,'missing-data');assert.equal(actual.reasonCodes[0],'QUOTE_SOURCE_CONFLICT');
   assert.equal(actual.coverage.conflictingRows,1);assert.equal(actual.coverage.invalidOrUnknown,1);
   assert.equal(actual.coverage.recentOriginal,0);assert.equal(actual.coverage.datedHistorical,0);
   assert.equal(actual.latestOriginalQuoteAt,null);assert.equal(actual.lastSuccessAt,null);
   assert.equal(actual.tradePermissionCertified,false);
  }
 }
 const mixed=row(buildSystemReadiness({now,session:{trading:true},quoteRows:[quote(),quote({sourceConflict:true,quoteAt:now-1,receivedAt:now})]}),'quotes');
 assert.equal(mixed.status,'missing-data');assert.equal(mixed.coverage.recentOriginal,1);assert.equal(mixed.coverage.conflictingRows,1);
 assert.equal(mixed.latestOriginalQuoteAt,now-15000);assert.equal(mixed.lastSuccessAt,now-100);
});

test('a completed yielding periodic task needs its own success receipt, not an older or impossible timestamp',()=>{
 const inspect=patch=>row(buildSystemReadiness({now,taskRows:{trendScan:{ok:true,done:'yield',lastAttemptAt:now-10,lastSuccessAt:now-10,...patch}}}),'task/trendScan');
 assert.equal(inspect({}).status,'normal');
 const older=inspect({lastSuccessAt:now-100});assert.equal(older.status,'unverified');
 assert.equal(older.lastSuccessAt,now-100);assert.equal(older.reasonCodes[0],'TASK_CURRENT_SUCCESS_UNVERIFIED');
 for(const lastSuccessAt of [now-5,now+1]){
  const bad=inspect({lastSuccessAt});assert.equal(bad.status,'unverified');assert.equal(bad.lastSuccessAt,null);
  assert.equal(bad.reasonCodes[0],'TASK_RECEIPT_TIME_CONFLICT');
 }
 const missing=inspect({lastSuccessAt:null});assert.equal(missing.status,'unverified');assert.equal(missing.lastSuccessAt,null);
 const failed=inspect({ok:false,done:'fail',lastSuccessAt:now-5});assert.equal(failed.status,'failed');assert.equal(failed.lastSuccessAt,null);
 const empty=inspect({done:'empty',lastSuccessAt:now-100});assert.equal(empty.status,'missing-data');assert.equal(empty.lastSuccessAt,now-100);
 const noAttempt=inspect({lastAttemptAt:null});assert.equal(noAttempt.status,'unverified');assert.equal(noAttempt.lastSuccessAt,null);
});

test('risk health requires both original account checks to belong to the completed observation',()=>{
 const inspect=patch=>row(buildSystemReadiness({now,risk:{running:false,attemptSequence:2,completedSequence:2,lastAttemptAt:now-40,lastObservedAt:now-20,accountChecks:{pool:now-30,pre:now-25},...patch}}),'risk-observation');
 assert.equal(inspect({}).status,'normal');
 for(const checks of [{pool:now-30},{pool:now-10,pre:now-25},{pool:now-30,pre:now+1}]){
  const actual=inspect({accountChecks:checks});assert.equal(actual.status,'unverified');
  assert.equal(actual.reasonCodes[0],'RISK_ACCOUNT_RECEIPTS_UNVERIFIED');
  assert.equal(actual.lastSuccessAt,now-20);assert.equal(actual.riskSafetyCertified,false);
 }
 assert.equal(inspect({accountErrors:{pre:'private /tmp/account'}}).status,'failed');
});


test('historical completion receipts cannot certify an in-flight or mismatched current task',()=>{
 const risk={running:false,attemptSequence:3,completedSequence:3,lastAttemptAt:now-40,lastObservedAt:now-10,accountChecks:{pool:now-30,pre:now-20}};
 const plan={status:'observing',running:false,attemptSequence:2,completedSequence:2,lastAttemptAt:now-20,lastCompletedAt:now-5,lastSuccessAt:now-21};
 const a={kind:'history',code:'600000',day:'2026-11-25',at:now-50};
 const background={running:false,lastAttempt:a,lastResult:{...a,status:'collected',completedAt:now-20},lastSuccessAt:now-20};
 const attemptHash='a'.repeat(64),feedback={status:'submitted',running:false,lastAttempt:{day:'2026-11-25',recordedAt:now-30,attemptHash},lastResult:{day:'2026-11-25',attemptHash,status:'submitted',recordedAt:now-10},lastSuccessAt:now-10};
 const inspect=(key,value,id)=>row(buildSystemReadiness({now,[key]:value}),id);
 assert.equal(inspect('risk',risk,'risk-observation').status,'normal');
 for(const patch of [{running:true},{completedSequence:2},{lastAttemptAt:now-25},{attemptSequence:undefined}])assert.equal(inspect('risk',{...risk,...patch},'risk-observation').status,'unverified');
 assert.equal(inspect('plans',plan,'plan-observer').status,'normal');
 for(const patch of [{running:true},{completedSequence:1},{lastCompletedAt:now-30},{lastSuccessAt:now+1}])assert.equal(inspect('plans',{...plan,...patch},'plan-observer').status,'unverified');
 assert.equal(inspect('background',background,'history-financial').status,'normal');
 assert.equal(inspect('background',{...background,lastAttempt:{...a,at:now-5}},'history-financial').status,'unverified');
 assert.equal(inspect('background',{...background,lastSuccessAt:now-21},'history-financial').status,'unverified');
 assert.equal(inspect('feedback',feedback,'feedback').status,'normal');
 assert.equal(inspect('feedback',{...feedback,lastAttempt:{...feedback.lastAttempt,attemptHash:'b'.repeat(64)}},'feedback').status,'unverified');
 assert.equal(inspect('feedback',{...feedback,lastResult:{status:'unrecorded-next-day'}},'feedback').status,'unverified');
});
