'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../src/core/research-workspace-decision'),F=require('../src/core/model-forward-evaluation'),checks=require('../src/core/research-workspace-diagnostics');
const {fixture,event,dates,at}=require('./helpers/research-workspace-fixtures');
test('F48 original frozen workspace input audit traces an actual zero-valued failed rule',()=>{
 const d=D.buildWorkspaceDecision(fixture()),r=checks.inputAudit(d).ruleEvidence;
 assert.equal(r.conditionTotal,d.conditions.length);
 const row=r.rows.find(x=>x.ruleId==='test-rule:funds');assert.ok(row);
 assert.equal(row.status,'bound-frozen-rule');assert.equal(row.originalVerdict,'fail');assert.equal(row.value,0);
 assert.equal(row.references[0].field,'funds');assert.equal(row.references[0].availableAt,d.asOf);assert.equal(row.coefficientContribution,null);
 const bad=structuredClone(d);bad.evidence=bad.evidence.filter(n=>n.id!==row.references[0].id);
 const invalid=checks.inputAudit(bad).ruleEvidence.rows.find(x=>x.ruleId===row.ruleId);assert.equal(invalid.status,'unknown');assert.equal(invalid.value,null);
});
test('F50 original forecast view reports all registered horizons outside visible page',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-model-scope-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'workspace'),e=event(D.buildWorkspaceDecision(fixture()));
 const input=F.prepareInput(e),target=input.targets.find(x=>x.horizon===1),now=e.recordedAt+2000;
 const prediction={schemaVersion:1,inputFingerprint:input.inputFingerprint,symbol:input.symbol,provider:input.provider,originDate:input.originDate,generatedAt:e.recordedAt+1000,model:{id:'scope',revision:'synthetic-only',latencyMs:0},forecasts:[{...target,point:11}]};
 const real=Date.now;try{Date.now=()=>now;F.freezeForecast(root,[e],{action:'freeze-forecast',runId:e.hash,requestId:'scope_forecast_001',prediction},{now});}finally{Date.now=real;}
 const before=F.evaluationView(root,[e],{asOf:now,limit:1,offset:1});assert.equal(before.status,'available');assert.equal(before.rows.length,0);assert.equal(before.forwardScope.registeredModelInputs,1);assert.equal(before.forwardScope.expectedCalendarCoveredHorizons,input.targets.length);assert.equal(before.forwardScope.submittedHorizons,1);assert.equal(before.forwardScope.notSubmittedHorizons,input.targets.length-1);assert.equal(before.forwardScope.pendingHorizons,1);
 const later=event(D.buildWorkspaceDecision(fixture({index:71})),2),after=F.evaluationView(root,[e,later],{asOf:at(71)});
 assert.equal(after.forwardScope.observedHorizons,1);assert.equal(after.forwardScope.declaredLatencySamples,1);assert.equal(after.forwardScope.verifiedRuntimeCost,null);assert.equal(after.forwardScope.realShadowRuns,null);assert.equal(after.canTrade,false);
 const other=F.evaluationView(root,[e,later],{asOf:at(71),symbol:'600001'});assert.equal(other.forwardScope.registeredModelInputs,0);
});
