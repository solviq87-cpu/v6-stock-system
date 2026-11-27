'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildWorkspaceDecision,assessResearchAlignment}=require('../src/core/research-workspace-decision');
const {fixture,native}=require('./helpers/research-workspace-fixtures');
const check=(f)=>f.research36.evaluations[0].checks[0];
const condition=r=>r.conditions.find(x=>x.id==='test-rule:funds');
const evidence=(r,c)=>r.evidence.find(x=>x.id===c.evidenceIds[0]);
test('future, malformed or cross-stock evidence cannot create a known condition',()=>{
 for(const patch of [{observedAt:'invalid'},{sourceTimestamp:1e16},{knownAt:null,receivedAt:1e16},{code:'000001'},{symbol:'000001'}]){
  const f=fixture(),c=check(f);c.pass=true;c.value=99;Object.assign(c.evidence,patch);
  const out=buildWorkspaceDecision(f),row=condition(out);
  assert.equal(row.status,'unknown');assert.equal(row.value,null);
  assert.equal(evidence(out,row).status,'unknown');assert.equal(evidence(out,row).value,null);
 }
 const f=fixture(),c=check(f);c.pass=true;c.evidence.observedAt=f.asOf+1;
 assert.equal(condition(buildWorkspaceDecision(f)).status,'unknown');
});
test('all availability clocks must be checked, not just the preferred one',()=>{
 for(const key of ['receivedAt','availableAt','recordedAt','knownAt']){
  const f=fixture(),c=check(f);c.pass=true;c.evidence[key]=f.asOf+1;
  const row=condition(buildWorkspaceDecision(f));assert.equal(row.status,'unknown');
 }
 const f=fixture(),c=check(f);c.evidence.receivedAt=f.asOf-1;
 assert.equal(condition(buildWorkspaceDecision(f)).status,'unknown');
});
test('explicit unknown or missing conditions cannot retain numeric evidence, known zero is preserved',()=>{
 const f=fixture(),c=check(f);c.missing='资金未知';c.pass=true;c.value=90;
 let out=buildWorkspaceDecision(f),row=condition(out);
 assert.equal(row.status,'unknown');assert.equal(row.value,null);assert.equal(evidence(out,row).value,null);
 delete c.missing;c.pass=null;out=buildWorkspaceDecision(f);row=condition(out);
 assert.equal(row.status,'unknown');assert.equal(row.value,null);assert.equal(evidence(out,row).value,null);
 c.pass=false;c.value=0;out=buildWorkspaceDecision(f);row=condition(out);
 assert.equal(row.status,'fail');assert.equal(row.value,0);assert.equal(evidence(out,row).value,0);
});
test('future research result and impossible calendar date cannot be admitted',()=>{
 const f=fixture();f.research36.asOf=f.asOf+1;
 assert.equal(condition(buildWorkspaceDecision(f)),undefined);
 const invalid=fixture();invalid.stock.bars[0].date='2025-02-30';
 assert.throws(()=>buildWorkspaceDecision(invalid),/K线/);
});
test('future source references and missing bundle identity remain unlinked',()=>{
 const f=fixture();f.evidenceBundle.sourceRefs.push({source:'future',sha256:'c'.repeat(64),receivedAt:f.asOf+1,url:'https://example.org/future'});
 assert.equal(buildWorkspaceDecision(f).sourceRefs.length,1);
 delete f.evidenceBundle.hash;const r=buildWorkspaceDecision(f);
 assert.equal(r.bundleHash,null);assert.equal(r.sourceRefs.length,0);
});
test('market regime is based on the same historical date, not a stale same-date flag',()=>{
 const f=fixture(),d=f.stock.bars.at(-1).date;
 f.linkage={sameMarketTradeDate:true,tradeDate:d,marketTradeDate:'2025-01-01',indices:{shanghaiChangePct:2}};
 assert.equal(buildWorkspaceDecision(f).regime,'unknown');
 f.linkage.marketTradeDate=d;assert.equal(buildWorkspaceDecision(f).regime,'index-up');
});
const group=(id,verdict='pass',missing=[])=>({id,verdict,known:missing.length?1:2,total:2,missing});
const groups=()=>['fourteen','bazi','gpt','python'].map(id=>group(id));
const options={linked:true,marketRegime:'index-up'};
test('full agreement remains observation only; unknown or opposition never yields a buy permission',()=>{
 const a=assessResearchAlignment(groups(),options);assert.equal(a.status,'aligned-research-only');assert.equal(a.action,'observe');
 assert.equal(a.canTrade,false);assert.equal(a.canNotify,false);assert.equal(a.combinedScore,null);assert.equal(a.probability,null);
 const r=groups();r[0]=group('fourteen','fail');
 const b=assessResearchAlignment(r,options);assert.equal(b.status,'strategy-disagreement');assert.equal(b.action,'defer');
 assert.deepEqual(b.opposition,['fourteen']);
});
test('watch, incomplete coverage, duplicate systems and absent market context trigger defer',()=>{
 for(const variant of [
  groups().slice(0,3),[...groups(),group('python')],groups().map(x=>x.id==='bazi'?group('bazi','watch'):x),
  groups().map(x=>x.id==='gpt'?group('gpt','pass',['missing']):x)]){
  assert.equal(assessResearchAlignment(variant,options).action,'defer');
 }
 assert.equal(assessResearchAlignment(groups(),{linked:false,marketRegime:'index-up'}).action,'defer');
 assert.equal(assessResearchAlignment(groups(),{linked:true,marketRegime:'unknown'}).action,'defer');
});
test('integrated decision output preserves native GPT and Python and abstains with missing systems',()=>{
 const r=buildWorkspaceDecision(fixture(),native());
 assert.equal(r.systems.find(x=>x.id==='python').verdict,'pass');
 assert.equal(r.systems.find(x=>x.id==='gpt').verdict,'pass');
 assert.equal(r.decisionAssessment.action,'defer');assert.equal(r.decisionAssessment.canTrade,false);
 assert.equal(r.decisionAssessment.support.includes('python'),true);
 assert.equal(r.decisionAssessment.unresolved.includes('fourteen'),true);
});
