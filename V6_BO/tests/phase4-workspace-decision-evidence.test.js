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

test('decision workspace refuses GPT children from a later receipt or another security',()=>{
 for(const patch of [{knownAt:null},{sourceTimestamp:fixture().asOf+1},{symbol:'000001'},{date:'2025-01-01'}]){
  for(const part of ['scores','market']){
   const n=native();Object.assign(n.gptEvidence[part],patch);
   assert.throws(()=>buildWorkspaceDecision(fixture(),n),/GPT子证据/);
  }
 }
 const n=native();n.gptEvidence.knownAt-=1000;n.gptEvidence.market.knownAt=n.gptEvidence.knownAt+1;
 assert.throws(()=>buildWorkspaceDecision(fixture(),n),/GPT子证据/);
 const valid=native();valid.gptEvidence.market.knownAt=valid.gptEvidence.knownAt;
 assert.equal(buildWorkspaceDecision(fixture(),valid).systems.find(x=>x.id==='gpt').verdict,'pass');
});
test('decision workspace refuses future or cross-security Python round metadata',()=>{
 for(const patch of [{knownAt:null},{recordedAt:fixture().asOf+1},{symbol:'000001'},{date:'2025-01-01'}]){
  const n=native();Object.assign(n.pythonEvidence.rounds[0],patch);
  assert.throws(()=>buildWorkspaceDecision(fixture(),n),/Python轮次证据/);
 }
 const n=native();n.pythonEvidence.knownAt-=1000;n.pythonEvidence.rounds[0].knownAt=n.pythonEvidence.knownAt+1;
 assert.throws(()=>buildWorkspaceDecision(fixture(),n),/Python轮次证据/);
 const valid=native();valid.pythonEvidence.rounds[0].knownAt=valid.pythonEvidence.knownAt;
 assert.equal(buildWorkspaceDecision(fixture(),valid).systems.find(x=>x.id==='python').verdict,'pass');
});
test('unrecognized regime and nonboolean linkage cannot imply complete alignment',()=>{
 for(const opts of [{linked:'true',marketRegime:'index-up'},{linked:true,marketRegime:'invalid'},{linked:true,marketRegime:null}]){
  assert.equal(assessResearchAlignment(groups(),opts).action,'defer');
 }
 assert.equal(assessResearchAlignment(groups(),options).action,'observe');
});
test('pre-close streak count cannot be frozen as a final closed-session fourteen-rule result',()=>{
 const f=fixture(),date=f.stock.bars.at(-1).date,proof={symbol:f.stock.symbol,date,knownAt:Date.parse(date+'T14:59:59+08:00'),source:'provider:original',stock:{limitUpCount:0}};
 assert.throws(()=>buildWorkspaceDecision(f,{fourteenEvidence:proof}),/连板证据早于/);
 proof.knownAt=Date.parse(date+'T15:00:00+08:00');
 assert.equal(buildWorkspaceDecision(f,{fourteenEvidence:proof}).conditions.find(x=>x.id==='fourteen:11').status,'pass');
});

test('eight-word workspace funds require the latest three complete same-stock sessions',()=>{
 const f=fixture(),days=f.stock.bars.slice(-3).map(b=>b.date);
 const flow={symbol:f.stock.symbol,source:'eastmoney',unit:'CNY',fundsMethod:'vendor-order-size-estimate',
  retrievedAt:f.asOf,records:days.map(tradeDate=>({tradeDate,mainNetInflow:1e8,dailyResearchEligible:true}))};
 const original=JSON.parse(JSON.stringify(flow)),fund=r=>r.conditions.find(x=>x.id==='bazi:fund');
 const build=proof=>{const x=fixture();x.marketContext={funds:{stock:proof}};return fund(buildWorkspaceDecision(x));};
 const noFunds=build(null),good=build(flow);
 assert.equal(noFunds.status,'unknown');
 assert.equal(good.status,'pass');
 assert.ok(good.value>0);
 for(const patch of [{partial:true},{unit:'USD'},{simulated:true},{retrievedAt:Date.parse(days.at(-1)+'T14:59:00+08:00')}])
  assert.deepEqual(build({...flow,...patch}),noFunds);
 for(const patch of [{dailyResearchEligible:false},{closed:false},{symbol:'000001'},{sourceTimestamp:Date.parse(days.at(-1)+'T14:59:00+08:00')},{mainInflow:999}]){
  const records=flow.records.map((r,i)=>i===2?{...r,...patch}:r);
  assert.deepEqual(build({...flow,records}),noFunds);
 }
 assert.deepEqual(build({...flow,records:[flow.records[0],flow.records[0],flow.records[2]]}),noFunds);
 assert.deepEqual(build({...flow,records:[{tradeDate:f.stock.bars.at(-4).date,mainNetInflow:1e8},...flow.records.slice(0,2)]}),noFunds);
 assert.equal(build({...flow,records:flow.records.map(r=>({...r,mainNetInflow:0}))}).status,'pass');
 assert.deepEqual(flow,original);
});
