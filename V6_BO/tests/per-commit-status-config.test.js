'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const source=()=>fs.readFileSync(path.join(root,'.github/workflows/v6-per-commit-smoke.yml'),'utf8');
test('whole forward range selected with strict cap and SHA identity',()=>{
 const s=source();
 for(const term of ["name: V6 Per-Commit Smoke","compareCommits","cmp.ahead_by>65","shas.length>(directMerge?65:32)",
 "parents[0]?.sha===before","shas.slice(0,-1).includes(parents[1].sha)",
 "incomplete-or-wrong-commit-range","context.payload.forced","fail-fast: false",
 "fromJSON(needs.select.outputs.matrix)"])assert.ok(s.includes(term),term);
 assert.match(s,/branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
 assert.match(s, /matrix: \$\{\{ fromJSON\(needs\.select\.outputs\.matrix\) \}\}/);
 assert.ok(!/\$\{(?!\{)[^}\n]+\}/.test(s),'invalid GitHub expression placeholder');
});
test('per revision test is read-only and actually checks out the exact SHA',()=>{
 const s=source().split('\n  smoke:\n')[1]?.split('\n  publish-status:\n')[0];
 assert.ok(s);
 for(const term of ["name: per-sha-","persist-credentials: false",
 "git rev-parse HEAD","node --test --test-timeout=60000",
 "market-feed-consensus.test.js","paper-order-state-machine.test.js"])assert.ok(s.includes(term),term);
 assert.ok(!s.includes("statuses: write"));
 assert.ok(!s.includes("secrets."));
});
test('privileged writer trusts only official GitHub job conclusions',()=>{
 const s=source().split('\n  publish-status:\n')[1];
 assert.ok(s);
 for(const term of ["statuses: write","listJobsForWorkflowRunAttempt",
 "matches.length===1","matches[0].conclusion==='success'","createCommitStatus",
 "context:'v6/per-commit-smoke'"])assert.ok(s.includes(term),term);
 for(const unsafe of ["actions/checkout","node --test","secrets.","execFile"])assert.ok(!s.includes(unsafe),unsafe);
});
test('original full CI and managed publisher are preserved',()=>{
 const full=fs.readFileSync(path.join(root,'.github/workflows/v6-ci.yml'),'utf8');
 assert.match(full,/^  verify:\s*$/m);
 assert.match(full,/^  verify-web:\s*$/m);
 const owner=JSON.parse(fs.readFileSync(path.join(root,'V6_BO/config/repository-auto-update-owner.json'),'utf8'));
 assert.equal(owner.publisher,'managed-task');
});

// Retain the independent negative writer cases from the integration follow-up.
test('expanded merge writer rejects failed, duplicate and incomplete official job evidence',async()=>{
 const vm=require('node:vm'),{MAX_COMMITS}=require('../scripts/verify-pr-commit-statuses');
 const blocks=[...source().matchAll(/^          script: \|\n((?:^ {12}[^\n]*\n)+)/gm)].map(m=>m[1]);
 assert.equal(blocks.length,2);
 const script=new vm.Script('(async()=>{\n'+blocks[1]+'\n})()');
 const shas=Array.from({length:MAX_COMMITS+1},(_,i)=>(i+1).toString(16).padStart(40,'0'));
 const jobs=shas.map(sha=>({name:'per-sha-'+sha,status:'completed',conclusion:'success'}));
 jobs[0].conclusion='failure';jobs.splice(1,1);jobs.push({...jobs[1]});
 const run=(writes,total)=>script.runInNewContext({context:{repo:{owner:'solviq87-cpu',repo:'v6-stock-system'},runId:123},
  process:{env:{COVERAGE_SHAS:JSON.stringify(shas),GITHUB_RUN_ATTEMPT:'1'}},
  core:{summary:{addRaw(){return this;},async write(){}}},
  github:{rest:{actions:{listJobsForWorkflowRunAttempt:async()=>({data:{total_count:total,jobs}})},repos:{createCommitStatus:async args=>writes.push(args)}}}},{timeout:1000});
 const writes=[];await assert.rejects(run(writes,jobs.length),/per-sha-smoke-failed:3/);
 assert.equal(writes.length,shas.length);assert.deepEqual(writes.filter(s=>s.state==='failure').map(s=>s.sha),shas.slice(0,3));
 const partial=[];await assert.rejects(run(partial,jobs.length+1),/job-records-not-complete/);assert.equal(partial.length,0);
});
