'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFeedbackRunStore,createDecisionFeedbackRuntime,MIN_GAP,MAX_RUNS}=require('../src/server/decision-feedback-runtime');
const day='2026-11-23',at=clock=>Date.parse(day+'T'+clock+'+08:00');
function fixture(t,options={}){
  const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'fayo-feedback-runtime-')),'private');
  t.after(()=>fs.rmSync(path.dirname(root),{recursive:true,force:true}));
  let now=at('16:10:00'),primary=true,enabled=true,report,submitResult={ok:true,result:{candidateId:'candidate-real-reference',status:'待人工审批'}};
  const calls={read:[],submit:[]},clock=()=>now,permitted=()=>primary&&enabled;
  const store=createFeedbackRunStore({root,clock,canWrite:permitted});
  const makeReport=()=>({ok:true,result:{authority:'fayo-intelligence-research',day,feedback:{archiveRevision:8,
    proposalFingerprint:'a'.repeat(64),validationBridge:{ready:true,missing:[]},archivedCandidates:[]}}});
  report=makeReport();
  const deps={clock,isPrimary:()=>primary,enabled:()=>enabled,
    session:time=>({day:'20261123',minute:new Date(time+28800000).getUTCHours()*60+new Date(time+28800000).getUTCMinutes()}),
    calendar:{isOpen:value=>value===day},store,
    readResearch:async input=>{calls.read.push(input);if(options.onRead)await options.onRead();return report;},
    submit:async(input,{authorize})=>{calls.submit.push({input,authorized:authorize()});if(options.onSubmit)await options.onSubmit(authorize);return submitResult;}};
  return {root,store,calls,create:()=>createDecisionFeedbackRuntime(deps),report:()=>report,setReport:value=>{report=value;},makeReport,
    set:value=>{if(value.now!==undefined)now=value.now;if(value.primary!==undefined)primary=value.primary;if(value.enabled!==undefined)enabled=value.enabled;},
    now:()=>now,setSubmit:value=>{submitResult=value;}};
}
test('read-only status and closed market gates do not create files or consume a validation attempt',async t=>{
  const x=fixture(t),runtime=x.create();assert.equal(runtime.status().automaticApproval,false);assert.equal(fs.existsSync(x.root),false);
  x.set({now:at('15:59:59')});assert.equal((await runtime.tick()).status,'waiting-close');
  x.set({now:at('16:10:00'),primary:false});assert.equal((await runtime.tick()).status,'disabled-or-replica');
  assert.equal(x.calls.read.length,0);assert.equal(fs.existsSync(x.root),false);
});
test('the ready server proposal is submitted only to original validation with a fresh authorization callback',async t=>{
  const x=fixture(t),result=await x.create().tick();
  assert.equal(result.status,'submitted');assert.equal(result.lastResult.validationStatus,'待人工审批');
  assert.deepEqual(x.calls.submit[0],{input:{day,now:x.now(),revision:8,proposalFingerprint:'a'.repeat(64)},authorized:true});
  assert.equal(result.automaticApproval,false);assert.equal(result.productionWeightsChanged,false);assert.equal(result.canTrade,false);
  assert.equal(x.store.read().attempts.length,1);assert.equal(x.store.read().results.length,1);
});
test('restart preserves quota and a previously validated proposal cannot consume the same window again',async t=>{
  const x=fixture(t);await x.create().tick();
  assert.equal((await x.create().tick()).status,'backoff');assert.equal(x.calls.read.length,1);
  x.set({now:x.now()+MIN_GAP});assert.equal((await x.create().tick()).status,'duplicate-proposal');
  assert.equal(x.calls.submit.length,1);assert.equal(x.store.read().attempts.length,2);
});
test('missing evidence and pending manual approval retain truthful receipts without sending weights or approvals',async t=>{
  const x=fixture(t),report=x.report();report.result.feedback.validationBridge={ready:false,missing:['缺成熟真实结算']};
  const first=await x.create().tick();assert.equal(first.status,'insufficient-evidence');assert.match(first.missing[0],/真实结算/);
  x.set({now:x.now()+MIN_GAP});x.setReport(x.makeReport());x.report().result.feedback.archivedCandidates=[{id:'awaiting',status:'待人工审批'}];
  const second=await x.create().tick();assert.equal(second.status,'awaiting-approval');assert.equal(second.lastResult.candidateId,'awaiting');
  assert.equal(x.calls.submit.length,0);
});
test('role revocation across an awaited archive read stops submission and keeps the durable attempt reserved',async t=>{
  let x;x=fixture(t,{onRead:async()=>x.set({primary:false})});
  const result=await x.create().tick();assert.equal(result.status,'disabled-or-replica');assert.equal(x.calls.submit.length,0);
  x.set({primary:true});assert.equal(x.store.read().attempts.length,1);assert.equal(x.store.read().results.length,0);
  assert.equal((await x.create().tick()).status,'backoff');
});
test('transient workspace contention can retry after persistent backoff without being misreported as validation failure',async t=>{
  const x=fixture(t);x.setSubmit({ok:false,httpStatus:503,error:'原档案忙'});
  assert.equal((await x.create().tick()).status,'unavailable');
  x.set({now:x.now()+MIN_GAP});x.setSubmit({ok:true,result:{candidateId:'after-busy',status:'验证未通过'}});
  const result=await x.create().tick();assert.equal(result.status,'submitted');assert.equal(result.lastResult.validationStatus,'验证未通过');
  assert.equal(x.calls.submit.length,2);assert.equal(result.automaticApproval,false);
});
test('persistent daily cap and damaged receipts fail closed across new runtime instances',async t=>{
  const x=fixture(t);x.report().result.feedback.validationBridge={ready:false,missing:['缺样本']};
  for(let i=0;i<MAX_RUNS;i++){await x.create().tick();x.set({now:x.now()+MIN_GAP});}
  assert.equal((await x.create().tick()).status,'daily-limit');assert.equal(x.calls.read.length,MAX_RUNS);
  const file=path.join(x.root,'runs',day,'000001.json');fs.writeFileSync(file,'{}');
  assert.throws(()=>x.store.read(),/校验/);assert.equal((await x.create().tick()).status,'unavailable');
  assert.equal(x.calls.submit.length,0);
});
