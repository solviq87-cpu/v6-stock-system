'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=process.env.V6_RISK_TEST_ROOT||path.resolve(__dirname,'..');
const {readResearchRiskCenter:read}=require(path.join(root,'src/core/research-risk-center'));
const now=Date.parse('2026-11-06T02:00:00Z');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'risk-center-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function holdings(){return {schemaVersion:1,mode:'manual-holding-watch',positions:[{symbol:'600000',cost:100,shares:100,weightPct:60}],
 quotes:[{symbol:'600000',price:85,quoteSource:'provider-one',quoteAt:now-1000}],
 crossCheckQuotes:[{symbol:'600000',price:85.1,quoteSource:'provider-two',quoteAt:now-1000}]};}
const emptyNews=()=>({mode:'news-evidence-readonly',canTrade:false,canNotify:false,rows:[],summary:{totalRevisions:0,currentEvents:0,retractedEvents:0,eligibleForResearchSupport:0,unknownEvents:0}});
test('empty evidence stays unknown and does not read arbitrary account or headline fields',()=>{
 const state={paper:{cash:987654321},privateToken:'PRIVATE_TOKEN',news:{goodAll:[{title:'股价必涨已确认',t:'2026-11-06'}]}};
 const before=JSON.stringify(state),r=read({state,now,readNews:emptyNews});
 assert.equal(r.status,'unknown');assert.equal(r.riskScore,null);assert.equal(r.strategyDecay.status,'unknown');
 assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.writesAccount,false);
 assert.equal(r.manualHoldings.status,'unconfigured');assert.equal(r.researchAgent.status,'unconfigured');
 assert.ok(r.missing.some(x=>x.code==='NO_PER_SYMBOL_QUOTES'));assert.ok(r.missing.some(x=>x.code==='NO_CURRENT_NEWS_EVIDENCE'));
 assert.doesNotMatch(JSON.stringify(r),/987654321|PRIVATE_TOKEN|股价必涨已确认/);assert.equal(JSON.stringify(state),before);
});
test('manual cost loss and declared concentration retain their original evidence and are read-only',t=>{
 const dir=fixture(t),file=path.join(dir,'holdings.json');fs.writeFileSync(file,JSON.stringify(holdings()));const before=fs.readFileSync(file);
 const r=read({now,holdingWatchFile:file,readNews:emptyNews});
 assert.equal(r.status,'observed-concerns-unverified');assert.equal(r.manualHoldings.positions[0].drawdownFromCostPct,-15);
 assert.ok(r.supports.some(x=>x.code==='loss-critical'));assert.ok(r.supports.some(x=>x.code==='weight-critical'));
 assert.ok(r.contra.some(x=>x.code==='MANUAL_INPUTS_NOT_ACCOUNT_ATTESTATION'));assert.deepEqual(fs.readFileSync(file),before);
 assert.equal(r.productionWeightsChanged,false);assert.equal(r.strategyDecay.estimate,null);
});
test('stale, conflicting and invalid holding inputs cannot become zero risk or a computed latest loss',t=>{
 const dir=fixture(t),file=path.join(dir,'holdings.json');
 for(const scenario of ['stale','conflicting','invalid']){
  const h=holdings();h.positions[0].weightPct=undefined;
  if(scenario==='stale')h.quotes[0].quoteAt=now-15001;
  if(scenario==='conflicting')h.crossCheckQuotes[0].price=100;
  fs.writeFileSync(file,scenario==='invalid'?'{broken':JSON.stringify(h));
  const r=read({now,holdingWatchFile:file,readNews:emptyNews});assert.equal(r.riskScore,null);
  assert.ok(r.missing.some(x=>x.domain==='manual-holdings'));
  assert.ok(!r.supports.some(x=>x.code==='loss-critical'));
  if(scenario==='invalid'){assert.equal(r.manualHoldings.status,'unavailable');assert.equal(r.manualHoldings.counts,undefined);}
  else assert.equal(r.manualHoldings.positions[0].drawdownFromCostPct,null);
 }
});
test('market quote gaps use per-symbol original time, not a fresh list receipt',()=>{
 const r=read({now,state:{stocksAt:now,stocks:[{code:'600000',price:10,quoteSource:'vendor',quoteAt:now-15001},{code:'600001',price:20,quoteAt:now}]},readNews:emptyNews});
 assert.equal(r.market.quotes.stale,1);assert.equal(r.market.quotes.unknown,1);assert.equal(r.market.quotes.recent,0);
 assert.ok(r.supports.some(x=>x.code==='QUOTE_QUALITY_GAPS'));assert.ok(r.missing.some(x=>x.code==='INCOMPLETE_CURRENT_QUOTES'));
});
test('news revisions, retractions and unknowns retain their meaning without classifying title words',()=>{
 let queryOptions;
 const row=(kind,supportStatus,current,url)=>({current,supportStatus,eligibleForResearchSupport:supportStatus==='source-declared-unverified',eventHash:'a'.repeat(64),
  evidence:{kind,title:'<img src=x onerror=bad()> 已确认重大利好',source:'declared-source',securities:['600000'],publishedAt:null,receivedAt:now-1,revisedAt:null,url}});
 const r=read({now,newsRoot:'/private/news',readNews:(root,options)=>{queryOptions={root,...options};return {mode:'news-evidence-readonly',canTrade:false,canNotify:false,
  summary:{totalRevisions:4,currentEvents:3,retractedEvents:1,eligibleForResearchSupport:1,unknownEvents:1,privateRoot:'DO_NOT_FORWARD_INTERNAL_PATH'},
  rows:[row('original','superseded',false,null),row('revised','source-declared-unverified',true,'https://example.com/source'),row('retracted','retracted',true,null),row('original','unknown',true,'javascript:alert(1)')]};}});
 assert.deepEqual(queryOptions,{root:'/private/news',symbol:null,limit:50,now});
 assert.equal(r.news.visibleRevisedEvents,1);assert.equal(r.news.rows[3].url,null);assert.equal(r.news.headlineSentimentUsed,false);
 assert.equal(r.news.rows[0].supportStatus,'superseded');assert.ok(r.supports.some(x=>x.code==='RETRACTED_NEWS'));
 assert.ok(r.missing.some(x=>x.code==='UNKNOWN_NEWS_EVIDENCE'));assert.ok(r.contra.some(x=>x.code==='DECLARED_NEWS_NOT_CONFIRMED'));
 assert.doesNotMatch(JSON.stringify(r),/DO_NOT_FORWARD_INTERNAL_PATH/);
 assert.ok(!r.supports.some(x=>x.message.includes('重大利好')));
});
test('bad news chains and agent journals report unavailable or blocked without writing recovery files',t=>{
 const dir=fixture(t),agentDir=path.join(dir,'agent');fs.mkdirSync(agentDir,{mode:0o700});
 const file=path.join(agentDir,'event-bad.json');fs.writeFileSync(file,'{}',{mode:0o600});const before=fs.readFileSync(file);
 const r=read({now,agentDir,readNews:()=>{throw Error('private-path-and-secret-should-not-leak');}});
 assert.equal(r.news.status,'unavailable');assert.equal(r.news.summary,null);assert.equal(r.researchAgent.status,'blocked-invalid-agent-journal');
 assert.ok(r.missing.some(x=>x.code==='AGENT_EVIDENCE_INVALID'));assert.doesNotMatch(JSON.stringify(r),/private-path-and-secret/);
 assert.deepEqual(fs.readdirSync(agentDir),['event-bad.json']);assert.deepEqual(fs.readFileSync(file),before);
});
test('real optional news module supports revisions and retractions and rejects tampered archives',t=>{
 const dir=fixture(t),newsRoot=path.join(dir,'news'),moduleFile=path.join(root,'src/core/news-evidence-journal.js');
 if(!fs.existsSync(moduleFile)){
  const r=read({now,newsRoot});assert.equal(r.news.status,'unavailable');assert.equal(fs.existsSync(newsRoot),false);return;
 }
 const {appendBatch}=require(moduleFile);
 const base={schemaVersion:1,source:'risk-fixture',eventId:'one',sourceRevisionId:'original',kind:'original',supersedes:null,url:'https://example.com/original',
  title:'original title',body:'source declared body',securities:['600000'],publishedAt:now-4000,receivedAt:now-3000,revisedAt:null};
 const first=appendBatch(newsRoot,[base],{now});
 const revised=appendBatch(newsRoot,[{...base,sourceRevisionId:'revision',kind:'revised',supersedes:first.results[0].eventHash,title:'revised title',receivedAt:now-2000,revisedAt:now-2500}],{now});
 appendBatch(newsRoot,[{...base,sourceRevisionId:'retraction',kind:'retracted',supersedes:revised.results[0].eventHash,title:'retracted title',receivedAt:now-1000,revisedAt:now-1500}],{now});
 const before=fs.readdirSync(newsRoot).map(n=>[n,fs.readFileSync(path.join(newsRoot,n),'utf8')]);
 const r=read({now,newsRoot});assert.equal(r.news.summary.totalRevisions,3);assert.equal(r.news.summary.retractedEvents,1);
 assert.equal(r.news.rows[0].supportStatus,'retracted');assert.ok(r.supports.some(x=>x.code==='RETRACTED_NEWS'));
 assert.deepEqual(fs.readdirSync(newsRoot).map(n=>[n,fs.readFileSync(path.join(newsRoot,n),'utf8')]),before);
 const file=path.join(newsRoot,'000002.json'),bad=JSON.parse(fs.readFileSync(file));bad.evidence.body='tampered';fs.writeFileSync(file,JSON.stringify(bad),{mode:0o600});
 const unknown=read({now,newsRoot});assert.equal(unknown.news.status,'unavailable');assert.equal(unknown.news.summary,null);assert.equal(unknown.riskScore,null);
});
