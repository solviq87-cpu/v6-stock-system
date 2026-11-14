'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision'),F=require('../src/core/model-forward-evaluation');
const {fixture,event,dates,at}=require('./helpers/research-workspace-fixtures');
const origin=()=>event(D.buildWorkspaceDecision(fixture()));
function prediction(e=origin(),patch={}){const input=F.prepareInput(e);return {schemaVersion:1,inputFingerprint:input.inputFingerprint,symbol:input.symbol,provider:input.provider,originDate:input.originDate,generatedAt:e.recordedAt+1000,
 model:{id:'M05',revision:'synthetic-only-v1',weightsHash:'a'.repeat(64),trainingCutoff:dates[69],seed:0,temperature:0,sampleCount:5,latencyMs:0},
 forecasts:[{horizon:1,targetDate:dates[71],point:11,quantiles:[{level:.1,value:10},{level:.5,value:11},{level:.9,value:12}]}],...patch};}
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-model-forward-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'workspace');}
function save(root,e=origin(),p=prediction(e),id='forecast_test_001',now=e.recordedAt+2000){return F.freezeForecast(root,[e],{action:'freeze-forecast',runId:e.hash,requestId:id,prediction:p},{now});}
test('forecast input binds exact frozen identity, calendar and closed prices, without copying holdings or factor defaults',()=>{
 const e=origin(),input=F.prepareInput(e);assert.equal(input.runId,e.hash);assert.equal(input.originDate,dates[70]);assert.equal(input.targets[0].targetDate,dates[71]);assert.equal(input.freezeDeadline,at(71,'09:30'));assert.match(input.inputFingerprint,/^[a-f0-9]{64}$/);
 assert.ok(!Object.hasOwn(input,'conditions'));assert.ok(!Object.hasOwn(input,'positions'));const changed=structuredClone(e);changed.data.bars.at(-1).close+=.01;assert.notEqual(F.prepareInput(changed).inputFingerprint,input.inputFingerprint);
});
test('GET with no forecasts creates no private directories',t=>{
 const root=setup(t),r=F.evaluationView(root,[origin()],{asOf:at(70)});assert.equal(r.status,'available');assert.equal(r.total,0);assert.equal(fs.existsSync(F.rootFor(root)),false);
});
test('explicit forecasts persist separately, preserve zero and replay only after actual receipt',t=>{
 const root=setup(t),e=origin(),p=prediction(e);p.forecasts[0].point=0;p.forecasts[0].quantiles=[];
 const saved=save(root,e,p);assert.equal(saved.ok,true);assert.equal(S.readEvents(F.rootFor(root))[0].data.model.seed,0);assert.equal(S.readEvents(F.rootFor(root))[0].data.forecasts[0].point,0);assert.equal(fs.existsSync(root),false);
 assert.equal(F.evaluationView(root,[e],{asOf:e.recordedAt+1999}).total,0);assert.equal(F.evaluationView(root,[e],{asOf:e.recordedAt+2000}).total,1);
 assert.equal(F.evaluationView(root,[e],{asOf:e.recordedAt+2000}).groups[0].pending,1);
});
test('idempotent retry after deadline returns original prediction; same-ID different payload cannot replace it',t=>{
 const root=setup(t),e=origin(),p=prediction(e),a=save(root,e,p);const reused=save(root,e,p,'forecast_test_001',at(72));assert.equal(a.forecastId,reused.forecastId);assert.equal(reused.reused,true);
 p.forecasts[0].point=12;assert.throws(()=>save(root,e,p),/请求ID/);assert.equal(S.readEvents(F.rootFor(root)).length,1);
});
for(const defect of ['foreign-symbol','foreign-provider','foreign-input','future-generation','before-input','late-receipt','training-future','negative-price','quantile-cross','quantile-duplicate','future-label','duplicate-horizon'])test('rejects '+defect+' without storing an experiment',t=>{
 const root=setup(t),e=origin(),p=prediction(e);let now=e.recordedAt+2000;
 if(defect==='foreign-symbol')p.symbol='600001';if(defect==='foreign-provider')p.provider='eastmoney';if(defect==='foreign-input')p.inputFingerprint='b'.repeat(64);
 if(defect==='future-generation')p.generatedAt=now+1;if(defect==='before-input')p.generatedAt=e.recordedAt-1;if(defect==='late-receipt')now=at(71,'09:30');if(defect==='training-future')p.model.trainingCutoff=dates[71];
 if(defect==='negative-price')p.forecasts[0].point=-1;if(defect==='quantile-cross')p.forecasts[0].quantiles[2].value=9;if(defect==='quantile-duplicate')p.forecasts[0].quantiles[1].level=.1;
 if(defect==='future-label')p.forecasts[0].targetDate=dates[72];if(defect==='duplicate-horizon')p.forecasts.push(p.forecasts[0]);
 assert.throws(()=>save(root,e,p,'forecast_test_001',now));assert.equal(S.readEvents(F.rootFor(root)).length,0);
});
test('point, naive/drift and pinball losses use real post-receipt close; interval coverage is not a win probability',t=>{
 const root=setup(t),e=origin(),p=prediction(e);save(root,e,p);
 const later=event(D.buildWorkspaceDecision(fixture({index:71})),2),r=F.evaluationView(root,[e,later],{asOf:at(71)}),row=r.rows[0],actual=later.data.bars.at(-1).close;
 assert.equal(row.actual,actual);assert.equal(row.absoluteError,Math.abs(actual-11));assert.ok(Math.abs(row.naiveError-.01)<1e-10);assert.equal(row.covered,true);assert.ok(Math.abs(row.nominalCoveragePct-80)<1e-9);
 const expected=(.1*(actual-10)+(.5-1)*(actual-11)+(.9-1)*(actual-12))/3;assert.ok(Math.abs(row.pinballLoss-expected)<1e-10);
 assert.equal(r.groups[0].status,'insufficient-independent-samples');assert.equal(r.groups[0].meanIntervalWidth,2);assert.equal(r.canTrade,false);assert.equal(r.groups[0].costReportsVerified,false);assert.equal(row.outcomeRunId,later.hash);
 assert.equal(F.evaluationView(root,[e,later],{asOf:at(71,'14:00')}).groups[0].pending,1);
});
test('mature missing prices and zero-volume observations remain in the denominator',t=>{
 const root=setup(t),e=origin();save(root,e);let r=F.evaluationView(root,[e],{asOf:at(71)});assert.equal(r.groups[0].missing,1);assert.equal(r.groups[0].mae,null);
 const later=event(D.buildWorkspaceDecision(fixture({index:71})),2);later.data.bars.at(-1).volume=0;r=F.evaluationView(root,[e,later],{asOf:at(71)});assert.equal(r.groups[0].invalid,1);assert.equal(r.groups[0].matured,0);
});
test('later price correction is visible but cannot rewrite the first observed evaluation',t=>{
 const root=setup(t),e=origin();save(root,e);const first=event(D.buildWorkspaceDecision(fixture({index:71})),2),revision=structuredClone(first);revision.hash='c'.repeat(64);revision.recordedAt++;revision.data.bars.at(-1).close+=.1;
 const before=F.evaluationView(root,[e,first],{asOf:at(71)}),after=F.evaluationView(root,[e,first,revision],{asOf:at(71)+1});assert.equal(after.rows[0].actual,before.rows[0].actual);assert.equal(after.rows[0].absoluteError,before.rows[0].absoluteError);assert.equal(after.rows[0].revisedOutcome,true);assert.equal(after.groups[0].revisedOutcomes,1);
});
test('same model/day repeats do not create independent samples, and filtering does not reclassify a repeat',t=>{
 const root=setup(t),e=origin();save(root,e);save(root,e,prediction(e),'forecast_test_002',e.recordedAt+3000);const later=event(D.buildWorkspaceDecision(fixture({index:71})),2);
 let r=F.evaluationView(root,[e,later],{asOf:at(71)});assert.equal(r.groups[0].total,2);assert.equal(r.groups[0].matured,1);assert.equal(r.groups[0].repeated,1);
 r=F.evaluationView(root,[e,later],{asOf:at(71),symbol:'600001'});assert.equal(r.groups.length,0);assert.equal(r.rows.length,0);
});
test('corrupt forecast archive fails closed while the original workspace remains untouched',t=>{
 const root=setup(t),e=origin();S.appendEvent(root,'analysis',e.data,{requestId:'original_run_001',now:e.recordedAt});save(root,e);const file=path.join(F.rootFor(root),'000001.json');fs.appendFileSync(file,'tamper');
 const r=F.evaluationView(root,[e],{asOf:at(71)});assert.equal(r.status,'unavailable');assert.equal(r.groups.length,0);assert.equal(S.readEvents(root).length,1);
});
test('model comparison uses the intersection of exact input/target/horizon, with no cross-universe ranking',t=>{
 const root=setup(t),e=origin(),a=prediction(e),b=prediction(e);b.model.id='M01';b.forecasts[0].point=11.5;
 save(root,e,a,'pair_forecast_001');save(root,e,b,'pair_forecast_002',e.recordedAt+3000);
 const later=event(D.buildWorkspaceDecision(fixture({index:71})),2),r=F.evaluationView(root,[e,later],{asOf:at(71)});assert.equal(r.pairs.rows.length,1);assert.equal(r.pairs.rows[0].samples,1);assert.equal(r.pairs.rows[0].profitComparison,null);assert.equal(r.pairs.rows[0].independenceCertified,false);
 const other=event(D.buildWorkspaceDecision(fixture({symbol:'600001'})),3),p=prediction(other);p.model.id='M02';save(root,other,p,'pair_forecast_003',e.recordedAt+4000);const different=F.evaluationView(root,[e,other,later,event(D.buildWorkspaceDecision(fixture({index:71,symbol:'600001'})),4)],{asOf:at(71)});assert.equal(different.pairs.rows.length,1);
});
test('sampling parameters form distinct model configurations, while missing training metadata stays unknown',t=>{
 const root=setup(t),e=origin(),a=prediction(e),b=prediction(e);delete a.model.trainingCutoff;b.model.sampleCount=10;
 save(root,e,a,'config_forecast_001');save(root,e,b,'config_forecast_002',e.recordedAt+3000);
 const r=F.evaluationView(root,[e,event(D.buildWorkspaceDecision(fixture({index:71})),2)],{asOf:at(71)});assert.equal(r.groups.length,2);assert.ok(r.groups.some(g=>g.trainingCoverage==='unknown'));assert.ok(r.groups.every(g=>g.matured===1));
});
test('large model catalogs paginate complete totals and bound quadratic pair comparison',t=>{
 const root=setup(t),e=origin();for(let i=0;i<25;i++){const p=prediction(e);p.model.id='custom'+i;save(root,e,p,'many_forecasts_'+String(i).padStart(3,'0'),e.recordedAt+2000+i);}
 const later=event(D.buildWorkspaceDecision(fixture({index:71})),2),v=F.evaluationView(root,[e,later],{asOf:at(71),offset:20,limit:20});assert.equal(v.groupTotal,25);assert.equal(v.groups.length,5);assert.equal(v.total,25);assert.equal(v.rows.length,5);assert.equal(v.pairs.rows.length,0);assert.equal(v.pairs.limitedGroups,1);
});
