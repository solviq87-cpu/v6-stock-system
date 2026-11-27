'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRiskAlertLifecycle,normalizeRisk}=require('../src/core/risk-alert-lifecycle');
const {riskState,resolutionCheck,reductionCheck,lastValidRisk}=require('../src/core/risk-state-contract');
const {riskRow,buildRiskWorkbench}=require('../src/core/risk-workbench');
const BASE=Date.parse('2026-11-27T10:00:00+08:00'),key={accountId:'pool',accountEpoch:'original-period'};
const rule=(at,extra={})=>({kind:'effective-rule',ruleId:'limit',ruleVersion:'v1',source:'original-paper-account',observedAt:at,enabled:true,configurationStatus:'active',exceeded:true,...extra});
const raw=(at,extra={})=>({id:'row-A',rootCauseId:'rule/limit',category:'portfolio',object:{type:'account',id:'pool'},
 severity:'critical',evidenceStatus:'available',executionStatus:'blocked',status:'active',sourceAt:at,source:'original-observation',
 facts:['原风险观察'],impact:'原风险',restrictions:['保留原限制'],checks:['核对原证据'],releaseConditions:['原证据恢复'],...extra});
const a=(at,extra={})=>raw(at,{authorityEvidence:rule(at),...extra});
const clear=(at,extra={})=>a(at,{status:'resolved',severity:'info',authorityEvidence:rule(at,{exceeded:false}),...extra});
const b=(at,extra={})=>raw(at,{id:'row-B',object:{type:'security',id:'600001'},...extra});
const missingB=()=>b(BASE,{status:'unknown',evidenceStatus:'missing',severity:'unknown'});
function space(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c-hidden-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=BASE;const make=()=>createRiskAlertLifecycle({root,clock:()=>now,canWrite:()=>true});
 let store=make();
 return {get now(){return now},advance:ms=>now+=ms,restart:()=>{store=make();return store.read(key)},read:()=>store.read(key),
  observe:rows=>store.observe({...key,risks:rows,complete:true})};
}
const group=r=>r.groups[0];
const normalized=(row,now)=>normalizeRisk(row,now);
test('H01.1 a missing sibling survives partial clearance and restart; all clear requires its own later evidence',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);f.observe([a(f.now),missingB()]);
 f.advance(1000);let g=group(f.observe([clear(f.now)]));
 assert.equal(g.status,'unknown');assert.equal(g.resolvedAt,null);assert.equal(g.events.at(-1).kind,'first-seen');
 assert.ok(group(f.restart()).pendingRecovery.some(x=>x.row.id==='row-B'));
 f.advance(1000);g=group(f.observe([b(f.now,{status:'resolved'})]));
 assert.equal(g.status,'resolved');assert.equal(g.pendingRecovery.length,0);assert.equal(g.events.at(-1).kind,'resolved');
});
test('H01.2 a missing scope cannot disappear after a later partial observation or from the workbench',t=>{
 const f=space(t);f.observe([a(f.now),missingB()]);f.advance(1000);f.observe([a(f.now)]);f.restart();
 f.advance(1000);
 const report=buildRiskWorkbench({accountId:'pool',now:f.now,alerts:f.read(),rules:{accountId:'pool',generatedAt:f.now,policyVersion:'v1',rules:[
  {id:'limit',label:'原规则',enabled:true,configurationStatus:'active',evidenceStatus:'available',used:10,limit:20,remaining:10,unit:'%',exceeded:false}]}});
 const row=report.risks.find(r=>r.rootCauseId==='rule/limit');assert.equal(row.status,'unknown');assert.equal(row.canTrade,false);
 assert.equal(group(f.observe([clear(f.now)])).status,'unknown');
});
test('H01.3 a rejected downgrade cannot discard an unresolved unknown sibling',t=>{
 const f=space(t);f.observe([a(f.now),missingB()]);f.advance(1000);
 const lower=a(f.now,{authorityEvidence:rule(f.now,{exceeded:false}),severity:'warning'});
 const x=group(f.observe([lower]));assert.equal(x.status,'unknown');assert.equal(x.lastValidRisk.riskLevel,3);
 assert.ok(x.pendingRecovery.some(p=>p.row.id==='row-B'));
});
test('H02.1 a first missing incident uses its discovery time, not the old last evidence clock',t=>{
 const f=space(t);const x=group(f.observe([raw(BASE-3600000,{evidenceStatus:'missing'})]));
 assert.equal(x.resolutionBaselineAt,BASE);f.advance(1000);
 assert.equal(group(f.observe([raw(BASE-1800000,{status:'resolved'})])).status,'unknown');
 assert.equal(group(f.observe([raw(f.now,{status:'resolved'})])).status,'resolved');
});
test('H03.1 another frozen plan, original buy lot or condition cannot clear an original held risk',()=>{
 const old=normalized(raw(BASE,{rootCauseId:'plan/p/stop',object:{type:'security',id:'600000'},references:{planId:'p',entryEventId:'lot-A',kind:'stop'}}),BASE);
 const now=BASE+1000,previous=lastValidRisk([old],BASE);
 for(const references of [{planId:'p',entryEventId:'lot-B',kind:'stop'},{planId:'p',kind:'stop'},{planId:'other',entryEventId:'lot-A',kind:'stop'},{planId:'p',entryEventId:'lot-A',kind:'target'}]){
  const next=normalized({...old,sourceAt:now,status:'resolved',references},now);
  assert.equal(resolutionCheck({risks:[next]},previous,now).allowed,false);
 }
 const correct=normalized({...old,sourceAt:now,status:'resolved'},now);
 assert.equal(resolutionCheck({risks:[correct]},previous,now).allowed,true);
});
test('H04.1 a fresh wrapper cannot grant positive display permission over stale, conflicted or newer-than-check price evidence',()=>{
 const actionEvidence={allowed:true,evidenceStatus:'available',checkedAt:BASE,reason:'原动作核验'};
 for(const patch of [{evidenceStatus:'stale',sourceAt:BASE-15001},{evidenceStatus:'conflict'},{dataAt:BASE-15001},
  {actionEvidence:{...actionEvidence,checkedAt:BASE-1}},{actionEvidence:{...actionEvidence,quoteAt:BASE-1}}]){
  const row=raw(BASE,{priceDependent:true,actionEvidence,...patch});const x=riskState(row,BASE);
  assert.equal(x.actionState,'unconfirmed');assert.equal(x.riskContract.canAuthorize,false);
 }
 const current=riskState(raw(BASE,{priceDependent:true,actionEvidence}),BASE);assert.equal(current.actionState,'allowed');
 const denied=riskState(raw(BASE-15001,{priceDependent:true,evidenceStatus:'stale',actionEvidence:{...actionEvidence,allowed:false}}),BASE);
 assert.equal(denied.actionState,'blocked');
 assert.equal(riskState(raw(BASE-15001,{priceDependent:false,actionEvidence}),BASE).actionState,'allowed');
});
test('H05.1 invalid attached rule or system authority cannot manufacture a complete clearance',()=>{
 for(const authorityEvidence of [rule(BASE+1),rule(BASE,{observedAt:null,exceeded:false}),rule(BASE,{ruleVersion:null,exceeded:false}),
  rule(BASE,{exceeded:null}),rule(BASE,{enabled:false,exceeded:false}),{kind:'quote-reader-failed',source:'original-reader',observedAt:BASE+1,detected:false}]){
  const x=raw(BASE,{status:'resolved',authorityEvidence});
  assert.equal(normalizeRisk(x,BASE).status,'unknown');assert.equal(riskRow(x,BASE).status,'unknown');
 }
 assert.equal(normalizeRisk(clear(BASE),BASE).status,'resolved');
 assert.equal(normalizeRisk(raw(BASE,{status:'resolved'}),BASE).status,'resolved');
});
test('H05.2 rejected clearance cannot create a new false incident or block a genuine same-clock recovery',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);
 for(const authorityEvidence of [rule(f.now+1,{exceeded:false}),rule(f.now,{ruleVersion:'wrong',exceeded:false})]){
  const x=group(f.observe([clear(f.now,{authorityEvidence})]));assert.equal(x.status,'unknown');
  assert.equal(x.pendingRecovery.length,1);assert.equal(x.pendingRecovery[0].row.authorityEvidence.ruleVersion,'v1');
 }
 const good=group(f.observe([clear(f.now)]));assert.equal(good.status,'resolved');assert.equal(good.pendingRecovery.length,0);
});
