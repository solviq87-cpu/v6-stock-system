'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,parseRunUrl,statusCandidate,MAX_COMMITS}=require('../scripts/verify-pr-commit-statuses');
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
 assert.equal(MAX_COMMITS,32);
 assert.deepEqual(parseRunUrl('https://github.com/'+OWNER+'/'+REPO+'/actions/runs/123/attempts/1'),{run_id:123,attempt_number:1});
 assert.equal(parseRunUrl('https://github.com/other/repo/actions/runs/123/attempts/1'),null);
});
