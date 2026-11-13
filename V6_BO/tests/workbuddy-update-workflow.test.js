'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/workbuddy-auto-update.yml'),'utf8');
const fragment=workflow.split('          script: |\n')[1]?.split('\n      - uses: actions/checkout@v4')[0];
const script=fragment?.split('\n').map(line=>line.startsWith('            ')?line.slice(12):line).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const A='a'.repeat(40),B='b'.repeat(40),REPO='solviq87-cpu/v6-stock-system';
const run=(patch={})=>({id:11,run_attempt:1,head_sha:A,head_branch:'dev',event:'push',path:'.github/workflows/v6-ci.yml',repository:{full_name:REPO},head_repository:{full_name:REPO},status:'completed',conclusion:'success',created_at:'2026-11-13T01:00:00Z',...patch});
const jobs=()=>['verify','verify-web'].map((name,i)=>({id:21+i,name,run_id:11,head_sha:A,status:'completed',conclusion:'success'}));
async function evaluate({heads=[A,A],runs=[run()],rows=jobs(),fail=false}={}){
 assert.ok(script,'workflow gate script missing');const outputs={},notes=[];let reads=0;
 const github={rest:{repos:{getBranch:async()=>({data:{commit:{sha:heads[Math.min(reads++,heads.length-1)]}}})},actions:{listWorkflowRuns:async()=>{if(fail)throw Error('API unavailable');return {data:{total_count:runs.length,workflow_runs:runs}};}}},
  request:async(route,args)=>{assert.equal(args.run_id,11);assert.match(route,/attempts/);return {data:{total_count:rows.length,jobs:rows}};}};
 const core={setOutput:(key,value)=>{outputs[key]=value;},summary:{addRaw:value=>{notes.push(value);return {write:async()=>{}};}}};
 await new AsyncFunction('context','github','core',script)({repo:{owner:'solviq87-cpu',repo:'v6-stock-system'},payload:{repository:{full_name:REPO}}},github,core);
 return {outputs,notes,reads};
}
test('official independent gate selects immutable approved publisher code before checkout and secrets',async()=>{
 const r=await evaluate();assert.equal(r.outputs.approved,'true');assert.equal(r.outputs.sha,A);assert.equal(r.reads,2);
 assert.ok(workflow.indexOf('id: gate')<workflow.indexOf('uses: actions/checkout@v4'));
 assert.ok(workflow.indexOf('ref: ${{ steps.gate.outputs.sha }}')<workflow.indexOf('V6_WORKBUDDY_SHARECODE:'));
 assert.doesNotMatch(workflow,/ref:\s*dev\s*\n/);
});
test('pending or failed newest CI cannot inherit an older successful run',async()=>{
 for(const patch of [{status:'in_progress',conclusion:null},{status:'completed',conclusion:'failure'}]){
  const r=await evaluate({runs:[run({...patch,id:12,created_at:'2026-11-13T02:00:00Z'}),run()]});assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);
 }
});
test('missing skipped duplicated extra pending and wrong-SHA jobs block publication',async()=>{
 for(const rows of [jobs().slice(0,1),jobs().map((x,i)=>i?{...x,conclusion:'skipped'}:x),[...jobs(),jobs()[0]],
  [...jobs(),{id:99,name:'extra',run_id:11,head_sha:A,status:'queued',conclusion:null}],jobs().map(x=>({...x,head_sha:B}))]){
  assert.equal((await evaluate({rows})).outputs.approved,'false');
 }
});
test('a moving branch PR run wrong repository or unknown workflow does not authorize execution',async()=>{
 assert.equal((await evaluate({heads:[A,B]})).outputs.approved,'false');
 for(const patch of [{event:'pull_request'},{head_repository:{full_name:'other/project'}},{path:'.github/workflows/other.yml'},{head_sha:B}]){
  assert.equal((await evaluate({runs:[run(patch)]})).outputs.approved,'false');
 }
 await assert.rejects(()=>evaluate({fail:true}));
});
test('runner paths are initialized at step runtime rather than unavailable job-level contexts',()=>{
 assert.doesNotMatch(workflow.split('    steps:')[0],/runner\.temp/);
 assert.match(workflow,/V6_UPDATE_STATE_DIR=\$RUNNER_TEMP\/v6-repository-update/);
 assert.match(workflow,/V6_UPDATE_CONFIG=\$RUNNER_TEMP\/v6-repository-update-config\.json/);
 assert.ok(workflow.indexOf('Initialize runner-local private paths')<workflow.indexOf('Create private updater configuration'));
 assert.match(workflow,/>> "\$GITHUB_ENV"/);
});
