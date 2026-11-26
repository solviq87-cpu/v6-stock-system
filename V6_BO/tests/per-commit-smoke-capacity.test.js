'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {MAX_COMMITS}=require('../scripts/verify-pr-commit-statuses');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/v6-per-commit-smoke.yml'),'utf8');
// Exercise the actual two embedded GitHub scripts with isolated mocked APIs.
// There is no network, real status write, or test-only copy of the selector.
const blocks=[...workflow.matchAll(/^          script: \|\n((?:^ {12}[^\n]*\n)+)/gm)].map(m=>m[1]);
assert.equal(blocks.length,2);
const scripts=blocks.map(s=>new vm.Script('(async()=>{\n'+s+'\n})()'));
const repo={owner:'solviq87-cpu',repo:'v6-stock-system'},before='a'.repeat(40);
const sha=n=>n.toString(16).padStart(40,'0');
const range=n=>Array.from({length:n},(_,i)=>sha(i+1));
const summary={addRaw(){return this;},async write(){}};
async function select(shas,{cmp={},forced=false,created=false,after=shas.at(-1)}={}){
 const outputs={};
 const context={repo,sha:after,payload:{before,after,forced,created}};
 const github={rest:{repos:{compareCommits:async args=>{
  assert.equal(args.base,before);assert.equal(args.head,after);assert.equal(args.per_page,100);assert.equal(args.page,1);
  return {data:{status:'ahead',ahead_by:shas.length,commits:shas.map(sha=>({sha})),...cmp}};
 }}}};
 await scripts[0].runInNewContext({context,github,core:{summary,setOutput:(k,v)=>outputs[k]=JSON.parse(v)}});
 return outputs;
}
async function publish(shas,{jobs=shas.map(sha=>({name:'per-sha-'+sha,status:'completed',conclusion:'success'})),total=jobs.length,writes=[]}={}){
 const github={rest:{actions:{listJobsForWorkflowRunAttempt:async args=>{
  assert.equal(args.per_page,100);assert.equal(args.page,1);assert.equal(args.attempt_number,1);return {data:{total_count:total,jobs}};
 }},repos:{createCommitStatus:async value=>writes.push(value)}}};
 await scripts[1].runInNewContext({context:{repo,runId:123},github,core:{summary},process:{env:{COVERAGE_SHAS:JSON.stringify(shas),GITHUB_RUN_ATTEMPT:'1'}}});
 return writes;
}
test('merged 57-commit integration and maximum 64-commit PR plus merge retain every exact SHA',async()=>{
 for(const n of [1,32,58,MAX_COMMITS+1]){
  const shas=range(n),selected=await select(shas);assert.deepEqual(selected.shas,shas);assert.deepEqual(selected.matrix.include,shas.map(sha=>({sha})));
  const statuses=await publish(shas);assert.deepEqual(statuses.map(s=>s.sha),shas);assert.ok(statuses.every(s=>s.state==='success'&&s.context==='v6/per-commit-smoke'));
 }
});
test('oversize, incomplete, forced, diverged and duplicate forward ranges still fail closed',async()=>{
 const shas=range(MAX_COMMITS+1);
 await assert.rejects(select(range(MAX_COMMITS+2)),/over-.*commit-push/);
 await assert.rejects(select(shas,{cmp:{ahead_by:shas.length+1}}),/over-.*commit-push|incomplete/);
 await assert.rejects(select(shas,{cmp:{commits:shas.slice(1).map(sha=>({sha}))}}),/incomplete/);
 await assert.rejects(select(shas,{cmp:{status:'diverged'}}),/nonforward/);
 await assert.rejects(select(shas,{forced:true}),/unsafe-or-forced/);
 await assert.rejects(select([sha(1),sha(1),sha(2)]),/invalid-sha-matrix/);
 assert.deepEqual((await select(shas,{created:true})).shas,[shas.at(-1)]);
});
test('expanded writer does not certify a missing, duplicate or failed job, and rejects oversized targets',async()=>{
 const shas=range(MAX_COMMITS+1),jobs=shas.map(sha=>({name:'per-sha-'+sha,status:'completed',conclusion:'success'}));
 const writes=[];
 jobs[0].conclusion='failure';jobs.splice(1,1);jobs.push({...jobs[1]});
 await assert.rejects(publish(shas,{jobs,writes}),/per-sha-smoke-failed:3/);
 assert.equal(writes.length,shas.length);assert.deepEqual(writes.filter(s=>s.state==='failure').map(s=>s.sha),shas.slice(0,3));
 await assert.rejects(publish(range(MAX_COMMITS+2)),/invalid-coverage-targets/);
 const partial=[];await assert.rejects(publish(shas,{jobs,total:jobs.length+1,writes:partial}),/job-records-not-complete/);assert.equal(partial.length,0);
});
