'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../src/core/research-workspace'),D=require('../src/core/research-workspace-decision'),S=require('../src/core/research-workspace-store');
const {fixture,at}=require('./helpers/research-workspace-fixtures'),{evidence}=require('./helpers/market-linkage-evidence-fixtures');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-linkage-integration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {workspaceRoot:path.join(root,'workspace'),observationRoot:path.join(root,'observations')};}
test('existing explicit review freezes linkage evidence and original strategy outputs stay identical',async t=>{
 const options=setup(t),raw=evidence(),base=D.buildWorkspaceDecision(fixture()),result=await W.reviewStored({symbol:'600000',provider:'tencent',requestId:'linkage_review_fixture',nativeEvidence:{marketLinkageEvidence:raw}},options,{read:async()=>({ok:true,result:fixture()})});
 assert.equal(result.ok,true);const view=W.workspaceView(options.workspaceRoot,{runId:result.runId});
 assert.equal(view.marketLinkage.symbol,'600000');assert.equal(view.marketLinkage.boards.length,3);
 assert.equal(view.marketLinkage.attribution.status,'method-compatible-unverified');
 assert.equal(view.marketLinkage.attribution.knownContribution,0);assert.equal(view.marketLinkage.attribution.residualPoints,0);
 assert.deepEqual(view.selectedRun.systems,base.systems);assert.deepEqual(view.selectedRun.conditions,base.conditions);
 assert.equal(view.canTrade,false);assert.equal(view.canNotify,false);assert.equal(view.marketLinkage.verified,false);
 raw.stocks[0].return=100;assert.equal(W.workspaceView(options.workspaceRoot,{runId:result.runId}).marketLinkage.boards[0].members[0].return,.03);
 assert.deepEqual(W.exportResearch(view).marketLinkage,view.marketLinkage);
});
test('selected version and replay keep original contribution when later input changes',t=>{
 const options=setup(t),old=D.buildWorkspaceDecision(fixture(),{marketLinkageEvidence:evidence()}),saved=S.appendEvent(options.workspaceRoot,'analysis',old,{requestId:'linkage_old_version',now:at(70)});
 const newer=evidence({index:71});newer.stocks[0].return=.5;newer.benchmark.return=.047;
 S.appendEvent(options.workspaceRoot,'analysis',D.buildWorkspaceDecision(fixture({index:71}),{marketLinkageEvidence:newer}),{requestId:'linkage_new_version',now:at(71)});
 const original=W.workspaceView(options.workspaceRoot,{runId:saved.hash}),replay=W.workspaceView(options.workspaceRoot,{symbol:'600000',asOf:at(70)});
 assert.equal(original.marketLinkage.attribution.knownContribution,0);assert.equal(replay.marketLinkage.attribution.knownContribution,0);
 assert.equal(W.workspaceView(options.workspaceRoot).marketLinkage.attribution.knownContribution,.047);
 assert.equal(W.exportResearch(original).run.id,saved.hash);
});
test('future or arbitrary fields cannot be archived as accepted linkage evidence',async t=>{
 const options=setup(t);
 for(const mutate of [e=>e.stocks[0].knownAt=at(71),e=>e.token='must-never-survive',e=>e.symbol='600001']){
  const bad=evidence();mutate(bad);assert.throws(()=>D.buildWorkspaceDecision(fixture(),{marketLinkageEvidence:bad}),/联动证据/);
 }
 const bad=evidence();bad.stocks[0].knownAt=at(71);
 const result=await W.reviewStored({symbol:'600000',provider:'tencent',requestId:'linkage_invalid_import',nativeEvidence:{marketLinkageEvidence:bad}},options,{read:async()=>({ok:true,result:fixture()})});
 assert.equal(result.ok,false);assert.equal(W.workspaceView(options.workspaceRoot).runs.total,0);
});
test('ordinary old archive and empty workspace expose explicit unknown without new writes',t=>{
 const options=setup(t);let view=W.workspaceView(options.workspaceRoot);assert.equal(view.marketLinkage.status,'unknown');
 const result=W.saveObservation(fixture(),options);assert.equal(result.status,'saved');const before=fs.readdirSync(options.workspaceRoot);
 view=W.workspaceView(options.workspaceRoot);assert.equal(view.marketLinkage.attribution.knownContribution,null);
 assert.deepEqual(fs.readdirSync(options.workspaceRoot),before);assert.ok(view.marketLinkage.unknownReasons.length);
});
