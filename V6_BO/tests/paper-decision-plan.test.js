'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'server.js'),'utf8'),serverRequire=createRequire(path.join(root,'server.js'));
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {executeDecisionPlan,paperExecutionScore,decisionPlanPayload,bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const now=Date.parse('2026-11-06T10:00:00+08:00'),day='2026-11-06';
const planId='plan-00000000-0000-4000-8000-000000000001';
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const wire=patch=>({code:'600000',name:'隔离测试',price:10,preClose:10,volume:100000,pct:0,score:88,paths:['温和连阳'],
  quoteSource:'tencent',quoteAt:now-1000,receivedAt:now-500,quoteMode:'public-live-unverified',canTrade:true,...patch});
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function authority(patch={}){return {authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,
  calculatedAt:now-2000,strategyAt:now-10000,quoteBasis:{source:'tencent',quoteAt:now-3000,receivedAt:now-2500,price:10},
  strategyBasis:{day,quoteAt:now-10000,score:88},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6},...patch};}
function plan(card=authority()){return bindAuthoritativePlan({id:planId,sampleSet:'real',frozenAt:new Date(now-1000).toISOString(),...decisionPlanPayload(card)},card);}
async function setup(t,{quote=wire()}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-decision-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'pool.json'),app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>d===day}});
  app.adoptLegacy({initial:10000,cash:10000,realized:0,enabled:true,positions:{},trades:[]});
  const notices=[],skips=[];
  const context={S:{lastPx:new Map(),stocks:[],stocksAt:now,candidatePool:[],trendPool:[],ztCodes:new Set()},PAPER:{pool:app.legacy()},PAPER_CFG:{pool:{name:'fixture',initial:10000,maxPos:5}},_paperAuthority:{pool:app},_paperAuthorityRevision:{pool:app.read().revision},PAPER_FILE:path.join(dir,'paper.json'),Date:Clock,Map,require:serverRequire,console:{error(){}},
    isReplica:()=>false,isContinuousTrading:()=>true,limitPctOfCode:()=>.1,paperFeeAmount:()=>5,paperT1Locked:()=>false,paperLotOf:()=>100,paperEquity:()=>10000,
    A:{isLimitUp:()=>false},skipAdd:k=>skips.push(k),numNeutral:()=>0,dataCapOf:()=>100,pushPaperDigest:m=>notices.push(m),atomicWrite:(p,s)=>{fs.writeFileSync(p,s);return true;},_diskFail:()=>false};
  context.refreshPaperAuthority=force=>{if(force){context.PAPER.pool=app.legacy();context._paperAuthorityRevision.pool=app.read().revision;}};
  vm.createContext(context);
  vm.runInContext([section('function paperAuthorityQuotes(){','refreshPaperAuthority();'),section("function savePaper(action=",'// ---------------- 模拟盘对账'),section('function ingestPx(rows)','function paperEquity(key, pm)'),section('function paperBuy(key, cands, pm, reasonOf)','// ---------------- A股 T+1')].join('\n'),context);
  if(quote)context.ingestPx([quote]);
  const rules=await import('../public/nova/system-picks.mjs'),card=authority(),frozen=plan(card);
  const run=(patch={})=>executeDecisionPlan({input:{action:'executePlan',account:'pool',planId},plan:frozen,now,day,clock:()=>now,replica:false,continuous:true,
    candidate:wire(),eligiblePick:rules.eligiblePick,systemPickDay:rules.systemPickDay,poolDay:day,newsBlocked:false,
    account:context.PAPER.pool,policy:context.PAPER_CFG.pool,equity:10000,quote:context.paperAuthorityQuotes()['600000'],authoritative:card,
    readBook:()=>app.read(),requireEntryBinding:true,buy:(row,reason,binding)=>context.paperBuy('pool',[row],new Map(),()=>reason,binding),...patch});
  return {app,file,run,frozen,card,context,notices,skips};
}
test('confirmed plan uses the original buy and durable account; duplicate retry and restart cannot buy twice',async t=>{
  const x=await setup(t);assert.equal(x.run().status,'executed');
  const first=x.app.read(),bytes=fs.readFileSync(x.file);
  assert.equal(first.account.cash,8995);assert.equal(first.account.events.length,1);assert.equal(first.account.positions['600000'].quantity,100);
  assert.equal(first.account.events[0].price,10);assert.ok(first.account.events[0].fillEvidence);
  assert.equal(x.run().status,'already-executed');assert.deepEqual(fs.readFileSync(x.file),bytes);
  const fresh=createPaperApplicationService({file:x.file,clock:()=>now});
  assert.equal(x.run({readBook:()=>fresh.read(),continuous:false,authoritative:undefined}).status,'already-executed');
  assert.deepEqual(fs.readFileSync(x.file),bytes);assert.equal(x.notices.length,1);
});
test('same-price fresh quote and an in-range price move retain the frozen plan; a new strategy batch cannot replace its lineage',async t=>{
  const x=await setup(t,{quote:wire({price:9.9})});
  const current={...x.card,decisionId:'b'.repeat(64),quoteBasis:{...x.card.quoteBasis,quoteAt:now-50,price:9.9},plan:{...x.card.plan,buyHigh:9.9}};
  assert.equal(x.run({authoritative:current}).price,9.9);
  const y=await setup(t);assert.throws(()=>y.run({authoritative:{...y.card,strategyAt:now-500}}),/策略批次/);
  assert.equal(y.app.read().account.events.length,0);
});
test('replica, midday, wrong day, risk, forged or incomplete plans and budget conflicts leave the ledger byte-identical',async t=>{
  const x=await setup(t),before=fs.readFileSync(x.file);
  const cases=[{replica:true},{continuous:false},{day:'2026-11-09'},{newsBlocked:true},{candidate:wire({canOpen:false})},
    {quote:{price:11,quoteAt:now-100}},{quote:{price:10,quoteAt:now-15001}},{quote:{price:10,quoteAt:now+1}},
    {quote:{price:10,quoteAt:null}},{authoritative:null},{plan:{...x.frozen,stop:8}},
    {authoritative:{...x.card,plan:{...x.card.plan,positionPct:10}}},{plan:{...x.frozen,decisionEvidence:undefined}},
    {input:{action:'executePlan',account:'pool',planId,price:1}},{account:{...x.context.PAPER.pool,enabled:false}}];
  for(const patch of cases){assert.throws(()=>x.run(patch));assert.deepEqual(fs.readFileSync(x.file),before);}
  assert.equal(x.notices.length,0);
});
test('stale or partial original quotes cannot be revived by the plan or request; rejected authority commit is not reported as success',async t=>{
  for(const patch of [{quoteAt:now-15001},{volume:undefined},{preClose:undefined},{canTrade:false},{volume:1}]){
    const x=await setup(t,{quote:wire(patch)}),before=fs.readFileSync(x.file);
    assert.throws(()=>x.run());assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.notices.length,0);
  }
});
test('execution score follows actual fills and T+1, remains unknown for unobserved stops, and never rewards missing plans',async t=>{
  const x=await setup(t);x.run();const book=x.app.read(),before=fs.readFileSync(x.file),closed=Date.parse(day+'T15:01:00+08:00');
  assert.equal(paperExecutionScore({book,plans:[x.frozen],day,now}).score,null);
  const score=paperExecutionScore({book,plans:[x.frozen],day,now:closed});
  assert.equal(score.score,100);assert.equal(score.assessed,1);assert.equal(score.notApplicable,1);
  assert.match(score.rows[0].facts[1].evidence,/T\+1/);
  const next=paperExecutionScore({book,plans:[x.frozen],day:'2026-11-09',now:Date.parse('2026-11-09T15:10:00+08:00')});
  assert.equal(next.score,null);assert.equal(next.unknown,1);
  assert.equal(paperExecutionScore({book,plans:[],day,now:closed}).score,null);
  const empty={account:{events:[]}};assert.equal(paperExecutionScore({book:empty,plans:[x.frozen],day,now:closed}).score,null);
  assert.deepEqual(fs.readFileSync(x.file),before);
});
test('only the internal preparation job may attach an authoritative lineage to the existing private research plan',async t=>{
  const {shortlineJob}=await import('../src/research/shortline/store.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-decision-research-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const currentDay=new Date(Date.now()+28800000).toISOString().slice(0,10),card=authority({day:currentDay,calculatedAt:Date.now(),strategyAt:Date.now()-10000});
  const payload=decisionPlanPayload(card);
  await assert.rejects(shortlineJob({root:dir,input:{revision:0,action:'learn:plan',payload:{...payload,decisionAuthority:card.authority,decisionId:card.decisionId}}}),/服务端准备/);
  const r=await shortlineJob({root:dir,decisionPlan:card,beforeDecisionCommit:()=>true,input:{revision:0,action:'learn:plan',payload}});
  assert.equal(r.result.entryMin,9.8);assert.equal(r.result.decisionId,card.decisionId);assert.equal(r.state.revision,1);
  const reread=await shortlineJob({root:dir});assert.deepEqual(reread.state.plans[0],r.result);
  await assert.rejects(shortlineJob({root:dir,decisionPlan:card,beforeDecisionCommit:()=>true,input:{revision:1,action:'learn:plan',payload:{...payload,entryMax:10.2}}}),/服务器决策/);
  assert.equal((await shortlineJob({root:dir})).state.revision,1);
});
test('durable conditional intent invokes the original paperBuy and original authority ledger, then restart reconciles one fill',async t=>{
  const x=await setup(t),{createConditionalOrderStore}=require('../src/core/paper-conditional-orders');
  const root=path.join(path.dirname(x.file),'conditional-intents'),store=createConditionalOrderStore({root,clock:()=>now});
  const input={requestId:'native-paper-round-trip',plan:x.frozen,authorization:{mode:'local',principal:null,generation:0}};
  const readBook=()=>x.app.read();store.create(input,{readBook});
  const run={now,day,replica:false,continuous:true,authorized:()=>true,planFor:()=>x.frozen,
    quoteFor:()=>x.context.paperAuthorityQuotes()['600000'],readBook,execute:()=>x.run()};
  const result=store.tick(run);assert.equal(result.orders[0].status,'executed');
  assert.equal(result.orders[0].fill.eventId,x.app.read().account.events[0].eventId);
  const before=fs.readFileSync(x.file);createConditionalOrderStore({root,clock:()=>now}).tick(run);
  assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.app.read().account.events.length,1);assert.equal(x.notices.length,1);
});

test('C20 bound original buy refuses a changed fresh quote before any account mutation',async t=>{
 for(const price of [10.2,10]){
  const x=await setup(t),before=fs.readFileSync(x.file),original=x.context.paperAuthorityQuotes;let reads=0;
  x.context.paperAuthorityQuotes=()=>{if(++reads===2)x.context.ingestPx([wire({price,quoteAt:now-500,receivedAt:now-100})]);return original();};
  assert.throws(()=>x.run(),/重新确认/);assert.equal(reads,2);assert.deepEqual(fs.readFileSync(x.file),before);
  assert.equal(x.app.read().account.events.length,0);assert.equal(x.context.PAPER.pool.cash,10000);assert.equal(x.notices.length,0);
 }
});
test('C20 bound plan refuses a newer original account revision after plan validation',async t=>{
 const x=await setup(t);let changed=null;
 x.context.refreshPaperAuthority=force=>{
  if(!force&&!changed){x.app.configure({expectedRevision:x.app.read().revision,riskPolicy:{version:'c20-original-policy',maxPositionPct:50}});changed=fs.readFileSync(x.file);}
  x.context.PAPER.pool=x.app.legacy();x.context._paperAuthorityRevision.pool=x.app.read().revision;
 };
 assert.throws(()=>x.run(),/重新确认/);assert.ok(changed);assert.deepEqual(fs.readFileSync(x.file),changed);
 assert.equal(x.app.read().account.events.length,0);assert.equal(x.notices.length,0);
});
test('C20 original account lock rejects changed bound risk marks without committing or notifying',async t=>{
 const x=await setup(t),before=fs.readFileSync(x.file),save=x.app.saveLegacy;let rejected=null;
 x.app.saveLegacy=(legacy,revision,options)=>{
  assert.ok(options.entryBinding);const q=options.quotes['600000'];
  const changed={...q,riskContext:{...q.riskContext,marks:{...q.riskContext.marks,'600001':5}}};
  try{return save(legacy,revision,{...options,quotes:{...options.quotes,'600000':changed}});}
  catch(e){rejected=e.message;throw e;}
 };
 assert.throws(()=>x.run(),/未产生持久成交/);assert.match(rejected,/重新确认/);
 assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.context.PAPER.pool.cash,10000);assert.equal(x.notices.length,0);
});
