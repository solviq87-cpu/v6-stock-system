'use strict';
// Real private archive readers with isolated synthetic records; no live feeds,
// account writes, notifications or model services participate in these tests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../src/core/research-interaction-workbench'),J=require('../src/core/news-evidence-journal');
const M=require('../src/core/manual-decision-loop');
const S=require('../src/core/research-workspace-store');
const {createReplayFixture}=require('./helpers/fayo-replay-boundaries-fixture');
function fixture(t){const x=createReplayFixture();t.after(x.cleanup);return x;}
test('replay keeps the original journal supersession and retraction support states at each cutoff',async t=>{
 const x=fixture(t),result=await W.readReplay(x.roots,{symbol:'600000',asOf:x.asOf,window:7});
 const original=result.markers.find(m=>m.ref===x.news[0].eventHash),revision=result.markers.find(m=>m.ref===x.news[1].eventHash),retraction=result.markers.find(m=>m.ref===x.news[2].eventHash);
 assert.equal(original.detail.current,false);assert.equal(original.detail.supportStatus,'superseded');assert.equal(original.detail.eligibleForResearchSupport,false);
 assert.equal(revision.detail.current,false);assert.equal(revision.detail.supersedes,original.ref);
 assert.equal(retraction.detail.current,true);assert.equal(retraction.detail.supportStatus,'retracted');assert.equal(retraction.detail.eligibleForResearchSupport,false);
 const early=await W.readReplay(x.roots,{symbol:'600000',asOf:x.stamp('14:15:00'),window:7});
 const onceCurrent=early.markers.find(m=>m.ref===original.ref);assert.equal(onceCurrent.detail.current,true);
 assert.equal(onceCurrent.detail.supportStatus,'source-declared-unverified');assert.equal(onceCurrent.detail.eligibleForResearchSupport,true);
 assert.equal(early.markers.some(m=>m.ref===retraction.ref),false);
});
test('a security-removal revision cannot inherit the removed company, industry, plans or holdings',async t=>{
 const x=fixture(t),raw={schemaVersion:1,source:'isolated-news',eventId:'association-removed',sourceRevisionId:'original',kind:'original',supersedes:null,
  url:'https://example.org/isolated-association',title:'隔离关联记录',body:'仅测试证券关联修订，不是真实公告。',bodyScope:'declared-body',securities:['600000'],
  publishedAt:x.stamp('17:14:00'),receivedAt:x.stamp('17:14:30'),revisedAt:null};
 const a=J.appendBatch(x.roots.newsRoot,[raw],{now:x.stamp('17:15:00')}).results[0];
 const b=J.appendBatch(x.roots.newsRoot,[{...raw,sourceRevisionId:'correction',kind:'revised',supersedes:a.eventHash,securities:[],
  revisedAt:x.stamp('17:19:00'),receivedAt:x.stamp('17:19:30')}],{now:x.stamp('17:20:00')}).results[0];
 const before=await W.readReplay(x.roots,{symbol:'600000',asOf:x.stamp('17:17:00'),window:7});
 const old=before.markers.find(m=>m.ref===a.eventHash);assert.equal(old.detail.associated,true);assert.ok(old.detail.subjectName);assert.ok(old.detail.relatedPlans.length);
 const after=await W.readReplay(x.roots,{symbol:'600000',asOf:x.asOf,window:7}),removed=after.markers.find(m=>m.ref===b.eventHash);
 assert.equal(removed.detail.associated,false);assert.equal(removed.detail.subject,null);assert.equal(removed.detail.subjectName,null);
 assert.deepEqual(removed.detail.industry,[]);assert.deepEqual(removed.detail.relatedPlans,[]);assert.deepEqual(removed.detail.holdingEvidence,[]);
 assert.equal(removed.detail.supportStatus,'security-removed');assert.equal(removed.detail.eligibleForResearchSupport,false);
 assert.match(removed.detail.associationScope,/移除/);assert.equal(after.accountMutated,false);
});
test('discipline keeps independently verified reports and manual logs when the shortline archive fails',async t=>{
 const x=fixture(t),now=x.stamp('16:15:00'),options={workspaceRoot:x.roots.root,now:x.stamp('16:05:00')};
 const frozen=M.execute(x.roots.manualRoot,{action:'freeze',runId:x.runs[1].hash,shares:100,limitPrice:'10.00',requestId:'isolated_manual_freeze',expectedRevision:0},options);
 M.execute(x.roots.manualRoot,{action:'not-executed',planId:frozen.recordId,reason:'隔离本人说明：未执行，未认证客观可成交性',requestId:'isolated_manual_skip',expectedRevision:1},{...options,now:x.stamp('16:06:00')});
 const shortlineFile=path.join(x.roots.shortlineRoot,'research.json'),manualFile=path.join(x.roots.manualRoot,'000002.json'),reportFile=path.join(x.reportRoot,'days',x.day,'000003.json');
 fs.writeFileSync(shortlineFile,'invalid isolated archive');
 const before=[shortlineFile,manualFile,reportFile].map(f=>fs.readFileSync(f));
 const result=await W.readDiscipline(x.roots,{symbol:'600000',asOf:now});
 assert.ok(result.rows.some(r=>r.source==='原模拟执行日报'&&r.refs.includes(x.reports[2].reportHash)));
 assert.ok(result.rows.some(r=>r.source==='本人原始日志'&&r.planId===frozen.recordId&&r.status==='资料不足'));
 assert.ok(result.missing.some(s=>s.includes('原短线结算档案未就绪')));
 assert.equal(result.rows.some(r=>r.source==='模拟成交'),false);assert.equal(result.canTrade,false);assert.equal(result.accountMutated,false);
 [shortlineFile,manualFile,reportFile].forEach((f,i)=>assert.deepEqual(fs.readFileSync(f),before[i]));
 const earlier=await W.readDiscipline(x.roots,{symbol:'600000',asOf:x.stamp('15:20:00')});
 assert.equal(earlier.rows.some(r=>r.source==='本人原始日志'),false);assert.ok(earlier.rows.every(r=>r.knownAt<=x.stamp('15:20:00')));
});
test('the missing-evidence model question cannot receive an unverified or future numeric value',async t=>{
 const x=fixture(t),data=structuredClone(x.runs.at(-1).data),futureValue=987654.125;
 data.conditions=[{id:'late-condition',system:'fourteen',version:null,status:'pass',value:futureValue,threshold:70,op:'>=',evidenceIds:['late-evidence']}];
 data.evidence=[{id:'late-evidence',symbol:'600000',source:'isolated-source',sourceTimestamp:data.asOf+1,availableAt:data.asOf+2,receivedAt:data.asOf+3,
  status:'observed-unverified',evidenceRef:'future-source-ref',value:futureValue}];
 const stored=S.appendEvent(x.roots.root,'analysis',data,{now:x.stamp('17:25:00'),requestId:'isolated_missing_model'});
 const input={action:'explain',symbol:'600000',runId:stored.hash,asOf:x.asOf,question:'missing'};
 let prompt='';
 const result=await W.explain(x.roots.root,input,{authorize:()=>true,adapter:{id:'isolated-model',complete:async request=>{
  prompt=request.prompt;return {text:'{"answer":"原条件证据缺失，请核对来源与版本","citations":["R1"]}'};
 }}});
 assert.equal(result.status,'completed');assert.equal(result.modelCalled,true);assert.equal(prompt.includes(String(futureValue)),false);
 assert.equal(prompt.includes('future-source-ref'),false);
 assert.equal(result.citations[0].ruleId,'late-condition');assert.equal(result.citations[0].version,null);
 assert.equal(result.citations[0].evidenceStatus,'missing');assert.ok(result.citations[0].missingReason);assert.deepEqual(result.citations[0].refs,[]);
 const duplicate=await W.explain(x.roots.root,input,{authorize:()=>true,adapter:{id:'isolated-model',complete:async()=>({text:'{"answer":"重复引用","citations":["R1","R1"]}'})}});
 assert.equal(duplicate.status,'failed');assert.equal(duplicate.answer,undefined);assert.equal(duplicate.canTrade,false);
});
