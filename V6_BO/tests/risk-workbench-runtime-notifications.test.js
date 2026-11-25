'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const {createRiskAlertLifecycle}=require('../src/core/risk-alert-lifecycle');
const {buildAccountEquityEvidence}=require('../src/core/account-equity-evidence');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {createPaperPlanObservationStore}=require('../src/core/paper-plan-observation-store');
const {decisionPlanPayload,bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {BASE,fixture}=require('./helpers/account-equity-fixture');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');

async function harness(t,{onSend}={}){
  const f=fixture(t),day=aShareCalendarDate(f.now),root=path.join(f.root,'risk');
  let primary=true,enabled=true,configured=true,price=10,conflict=false,quoteFields={},quotesMissing=false;
  let currentBook=()=>f.service.read();
  const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,name:'隔离计划',
    calculatedAt:BASE-15000,strategyAt:BASE-60000,quoteBasis:{source:'tencent',quoteAt:BASE-15000},
    plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
  const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',
    frozenAt:new Date(BASE-10000).toISOString(),...decisionPlanPayload(card)},card);
  function quote(){
    const raw={code:'600000',name:'隔离计划',price,preClose:10,volume:100000,quoteSource:'tencent',
      quoteMode:'public-live-unverified',quoteAt:f.now,receivedAt:f.now,canTrade:true,suspended:false,tradable:true,...quoteFields};
    return {symbol:raw.code,price,quoteSource:'tencent',provider:'tencent',quoteAt:raw.quoteAt,timestamp:raw.quoteAt,receivedAt:raw.receivedAt,
      tradeDate:aShareCalendarDate(f.now),mode:'public-live-unverified',volumeUnit:'shares',volume:10000000,
      upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
      inputProvenance:createAutomaticInputProvenance({stock:raw,observation:raw,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1}),...quoteFields};
  }
  const observationStore=createPaperPlanObservationStore({root:path.join(f.root,'observations'),clock:()=>f.now,canWrite:()=>primary});
  const calendar={isOpen:()=>true},sent=[];
  const opts={root,clock:()=>f.now,isPrimary:()=>primary,planEnabled:()=>enabled,privateReady:()=>configured,
    readBook:()=>currentBook(),readQuotes:()=>quotesMissing?{}:({600000:quote()}),readPlans:async()=>({ok:true,state:{plans:[plan]}}),
    readObservations:input=>observationStore.read(input),readResearch:()=>({}),readAutomaticPolicy:()=>null,
    readOriginalExitChecks:()=>({[plan.id]:{allowed:true,reason:'原隔离退出检查已通过',checkedAt:f.now,quoteAt:f.now}}),
    readMarket:()=>({conflicts:conflict?[{code:'600000',status:'conflict',checkedAt:f.now}]:[]}),
    calendar,session:()=>({continuous:true,day:aShareCalendarDate(f.now)}),
    sendPrivate:(message,options)=>{sent.push({message,options});return onSend?onSend(message,options):true;}};
  let runtime=createRiskWorkbenchRuntime(opts);
  async function commitObservation(){
    const result=observePaperPlans({plans:[plan],book:f.service.read(),quotes:{600000:quote()},now:f.now,day:aShareCalendarDate(f.now),
      calendar,continuous:true,entryEligibilityByPlan:{[plan.id]:{allowed:true,reason:'原隔离买入预检通过',checkedAt:f.now,quoteAt:f.now}},
      exitEligibilityByPlan:{[plan.id]:{allowed:true,reason:'原隔离退出检查已通过',checkedAt:f.now,quoteAt:f.now}}});
    runtime.observePlans(result);const committed=await observationStore.append({records:result.records,alerts:result.alerts,now:f.now});
    return {result,committed,alert:committed.alerts[0]||result.alerts[0]};
  }
  const evidence=buildAccountEquityEvidence({book:f.service.read(),accountId:'pool',quotes:{600000:quote()},now:f.now});
  const key={accountId:'pool',accountEpoch:evidence.accountEpoch};
  const lifecycle=()=>createRiskAlertLifecycle({root:path.join(root,'notifications'),clock:()=>f.now,canWrite:()=>primary});
  return {f,plan,sent,key,quote,lifecycle,commitObservation,get runtime(){return runtime;},
    restart:()=>{runtime=createRiskWorkbenchRuntime(opts);return runtime;},
    changeAccount:()=>{const other=require('../src/core/paper-application-service').createPaperApplicationService({
      file:path.join(f.root,'reset-account.json'),clock:()=>f.now,calendar});other.initialize(200000);currentBook=()=>other.read();},
    primary:value=>{primary=value;},enabled:value=>{enabled=value;},configured:value=>{configured=value;},
    price:value=>{price=value;},conflict:value=>{conflict=value;},quoteFields:value=>{quoteFields=value;},missingQuotes:value=>{quotesMissing=value;}};
}

test('committed plan alerts use original rows and one reservation across callback repeats and runtime restart',async t=>{
  const h=await harness(t),{alert}=await h.commitObservation();assert.ok(alert);
  const before=fs.readFileSync(path.join(h.f.root,'authority.json'),'utf8');
  assert.equal(await h.runtime.sendPlanAlert(alert),true);assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].options.beforeSend().ok,true);
  assert.equal(await h.runtime.sendPlanAlert(alert),false);
  assert.equal(await h.restart().sendPlanAlert(alert),false);assert.equal(h.sent.length,1);
  const group=h.lifecycle().read(h.key).groups.find(row=>row.rootCauseId.endsWith('/entry'));
  assert.equal(group.notification.status,'queued');assert.equal(group.notification.receiverConfirmed,false);
  assert.equal(group.risks[0].references.observationId,alert.observationId);
  assert.equal(fs.readFileSync(path.join(h.f.root,'authority.json'),'utf8'),before);
});

test('gateway callbacks remain acceptance evidence and duplicate or uncertain callback cannot trigger resending',async t=>{
  const h=await harness(t,{onSend:(_message,options)=>{options.onReceipt({ok:true,msg:'ok'});return true;}});
  const {alert}=await h.commitObservation();await h.runtime.sendPlanAlert(alert);
  let group=h.lifecycle().read(h.key).groups[0];assert.equal(group.notification.status,'gateway-accepted');
  assert.equal(group.notification.receiverConfirmed,false);
  h.sent[0].options.onReceipt({ok:false,status:'unknown',msg:'private webhook secret should not be persisted'});
  group=h.lifecycle().read(h.key).groups[0];assert.equal(group.notification.status,'gateway-accepted');
  assert.doesNotMatch(JSON.stringify(group),/secret should/);
  assert.equal(await h.runtime.sendPlanAlert(alert),false);assert.equal(h.sent.length,1);
});

test('queue dispatch rechecks user mute, instance role, original enable flag, actual quote and account period',async t=>{
  for(const change of ['mute','replica','disabled','quote','sourceConflict','conflict','reset']){
    const h=await harness(t),{alert}=await h.commitObservation();await h.runtime.sendPlanAlert(alert);
    const store=h.lifecycle(),before=store.read(h.key),rootCauseId=before.groups[0].rootCauseId;
    if(change==='mute')store.setMuted({...h.key,rootCauseId,actor:'editor',expectedRevision:before.revision,mutedUntil:h.f.now+60000});
    else if(change==='replica')h.primary(false);
    else if(change==='disabled')h.enabled(false);
    else if(change==='quote')h.price(10.5);
    else if(change==='sourceConflict'||change==='conflict')h.quoteFields({[change]:true});
    else h.changeAccount();
    assert.equal(h.sent[0].options.beforeSend().ok,false,change);
  }
});

test('queued non-plan price clearances recheck current missing, stale and conflicting marks before delivery',async t=>{
  for(const change of ['missing','stale','sourceConflict','conflict']){
    const h=await harness(t);h.f.buy();h.quoteFields({sourceConflict:true});
    await h.runtime.tick();assert.equal(h.sent.length,0);
    h.quoteFields({});await h.runtime.tick();
    const clearances=h.sent.filter(row=>row.message.includes('解除观察'));
    assert.ok(clearances.length>=2);assert.ok(clearances.every(row=>row.options.beforeSend().ok));
    if(change==='missing')h.missingQuotes(true);
    else if(change==='stale')h.quoteFields({quoteAt:h.f.now-15001,receivedAt:h.f.now});
    else h.quoteFields({[change]:true});
    assert.ok(clearances.every(row=>row.options.beforeSend().ok===false),change);
  }
});

test('queued source-conflict warnings require a current conflict diagnostic without treating unusable prices as executable',async t=>{
  const h=await harness(t);h.conflict(true);h.quoteFields({sourceConflict:true});await h.runtime.tick();
  const warnings=h.sent.filter(row=>row.message.includes('多源价格或时点核对'));
  assert.equal(warnings.length,2);assert.ok(warnings.every(row=>row.options.beforeSend().ok));
  h.conflict(false);assert.ok(warnings.every(row=>row.options.beforeSend().ok===false));
  h.conflict(true);h.f.setNow(h.f.now+15001);assert.ok(warnings.every(row=>row.options.beforeSend().ok===false));
});

test('forged, stale, wrong-day or uncommitted plan alerts never reach the sender',async t=>{
  const h=await harness(t),{alert}=await h.commitObservation();
  for(const altered of [{...alert,id:'f'.repeat(64)},{...alert,price:1},{...alert,observationId:'f'.repeat(64)},
    {...alert,quoteAt:h.f.now-15001},{...alert,day:'2026-11-20'}])assert.equal(await h.runtime.sendPlanAlert(altered),false);
  assert.equal(h.sent.length,0);h.enabled(false);assert.equal(await h.runtime.sendPlanAlert(alert),false);
  assert.equal(h.sent.length,0);
});

test('sender exceptions or absent admission return stay unconfirmed and are not retried after restart',async t=>{
  for(const mode of ['throw','undefined']){
    const h=await harness(t,{onSend:()=>{if(mode==='throw')throw Error('HTTP 429 uncertain transport');}});
    const {alert}=await h.commitObservation();assert.equal(await h.runtime.sendPlanAlert(alert),false);
    assert.equal(h.lifecycle().read(h.key).groups[0].notification.status,'unconfirmed');
    assert.equal(await h.restart().sendPlanAlert(alert),false);assert.equal(h.sent.length,1);
  }
});

test('receipt persistence failure remains visible and queued reservation survives without duplicate external effects',async t=>{
  const h=await harness(t);const {alert}=await h.commitObservation();await h.runtime.sendPlanAlert(alert);
  const dir=path.join(h.f.root,'risk','notifications'),filename=fs.readdirSync(dir).find(name=>name.endsWith('.json'));
  const file=path.join(dir,filename),saved=fs.readFileSync(file);fs.writeFileSync(file,'{}');
  assert.doesNotThrow(()=>h.sent[0].options.onReceipt({ok:true,msg:'ok'}));
  assert.match(h.runtime.status().lastError,/尚未持久确认/);
  assert.equal(await h.runtime.sendPlanAlert(alert),false);assert.equal(h.sent.length,1);
  fs.writeFileSync(file,saved);assert.equal(h.lifecycle().read(h.key).groups[0].notification.status,'queued');
  assert.equal(await h.restart().sendPlanAlert(alert),false);assert.equal(h.sent.length,1);
});

test('ordinary background risks share lifecycle and receipts without a second active plan alert producer',async t=>{
  const h=await harness(t);await h.commitObservation();h.conflict(true);
  const inspected=await h.runtime.read({accountId:'pool'});
  assert.doesNotThrow(()=>require('../src/core/account-equity-evidence').validateEquityEvidence(inspected.equity));
  const tick=await h.runtime.tick();assert.equal(tick.lastError,null);
  assert.equal(h.sent.filter(row=>row.message.includes('进入计划买区')).length,0);
  assert.equal(h.sent.length,2); // independently scoped pool/pre account evidence
  assert.ok(h.sent.every(row=>row.message.includes('多源价格或时点核对')));
  for(const row of h.sent)row.options.onReceipt({ok:false,msg:'HTTP 429'});
  await h.runtime.tick();assert.equal(h.sent.length,2);
  assert.equal(h.lifecycle().read(h.key).groups.find(row=>row.rootCauseId==='quote/600000').notification.status,'gateway-rejected');
});

test('HTTP-facing notification updates require the currently authoritative account epoch and CAS revision',async t=>{
  const h=await harness(t),{alert}=await h.commitObservation();await h.runtime.sendPlanAlert(alert);
  const view=h.lifecycle().read(h.key),group=view.groups[0];
  await assert.rejects(()=>h.runtime.update({action:'view',...h.key,accountEpoch:'old-epoch',rootCauseId:group.rootCauseId,expectedRevision:view.revision},{actor:'editor',authorized:()=>true}),/期间已变化/);
  const changed=await h.runtime.update({action:'view',...h.key,rootCauseId:group.rootCauseId,expectedRevision:view.revision},{actor:'editor',authorized:()=>true});
  assert.equal(changed.groups[0].viewed,true);assert.equal(changed.groups[0].notification.receiverConfirmed,false);
  h.primary(false);
  await assert.rejects(()=>h.runtime.update({action:'mute',...h.key,rootCauseId:group.rootCauseId,expectedRevision:changed.revision,mutedUntil:null},{actor:'editor',authorized:()=>true}),/副本只读/);
});

test('an editor revoked while awaiting evidence cannot mark viewed or mute after the read finishes',async t=>{
  const h=await harness(t),{alert}=await h.commitObservation();await h.runtime.sendPlanAlert(alert);
  const before=h.lifecycle().read(h.key),rootCauseId=before.groups[0].rootCauseId;
  let authorized=true;
  const pending=h.runtime.update({action:'view',...h.key,rootCauseId,expectedRevision:before.revision},
    {actor:'editor',authorized:()=>authorized});
  authorized=false;
  await assert.rejects(()=>pending,/编辑授权已失效/);
  assert.equal(h.lifecycle().read(h.key).revision,before.revision);
  assert.equal(h.lifecycle().read({...h.key,actor:'editor'}).groups[0].viewed,false);
  await assert.rejects(()=>h.runtime.update({action:'mute',...h.key,rootCauseId,expectedRevision:before.revision,mutedUntil:h.f.now+60000},
    {actor:'editor'}),/编辑授权已失效/);
});
