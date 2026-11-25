'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,MAX_COMMITS}=require('../scripts/verify-pr-commit-statuses');
const owner='solviq87-cpu',repo='v6-stock-system';
const shas=count=>Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(40,'0'));
function fixture(count,{missing,failed,missingJob,incomplete,duplicate}={}){
 const commits=shas(count),pr={number:368,commits:count,head:{sha:commits.at(-1),repo:{full_name:owner+'/'+repo}},base:{sha:'f'.repeat(40)}};
 const read=[],jobsRead=[];
 const github={rest:{pulls:{get:async()=>({data:pr}),listCommits:async({per_page})=>{
  assert.equal(per_page,100);
  const rows=commits.map(sha=>({sha}));
  if(incomplete)rows.shift();if(duplicate)rows[1]=rows[0];return {data:rows};
 }},repos:{listCommitStatusesForRef:async({ref})=>{
  read.push(ref);const index=commits.indexOf(ref);
  return {data:index===missing?[]:[{context:'v6/per-commit-smoke',state:index===failed?'failure':'success',creator:{login:'github-actions[bot]'},target_url:`https://github.com/${owner}/${repo}/actions/runs/${1000+index}/attempts/1`}]};
 }},actions:{getWorkflowRun:async()=>({data:{name:'V6 Per-Commit Smoke',head_repository:{full_name:owner+'/'+repo},status:'completed',conclusion:'success'}}),listJobsForWorkflowRunAttempt:async({run_id})=>{
  const index=run_id-1000;jobsRead.push(index);
  const jobs=[{name:'per-commit-evidence',status:'completed',conclusion:'success'}];
  if(index!==missingJob)jobs.push({name:'per-sha-'+commits[index],status:'completed',conclusion:'success'});
  return {data:{total_count:jobs.length,jobs}};
 }}}};
 return {commits,read,jobsRead,run:()=>audit({github,owner,repo,pr})};
}
test('integration PRs with 33 and 64 commits verify every exact historical SHA',async()=>{
 assert.equal(MAX_COMMITS,64);
 for(const n of [33,64]){
  const f=fixture(n),r=await f.run();
  assert.deepEqual({ok:r.ok,checked:r.checked,passed:r.passed},{ok:true,checked:n,passed:n});
  assert.deepEqual(f.read,f.commits);assert.equal(f.jobsRead.length,n);
 }
});
test('a failed, missing or unmatched historical receipt in a long PR blocks the whole PR',async()=>{
 for(const options of [{missing:0},{failed:16},{missingJob:31}]){
  const f=fixture(64,options),r=await f.run();
  assert.equal(r.ok,false);assert.equal(r.passed,63);assert.equal(r.checked,64);assert.equal(r.failures.length,1);
 }
});
test('oversized, incomplete or duplicate commit lists still fail closed',async()=>{
 const big=fixture(65);await assert.rejects(big.run(),/pr-exceeds-verified-commit-cap/);assert.deepEqual(big.read,[]);
 for(const [options,pattern] of [[{incomplete:true},/incomplete-pr-commit-page/],[{duplicate:true},/invalid-pr-commit-shas/]]){
  const f=fixture(64,options);await assert.rejects(f.run(),pattern);assert.deepEqual(f.read,[]);
 }
});
