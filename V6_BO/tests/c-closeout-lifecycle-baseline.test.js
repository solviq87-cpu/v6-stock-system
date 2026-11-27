'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRiskAlertLifecycle,normalizeRisk,groupRows}=require('../src/core/risk-alert-lifecycle');
const BASE=Date.parse('2026-11-27T10:00:00+08:00'),key={accountId:'pool',accountEpoch:'original-period'};
const rule=(at,extra={})=>({kind:'effective-rule',ruleId:'original-limit',ruleVersion:'v1',source:'original-account',observedAt:at,enabled:true,configurationStatus:'active',exceeded:true,...extra});
const risk=(at,extra={})=>({id:'row-A',rootCauseId:'same-root',category:'portfolio',object:{type:'security',id:'600000'},severity:'critical',
 evidenceStatus:'available',executionStatus:'blocked',status:'active',sourceAt:at,source:'original-observation',
 facts:['原风险观察'],impact:'仅研究显示',restrictions:['原限制保留'],checks:['核对原回执'],releaseConditions:['原证据恢复'],...extra});
const a=(at,extra={})=>risk(at,{authorityEvidence:rule(at),...extra});
const b=(at,extra={})=>risk(at,{id:'row-B',object:{type:'security',id:'600001'},authorityEvidence:rule(at),...extra});
const clear=(at,extra={})=>a(at,{status:'resolved',severity:'info',authorityEvidence:rule(at,{exceeded:false}),...extra});
const unknown=()=>risk(null,{status:'unknown',evidenceStatus:'missing',severity:'unknown'});
function space(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c-closeout-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=BASE;
 const make=()=>createRiskAlertLifecycle({root,clock:()=>now,canWrite:()=>true});
 const store=make(),observe=rows=>store.observe({...key,risks:rows,complete:true});
 return {make,store,observe,get now(){return now;},advance:n=>{now+=n;}};
}
const g=value=>value.groups[0];
const find=(value,id)=>value.lastValidRisk?.risks.find(r=>r.id===id);
test('C34.1 a resolved label with stale price, still-hit rule or detected incident remains unknown at normalization',()=>{
 for(const row of [
  risk(BASE-15001,{status:'resolved',priceDependent:true}),
  a(BASE,{status:'resolved'}),
  risk(BASE,{status:'resolved',authorityEvidence:{kind:'quote-reader-failed',source:'original-reader',observedAt:BASE,detected:true}})
 ]){
  const n=normalizeRisk(row,BASE);assert.equal(n.status,'unknown');assert.equal(n.assessmentState,'unable-to-assess');
 }
 assert.equal(normalizeRisk(clear(BASE),BASE).status,'resolved');
});
test('C34.2 grouping cannot turn an inconsistent derived resolved row into a confirmed all-clear',()=>{
 const valid=normalizeRisk(clear(BASE),BASE);
 for(const patch of [{assessmentState:'unable-to-assess'},{dataState:'stale'},{evidenceState:'conflict'}]){
  const group=groupRows([{...valid,...patch}])[0];assert.equal(group.status,'unknown');assert.equal(group.assessmentState,'unable-to-assess');
 }
 assert.equal(groupRows([valid])[0].status,'resolved');
});
test('C34.3 reopening an unknown occurrence must not inherit the last occurrence valid grade',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);
 const closed=g(f.observe([clear(f.now)]));assert.equal(closed.status,'resolved');assert.equal(closed.lastValidRisk.riskLevel,3);
 f.advance(1000);const open=g(f.observe([unknown()]));assert.equal(open.status,'unknown');assert.equal(open.occurrence,2);
 assert.equal(open.lastValidRisk,null);assert.equal(g(f.make().read(key)).lastValidRisk,null);
 assert.equal(open.events.at(-1).kind,'reopened');
});
test('C34.4 a reopened incomplete incident starts its own baseline, not the original first event',t=>{
 const f=space(t);f.observe([unknown()]);f.advance(1000);
 assert.equal(g(f.observe([risk(f.now,{status:'resolved'})])).status,'resolved');
 f.advance(1000);const reopened=g(f.observe([unknown()]));assert.equal(reopened.resolutionBaselineAt,f.now);
 f.advance(1000);const early=g(f.observe([risk(BASE+1500,{status:'resolved'})]));
 assert.equal(early.status,'unknown');assert.equal(early.resolvedAt,null);
 assert.equal(g(f.observe([risk(f.now,{status:'resolved'})])).status,'resolved');
});
test('C34.5 another object at the same grade cannot erase an unresolved original object',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);
 const x=g(f.observe([b(f.now)]));assert.equal(x.riskLevel,3);assert.ok(find(x,'row-A'));assert.ok(find(x,'row-B'));
 assert.ok(find(g(f.make().read(key)),'row-A'));
 f.advance(1000);const onlyB=b(f.now,{status:'resolved',authorityEvidence:rule(f.now,{exceeded:false})});
 assert.equal(g(f.observe([onlyB])).status,'unknown');
});
test('C34.6 a newer group clock cannot replace a newer original scope with an older row',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);f.observe([a(f.now)]);
 f.advance(1000);const x=g(f.observe([a(BASE),b(f.now)]));
 assert.equal(x.lastValidRisk.sourceAt,f.now);assert.equal(find(x,'row-A').sourceAt,BASE+1000);
 assert.equal(find(x,'row-B').sourceAt,f.now);
});
test('C34.7 partial clearance must match original authority; a genuine clearance can retire just its own scope',t=>{
 const f=space(t);f.observe([a(f.now),b(f.now)]);f.advance(1000);
 let x=g(f.observe([clear(f.now,{authorityEvidence:rule(f.now,{exceeded:false,source:'unrelated'})}),b(f.now)]));
 assert.ok(find(x,'row-A'));assert.ok(find(x,'row-B'));
 f.advance(1000);x=g(f.observe([clear(f.now),b(f.now)]));
 assert.equal(find(x,'row-A'),undefined);assert.ok(find(x,'row-B'));assert.equal(x.status,'active');
});
test('C34.8 replay of an older active observation cannot reopen a genuinely resolved occurrence',t=>{
 const f=space(t);f.observe([a(f.now)]);f.advance(1000);
 const closed=g(f.observe([clear(f.now)]));f.advance(1000);
 const replay=f.observe([a(BASE)]);assert.equal(replay.changed,false);assert.equal(g(replay).status,'resolved');
 assert.equal(g(replay).events.length,closed.events.length);assert.equal(g(replay).occurrence,1);
 const fresh=g(f.observe([a(f.now)]));assert.equal(fresh.status,'active');assert.equal(fresh.occurrence,2);
 assert.equal(fresh.lastValidRisk.sourceAt,f.now);
});

test('C39.1 a currently missing quote with its last original old timestamp reopens after valid clearance',t=>{
 const f=space(t),missing=risk(BASE,{evidenceStatus:'missing'});
 f.observe([missing]);f.advance(1000);f.observe([risk(BASE,{status:'resolved',evidenceStatus:'stale'})]);
 f.advance(1000);const closed=g(f.observe([risk(f.now,{status:'resolved'})]));
 assert.equal(closed.status,'resolved');f.advance(1000);
 const open=g(f.observe([missing]));assert.equal(open.occurrence,2);assert.equal(open.events.at(-1).kind,'reopened');
 assert.equal(open.firstSeenAt,BASE);assert.equal(open.resolvedAt,null);assert.equal(open.lastValidRisk,null);
});
test('C39.2 stale, partial, conflict and unknown active evidence must not be silently suppressed after recovery',t=>{
 for(const evidenceStatus of ['stale','partial','conflict','unknown']){
  const f=space(t);f.observe([risk(BASE)]);f.advance(1000);f.observe([risk(f.now,{status:'resolved'})]);f.advance(1000);
  const open=g(f.observe([risk(BASE,{evidenceStatus})]));
  assert.equal(open.occurrence,2);assert.equal(open.status,'active');assert.equal(open.events.at(-1).kind,'reopened');
 }
});
test('C39.3 exact retained complete evidence replay stays closed; changed original facts do not',t=>{
 const f=space(t);f.observe([a(BASE)]);f.advance(1000);f.observe([clear(f.now)]);f.advance(1000);
 const replay=f.make().observe({...key,risks:[a(BASE)],complete:true});assert.equal(replay.changed,false);
 assert.equal(g(replay).status,'resolved');assert.equal(g(replay).occurrence,1);
 const open=g(f.observe([a(BASE,{facts:['原风险出现新的更正事实']})]));assert.equal(open.occurrence,2);
 assert.equal(open.events.at(-1).kind,'reopened');
});
test('C39.4 another object under the same root cannot borrow an unrelated old clearance',t=>{
 const f=space(t);f.observe([a(BASE)]);f.advance(1000);f.observe([clear(f.now)]);f.advance(1000);
 const open=g(f.observe([b(BASE)]));assert.equal(open.occurrence,2);
 assert.equal(open.lastValidRisk.risks[0].object.id,'600001');
});
test('C39.5 different source or rule version is not an exact historical replay',t=>{
 for(const extra of [{source:'another-original-source'},{authorityEvidence:rule(BASE,{ruleVersion:'v2'})}]){
  const f=space(t);f.observe([a(BASE)]);f.advance(1000);f.observe([clear(f.now)]);f.advance(1000);
  assert.equal(g(f.observe([a(BASE,extra)])).occurrence,2);
 }
});
test('C39.6 old valid active row alongside unknown or missing sibling cannot hide the new gap',t=>{
 const f=space(t);f.observe([a(BASE)]);f.advance(1000);f.observe([clear(f.now)]);f.advance(1000);
 const sibling=b(BASE,{status:'unknown',evidenceStatus:'missing',authorityEvidence:null});
 const open=g(f.observe([a(BASE),sibling]));assert.equal(open.occurrence,2);
 assert.ok(open.risks.some(r=>r.id==='row-B'&&r.status==='unknown'));
});
test('C39.7 newer original knowledge or data clocks are not an older complete replay',t=>{
 for(const patch of [now=>({firstKnowableAt:now}),now=>({dataAt:now}),now=>({actionEvidence:{allowed:false,reason:'原新检查',checkedAt:now,evidenceStatus:'available'}})]){
  const f=space(t);f.observe([a(BASE)]);f.advance(1000);f.observe([clear(f.now)]);f.advance(1000);
  const open=g(f.observe([a(BASE,patch(f.now))]));assert.equal(open.occurrence,2);
 }
});
test('C39.8 reopened missing observation uses its own current baseline; older recovery cannot close it again',t=>{
 const f=space(t);f.observe([risk(BASE)]);f.advance(1000);const closed=g(f.observe([risk(f.now,{status:'resolved'})]));
 f.advance(1000);const open=g(f.observe([risk(BASE,{evidenceStatus:'missing'})]));
 assert.equal(open.resolutionBaselineAt,f.now);assert.equal(open.occurrence,2);
 f.advance(1000);const stale=g(f.observe([risk(closed.resolvedAt+100,{status:'resolved'})]));
 assert.equal(stale.status,'unknown');assert.equal(stale.resolvedAt,null);
 const fresh=g(f.observe([risk(f.now,{status:'resolved'})]));assert.equal(fresh.status,'resolved');assert.equal(fresh.occurrence,2);
});
