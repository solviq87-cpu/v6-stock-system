'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createFixture}=require('./helpers/v6-studio-fixture');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const {createFeedbackRunStore}=require('../src/server/decision-feedback-runtime');
const {buildEvolutionReport}=require('../src/core/intelligence-evolution');
const day='2026-11-23',at=time=>Date.parse(day+'T'+time+'+08:00'),digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function frozenPlan(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600001',day,calculatedAt:at('09:29:40'),strategyAt:at('09:29:00'),
  quoteBasis:{source:'tencent',quoteAt:at('09:29:39')},plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
 return bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(at('09:29:50')).toISOString(),...decisionPlanPayload(card)},card);
}
test('future wire quotes do not change an earlier report or its visible-evidence fingerprint',async()=>{
 const asOf=at('10:00:00'),archive={scope:'live',catalog:[],plans:[frozenPlan()]};
 const before=await buildEvolutionReport({archive,code:'600001',asOf});
 const later=await buildEvolutionReport({archive,code:'600001',asOf,latestQuote:{code:'600001',price:50,quoteSource:'tencent',quoteMode:'public-live-unverified',quoteAt:asOf+1,receivedAt:asOf+2}});
 assert.deepEqual(later.market,before.market);assert.equal(later.visibleEvidenceFingerprint,before.visibleEvidenceFingerprint);
 assert.equal(later.market.signalValidity.priceReview.price,null);assert.equal(later.market.signalValidity.priceReview.quoteAt,null);
});
test('real HTTP connects original quote, plan, execution report and feedback while preserving original private files',{timeout:120000},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-http-clock-')),clockFile=path.join(temp,'clock');
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const now=at('10:00:00');fs.writeFileSync(clockFile,String(now));
 const wire={code:'600001',price:10.2,quoteAt:now-5000,receivedAt:now-4000,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true};
 const original=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),anchor='S.lastPx = new Map();';
 assert.equal(original.split(anchor).length,2);
 // This insertion exists only in the disposable test server; there is no
 // production endpoint accepting a quote, account path or frozen plan.
 const serverSource=original.replace(anchor,anchor+'\nS.lastPx.set("600001",{wireQuote:'+JSON.stringify(wire)+'});');
 const f=await createFixture({count:3,serverSource,clockFile});
 try{
  const root=path.join(f.tmp,'data/shortline-research');
  const initial=(await f.request('/api/research/shortline')).body;assert.equal(initial.ok,true);
  const state={...initial.state,revision:1,plans:[frozenPlan()]};delete state.catalog;delete state.permissions;delete state.books;delete state.book;delete state.dictionaryVersion;
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const archiveFile=path.join(root,'research.json');fs.writeFileSync(archiveFile,JSON.stringify({state,digest:digest(state)}),{mode:0o600});
  const archiveBefore=fs.readFileSync(archiveFile);
  const report=await f.request('/api/research/evolution?symbol=600001');assert.equal(report.status,200,report.raw);
  const price=report.body.result.market.signalValidity.priceReview;
  assert.equal(price.status,'outside-range');assert.equal(price.price,wire.price);assert.equal(price.quoteAt,wire.quoteAt);
  assert.equal(price.entryMin,9.8);assert.equal(price.entryMax,10.1);assert.equal(report.body.result.canTrade,false);
  const past=await f.request('/api/research/evolution?symbol=600001&asOf='+String(now-6000));assert.equal(past.status,200,past.raw);
  assert.equal(past.body.result.market.signalValidity.priceReview.price,null);assert.equal(past.body.result.market.signalValidity.priceReview.quoteAt,null);
  assert.deepEqual(fs.readFileSync(archiveFile),archiveBefore);
  assert.equal(fs.existsSync(path.join(root,'execution-reports')),false,'read does not start the report scheduler');
  const closedAt=at('16:30:00');fs.writeFileSync(clockFile,String(closedAt));
  // Advancing the clock must not relax the original session lifetime. Obtain
  // a new legitimate session before reading the post-close private report.
  const login=await f.request('/api/lock/unlock','POST',{role:'edit',password:f.password,fp:'studio-fixture-admin',name:'fixture-admin'},'');
  assert.equal(login.body?.ok,true,login.raw);assert.ok(login.body.token);
  const reports=createPaperExecutionReportStore({root:path.join(root,'execution-reports'),clock:()=>at('15:15:00'),canWrite:()=>true});
  const saved=reports.save({day,now:at('15:15:00'),plans:[],book:{revision:1,account:{cash:10000,events:[],positions:{}},orders:{}},observations:[],conditionalOrders:[]});
  const feedback=createFeedbackRunStore({root:path.join(root,'feedback-runs'),clock:()=>at('16:10:00'),canWrite:()=>true});
  const attempt=feedback.reserve({day}),receipt=feedback.complete(attempt,{status:'insufficient-evidence',reason:'尚无真实成熟样本'});
  const files=[archiveFile,path.join(root,'execution-reports/days',day,'000001.json'),path.join(root,'feedback-runs/runs',day,'000002.json')];
  const before=files.map(file=>fs.readFileSync(file));
  const after=await f.request('/api/research/evolution?symbol=600001','GET',null,login.body.token);assert.equal(after.status,200,after.raw);assert.equal(after.body.ok,true,after.raw);
  assert.deepEqual(after.body.result.workflow.workflow.evidence.reports,[saved.reportHash]);
  assert.deepEqual(after.body.result.workflow.workflow.evidence.feedback,[receipt.hash]);
  assert.equal(after.body.result.market.signalValidity.status,'expired');
  assert.deepEqual(files.map(file=>fs.readFileSync(file)),before,'GET leaves the original plans and operator chains unchanged');
 }finally{await f.close();}
});
