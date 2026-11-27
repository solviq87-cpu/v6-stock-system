'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildRiskWorkbench,riskRow,planRootCause}=require('../src/core/risk-workbench');
const now=Date.parse('2026-11-27T10:00:00+08:00'),planId='original-plan',code='600000',entry='original-entry';
const report=extra=>buildRiskWorkbench({accountId:'pool',now,...extra});
const row=(r,root)=>r.risks.find(x=>x.rootCauseId===root);
const raw=(extra={})=>({rootCauseId:'test/original',category:'portfolio',object:{type:'account',id:'pool'},
 severity:'warning',evidenceStatus:'available',status:'resolved',sourceAt:now,source:'original',facts:['原证据'],...extra});
const rule=(extra={})=>({id:'maxGrossExposurePct',label:'总仓位',enabled:true,configurationStatus:'active',
 evidenceStatus:'available',used:15,limit:20,remaining:5,unit:'%',exceeded:false,...extra});
const rules=(extra={},version='v1')=>({accountId:'pool',generatedAt:now,policyVersion:version,rules:[rule(extra)]});
const condition=(at=now,price=10)=>({status:price<=8||price>=14?'triggered':'not-triggered',
 kind:price<=8?'stop':price>=14?'target':null,price,source:'original-quote',quoteAt:at,observedAt:now});
function action(at=now,price=10){
 const c=condition(at,price);
 return {id:'risk-action:pool:'+planId,planId,code,entryEventId:entry,status:c.status==='triggered'?'condition-triggered':'observing',
 sourceAt:now-20000,condition:c,execution:{allowed:true,reason:'原动作核验',evidenceStatus:'available',checkedAt:now},
 constraints:{remainingQuantity:100,price:{current:price,source:c.source,quoteAt:at,stop:8,target:14}},orders:[],orderIds:[],fills:[],continueObserving:true};
}
function closed(){
 const a=action();Object.assign(a,{status:'filled',sourceAt:now,continueObserving:false,
  fills:[{eventId:'exit',orderId:'sell',quantity:100,executionAt:now,source:'original-paper-ledger'}]});
 a.constraints.remainingQuantity=0;a.execution.allowed=false;a.condition={status:'unknown',kind:null};return a;
}
const actions=(...items)=>({accountId:'pool',generatedAt:now,items});
const stop=r=>row(r,planRootCause(planId,'stop'));
const alert=(extra={})=>({id:'old-alert',planId,code,entryEventId:entry,kind:'stop',quoteAt:now-1000,source:'original-quote',
 price:8,availability:'allowed',reason:'原条件已观察',observationId:'old-observation',...extra});
test('C35.1 direct risk rows do not expose stale or contradictory resolved labels as current clearance',()=>{
 for(const extra of [{priceDependent:true,sourceAt:now-15001},{sourceAt:null},
  {authorityEvidence:{kind:'effective-rule',enabled:true,configurationStatus:'active',source:'original',ruleId:'r',ruleVersion:'v1',observedAt:now,exceeded:true}}]){
  const x=riskRow(raw(extra),now);assert.equal(x.status,'unknown');assert.equal(x.assessmentState,'unable-to-assess');assert.equal(x.canTrade,false);
 }
 assert.equal(riskRow(raw(),now).status,'resolved');
});
test('C35.2 numeric usage alone without a boolean original breach result or policy version cannot confirm no breach',()=>{
 for(const value of [undefined,null,0,'false']){
  const r=row(report({rules:rules({exceeded:value})}),'rule/maxGrossExposurePct');assert.equal(r.status,'unknown');
 }
 assert.equal(row(report({rules:rules({},null)}),'rule/maxGrossExposurePct').status,'unknown');
 assert.equal(row(report({rules:rules()}),'rule/maxGrossExposurePct').status,'resolved');
 assert.equal(row(report({rules:rules({exceeded:true})}),'rule/maxGrossExposurePct').riskLevel,3);
});
test('C35.3 completed label must reconcile original remaining quantity and current closed-ledger receipt',()=>{
 for(const edit of [a=>a.constraints.remainingQuantity=100,a=>a.entryEventId=null,a=>a.execution.checkedAt--,
  a=>a.execution.allowed=true,a=>a.continueObserving=true,a=>a.fills=[],a=>a.sourceAt=now+1]){
  const a=closed();edit(a);const r=stop(report({actions:actions(a)}));assert.equal(r.status,'unknown');assert.equal(r.actionState,'unconfirmed');
 }
 const r=stop(report({actions:actions(closed())}));assert.equal(r.status,'resolved');assert.equal(r.priceDependent,false);
});
test('C35.4 current condition must use same original mark, source and observation time; missing data is not no trigger',()=>{
 for(const edit of [a=>delete a.condition,a=>a.condition.source='other',a=>a.condition.quoteAt--,
  a=>a.condition.observedAt--,a=>a.condition.price=11,a=>a.condition.quoteAt=now-15001]){
  const a=action();edit(a);const r=stop(report({actions:actions(a)}));assert.equal(r.status,'unknown');assert.equal(r.actionState,'unconfirmed');
 }
 assert.equal(stop(report({actions:actions(action())})).status,'resolved');
});
test('C35.5 frozen stop and target geometry must agree with the declared held condition; no new levels',()=>{
 for(const edit of [a=>{a.condition.status='not-triggered';a.condition.kind=null;},a=>a.condition.kind='target',
  a=>a.constraints.price.stop=0,a=>a.entryEventId=null]){
  const a=action(now,8);edit(a);assert.equal(stop(report({actions:actions(a)})).status,'unknown');
 }
 assert.equal(stop(report({actions:actions(action(now,8))})).status,'active');
 assert.equal(stop(report({actions:actions(action(now,9))})).status,'resolved');
});
test('C35.6 wrong lot, security or invalid newer observation cannot erase an original trigger',()=>{
 for(const edit of [a=>a.entryEventId='another-lot',a=>a.code='600001',a=>a.condition.observedAt--]){
  const a=action();edit(a);const r=stop(report({actions:actions(a),planAlerts:[alert()]}));
  assert.ok(r.evidenceReferences.some(x=>x.observationId==='old-observation'));assert.notEqual(r.status,'resolved');
 }
 const good=stop(report({actions:actions(action()),planAlerts:[alert()]}));
 assert.equal(good.status,'resolved');assert.ok(!good.evidenceReferences.some(x=>x.observationId==='old-observation'));
 const x=closed();x.constraints.remainingQuantity=100;
 assert.ok(stop(report({actions:actions(x),planAlerts:[alert()]})).evidenceReferences.some(v=>v.observationId==='old-observation'));
});
test('C35.7 a same-time original denial cannot be replaced by an allowed label when root evidence is combined',()=>{
 const a=action(now,8);a.execution.allowed=false;a.execution.reason='原退出限制';
 const r=stop(report({actions:actions(a),planAlerts:[alert({quoteAt:now})]}));
 assert.equal(r.status,'active');assert.equal(r.actionState,'blocked');assert.equal(r.canTrade,false);
 const other=action(now,8);other.code='600001';const mixed=stop(report({actions:actions(other),planAlerts:[alert({quoteAt:now})]}));
 assert.equal(mixed.status,'unknown');assert.equal(mixed.evidenceStatus,'conflict');assert.equal(mixed.actionState,'unconfirmed');
});
test('C35.8 summary includes unable-to-assess even when raw evidence was labeled available',()=>{
 const r=report({accountSafety:{accountId:'pool',risks:[raw({rootCauseId:'account/reconciliation',status:'unknown',
  severity:'warning',evidenceStatus:'available'})]}});
 const x=row(r,'account/reconciliation');assert.equal(x.assessmentState,'unable-to-assess');
 assert.equal(r.summary.unknown,r.risks.filter(y=>y.status!=='resolved'&&(y.severity==='unknown'||y.evidenceStatus!=='available'||y.assessmentState==='unable-to-assess')).length);
 assert.equal(r.summary.status,'incomplete-evidence');assert.equal(r.canTrade,false);
});
