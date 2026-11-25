'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const {probabilityResearch:run, readProbabilityResearch:read} = require('../src/core/probability-reliability-store');
const probability = require('../src/core/probability-reliability');
const {withAccountLock} = require('../src/core/account-process-lock');
const Evidence = require('../src/core/signal-evidence-chain');
const SignalJournal = require('../src/core/production-signal-journal');
const Observations = require('../src/core/stock-observation-store');
const Source = require('../src/core/probability-reliability-sources');

// Artificial consecutive-session calendars only test protocol logic. Formal
// adapter fixtures below exercise schema boundaries, never market evidence.
const dates = Array.from({length:120}, (_,i) => new Date(Date.UTC(2026,0,i + 1)).toISOString().slice(0,10));
const at = (i, h = '10:00') => Date.parse(dates[i] + 'T' + h + ':00+08:00');
const calendar = {schemaVersion:1, exchange:'SSE', source:'test-fixture', from:dates[0], to:dates.at(-1), sessions:dates.map(date => ({date, open:true}))};
const modelFingerprint = 'a'.repeat(64), sourceFingerprint = 'b'.repeat(64);
const spec = {scope:'test', source:'test-fixture', target:'ztNext', modelVersion:'test-v1', modelFingerprint,
  trainingEndedAt:at(0,'09:00'), calibrationStartAt:at(1,'09:00'), validationStartAt:at(30,'09:00'),
  validationEndAt:at(60,'16:00'), horizonTradingDays:1};
function root(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'probability-study-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true})); return path.join(dir,'private'); }
function register(root, patch = {}, now = at(0)) { return run(root,{operation:'register',scope:'test',requestId:'register-0001',plan:{...spec,...patch},calendar},{now}); }
function prediction(i,j=0,patch={}) { return {scope:'test',source:'test-fixture',id:i+'-'+j,code:String(j+1).padStart(6,'0'),sourceFingerprint,
  target:spec.target,modelVersion:spec.modelVersion,modelFingerprint,value:.55,predictedAt:at(i),observedAt:at(i),...patch}; }
function outcome(p,value=true) { return {scope:'test',source:'test-fixture',sourceFingerprint,predictionId:p.id,predictionFingerprint:p.fingerprint,
  target:p.target,targetDay:p.targetDay,value,quality:'standard',availableAt:Date.parse(p.targetDay+'T15:10:00+08:00')}; }
const files = dir => fs.readdirSync(path.join(dir,'test','events')).filter(n=>n.endsWith('.json'));

test('summary is bounded, private-data-free and a missing read creates no directory', t => {
  const dir=root(t), r=read(dir,{asOf:at(0)});
  assert.equal(r.status,'missing-evidence'); assert.equal(r.mode,'fayo-probability-journal-v1'); assert.equal(fs.existsSync(dir),false);
  assert.equal(r.registeredPlans,0); assert.equal(r.canTrade,false); assert.equal(r.calibrationCertified,false); assert.equal(r.trials.remainingTrials,6);
  assert.ok(!JSON.stringify(r).includes(dir));
});

test('registration preserves exact legacy seals through canonical journal restart and idempotent retry', t => {
  const dir=root(t), input={operation:'register',scope:'test',requestId:'register-0001',plan:spec,calendar};
  const a=run(dir,input,{now:at(0)}), bytes=fs.readFileSync(path.join(dir,'test','events','000001.json'));
  assert.equal(a.status,'accepted'); assert.equal(fs.statSync(path.join(dir,'test','events')).mode&0o077,0);
  assert.equal(fs.statSync(path.join(dir,'test','events','000001.json')).mode&0o077,0);
  const b=run(dir,input,{now:at(0,'11:00')}); assert.equal(b.reused,true); assert.deepEqual(b.result,a.result);
  assert.deepEqual(fs.readFileSync(path.join(dir,'test','events','000001.json')),bytes);
  const original=JSON.parse(JSON.parse(bytes).data.resultRaw).plan;
  assert.doesNotThrow(() => probability.evaluate(original,[],[],calendar,{now:at(0)}));
  delete require.cache[require.resolve('../src/core/probability-reliability-store')];
  assert.equal(require('../src/core/probability-reliability-store').readProbabilityResearch(dir,{scope:'test',asOf:at(0)}).registeredPlans,1);
  assert.throws(() => run(dir,{...input,plan:{...spec,modelVersion:'different'}},{now:at(0)}),/请求ID内容冲突/);
});

test('formal and test histories are isolated and bad registrations remain visible as rejected attempts', t => {
  const dir=root(t); assert.equal(register(dir).status,'accepted');
  const r=run(dir,{operation:'register',scope:'formal',requestId:'invalid-formal',plan:{...spec,scope:'formal'},calendar},{now:at(0)});
  assert.equal(r.status,'rejected'); assert.equal(read(dir,{scope:'formal',asOf:at(0)}).registeredPlans,0);
  assert.equal(read(dir,{scope:'formal',asOf:at(0)}).rejectedAttempts,1);
  assert.equal(read(dir,{scope:'test',asOf:at(0)}).registeredPlans,1);
});

test('freshness, duplicate stock/day signals, late labels and kernel lock are enforced before persistence', t => {
  const dir=root(t), plan=register(dir).result.plan;
  const freeze=(requestId,p,now)=>run(dir,{operation:'freeze',scope:'test',requestId,planFingerprint:plan.fingerprint,prediction:p},{now});
  const f=freeze('freeze-first',prediction(2),at(2)); assert.equal(f.status,'accepted');
  assert.equal(freeze('freeze-duplicate',prediction(2,0,{id:'another'}),at(2)).status,'rejected');
  assert.equal(freeze('freeze-late',prediction(3),at(3)+60001).status,'rejected');
  withAccountLock(path.join(dir,'test','probability'), () => assert.throws(() => freeze('freeze-lock',prediction(4),at(4)),/正在处理/));
  const label=outcome(f.result.predictions[0]);
  const saved=run(dir,{operation:'outcome',scope:'test',requestId:'outcome-late',planFingerprint:plan.fingerprint,outcome:label},{now:at(31)});
  assert.equal(saved.status,'accepted'); assert.equal(saved.result.outcomes[0].availableAt,at(31));
  const final=run(dir,{operation:'evaluate',scope:'test',requestId:'evaluate-final',planFingerprint:plan.fingerprint},{now:at(61)});
  assert.equal(final.result.report.exclusions['purged-overlapping-or-late-calibration-label'],1);
  assert.equal(final.result.trialAudit.status,'consumed');
});

test('one sealed evaluation retains worse calibration, spends a trial, and cannot be overwritten or repeatedly peeked', t => {
  const dir=root(t), plan=register(dir).result.plan;
  const early=run(dir,{operation:'evaluate',scope:'test',requestId:'early-peek',planFingerprint:plan.fingerprint},{now:at(1)});
  assert.equal(early.status,'rejected'); assert.equal(early.result,null);
  for(const start of [2,32]) {
    let previous=[];
    for(let i=start;i<=start+20;i++) {
      let today=[];
      if(i<start+20) {
        const receipt=run(dir,{operation:'freeze',scope:'test',requestId:'freeze-day-'+i,planFingerprint:plan.fingerprint,
          predictions:Array.from({length:5},(_,j)=>prediction(i,j))},{now:at(i)});
        assert.equal(receipt.status,'accepted',receipt.reason); today=receipt.result.predictions;
      }
      if(previous.length) {
        const receipt=run(dir,{operation:'outcome',scope:'test',requestId:'label-day-'+i,planFingerprint:plan.fingerprint,
          outcomes:previous.map(p=>outcome(p,p.phase==='calibration'?p.code!=='000005':p.code==='000001'))},{now:at(i,'15:10')});
        assert.equal(receipt.status,'accepted',receipt.reason);
      }
      previous=today;
    }
  }
  const before=read(dir,{scope:'test',asOf:at(55)});
  assert.equal(before.plans[0].metrics,null); assert.equal(before.plans[0].coverage.fraction,1);
  const final=run(dir,{operation:'evaluate',scope:'test',requestId:'final-evaluation',planFingerprint:plan.fingerprint},{now:at(61)});
  assert.equal(final.status,'accepted',final.reason); const report=final.result.report;
  assert.equal(report.validationRaw.samples,100); assert.equal(report.calibration.samples,100);
  assert.ok(report.validationCalibrated.brier>report.validationRaw.brier); assert.equal(report.calibrationCertified,false);
  const count=files(dir).length;
  const repeat=run(dir,{operation:'evaluate',scope:'test',requestId:'another-evaluation',planFingerprint:plan.fingerprint},{now:at(62)});
  assert.equal(repeat.reused,true); assert.deepEqual(repeat.result.report,report); assert.equal(files(dir).length,count);
  const mutation=run(dir,{operation:'freeze',scope:'test',requestId:'after-evaluation',planFingerprint:plan.fingerprint,prediction:prediction(63)},{now:at(63)});
  assert.equal(mutation.status,'rejected');
  const summary=read(dir,{scope:'test',asOf:at(63)});
  assert.equal(summary.trials.usedTrials,1); assert.equal(summary.rejectedEvaluations,1); assert.equal(summary.rejectedAttempts,2);
  assert.equal(summary.plans[0].metrics.validationRaw.samples,100);
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){assert.ok(!['code','predictionId','sourceFingerprint','resultRaw'].includes(key));inspect(v);}};inspect(summary);
  assert.equal(read(dir,{scope:'test',asOf:at(2)}).outcomes,0);
});

test('retained holdout windows cannot be reused across target or model versions and calendar revisions cannot hide history', t => {
  const dir=root(t); register(dir);
  const retry=run(dir,{operation:'register',scope:'test',requestId:'overlapping-new-model',plan:{...spec,modelVersion:'test-v2',target:'upNext'},calendar},{now:at(0,'11:00')});
  assert.equal(retry.status,'rejected'); assert.match(retry.reason,/保留窗口/);
  const changed={...calendar,sessions:calendar.sessions.map((s,i)=>i===2?{...s,open:false}:s)};
  const later={...spec,calibrationStartAt:at(65),validationStartAt:at(80),validationEndAt:at(110)};
  const bad=run(dir,{operation:'register',scope:'test',requestId:'changed-calendar',plan:later,calendar:changed},{now:at(1)});
  assert.equal(bad.status,'rejected'); assert.match(bad.reason,/日历/);
});

test('insufficient or negative experiments also exhaust the shared probability-family cap', t => {
  const dir=root(t);
  for(let i=0;i<6;i++) {
    const start=i*5+1, plan={...spec,calibrationStartAt:at(start+1),validationStartAt:at(start+2),validationEndAt:at(start+3)};
    const created=run(dir,{operation:'register',scope:'test',requestId:'budget-register-'+i,plan,calendar},{now:at(start)});
    assert.equal(created.status,'accepted',created.reason);
    const r=run(dir,{operation:'evaluate',scope:'test',requestId:'budget-evaluate-'+i,planFingerprint:created.result.plan.fingerprint},{now:at(start+3)});
    assert.equal(r.status,'accepted',r.reason); assert.equal(r.result.report.validationRaw.samples,0);
  }
  const summary=read(dir,{scope:'test',asOf:at(32)}); assert.equal(summary.trials.status,'budget-exhausted'); assert.equal(summary.trials.usedTrials,6);
  const seventh=run(dir,{operation:'register',scope:'test',requestId:'budget-seventh',plan:{...spec,calibrationStartAt:at(35),validationStartAt:at(40),validationEndAt:at(45)},calendar},{now:at(32)});
  assert.equal(seventh.status,'accepted','new independent prospective capture may continue without inspecting any result');
  assert.equal(seventh.result.trialBudget.remainingTrials,0);
  const blocked=run(dir,{operation:'evaluate',scope:'test',requestId:'budget-seventh-evaluate',planFingerprint:seventh.result.plan.fingerprint},{now:at(46)});
  assert.equal(blocked.status,'rejected'); assert.match(blocked.reason,/预算/);
});

test('delaying old studies does not reset inspection budget or substitute calendar dates for fresh signal days', t => {
  const dir=root(t), longDates=Array.from({length:300},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
  const longCalendar={...calendar,to:longDates.at(-1),sessions:longDates.map(date=>({date,open:true}))}, plans=[];
  for(let i=0;i<7;i++) {
    const start=i*5+1, plan={...spec,calibrationStartAt:at(start),validationStartAt:at(start+1),validationEndAt:at(start+3)};
    const r=run(dir,{operation:'register',scope:'test',requestId:'delayed-register-'+i,plan,calendar:longCalendar},{now:at(0)});
    assert.equal(r.status,'accepted',r.reason);plans.push(r.result.plan);
  }
  const late=Date.parse(longDates.at(-1)+'T16:00:00+08:00');
  for(let i=0;i<plans.length;i++) {
    const r=run(dir,{operation:'evaluate',scope:'test',requestId:'delayed-evaluate-'+i,planFingerprint:plans[i].fingerprint},{now:late});
    assert.equal(r.status,i<6?'accepted':'rejected',r.reason);
  }
  const summary=read(dir,{scope:'test',asOf:late});assert.equal(summary.trials.usedTrials,6);assert.equal(summary.trials.observedSignalDays,0);
  assert.equal(summary.trials.remainingTrials,0);assert.equal(summary.trials.allTimeTrialCount,6);
});

test('tampering, public paths and symlinks fail closed without reconstructing evidence', t => {
  const dir=root(t); register(dir); const file=path.join(dir,'test','events','000001.json');
  const data=JSON.parse(fs.readFileSync(file));data.data.status='rejected';fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>read(dir,{scope:'test',asOf:at(1)}),/完整性/);
  assert.throws(()=>read(path.join(path.dirname(dir),'public'),{asOf:at(1)}),/公开/);
  const link=dir+'-link';fs.symlinkSync(dir,link);assert.throws(()=>read(link,{asOf:at(1)}),/符号链接/);
});

function originalSignal(patch={}) {
  return Evidence.createProductionSignalEvidence({code:'000001',type:'大单快速流入',triggerAt:at(2),strategyVersion:'rules-v1',recordKind:'trigger',
    strategyDependencies:{status:'complete',files:[{path:'server.js',status:'known',sha256:'c'.repeat(64)}],fingerprint:modelFingerprint},
    quote:{price:10,pct:1,quoteAt:at(2)-1000,receivedAt:at(2),quoteSource:'eastmoney',canTrade:true},
    conditions:[{id:'flow',label:'资金',value:5e7,threshold:3e6,operator:'>',source:'rules-v1',updatedAt:at(2)}],
    conditionCoverage:{status:'complete',scope:'single-rule',producers:['rule'],covered:['flow'],missing:[]},
    inputs:{bars:[{date:dates[1],close:10}],news:{originalEvidence:[{id:'announcement'}]},qualityEvidence:{canNotify:true}},
    model:{value:60,kind:'model-estimate',target:'upNext'},risk:{invalidWhen:'原条件失效'},...patch});
}

test('formal predictions bind the archived value, identity and source time instead of caller assertions', t => {
  const dir=root(t), signalRoot=path.join(path.dirname(dir),'signals');
  const c={...calendar,source:'exchange-calendar'}, planSpec={...spec,scope:'formal',source:'production-signal-journal',modelVersion:'rules-v1',target:'upNext'};
  const sourcePolicy={predictionChannel:'model',outcomeProvider:'eastmoney'};
  const registered=run(dir,{operation:'register',scope:'formal',requestId:'formal-register',plan:planSpec,calendar:c,sourcePolicy},{now:at(0)});
  assert.equal(registered.status,'accepted',registered.reason);
  const e=originalSignal();SignalJournal.appendEvidence(signalRoot,e,{clock:()=>at(2)});
  const r=run(dir,{operation:'freeze',scope:'formal',requestId:'formal-freeze',planFingerprint:registered.result.plan.fingerprint,
    prediction:{signalId:e.signalId,date:dates[2],code:e.code,value:.99,predictedAt:at(1)}},{now:at(2),signalRoot});
  assert.equal(r.status,'accepted',r.reason); assert.equal(r.result.predictions[0].value,.6); assert.equal(r.result.predictions[0].predictedAt,at(2));
  const fake=run(dir,{operation:'freeze',scope:'formal',requestId:'formal-fake',planFingerprint:registered.result.plan.fingerprint,
    prediction:prediction(3)},{now:at(3),signalRoot}); assert.equal(fake.status,'rejected');
  const ranking=originalSignal({model:{value:60,kind:'ranking-score',target:'upNext'}});SignalJournal.appendEvidence(signalRoot,ranking,{clock:()=>at(2)});
  const boundPlan={...registered.result.plan,sourcePolicy};
  assert.throws(()=>Source.archivedPrediction(boundPlan,{signalId:ranking.signalId,date:dates[2],code:'000001'},{now:at(2),signalRoot}),/规则分或排序分/);
  assert.throws(()=>Source.archivedPrediction(boundPlan,{signalId:e.signalId,date:dates[2],code:'000001'},{now:at(2)+60001,signalRoot}),/冻结窗口/);
  assert.throws(()=>Source.archivedPrediction(boundPlan,{signalId:e.signalId,date:dates[2],code:'000001',channel:'riseModel'},{now:at(2),signalRoot}),/来源策略/);
  for(const patch of [
    {inputs:{scope:'demo',bars:[{date:dates[1],close:10}],news:{originalEvidence:[{id:'n'}]},qualityEvidence:{canNotify:true}}},
    {inputs:{bars:[{date:dates[1],close:10,sampleSet:'test'}],news:{originalEvidence:[{id:'n'}]},qualityEvidence:{canNotify:true}}},
    {inputs:{bars:[{date:dates[1],close:10}],news:{originalEvidence:[{id:'n'}]},qualityEvidence:{canNotify:true,simulated:true}}},
    {inputs:{bars:[{date:dates[1],close:10,provenance:{quality:'黑天鹅'}}],news:{originalEvidence:[{id:'n'}]},qualityEvidence:{canNotify:true}}}
  ]) {
    const contaminated=originalSignal(patch);SignalJournal.appendEvidence(signalRoot,contaminated,{clock:()=>at(2)});
    assert.throws(()=>Source.archivedPrediction(boundPlan,{signalId:contaminated.signalId,date:dates[2],code:'000001'},{now:at(2),signalRoot}),/非标准样本/);
  }
});

test('formal labels derive from original unadjusted mature observations and keep net-profit identity blocked', t => {
  const dir=root(t), observationRoot=path.join(path.dirname(dir),'observations');
  let current=at(3,'15:10'); t.mock.method(Date,'now',()=>current);
  const bar=(date,close)=>({date,open:10,high:12,low:9,close,volume:100,suspended:false,tradable:true,isST:false,corporateAction:false});
  Observations.retainStockObservation(observationRoot,{stock:{scope:'formal',symbol:'000001',name:'样例股票',source:'eastmoney-public-history',provider:'eastmoney',priceBasis:'unadjusted',
    bars:[bar(dates[2],10),bar(dates[3],11)]},observedAt:current});
  const p={id:'original-id',fingerprint:sourceFingerprint,code:'000001',signalDay:dates[2],targetDay:dates[3]};
  const sourcePolicy={predictionChannel:'model',outcomeProvider:'eastmoney'};
  const y=Source.archivedOutcome({target:'upNext',sourcePolicy},p,{provider:'eastmoney',value:false},{observationRoot,now:current});
  assert.equal(y.value,true);assert.equal(y.availableAt,current);assert.equal(y.providerAttestation,'local-receipt-only');
  assert.throws(()=>Source.archivedOutcome({target:'netProfitAfterFill'},p,{provider:'eastmoney'},{observationRoot,now:current}),/唯一事前计划/);
  assert.throws(()=>Source.archivedOutcome({target:'ztNext',sourcePolicy},p,{provider:'eastmoney'},{observationRoot,now:current}),/原日明确涨停/);
  Observations.retainStockObservation(observationRoot,{stock:{scope:'formal',symbol:'000001',name:'样例股票',source:'tencent-public-history',provider:'tencent',priceBasis:'unadjusted',
    bars:[bar(dates[2],10),bar(dates[3],9)]},observedAt:current});
  assert.throws(()=>Source.archivedOutcome({target:'upNext',sourcePolicy},p,{provider:'tencent'},{observationRoot,now:current}),/来源策略/);
  current+=1000;
  Observations.retainStockObservation(observationRoot,{stock:{scope:'formal',symbol:'000001',name:'样例股票',source:'eastmoney-public-history',provider:'eastmoney',priceBasis:'unadjusted',
    bars:[{...bar(dates[3],11),corporateAction:true}]},observedAt:current});
  assert.throws(()=>Source.archivedOutcome({target:'upNext',sourcePolicy},p,{provider:'eastmoney'},{observationRoot,now:current}),/修订冲突/);
  const contaminatedRoot=path.join(path.dirname(dir),'contaminated-observations');
  Observations.retainStockObservation(contaminatedRoot,{stock:{scope:'formal',symbol:'000001',name:'样例股票',source:'eastmoney-public-history',provider:'eastmoney',priceBasis:'unadjusted',
    bars:[bar(dates[2],10),{...bar(dates[3],11),provenance:{isTest:true}}]},observedAt:current});
  assert.throws(()=>Source.archivedOutcome({target:'upNext',sourcePolicy},p,{provider:'eastmoney'},{observationRoot:contaminatedRoot,now:current}),/标准标签/);
  for(const [name,classification] of [['unclassified',{}],['top-level-demo',{scope:'demo',synthetic:true}],['context-demo',{scope:'formal'}]]) {
    const scopeRoot=path.join(path.dirname(dir),name);
    Observations.retainStockObservation(scopeRoot,{stock:{...classification,symbol:'000001',name:'样例股票',source:'eastmoney-public-history',provider:'eastmoney',priceBasis:'unadjusted',
      bars:[bar(dates[2],10),bar(dates[3],11)]},observedAt:current,context:name==='context-demo'?{sampleScope:'demo'}:{}});
    assert.throws(()=>Source.archivedOutcome({target:'upNext',sourcePolicy},p,{provider:'eastmoney'},{observationRoot:scopeRoot,now:current}),/样本范围/);
  }
});

test('operator CLI keeps the missing summary read-only and rejects unsafe private inputs', t => {
  const dir=root(t), file=path.join(path.dirname(dir),'request.json');fs.writeFileSync(file,JSON.stringify({scope:'test',asOf:at(0)}),{mode:0o600});
  const command=path.resolve(__dirname,'../scripts/probability-reliability.js');
  const result=spawnSync(process.execPath,[command,'journal-read',file,dir],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'missing-evidence');assert.equal(fs.existsSync(dir),false);
  fs.chmodSync(file,0o644);const unsafe=spawnSync(process.execPath,[command,'journal-read',file,dir],{encoding:'utf8'});
  assert.equal(unsafe.status,1);assert.match(unsafe.stderr,/0600/);
});

test('a known source correction quarantines an already recorded formal label at the single final evaluation', t => {
  const dir=root(t), signalRoot=path.join(path.dirname(dir),'signals'), observationRoot=path.join(path.dirname(dir),'observations');
  const sourcePolicy={predictionChannel:'model',outcomeProvider:'eastmoney'}, c={...calendar,source:'exchange-calendar'};
  const created=run(dir,{operation:'register',scope:'formal',requestId:'correction-register',sourcePolicy,calendar:c,
    plan:{...spec,scope:'formal',source:'production-signal-journal',modelVersion:'rules-v1',target:'upNext'}},{now:at(0)});
  assert.equal(created.status,'accepted',created.reason);
  const planFingerprint=created.result.plan.fingerprint,e=originalSignal();SignalJournal.appendEvidence(signalRoot,e,{clock:()=>at(2)});
  const frozen=run(dir,{operation:'freeze',scope:'formal',requestId:'correction-freeze',planFingerprint,prediction:{signalId:e.signalId,date:dates[2],code:e.code}},{now:at(2),signalRoot});
  assert.equal(frozen.status,'accepted',frozen.reason);
  let current=at(3,'15:10');t.mock.method(Date,'now',()=>current);
  const bar=(date,close)=>({date,open:10,high:12,low:9,close,volume:100,suspended:false,tradable:true,isST:false,corporateAction:false});
  const stock={scope:'formal',symbol:'000001',name:'样例股票',source:'eastmoney-public-history',provider:'eastmoney',priceBasis:'unadjusted',bars:[bar(dates[2],10),bar(dates[3],11)]};
  Observations.retainStockObservation(observationRoot,{stock,observedAt:current});
  const label=run(dir,{operation:'outcome',scope:'formal',requestId:'correction-label',planFingerprint,outcome:{predictionId:frozen.result.predictions[0].id}},{now:current,observationRoot});
  assert.equal(label.status,'accepted',label.reason);assert.equal(label.result.outcomes[0].value,true);
  current=at(4,'15:10');stock.bars[1].close=9;Observations.retainStockObservation(observationRoot,{stock,observedAt:current});
  current=at(61);
  const final=run(dir,{operation:'evaluate',scope:'formal',requestId:'correction-evaluate',planFingerprint},{now:current,observationRoot});
  assert.equal(final.status,'accepted',final.reason);assert.equal(final.result.report.sourceRecheck.rejected,1);
  assert.equal(final.result.report.sourceRecheck.reasons['source-revision-conflict'],1);assert.equal(final.result.report.calibration.samples,0);
  assert.equal(final.result.trialAudit.status,'consumed');assert.equal(final.result.report.modelParametersVerified,false);
  assert.equal(read(dir,{asOf:current}).outcomes,1,'original label remains retained with its first receipt, even when later excluded');
});
