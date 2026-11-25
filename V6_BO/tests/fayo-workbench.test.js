'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const J=require('../src/core/news-evidence-journal'),B=require('../src/core/fayo-workbench'),S=require('../src/core/research-workspace-store'),M=require('../src/core/fayo-explanation-model'),D=require('../src/core/fayo-discipline-view');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-workbench-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const stamp=Date.parse('2026-01-05T15:30:00+08:00');
const news={schemaVersion:1,source:'test-source',eventId:'news-1',sourceRevisionId:'rev-1',kind:'original',supersedes:null,url:'https://example.invalid/news',title:'测试公告',body:'测试主体合同规模10亿元',bodyScope:'declared-body',securities:['600000'],publishedAt:stamp-2000,receivedAt:stamp-1000,revisedAt:null,structured:[{field:'scale',value:'10亿元',quote:'合同规模10亿元'}]};
test('news exact quote validation and point-in-time subject removal',t=>{
 const root=temp(t);
 assert.throws(()=>J.normalize({...news,structured:[{field:'scale',value:'99亿元',quote:'合同规模10亿元'}]},{now:stamp}),/STRUCTURED/);
 const e=J.appendBatch(root,[news],{now:stamp}).results[0];
 J.appendBatch(root,[{...news,sourceRevisionId:'rev-2',kind:'revised',supersedes:e.eventHash,securities:['600001'],receivedAt:stamp+1000,revisedAt:stamp+500}],{now:stamp+2000});
 const a=J.query(root,{symbol:'600000',now:stamp+3000,asOf:stamp,includeAssociated:true});
 assert.equal(a.rows.length,1);assert.equal(a.rows[0].evidence.structured[0].value,'10亿元');assert.equal(a.rows[0].current,true);
 const b=J.query(root,{symbol:'600000',now:stamp+3000,asOf:stamp+2000,includeAssociated:true});
 assert.equal(b.rows[0].supportStatus,'security-removed');assert.equal(b.rows[0].eligibleForResearchSupport,false);assert.equal(b.rows[1].current,false);
});
test('command templates reuse original archive with editor gate and strict scope',async t=>{
 const root=temp(t),input={action:'fayo-save-command',value:'精选评分前3且涨幅小于5%',requestId:'test_cmd_001'};
 await assert.rejects(B.saveTemplate(root,input,()=>false),/REVOKED/);
 assert.equal((await B.saveTemplate(root,input,()=>true)).reused,false);
 assert.equal((await B.saveTemplate(root,{...input,requestId:'test_cmd_002'},()=>true)).reused,true);
 assert.equal(B.templates(S.readEvents(root)).total,1);
 assert.equal(B.templates(S.readEvents(root)).templates[0].command,input.value);
 await assert.rejects(B.saveTemplate(root,{...input,value:'全市场精选评分前3'},()=>true),/UNSUPPORTED/);
 assert.throws(()=>B.queryInput({panel:'templates',symbol:'600000'}));
 assert.throws(()=>B.queryInput({panel:'replay',symbol:'600000',asOf:stamp+1},stamp));
});
test('replay marker requires original receipt before cutoff and does not mutate account',()=>{
 const days=['2026-01-05'],r=B.replayMarkers({days,symbol:'600000',cut:stamp,events:[],news:{rows:[{eventHash:'a'.repeat(64),recordedAt:stamp+1,evidence:{securities:['600000'],title:'晚到'}}]},reports:[],signals:[{archiveHash:'b'.repeat(64),recordedAt:stamp+1,evidence:{code:'600000',triggerAt:stamp-100}}]});
 assert.deepEqual(r,[]);
 const r2=B.replayMarkers({days,symbol:'600000',cut:stamp,events:[],news:{rows:[{eventHash:'a'.repeat(64),recordedAt:stamp-1,evidence:{securities:['600000'],title:'已记录'}}]},reports:[],signals:[]});
 assert.equal(r2[0].canTrade,false);assert.equal(r2[0].accountMutated,false);
});
test('similar cohort matches independent system version and only known completed outcomes',()=>{
 const record=(date,hash,version='v1')=>({kind:'analysis',hash,sequence:1,recordedAt:Date.parse(date+'T15:30:00+08:00'),data:{symbol:'600000',tradeDate:date,asOf:Date.parse(date+'T15:20:00+08:00'),provider:'eastmoney',priceBasis:'unadjusted',regime:'trend',systems:[{id:'fourteen',version,verdict:'pass'}],conditions:[{id:'c',system:'fourteen',version,status:'pass'}]}});
 const p=record('2026-01-02','a'.repeat(64)),s=record('2026-01-08','b'.repeat(64)),cut=s.recordedAt;
 const o={runId:p.hash,symbol:p.data.symbol,system:'fourteen',signalDate:p.data.tradeDate,entryDate:'2026-01-05',exitDate:'2026-01-06',horizon:1,status:'paper-estimate',netReturnPct:2,entryOutcomeRunId:'c'.repeat(64),exitOutcomeRunId:'d'.repeat(64),entryOutcomeRecordedAt:stamp,exitOutcomeRecordedAt:stamp+86400000};
 const good=B.sameHistory([p,s],s,cut,{observations:[o,{...o,exitOutcomeRecordedAt:cut+1}]});assert.equal(good.total,1);assert.equal(good.groups[0].meanNetReturnPct,2);assert.equal(good.canTrade,false);
 assert.equal(B.sameHistory([record('2026-01-02',p.hash,'other'),s],s,cut,{observations:[o]}).total,0);
});
test('local model configuration, response citations and actual adapter failure fallback',async t=>{
 const root=temp(t),record={symbol:'600000',tradeDate:'2026-01-05',asOf:stamp-20,conditions:[{id:'c',name:'条件',system:'fourteen',version:'v1',status:'pass',evidenceIds:['e']}],evidence:[{id:'e',symbol:'600000',source:'fixture',availableAt:stamp-100,receivedAt:stamp-50,status:'observed',evidenceRef:'source-1'}]};
 const run=S.appendEvent(root,'analysis',record,{requestId:'model_fixture_1',now:stamp-10});
 const p={root,input:{action:'fayo-explain',symbol:'600000',runId:run.hash,asOf:stamp,question:'support'}};
 const config={V6_FAYO_RESEARCH_MODEL_ENABLED:'1',V6_FAYO_RESEARCH_MODEL_ID:'test-model',V6_FAYO_RESEARCH_MODEL_URL:'http://127.0.0.1:11434/api/chat'};
 const reply=refs=>async()=>new Response(JSON.stringify({model:'test-model',message:{content:JSON.stringify({claims:[{text:'条件解释',refs}]})}}),{status:200});
 assert.equal(M.configured({...config,V6_FAYO_RESEARCH_MODEL_URL:'https://example.invalid/api/chat'}).status,'unconfigured');
 const ok=await M.answer(p,{authorize:()=>true,env:config,fetchImpl:reply(['e'])});
 assert.equal(ok.result.status,'completed',JSON.stringify(ok));assert.equal(ok.result.modelCalled,true);assert.equal(ok.result.canTrade,false);
 const bad=await M.answer(p,{authorize:()=>true,env:config,fetchImpl:reply(['nonexistent'])});
 assert.equal(bad.result.status,'model-failed');assert.equal(bad.result.rule.rows.length,1);assert.deepEqual(bad.result.claims,[]);
 const unconfigured=await M.answer(p,{env:{},fetchImpl:async()=>{throw Error('unexpected egress');}});
 assert.equal(unconfigured.result.status,'unconfigured');assert.equal(unconfigured.result.modelCalled,false);
});
test('follow-up uses a distinct later original plan and never assumes compliance',()=>{
 const a={code:'600000',day:'2026-01-05',rule:'按计划止损',planId:'a'};
 assert.equal(D.nextEvidence([a,{...a,day:'2026-01-06',status:'符合'}],a).status,'unknown');
 assert.equal(D.nextEvidence([a,{...a,day:'2026-01-06',planId:'b',status:'符合'}],a).status,'observed-followed');
});
test('positive news does not alter old score or lower legacy probability gate',()=>{
 const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
 assert.doesNotMatch(server,/if\s*\(S\.news\s*&&\s*S\.news\.goodCodes\s*&&\s*newsSupportsCode\([^)]*\)\)\s*\{\s*(?:s|prob|p)\s*\+=/);
 assert.doesNotMatch(server,/goodHit\s*\?\s*0\.88/);assert.match(server,/newsWarnsCode/);
});
