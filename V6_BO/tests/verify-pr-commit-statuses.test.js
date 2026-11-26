'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,auditUntilReady,parseRunUrl,statusCandidate,MAX_COMMITS}=require('../scripts/verify-pr-commit-statuses');
const A='a'.repeat(40),B='b'.repeat(40),OWNER='solviq87-cpu',REPO='v6-stock-system';
const base={number:101,head:{sha:B},base:{sha:'c'.repeat(40)}};
function mock({badStatus=false,badActor=false,runFailure=false,wrongHead=false,invalidRunUrl=false,statusesMissing=false,incomplete=false,commits=[A,B]}={}){
 const pr={...base,head:{sha:wrongHead?A:B},commits:commits.length,base:{sha:base.base.sha}};
 const calls=[];
 const github={rest:{
 pulls:{
  get:async()=>({data:{...pr,head:{...pr.head,repo:{full_name:OWNER+'/'+REPO}}}}),
  listCommits:async()=>({data:incomplete?commits.slice(0,-1).map(sha=>({sha})):commits.map(sha=>({sha}))})
 },
 repos:{
  listCommitStatusesForRef:async({ref})=>{calls.push(ref);return {data:statusesMissing?[]:[{
   context:'v6/per-commit-smoke',state:badStatus&&ref===B?'failure':'success',
   creator:{login:badActor?'fake-bot':'github-actions[bot]'},
   target_url:invalidRunUrl?'https://evil.invalid':'https://github.com/'+OWNER+'/'+REPO+'/actions/runs/123/attempts/1'
  }]};}
 },
 actions:{
  getWorkflowRun:async()=>({data:{name:'V6 Per-Commit Smoke',status:'completed',conclusion:runFailure?'failure':'success',head_repository:{full_name:OWNER+'/'+REPO}}}),
  listJobsForWorkflowRunAttempt:async()=>({data:{total_count:3,jobs:[
   {name:'per-sha-'+A,status:'completed',conclusion:'success'},
   {name:'per-sha-'+B,status:'completed',conclusion:'success'},
   {name:'per-commit-evidence',status:'completed',conclusion:'success'}
  ]}})
 }
 }};
 return {github,pr, calls};
}
test('two actual PR commits require two exact official successful jobs',async()=>{
 const t=mock();const x=await audit({github:t.github,owner:OWNER,repo:REPO,pr:base});
 assert.deepEqual({ok:x.ok,checked:x.checked,passed:x.passed},{ok:true,checked:2,passed:2});
 assert.deepEqual(t.calls,[A,B]);
});
test('missing or failed newest status is not masked by older success',async()=>{
 const t=mock({badStatus:true});
 const x=await audit({github:t.github,owner:OWNER,repo:REPO,pr:base});
 assert.equal(x.ok,false);assert.equal(x.passed,1);
 assert.deepEqual(statusCandidate([{context:'v6/per-commit-smoke',state:'failure'},{context:'v6/per-commit-smoke',state:'success'}]).state,'failure');
});
test('nonofficial status author or forged job link fails closed',async()=>{
 for(const opt of [{badActor:true},{invalidRunUrl:true},{runFailure:true},{statusesMissing:true}]){
  const t=mock(opt),x=await audit({github:t.github,owner:OWNER,repo:REPO,pr:base});
  assert.equal(x.ok,false,JSON.stringify(opt));
 }
});
test('PR moved since event and incomplete commit list are rejected',async()=>{
 const t=mock({wrongHead:true});
 await assert.rejects(audit({github:t.github,owner:OWNER,repo:REPO,pr:base}),/pr-head-or-base-changed/);
 const m=mock({incomplete:true});
 await assert.rejects(audit({github:m.github,owner:OWNER,repo:REPO,pr:base}),/incomplete-pr-commit-page/);
});
test('safety bounds and URL identity are strict',()=>{
 assert.equal(MAX_COMMITS,64);
 assert.deepEqual(parseRunUrl('https://github.com/'+OWNER+'/'+REPO+'/actions/runs/123/attempts/1'),{run_id:123,attempt_number:1});
 assert.equal(parseRunUrl('https://github.com/other/repo/actions/runs/123/attempts/1'),null);
});

test('coverage waits for concurrent smoke publication and terminal official success',async()=>{
 const t=mock();let phase=0;
 const readStatuses=t.github.rest.repos.listCommitStatusesForRef;
 t.github.rest.repos.listCommitStatusesForRef=async args=>{
  if(phase===0)return {data:[]};
  const response=await readStatuses(args);
  if(phase===1)response.data[0].state='pending';
  return response;
 };
 const readRun=t.github.rest.actions.getWorkflowRun;
 t.github.rest.actions.getWorkflowRun=async args=>{
  const response=await readRun(args);
  if(phase===2)Object.assign(response.data,{status:'in_progress',conclusion:null});
  return response;
 };
 const waits=[];
 const result=await auditUntilReady({github:t.github,owner:OWNER,repo:REPO,pr:base,
  wait:async ms=>{waits.push(ms);phase++;}});
 assert.equal(result.ok,true);assert.equal(result.attempts,4);
 assert.deepEqual(waits,[15000,15000,15000]);
});

test('failed or untrusted evidence fails immediately without waiting for an older success',async()=>{
 for(const options of [{badStatus:true},{badActor:true},{invalidRunUrl:true},{runFailure:true},{invalidRunUrl:true,pendingStatus:true}]){
  const t=mock(options);
  if(options.pendingStatus){const read=t.github.rest.repos.listCommitStatusesForRef;t.github.rest.repos.listCommitStatusesForRef=async args=>{const response=await read(args);response.data[0].state='pending';return response;};}
  const result=await auditUntilReady({github:t.github,owner:OWNER,repo:REPO,pr:base,
   wait:()=>assert.fail('terminal or invalid evidence must not be retried')});
  assert.equal(result.ok,false);assert.equal(result.attempts,1);
 }
});

test('missing smoke evidence exhausts its bounded wait and never passes',async()=>{
 const t=mock({statusesMissing:true});let waits=0;
 const result=await auditUntilReady({github:t.github,owner:OWNER,repo:REPO,pr:base,maxAttempts:2,
  wait:async()=>{waits++;}});
 assert.equal(result.ok,false);assert.equal(result.timedOut,true);
 assert.equal(result.attempts,2);assert.equal(waits,1);
 for(const maxAttempts of [0,22,Infinity])await assert.rejects(
  auditUntilReady({github:t.github,owner:OWNER,repo:REPO,pr:base,maxAttempts}),/invalid-coverage-attempt-limit/);
});

test('a changed PR head during polling or successful final read cannot inherit old evidence',async()=>{
 const pending=mock({statusesMissing:true}),pendingGet=pending.github.rest.pulls.get;let moved=false;
 pending.github.rest.pulls.get=async args=>{
  const response=await pendingGet(args);if(moved)response.data.head.sha=A;return response;
 };
 await assert.rejects(auditUntilReady({github:pending.github,owner:OWNER,repo:REPO,pr:base,
  wait:async()=>{moved=true;}}),/pr-head-or-base-changed/);
 const success=mock(),successGet=success.github.rest.pulls.get;let reads=0;
 success.github.rest.pulls.get=async args=>{
  const response=await successGet(args);if(++reads===2)response.data.base.sha=A;return response;
 };
 await assert.rejects(auditUntilReady({github:success.github,owner:OWNER,repo:REPO,pr:base}),/pr-head-or-base-changed/);
});
