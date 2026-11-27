'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/risk-workbench-read-scope.mjs');
const at=Date.parse('2026-11-27T10:00:00+08:00'),epoch='a'.repeat(64);
const report=(id='pool',generatedAt=at,selectedCode=null)=>({protocol:'fayo-risk-workbench-v1',account:{id},accountEpoch:epoch,generatedAt,risks:[],summary:{},
 ...(selectedCode?{selectedCode}:{}),alerts:{schemaVersion:1,accountId:id,accountEpoch:epoch,revision:0,canTrade:false,ledgerOwned:false,
 groups:[{rootCauseId:'risk/root'}],preferences:{generalMutedUntil:null,criticalMutedUntil:null}}});
const input=(r,startedAt,receivedAt)=>({report:r,accountId:r.account.id,selectedCode:r.selectedCode??null,startedAt,receivedAt});
test('C12.1 same server generation never renews receipt, including code changes',async()=>{
 const a=await api,t=a.createRiskReceiptTracker(),r=report();
 assert.equal(t.accept(input(r,100,200)).expiresAt,15100);
 assert.equal(t.accept(input(report('pool',at,'600001'),5000,5100)).expiresAt,15100);
 assert.equal(t.accept(input(report(),15000,15100)),null);
 assert.equal(t.accept(input(report(),16000,16100)),null);
});
test('C12.1 first response already expired cannot be revived by another request',async()=>{
 const a=await api,t=a.createRiskReceiptTracker();
 assert.equal(t.accept(input(report(),0,15000)),null);
 assert.equal(t.accept(input(report(),15001,15002)),null);
});
test('C12.1 clock rollback rejected, genuinely newer generation and different account separated',async()=>{
 const a=await api,t=a.createRiskReceiptTracker();
 assert.ok(t.accept(input(report(),100,200)));
 assert.equal(t.accept(input(report('pool',at-1),300,400)),null);
 assert.equal(t.accept(input(report('pool',at+1),150,199)),null);
 assert.equal(t.accept(input(report('pre',at-100),500,600)).expiresAt,15500);
 assert.equal(t.accept(input(report('pool',at+1),700,800)).expiresAt,15700);
});
test('C12.2 an explicit missing original data clock cannot use a newer wrapper time',async()=>{
 const a=await api,r=report();r.risks=[{priceDependent:true,dataState:'valid',sourceAt:at,riskContract:{dataAt:null}}];
 assert.equal(a.createRiskViewReceipt(input(r,100,200)),null);
 r.risks[0].riskContract={};assert.ok(a.createRiskViewReceipt(input(r,100,200)));
 r.risks[0].riskContract={dataAt:at-14950};assert.equal(a.createRiskViewReceipt(input(r,100,200)),null);
});
test('C12.2 replay cannot restore the portion of the original quote budget already consumed',async()=>{
 const a=await api,t=a.createRiskReceiptTracker(),r=report();r.equity={positions:[{evidenceStatus:'available',quote:{quoteAt:at-14000}}]};
 assert.equal(t.accept(input(r,100,200)).expiresAt,1100);
 assert.equal(t.accept(input(structuredClone(r),900,1000)).expiresAt,1100);
 assert.equal(t.accept(input(structuredClone(r),1100,1200)),null);
});
function page(state='visible'){const doc=new EventTarget();doc.visibilityState=state;doc.change=value=>{doc.visibilityState=value;doc.dispatchEvent(new Event('visibilitychange'));};return doc;}
test('C12.3 hiding or restoring a document emits only actual transitions',async()=>{
 const a=await api,doc=page(),c=new AbortController(),events=[];
 const w=a.watchRiskVisibility(doc,{signal:c.signal,onHidden:()=>events.push('hidden'),onVisible:()=>events.push('visible')});
 doc.change('hidden');doc.change('hidden');assert.equal(w.visible(),false);doc.change('visible');doc.change('visible');
 assert.equal(w.visible(),true);assert.deepEqual(events,['hidden','visible']);w.dispose();doc.change('hidden');assert.equal(events.length,2);
});
test('C12.3 hidden initial document or aborted scope cannot appear available',async()=>{
 const a=await api,doc=page('hidden'),c=new AbortController(),events=[];
 const w=a.watchRiskVisibility(doc,{signal:c.signal,onVisible:()=>events.push('visible')});assert.equal(w.visible(),false);
 doc.change('visible');assert.equal(w.visible(),true);c.abort();doc.change('hidden');doc.change('visible');assert.equal(w.visible(),false);assert.deepEqual(events,['visible']);
});
test('C12.4 correct notification receipt binds explicit account epoch and revision zero',async()=>{
 const a=await api,r=report();assert.equal(a.boundRiskAlerts(r),r.alerts);
 assert.deepEqual(a.buildRiskAlertMutation(r,{action:'view',rootCauseId:'risk/root'}),{action:'view',accountId:'pool',accountEpoch:epoch,expectedRevision:0,rootCauseId:'risk/root'});
 assert.deepEqual(a.buildRiskAlertMutation(r,{action:'mute',classification:'critical',mutedUntil:null}),{action:'mute',accountId:'pool',accountEpoch:epoch,expectedRevision:0,classification:'critical',mutedUntil:null});
});
test('C12.4 absent mixed or damaged alert receipts cannot become empty editable archives',async()=>{
 const a=await api;for(const edit of [r=>r.alerts=null,r=>r.alerts.accountId='pre',r=>r.alerts.accountEpoch='b'.repeat(64),r=>r.alerts.revision=-1,r=>r.alerts.revision=null,r=>r.alerts.canTrade=true,r=>r.alerts.ledgerOwned=true,r=>r.alerts.groups.push({...r.alerts.groups[0]})]){
  const r=report();edit(r);assert.equal(a.boundRiskAlerts(r),null);assert.equal(a.buildRiskAlertMutation(r,{action:'mute',classification:'critical',mutedUntil:null}),null);
 }
});
test('C12.4 unknown root, ambiguous scope, unknown actions and fake confirmation rejected',async()=>{
 const a=await api,r=report();for(const x of [{action:'view',rootCauseId:'other'},{action:'view',rootCauseId:'risk/root',classification:'critical'},
 {action:'mute',rootCauseId:'risk/root',classification:'critical',mutedUntil:null},{action:'mute',rootCauseId:'other',classification:'critical',mutedUntil:null},
 {action:'mute',classification:'critical',mutedUntil:0},{action:'mute',classification:'other',mutedUntil:null},{action:'confirm',rootCauseId:'risk/root'}])assert.equal(a.buildRiskAlertMutation(r,x),null);
});
test('C12.5 single in-flight mutation token cannot be replaced or released by old completion',async()=>{
 const a=await api,g=a.createRiskMutationGate(),one=g.begin();assert.ok(one);assert.equal(g.available(),false);assert.equal(g.begin(),null);assert.equal(g.end({}),false);
 assert.equal(g.end(one),true);const two=g.begin();assert.ok(two);assert.equal(g.end(one),false);assert.equal(g.available(),false);assert.equal(g.end(two),true);assert.equal(g.available(),true);
});
