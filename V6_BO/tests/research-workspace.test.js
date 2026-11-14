'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,native,at}=require('./helpers/research-workspace-fixtures');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-workspace-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {workspaceRoot:path.join(dir,'workspace'),observationRoot:path.join(dir,'observations')};}
test('stored review reuses real strategies, records every save stage and is idempotent without another read',async t=>{
 const options=setup(t),input={symbol:'600000',provider:'tencent',requestId:'review_test_0001',nativeEvidence:native()},read=async()=>({ok:true,result:fixture()});
 const r=await W.reviewStored(input,options,{read});assert.equal(r.ok,true);assert.equal(r.diagnostics.length,3);assert.equal(r.diagnostics.at(-1).stage,'封存研究结果');
 const reused=await W.reviewStored(input,options,{read:async()=>{throw Error('idempotent request must not read');}});assert.equal(reused.runId,r.runId);assert.equal(reused.reused,true);
 const v=W.workspaceView(options.workspaceRoot,{symbol:'600000'});assert.equal(v.runs.total,1);assert.equal(v.diagnostics[0].stages.at(-1).status,'completed');assert.equal(v.selectedRun.systems.find(x=>x.id==='python').verdict,'pass');assert.match(v.selectedRun.codeVersion.fingerprint,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>W.reviewStored({...input,provider:'eastmoney'},options,{read}),/冲突/);
});
for(const stage of ['read','analysis','save'])test('failed '+stage+' has a durable stage and preserves previous runs',async t=>{
 const options=setup(t);W.saveObservation(fixture(),options);
 const read=async()=>{if(stage==='read')throw Error('/private/path?secret=never-return');const f=fixture();if(stage==='analysis')f.stock.symbol='bad';return {ok:true,result:f};};
 if(stage==='save')t.mock.method(S,'appendEvent',function(root,kind,...args){if(kind==='analysis')throw Error('disk failure');return original(root,kind,...args);});
 const r=await W.reviewStored({symbol:'600000',provider:'tencent',requestId:'failed_review_001'},options,{read});assert.equal(r.ok,false);assert.ok(r.diagnostics.some(s=>s.status==='failed'));assert.ok(!JSON.stringify(r).includes('private/path'));
 const v=W.workspaceView(options.workspaceRoot);assert.equal(v.runs.total,1);assert.equal(v.diagnostics.at(-1).status,'failed');
});
const original=S.appendEvent;
test('all screening rows are retrievable with scope, status filters, pages and independent scan batches',t=>{
 const options=setup(t),items=Array.from({length:73},(_,i)=>({symbol:String(600000+i),quality:{usable:false,errors:['合成缺数']},score:0}));
 const saved=W.saveScreen(options.workspaceRoot,{items},'synthetic-upload');assert.equal(saved.status,'saved');
 let v=W.workspaceView(options.workspaceRoot,{offset:60,limit:20,minScore:0});assert.equal(v.screening.total,73);assert.equal(v.screening.rows.length,13);assert.equal(v.screening.rows[0].symbol,'600060');
 v=W.workspaceView(options.workspaceRoot,{symbol:'600000',status:'selected'});assert.equal(v.screening.lookupStatus,'filtered-out');
 assert.equal(W.workspaceView(options.workspaceRoot,{symbol:'601000'}).screening.lookupStatus,'not-evaluated-in-this-run');
 W.saveScreen(options.workspaceRoot,{items:items.slice(0,1)},'synthetic-second');assert.equal(W.workspaceView(options.workspaceRoot,{screenId:saved.runId}).screening.total,73);assert.equal(W.workspaceView(options.workspaceRoot).screening.total,1);
});
test('historical replay is immutable, hides later preferences/runs and never borrows current holdings',t=>{
 const options=setup(t),first=D.buildWorkspaceDecision(fixture());S.appendEvent(options.workspaceRoot,'analysis',first,{requestId:'historic_run_001',now:at(70)});
 S.appendEvent(options.workspaceRoot,'preferences',S.preferenceInput({objective:'未来的约束'}),{requestId:'historic_pref_001',now:at(71)});
 const later=D.buildWorkspaceDecision(fixture({index:71}));S.appendEvent(options.workspaceRoot,'analysis',later,{requestId:'historic_run_002',now:at(71)});
 const files=fs.readdirSync(options.workspaceRoot),v=W.workspaceView(options.workspaceRoot,{symbol:'600000',asOf:at(70)},{accounts:{private:{positions:{'600000':{shares:100}}}}});
 assert.equal(v.runs.total,1);assert.equal(v.preferences.revision,0);assert.equal(v.defense.rows.length,0);assert.equal(v.selectedRun.tradeDate,first.tradeDate);assert.deepEqual(fs.readdirSync(options.workspaceRoot),files);
 const exported=W.exportResearch(v);assert.equal(exported.mode,'research-reproducible-export');assert.ok(!JSON.stringify(exported).includes('"positions"'));assert.equal(exported.canTrade,false);
});
test('timeline and run catalogs have real totals and deterministic pagination',t=>{
 const {workspaceRoot:root}=setup(t);for(let i=0;i<26;i++){const f=D.buildWorkspaceDecision(fixture());f.asOf+=i;S.appendEvent(root,'analysis',f,{requestId:'paged_history_'+String(i).padStart(3,'0'),now:at(70)+i});}
 const v=W.workspaceView(root,{symbol:'600000',offset:20,limit:20});assert.equal(v.timelineTotal,26);assert.equal(v.timeline.length,6);assert.equal(v.runs.total,26);assert.equal(v.runs.rows.length,6);
 for(const q of [{limit:101},{offset:-1},{symbol:'../etc'},{asOf:Date.now()+1000},{runId:'bad'},{compareId:'a'.repeat(64)},{screenId:'a'.repeat(64)}])assert.throws(()=>W.workspaceView(root,q));
});
