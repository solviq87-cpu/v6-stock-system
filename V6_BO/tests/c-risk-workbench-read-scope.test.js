'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/risk-workbench-read-scope.mjs');
const at=Date.parse('2026-11-27T10:00:00+08:00'),epoch='a'.repeat(64),fp='b'.repeat(64),eid='c'.repeat(64);
function report(accountId='pool',selectedCode=null){
 const base={accountId,accountEpoch:epoch,accountRevision:2,authoritySnapshotFingerprint:fp,equityEvidenceId:eid,asOf:at};
 const flags={researchOnly:true,canTrade:false,canNotify:false,writesAccount:false,accountMutated:false,executionGuaranteed:false,maximumLossGuarantee:false};
 return {protocol:'fayo-risk-workbench-v1',account:{id:accountId},generatedAt:at,accountEpoch:epoch,accountRevision:2,risks:[],summary:{},
  ...(selectedCode===null?{}:{selectedCode}),equity:{accountId,accountEpoch:epoch,observedAt:at,fingerprint:eid,source:{snapshotFingerprint:fp,accountRevision:2}},
  stress:{...base,generatedAt:at,adversePaths:{...base,...flags,protocol:'fayo-adverse-path-research-v1',paths:[]},
   planOdds:{...base,...flags,protocol:'fayo-frozen-plan-odds-research-v1',rows:[]}}};
}
const reply=result=>({ok:true,result});
const receipt=(a,r,extra={})=>a.createRiskViewReceipt({report:r,accountId:r.account.id,selectedCode:r.selectedCode??null,startedAt:100,receivedAt:200,...extra});
const ctx=(r,extra={})=>({report:r,accountId:r.account.id,selectedCode:r.selectedCode??null,now:300,available:true,editable:true,...extra});
test('C11.1 exact same-account security response accepted; wrong, absent or extra code rejected',async()=>{
 const a=await api,r=report('pool','600000');assert.equal(a.validateRiskRead(reply(r),'pool','600000'),r);
 for(const bad of [report('pool','600001'),report(),report('pre','600000')])assert.throws(()=>a.validateRiskRead(reply(bad),'pool','600000'),/风险回执/);
 assert.throws(()=>a.validateRiskRead(reply(r),'pool'),/风险回执/);
});
test('C11.1 malformed observation time or incomplete core report cannot be read as current',async()=>{
 const a=await api;for(const extra of [{generatedAt:null},{generatedAt:0},{generatedAt:1.5},{risks:null},{summary:null}])assert.throws(()=>a.validateRiskRead(reply({...report(),...extra}),'pool'),/风险回执/);
 assert.equal(a.validateRiskRead(reply(report()),'pool').account.id,'pool');
});
test('C11.2 scope abort after request completion still invalidates the selected security',async()=>{
 const a=await api,controller=new AbortController();let invalidations=0;const s=a.createRiskScope(()=>invalidations++);
 assert.equal(s.set(controller.signal),true);controller.abort();assert.equal(invalidations,1);assert.equal(s.active(),false);s.detach();assert.equal(invalidations,1);
});
test('C11.2 old scope abort cannot invalidate a replacement; disposal removes listeners',async()=>{
 const a=await api,old=new AbortController(),next=new AbortController();let invalidations=0;const s=a.createRiskScope(()=>invalidations++);
 s.set(old.signal);s.set(next.signal);old.abort();assert.equal(invalidations,0);s.detach();next.abort();assert.equal(invalidations,0);
});
test('C11.2 already-aborted scope refuses to read',async()=>{
 const a=await api,c=new AbortController();c.abort();let invalidations=0;const s=a.createRiskScope(()=>invalidations++);assert.equal(s.set(c.signal),false);assert.equal(invalidations,1);
});
test('C11.3 freshness is bounded from request start, not the later receipt or redraw',async()=>{
 const a=await api,r=report(),v=receipt(a,r,{receivedAt:14999});assert.equal(a.remainingRiskViewMs(v,14999),101);assert.equal(a.remainingRiskViewMs(v,15100),0);
 assert.equal(receipt(a,r,{receivedAt:15100}),null);assert.equal(receipt(a,r,{receivedAt:99}),null);assert.equal(a.remainingRiskViewMs(v,14998),0);
});
test('C11.3 elapsed time ignores historical server clock but never renews an old receipt',async()=>{
 const a=await api,r=report(),v=receipt(a,r);assert.equal(a.riskViewMatches(v,ctx(r)),true);assert.equal(a.riskViewMatches(v,ctx(r,{now:15100})),false);
 assert.equal(a.riskViewMatches(v,ctx(r,{now:199})),false);
});
test('C11.4 old account, old report, detached role or connectivity cannot act on a different current report',async()=>{
 const a=await api,r=report(),v=receipt(a,r);for(const extra of [{report:report()},{accountId:'pre'},{selectedCode:'600000'},{available:false},{editable:false},{aborted:true},{now:15100}])assert.equal(a.riskViewMatches(v,ctx(r,extra)),false);
 assert.equal(a.riskViewMatches(v,ctx(r)),true);
});
test('C11.5 correct research projections are subordinate to one original report; no new authority',async()=>{
 const a=await api,r=report();assert.equal(a.boundRiskResearch(r,'adversePaths'),r.stress.adversePaths);assert.equal(a.boundRiskResearch(r,'planOdds'),r.stress.planOdds);assert.equal(a.boundRiskResearch(r,'other'),null);
});
test('C11.5 mixed account, epoch, equity fingerprint, revision, clock or permission hides only optional research',async()=>{
 const a=await api;for(const patch of [{accountId:'pre'},{accountEpoch:fp},{accountRevision:3},{equityEvidenceId:fp},{authoritySnapshotFingerprint:eid},{asOf:at-1},{canTrade:true},{canNotify:true},{maximumLossGuarantee:true}]){
  const r=report();Object.assign(r.stress.adversePaths,patch);assert.equal(a.boundRiskResearch(r,'adversePaths'),null);assert.equal(a.boundRiskResearch(r,'planOdds'),r.stress.planOdds);assert.equal(r.account.id,'pool');
 }
});
test('C11.5 mismatch in parent report or missing original equity makes research unknown, never default zero',async()=>{
 const a=await api;for(const edit of [r=>{r.equity=null},r=>{r.stress.generatedAt++},r=>{r.stress.accountId='pre'},r=>{r.accountRevision++},r=>{r.equity.fingerprint=fp}]){const r=report();edit(r);assert.equal(a.boundRiskResearch(r,'adversePaths'),null);assert.equal(a.boundRiskResearch(r,'planOdds'),null);}
});
test('C11.3 original quote age shortens the remaining presentation lifetime, expired or future claimed current price cannot renew it',async()=>{
 const a=await api,r=report();r.equity.positions=[{evidenceStatus:'available',quote:{quoteAt:at-14000}}];
 const v=receipt(a,r);assert.equal(a.remainingRiskViewMs(v,200),900);assert.equal(a.remainingRiskViewMs(v,1100),0);
 assert.equal(receipt(a,r,{receivedAt:1100}),null);
 for(const quoteAt of [at-15001,at+1,null]){r.equity.positions[0].quote.quoteAt=quoteAt;assert.equal(receipt(a,r),null);}
});
test('C11.3 explicit historical or unavailable risk rows do not fabricate current clocks or erase valid original report',async()=>{
 const a=await api,r=report();r.risks=[{priceDependent:true,dataState:'stale',sourceAt:at-99999}];
 assert.equal(a.remainingRiskViewMs(receipt(a,r),200),14900);
 r.risks[0].dataState='valid';assert.equal(receipt(a,r),null);
});
