'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../src/core/research-workspace-store'),W=require('../src/core/research-workspace');
const F=require('../src/core/model-forward-evaluation'),D=require('../src/core/research-workspace-decision');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const {fixture}=require('./helpers/research-workspace-fixtures');

function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-workspace-authority-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,workspaceRoot:path.join(dir,'workspace'),observationRoot:path.join(dir,'observations'),
  memoryRoot:path.join(dir,'memory'),calendarFile:path.resolve(__dirname,'../config/research-calendar-2026.json')};
}
const noEvents=root=>{assert.deepEqual(S.readEvents(root),[]);if(fs.existsSync(root))assert.ok(!fs.readdirSync(root).some(name=>name.startsWith('.stage-')));};
const preferences=requestId=>({action:'preferences',value:{objective:'合成授权边界验证'},expectedRevision:0,requestId});
function seedForecast(root){
 // Synthetic dates keep the import window open regardless of the test clock;
 // these are not supplier prices or a certification of an exchange calendar.
 const now=Date.now(),today=new Date(now+8*3600000).toISOString().slice(0,10),midnight=Date.parse(today+'T00:00:00Z');
 const previous=new Date(midnight-86400000).toISOString().slice(0,10),next=new Date(midnight+86400000).toISOString().slice(0,10);
 const data=D.buildWorkspaceDecision(fixture());
 Object.assign(data,{asOf:now-2000,tradeDate:previous,tradeDates:[previous,next],bars:[{date:previous,open:10,high:11,low:9,close:10.5,volume:100,
  knownAt:Date.parse(previous+'T16:30:00+08:00')}]});
 const event=S.appendEvent(root,'analysis',data,{requestId:'authority_forecast_origin',now:now-1000}),input=F.prepareInput(event);
 return {action:'freeze-forecast',runId:event.hash,requestId:'authority_forecast_save',prediction:{schemaVersion:1,
  inputFingerprint:input.inputFingerprint,symbol:input.symbol,provider:input.provider,originDate:input.originDate,generatedAt:now-500,
  model:{id:'synthetic',revision:'authority-test-only'},forecasts:[{horizon:1,targetDate:next,point:10.6}]}};
}
function payloadFor(t,action){
 const options=setup(t),root=options.workspaceRoot;
 if(action==='settings')return {action,root,input:preferences('authority_worker_settings'),guardWorkspaceWrite:true};
 if(action==='forecast')return {action,root,input:seedForecast(root),guardWorkspaceWrite:true};
 const f=fixture();f.stock.bars=f.stock.bars.map(bar=>Object.fromEntries(['date','open','high','low','close','volume','amount'].map(k=>[k,bar[k]])));
 require('../src/core/stock-observation-store').retainStockObservation(options.observationRoot,{stock:f.stock,observedAt:f.asOf});
 return {action,options,input:{action:'review',symbol:'600000',provider:'tencent',requestId:'authority_worker_review'},guardWorkspaceWrite:true};
}

test('workspace commit rejects absent permission before creating a private directory',t=>{
 const {workspaceRoot:root}=setup(t);
 for(const beforeCommit of [()=>false,()=>1,true])assert.throws(()=>S.appendEvent(root,'preferences',{},
  {requestId:'authority_no_directory',beforeCommit}),error=>error.code==='WORKSPACE_AUTHORIZATION'&&error.httpStatus===403);
 assert.equal(fs.existsSync(root),false);
});

test('workspace commit rechecks after the original lock and archive validation',t=>{
 const {workspaceRoot:root}=setup(t);let checks=0;
 assert.throws(()=>S.appendEvent(root,'preferences',{}, {requestId:'authority_lock_revoke',beforeCommit:()=>++checks===1}),/授权/);
 assert.equal(checks,2);noEvents(root);
});

test('revocation during staged file sync cannot publish an event and removes its stage',t=>{
 const {workspaceRoot:root}=setup(t);let allowed=true,checks=0;const sync=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',function(fd){const result=sync.call(this,fd);allowed=false;return result;});
 assert.throws(()=>S.appendEvent(root,'preferences',{}, {requestId:'authority_fsync_revoke',beforeCommit:()=>{checks++;return allowed;}}),/授权/);
 assert.equal(checks,3);noEvents(root);
});

test('all legacy settings and restore actions preserve prior records when authority is revoked',t=>{
 const {workspaceRoot:root}=setup(t);
 W.saveSettings(root,preferences('authority_original_preferences'));
 W.saveSettings(root,{action:'preset',value:{name:'原模板'},expectedRevision:0,requestId:'authority_original_preset'});
 const before=S.readEvents(root),attempts=[
  {action:'preferences',value:{objective:'不得保存'}},
  {action:'restore-preferences',revision:1},
  {action:'preset',value:{name:'原模板',minScore:80}},
  {action:'restore-preset',name:'原模板',revision:1}
 ];
 for(const [i,input] of attempts.entries())assert.throws(()=>W.saveSettings(root,{...input,expectedRevision:1,requestId:'authority_denied_setting_'+i},{beforeCommit:()=>false}),/授权/);
 assert.deepEqual(S.readEvents(root),before);
});

for(const failure of [false,true])test('review revocation after awaited '+(failure?'failed':'valid')+' read cannot append analysis or failure diagnostics',async t=>{
 const options=setup(t);let allowed=true,checks=0;
 const result=await W.reviewStored({symbol:'600000',provider:'tencent',requestId:'authority_delayed_review'},options,{
  read:async()=>{await Promise.resolve();allowed=false;if(failure)throw Error('synthetic missing archive');return {ok:true,result:fixture()};},
  beforeCommit:()=>{checks++;return allowed;}
 });
 assert.equal(result.ok,false);assert.equal(result.httpStatus,403);assert.equal(result.runId,null);assert.ok(checks>=1);
 assert.equal(fs.existsSync(options.workspaceRoot),false);noEvents(options.workspaceRoot);
});

test('revocation after an authorized analysis preserves that commit without writing a success diagnostic',async t=>{
 const options=setup(t);let checks=0;
 const result=await W.reviewStored({symbol:'600000',provider:'tencent',requestId:'authority_after_analysis'},options,{
  read:async()=>({ok:true,result:fixture()}),beforeCommit:()=>++checks<=3
 });
 assert.equal(result.ok,true);assert.equal(result.diagnosticsSaved,false);assert.equal(checks,4);
 assert.deepEqual(S.readEvents(options.workspaceRoot).map(e=>e.kind),['analysis']);
});

test('forecast wrapper forwards refusal without creating a forecast archive or changing its source',t=>{
 const {workspaceRoot:root}=setup(t),input=seedForecast(root),before=S.readEvents(root);
 assert.throws(()=>W.saveModelForecast(root,input,{beforeCommit:()=>false}),error=>error.code==='WORKSPACE_AUTHORIZATION');
 assert.equal(fs.existsSync(F.rootFor(root)),false);assert.deepEqual(S.readEvents(root),before);
});

test('guarded forecast cannot cross its import deadline while waiting to publish',t=>{
 const {workspaceRoot:root}=setup(t),input=seedForecast(root),before=S.readEvents(root),deadline=F.prepareInput(before[0]).freezeDeadline;
 let clock=Date.now(),checks=0;t.mock.method(Date,'now',()=>clock);
 assert.throws(()=>W.saveModelForecast(root,input,{beforeCommit:()=>{if(++checks===3)clock=deadline;return true;}}),
  error=>error.code==='FORECAST_LATE');
 assert.equal(checks,3);noEvents(F.rootFor(root));assert.deepEqual(S.readEvents(root),before);
});

test('guarded workspace workers refuse missing or denied authorization before starting any action',async t=>{
 const {workspaceRoot:root}=setup(t);
 for(const action of ['settings','review','forecast']){
  const payload={action,root,guardWorkspaceWrite:true};
  assert.equal((await runWorkspaceJob(payload)).httpStatus,403);
  assert.equal((await runWorkspaceJob(payload,{authorize:()=>false})).httpStatus,403);
 }
 assert.equal(fs.existsSync(root),false);
});

for(const action of ['settings','review','forecast'])for(const transition of ['device-revoked','became-replica'])
test('real '+action+' worker blocks '+transition+' between startup and commit',async t=>{
 const payload=payloadFor(t,action),root=payload.root||payload.options.workspaceRoot,before=S.readEvents(root);
 const authority={edit:true,primary:true};let checks=0;
 const result=await runWorkspaceJob(payload,{authorize:()=>{
  if(++checks===2)authority[transition==='device-revoked'?'edit':'primary']=false;
  return authority.edit&&authority.primary;
 }});
 assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.httpStatus,403,JSON.stringify(result));assert.ok(checks>=2);
 assert.deepEqual(S.readEvents(root),before);
 if(action==='review')assert.ok(result.diagnostics.some(stage=>stage.stage==='封存研究结果'),'the real archive must reach the analysis commit checkpoint');
 if(action==='forecast')assert.equal(fs.existsSync(F.rootFor(root)),false);
});

test('authorized real workers preserve normal settings, review, forecast and idempotence behavior',async t=>{
 for(const action of ['settings','review','forecast']){
  const payload=payloadFor(t,action);let checks=0;
  const saved=await runWorkspaceJob(payload,{authorize:()=>{checks++;return true;}});
  assert.equal(saved.ok,true,JSON.stringify(saved));assert.ok(checks>=4,action+' must authorize startup and commit publication');
  const reused=await runWorkspaceJob(payload,{authorize:()=>true});assert.equal(reused.ok,true,JSON.stringify(reused));assert.equal(reused.reused,true);
 }
});

test('identical workspace views share the existing read queue and create no archive',async t=>{
 const {workspaceRoot:root}=setup(t),payload={action:'view',root,query:{},now:Date.now()};
 const first=runWorkspaceJob(payload),second=runWorkspaceJob(payload);
 assert.equal(first,second);const result=await first;assert.equal(result.ok,true,JSON.stringify(result));assert.equal(fs.existsSync(root),false);
});
