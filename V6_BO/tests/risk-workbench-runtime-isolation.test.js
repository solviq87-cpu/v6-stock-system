'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {BASE,fixture}=require('./helpers/account-equity-fixture');

function files(root) {
  const result={};
  function visit(dir) {
    if(!fs.existsSync(dir))return;
    for(const name of fs.readdirSync(dir).sort()){
      const file=path.join(dir,name),stat=fs.lstatSync(file);
      if(stat.isDirectory())visit(file);
      else if(stat.isFile())result[path.relative(root,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw Error('unexpected file type in isolated fixture');
    }
  }
  visit(root);return result;
}

function harness(t) {
  const f=fixture(t),calendar={isOpen:()=>true},root=path.join(f.root,'risk');
  const pre=createPaperApplicationService({file:path.join(f.root,'pre-authority.json'),clock:()=>f.now,calendar});
  pre.initialize(200000);
  let primary=true,sendCount=0;
  const options={root,clock:()=>f.now,isPrimary:()=>primary,
    readBook:accountId=>(accountId==='pool'?f.service:pre).read(),readQuotes:()=>({}),
    readResearch:()=>({}),readPlans:async()=>({ok:true,state:{plans:[]}}),
    readObservations:()=>({records:[],alerts:[]}),readAutomaticPolicy:()=>null,readOriginalExitChecks:()=>({}),
    readMarket:()=>({}),readSystem:()=>({}),readStrategy:()=>null,calendar,
    session:()=>({continuous:true,day:aShareCalendarDate(f.now)}),planEnabled:()=>false,
    privateReady:()=>false,sendPrivate:()=>{sendCount++;throw Error('isolated fixture forbids notification delivery');}};
  let runtime=createRiskWorkbenchRuntime(options);
  const authority=()=>({pool:fs.readFileSync(path.join(f.root,'authority.json'),'utf8'),
    pre:fs.readFileSync(path.join(f.root,'pre-authority.json'),'utf8')});
  function damage(report) {
    const dir=path.join(root,'equity',report.account.id,report.accountEpoch,report.equity.day);
    const file=path.join(dir,fs.readdirSync(dir).find(name=>/^\d{6}\.json$/.test(name)));
    const original=fs.readFileSync(file);fs.writeFileSync(file,'{}');
    return {file,restore:()=>fs.writeFileSync(file,original)};
  }
  return {f,root,authority,damage,get runtime(){return runtime;},get sendCount(){return sendCount;},
    primary:value=>{primary=value;},restart:()=>{runtime=createRiskWorkbenchRuntime(options);return runtime;}};
}

const activeSystemFacts=report=>report.risks.filter(row=>row.category==='system'&&row.status!=='resolved').flatMap(row=>row.facts||[]);
function visibleRuntimeFailure(report) {
  assert.equal(typeof report.runtime.lastError,'string');assert.ok(report.runtime.lastError.length>0);
  assert.ok(activeSystemFacts(report).some(fact=>fact.includes(report.runtime.lastError)),
    'the runtime failure must be represented in station-visible system risk facts, not only opaque runtime metadata');
}

test('a corrupt pool derived journal does not block pre observations and remains visible without read-side writes',async t=>{
  const h=harness(t),authority=h.authority();
  assert.equal((await h.runtime.tick()).lastError,null);
  const pool=await h.runtime.read({accountId:'pool'}),pre=await h.runtime.read({accountId:'pre'});
  assert.equal(pool.equityHistory.observations.length,1);assert.equal(pre.equityHistory.observations.length,1);
  assert.notEqual(pool.accountEpoch,pre.accountEpoch);
  const broken=h.damage(pool);h.f.setNow(BASE+60000);
  const result=await h.runtime.tick();assert.ok(result.lastError);assert.ok(result.accountErrors.pool);
  assert.equal(result.accountErrors.pre,null);
  const saved=files(h.root),failed=await h.runtime.read({accountId:'pool'}),healthy=await h.runtime.read({accountId:'pre'});
  visibleRuntimeFailure(failed);visibleRuntimeFailure(healthy);
  assert.equal(failed.equityHistory,null,'a damaged journal cannot be repaired or converted into an empty safe history');
  assert.equal(healthy.equityHistory.observations.length,2);
  assert.equal(healthy.equityHistory.latest.observedAt,h.f.now);
  assert.equal(healthy.equity.cash,200000);assert.equal(failed.equity.cash,100000);
  assert.equal(fs.readFileSync(broken.file,'utf8'),'{}');assert.deepEqual(files(h.root),saved);
  assert.deepEqual(h.authority(),authority);assert.equal(h.sendCount,0);
});

test('independent pool/pre failures clear only after their own successful tick and retain observed recovery gaps',async t=>{
  const h=harness(t),authority=h.authority(),initial=await h.runtime.tick();
  const pool=await h.runtime.read({accountId:'pool'}),pre=await h.runtime.read({accountId:'pre'});
  const brokenPool=h.damage(pool),brokenPre=h.damage(pre);h.f.setNow(BASE+60000);
  const failed=await h.runtime.tick();assert.ok(failed.accountErrors.pool);assert.ok(failed.accountErrors.pre);
  assert.ok(failed.lastError);assert.ok(failed.lastError.includes(failed.accountErrors.pool));
  assert.ok(failed.lastError.includes(failed.accountErrors.pre));
  assert.equal(failed.lastObservedAt,initial.lastObservedAt,'a failed tick cannot advance the last completed observation time');
  const lastComplete=failed.lastObservedAt;

  brokenPool.restore();h.f.setNow(BASE+120000);
  const partiallyRecovered=await h.runtime.tick();
  assert.equal(partiallyRecovered.accountErrors.pool,null);assert.ok(partiallyRecovered.accountErrors.pre);
  assert.ok(partiallyRecovered.lastError.includes(partiallyRecovered.accountErrors.pre));
  assert.equal(partiallyRecovered.lastObservedAt,lastComplete,'a partial tick cannot claim both accounts completed observation');
  const poolRecovered=await h.runtime.read({accountId:'pool'}),preFailed=await h.runtime.read({accountId:'pre'});
  assert.equal(poolRecovered.equityHistory.latest.observedAt,h.f.now);assert.equal(preFailed.equityHistory,null);
  visibleRuntimeFailure(preFailed);

  brokenPre.restore();const beforeRead=files(h.root);
  const readable=await h.runtime.read({accountId:'pre'});
  assert.ok(readable.runtime.lastError,'a successful GET does not claim that the background writer has recovered');
  assert.ok(readable.runtime.accountErrors.pre);assert.deepEqual(files(h.root),beforeRead);
  h.primary(false);const replicaTick=await h.runtime.tick();
  assert.equal(replicaTick.lastError,partiallyRecovered.lastError,'skipping a replica tick cannot clear an unverified recovery');
  h.primary(true);h.f.setNow(BASE+180000);
  const recovered=await h.runtime.tick();assert.equal(recovered.lastError,null);
  assert.deepEqual(recovered.accountErrors,{pool:null,pre:null});assert.equal(recovered.lastObservedAt,h.f.now);
  for(const accountId of ['pool','pre']){
    const report=await h.runtime.read({accountId});assert.equal(report.runtime.lastError,null);
    assert.equal(report.equityHistory.latest.observedAt,h.f.now);
    assert.ok(report.equityHistory.history.gaps.some(gap=>gap.code==='OBSERVATION_GAP'),
      'successful recovery keeps the actual missed observation interval instead of fabricating continuity');
    assert.equal(report.equityHistory.history.continuousAccountMaxDrawdownPct,null);
    assert.ok(!activeSystemFacts(report).some(fact=>fact.includes(partiallyRecovered.lastError)));
    for(const id of ['pool','pre']){
      const health=report.risks.find(row=>row.rootCauseId==='system/risk-observer/'+id);
      assert.equal(health?.status,'resolved');assert.equal(health.evidenceStatus,'available');
      assert.equal(health.sourceAt,h.f.now,'station recovery has an explicit successful observation time');
    }
  }
  // The successful observation becomes a lifecycle input on the next tick;
  // disappearing error text alone is deliberately not a resolution signal.
  h.f.setNow(BASE+185000);assert.equal((await h.runtime.tick()).lastError,null);
  for(const accountId of ['pool','pre']){
    const report=await h.runtime.read({accountId});
    const group=report.alerts.groups.find(row=>row.rootCauseId==='system/risk-observer/pre');
    assert.equal(group?.status,'resolved');assert.equal(group.observationGap,false);
    assert.ok(group.events.some(event=>event.kind==='resolved'));
    assert.equal(group.notification.receiverConfirmed,false);
  }
  assert.deepEqual(h.authority(),authority);assert.equal(h.sendCount,0);
});

test('restart revalidates a corrupt account journal, preserves the sibling history, and never rewrites authority',async t=>{
  const h=harness(t),authority=h.authority();await h.runtime.tick();
  const pool=await h.runtime.read({accountId:'pool'});const broken=h.damage(pool);
  h.f.setNow(BASE+60000);h.restart();
  const before=files(h.root),read=await h.runtime.read({accountId:'pool'});
  assert.equal(read.equityHistory,null);
  assert.ok(activeSystemFacts(read).some(fact=>fact.includes('权益观察档')));
  assert.deepEqual(files(h.root),before);
  const tick=await h.runtime.tick();assert.ok(tick.lastError);assert.ok(tick.accountErrors.pool);
  assert.equal(tick.accountErrors.pre,null);
  const pre=await h.runtime.read({accountId:'pre'});assert.equal(pre.equityHistory.observations.length,2);
  assert.equal(pre.equityHistory.latest.observedAt,h.f.now);visibleRuntimeFailure(await h.runtime.read({accountId:'pool'}));
  assert.equal(fs.readFileSync(broken.file,'utf8'),'{}');assert.deepEqual(h.authority(),authority);assert.equal(h.sendCount,0);
});
