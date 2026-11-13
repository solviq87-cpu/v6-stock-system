'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/workbuddy-auto-update.yml'),'utf8');
const fragment=workflow.split('          script: |\n')[1]?.split('\n      - uses: actions/checkout@v4')[0];
const script=fragment?.split('\n').map(line=>line.startsWith('            ')?line.slice(12):line).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const A='a'.repeat(40),B='b'.repeat(40),REPO='solviq87-cpu/v6-stock-system';
const OWNER_PATH='V6_BO/config/repository-auto-update-owner.json';
const ownerConfig=(patch={})=>({schemaVersion:1,publisher:'github-actions',repository:REPO,branch:'dev',targetOrigin:'https://af3c7822e6aafc135.app.workbuddy.host',scope:'static-frontend-only',...patch});
const ownerFile=value=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));return {type:'file',path:OWNER_PATH,encoding:'base64',size:bytes.length,content:bytes.toString('base64')};};
const run=(patch={})=>({id:11,run_attempt:1,head_sha:A,head_branch:'dev',event:'push',path:'.github/workflows/v6-ci.yml',repository:{full_name:REPO},head_repository:{full_name:REPO},status:'completed',conclusion:'success',created_at:'2026-11-13T01:00:00Z',...patch});
const jobs=()=>['verify','verify-web'].map((name,i)=>({id:21+i,name,run_id:11,head_sha:A,status:'completed',conclusion:'success'}));
async function evaluate({heads=[A,A],runs=[run()],rows=jobs(),fail=false,ownership=ownerFile(ownerConfig()),ownerError=false}={}){
 assert.ok(script,'workflow gate script missing');const outputs={},notes=[],events=[];let reads=0,ownerReads=0;
 const github={rest:{repos:{getBranch:async()=>{events.push('head');return {data:{commit:{sha:heads[Math.min(reads++,heads.length-1)]}}};},
  getContent:async args=>{ownerReads++;events.push('owner');assert.equal(reads,2);assert.deepEqual(args,{owner:'solviq87-cpu',repo:'v6-stock-system',path:OWNER_PATH,ref:A,request:{timeout:10000}});if(ownerError)throw Error('private upstream detail');return {data:ownership};}},actions:{listWorkflowRuns:async()=>{events.push('ci');if(fail)throw Error('API unavailable');return {data:{total_count:runs.length,workflow_runs:runs}};}}},
  request:async(route,args)=>{events.push('jobs');assert.equal(args.run_id,11);assert.match(route,/attempts/);return {data:{total_count:rows.length,jobs:rows}};}};
 const core={setOutput:(key,value)=>{outputs[key]=value;},summary:{addRaw:value=>{notes.push(value);return {write:async()=>{}};}}};
 await new AsyncFunction('context','github','core',script)({repo:{owner:'solviq87-cpu',repo:'v6-stock-system'},payload:{repository:{full_name:REPO}}},github,core);
 return {outputs,notes,reads,ownerReads,events};
}
test('official independent gate selects immutable approved publisher code before checkout and secrets',async()=>{
 const r=await evaluate();assert.equal(r.outputs.approved,'true');assert.equal(r.outputs.sha,A);assert.equal(r.reads,3);
 assert.ok(workflow.indexOf('id: gate')<workflow.indexOf('uses: actions/checkout@v4'));
 assert.ok(workflow.indexOf('ref: ${{ steps.gate.outputs.sha }}')<workflow.indexOf('V6_WORKBUDDY_SHARECODE:'));
 assert.doesNotMatch(workflow,/ref:\s*dev\s*\n/);
 assert.equal(r.ownerReads,1);assert.deepEqual(r.events,['head','ci','jobs','head','owner','head']);
 assert.ok(workflow.indexOf('github.rest.repos.getContent')<workflow.indexOf('uses: actions/checkout@v4'));
 assert.ok(workflow.indexOf('github.rest.repos.getContent')<workflow.indexOf('V6_WORKBUDDY_SHARECODE:'));
 assert.ok(workflow.indexOf("if(await head()!==sha)")<workflow.indexOf('github.rest.repos.getContent'));
 assert.match(workflow,/path:ownerPath,ref:sha/);
 assert.match(workflow,/uses: actions\/checkout@v4\n\s+if: steps\.gate\.outputs\.approved == 'true'/);
 assert.match(workflow,/name: Check private deployment configuration\n\s+if: steps\.gate\.outputs\.approved == 'true'/);
 assert.match(workflow,/V6_APPROVED_PUBLISHER_SHA: \$\{\{ steps\.gate\.outputs\.sha \}\}/);
 assert.match(workflow,/run: node V6_BO\/scripts\/github-repository-auto-update\.js once "\$V6_UPDATE_CONFIG" --apply/);
 assert.doesNotMatch(workflow,/run: node V6_BO\/scripts\/repository-auto-update\.js once/);
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

test('committed ownership selects the managed task and GitHub reports inspection without asking for a secret',async()=>{
 const committed=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../config/repository-auto-update-owner.json'),'utf8'));
 assert.deepEqual(committed,ownerConfig({publisher:'managed-task'}));
 const r=await evaluate({ownership:ownerFile(committed)});
 assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);assert.equal(r.ownerReads,1);
 assert.match(r.notes.join(''),/受管云任务负责发布，GitHub只巡检/);
 assert.doesNotMatch(r.notes.join(''),/Secret|secret|尚未启用|需要.*配置/);
});

test('ownership missing, unavailable, unknown or incomplete never authorizes repository execution',async()=>{
 const missing=Object.keys(ownerConfig()).map(key=>{const value=ownerConfig();delete value[key];return value;});
 const invalid=[...missing,ownerConfig({publisher:'other'}),ownerConfig({publisher:null}),ownerConfig({publisher:'Managed-Task'}),ownerConfig({schemaVersion:2}),ownerConfig({repository:'other/project'}),ownerConfig({branch:'main'}),ownerConfig({targetOrigin:'https://other.app.workbuddy.host'}),ownerConfig({scope:'full-backend'}),ownerConfig({extra:true}),[],null];
 for(const value of invalid){
  const r=await evaluate({ownership:ownerFile(value)});
  assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);assert.match(r.notes.join(''),/publisher-ownership-unverified/);
 }
 for(const options of [{ownership:null},{ownerError:true}]){
  const r=await evaluate(options);assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);
  assert.doesNotMatch(r.notes.join(''),/private upstream detail/);
 }
});

test('ownership is bounded raw base64 UTF-8 JSON for the exact fixed file',async()=>{
 const good=ownerFile(ownerConfig()),badUtf8=Buffer.from([0xff,0xfe]);
 const invalid=[{...good,type:'symlink'},{...good,path:'other.json'},{...good,encoding:'none'},{...good,size:1025},{...good,size:0},{...good,size:good.size+1},
  {...good,content:good.content+'!'}, {...good,content:' '.repeat(2049)}, {...good,content:'!'.repeat(100)},
  {...good,size:2,content:badUtf8.toString('base64')},ownerFile('{broken'),ownerFile(' '.repeat(1025)),[good]];
 for(const ownership of invalid){const r=await evaluate({ownership});assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);}
 const newlines={...good,content:good.content.match(/.{1,60}/g).join('\n')+'\n'};
 assert.equal((await evaluate({ownership:newlines})).outputs.approved,'true');
});

test('duplicate ownership JSON keys, including escaped equivalents, cannot select a publisher',async()=>{
 const valid=JSON.stringify(ownerConfig());
 for(const duplicate of ['"publisher":"managed-task",','"publisher":"github-actions",','"\\u0070ublisher":"github-actions",','"schemaVersion":1,']){
  const r=await evaluate({ownership:ownerFile('{'+duplicate+valid.slice(1))});
  assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);assert.match(r.notes.join(''),/publisher-ownership-unverified/);
 }
 const escaped=valid.replace('"publisher"','"\\u0070ublisher"');
 assert.equal((await evaluate({ownership:ownerFile(escaped)})).outputs.approved,'true');
});

test('branch moves while ownership is fetched block checkout and SHA output',async()=>{
 const r=await evaluate({heads:[A,A,B]});
 assert.equal(r.outputs.approved,'false');assert.equal(r.outputs.sha,undefined);assert.equal(r.ownerReads,1);assert.equal(r.reads,3);
 assert.match(r.notes.join(''),/branch-moved-after-ownership/);
});

test('CI and HEAD gates complete before any ownership fetch and failures never reach ownership',async()=>{
 for(const options of [{heads:[A,B]},{runs:[run({status:'queued',conclusion:null})]},{rows:jobs().slice(0,1)}]){
  const r=await evaluate(options);assert.equal(r.outputs.approved,'false');assert.equal(r.ownerReads,0);
 }
});
