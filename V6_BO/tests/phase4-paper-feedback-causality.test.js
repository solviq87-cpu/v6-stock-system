'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const sourcePath=path.resolve(__dirname,'../src/research/shortline-paper-import.js');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day='2026-11-04',at=Date.parse(day+'T10:00:15+08:00'),exit=Date.parse('2026-11-05T11:00:00+08:00');
const now=exit+3600000,code='600000';
function fixture(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day,calculatedAt:at-6000,
  strategyAt:at-30000,strategyBasis:{day,score:88},quoteBasis:{code,source:'tencent',price:10,quoteAt:at-7000,receivedAt:at-6500},
  plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',
  frozenAt:new Date(at-5000).toISOString(),factors:['YZ-08'],...decisionPlanPayload(card)},card);
 const book={paperOnly:true,brokerConnected:false,orders:{},account:{cash:100090,positions:{},events:[],eventHashes:{}}};
 function leg(side,time,date,price){
  const orderId=side+'-order',eventId=side+'-fill',quantity=100,fee=5;
  const fill={type:'fill',eventId,quantity,price,fee,date,timestamp:time};
  book.orders[orderId]={order:{orderId,symbol:code,side},events:[fill]};
  book.account.eventHashes[eventId]=sha({orderId,fill,tradeDate:date});
  book.account.events.push({orderId,eventId,symbol:code,side,quantity,price,fee,tradeDate:date,timestamp:time,gross:price*quantity,
    ...(side==='buy'?{reason:'作战台计划['+plan.id+']'}:{costBasis:1005,realizedPnl:90})});
 }
 leg('buy',at,day,10);leg('sell',exit,'2026-11-05',11);
 const a=book.account;a.fingerprint=sha({cash:a.cash,positions:a.positions,events:a.events});
 const state={trades:[],plans:[plan],checks:[]};
 const m={exports:{}},req=id=>{
  if(id==='node:fs')return {lstatSync(f){if(!f.endsWith('/pool.json'))throw Object.assign(Error('missing'),{code:'ENOENT'});return {};}};
  if(id==='../core/paper-application-service')return {createPaperApplicationService(){return{read:()=>book};}};
  return require(id.startsWith('.')?path.resolve(path.dirname(sourcePath),id):id);
 };
 new Function('require','module','exports','__dirname',fs.readFileSync(sourcePath,'utf8'))(req,m,m.exports,path.dirname(sourcePath));
 return {plan,book,state,run:()=>m.exports.importSettledPaperTrades(state,{accountDir:'/isolated-feedback',now})};
}
test('causally inconsistent frozen quote or decision metadata cannot label a settled sample as verified',()=>{
 for(const change of [
  p=>p.decisionEvidence.calculatedAt=0,
  p=>p.decisionEvidence.calculatedAt=at-8000,
  p=>p.decisionEvidence.strategyAt=at-5500,
  p=>p.decisionEvidence.quoteBasis.receivedAt=at-5500,
  p=>p.decisionEvidence.quoteBasis.receivedAt=at-8000,
  p=>p.decisionEvidence.quoteBasis.receivedAt=null,
  p=>p.decisionEvidence.quoteBasis.quoteAt=Date.parse('2026-11-03T15:00:00+08:00'),
  p=>p.decisionEvidence.quoteBasis.code='600001',
  p=>p.decisionEvidence.quoteBasis.price=-1,
  p=>p.decisionEvidence.strategyBasis.day='2026-11-03',
  p=>p.decisionEvidence.quoteBasis.source=' '
 ]){
  const x=fixture();change(x.plan);const before=JSON.stringify(x.book),r=x.run();
  assert.equal(r.imported,1);assert.equal(x.state.trades[0].pnlAmount,90);
  assert.equal(x.state.trades[0].planId,null);assert.equal(x.state.trades[0].snapshotVerified,false);
  assert.equal(JSON.stringify(x.book),before);
 }
});
test('ambiguous or wrong-sample optional checks cannot inject learning factors',()=>{
 for(const duplicate of [true,false]){
  const x=fixture();x.plan.checkId='check-1';
  const check={id:'check-1',code,createdAt:new Date(at-10000).toISOString(),factorCodes:['BAD-01']};
  x.state.checks=duplicate?[check,{...check,factorCodes:['BAD-02']}]:[{...check,sampleSet:'demo'}];
  assert.equal(x.run().imported,1);const row=x.state.trades[0];
  assert.equal(row.planVerified,true);assert.equal(row.checkId,null);assert.deepEqual(row.factors,['YZ-08']);
 }
});
test('a valid original settlement retains causal plan factors, exact profit and retry idempotency',()=>{
 const x=fixture();x.plan.checkId='check-1';
 x.state.checks=[{id:'check-1',code,createdAt:new Date(at-10000).toISOString(),sampleSet:'real',factorCodes:['YZ-09']}];
 assert.equal(x.run().imported,1);
 const row=x.state.trades[0];assert.equal(row.planVerified,true);assert.equal(row.pnlAmount,90);
 assert.deepEqual(row.factors,['YZ-08','YZ-09']);assert.equal(row.checkId,'check-1');
 const before=JSON.stringify(x.state.trades);assert.equal(x.run().existing,1);assert.equal(JSON.stringify(x.state.trades),before);
});
test('malformed optional factor metadata cannot discard an otherwise valid settlement',()=>{
 const x=fixture();x.plan.factors={untrusted:true};assert.equal(x.run().imported,1);
 assert.equal(x.state.trades[0].planVerified,true);assert.deepEqual(x.state.trades[0].factors,[]);
 assert.equal(x.state.trades[0].decisionLink.factorsMissing,true);
});

test('explicit observation-only frozen data cannot certify the learning link but retains settlement',()=>{
 for(const patch of [
  {source:'simulated'},{source:'fixture'},{source:'mock'},{source:'demo'},
  {mode:'historical-replay'},{mode:'imported'},{mode:'simulated'},{mode:'demo'},
  {readOnlyBackup:true},{canTrade:false}
 ]){
  const x=fixture();Object.assign(x.plan.decisionEvidence.quoteBasis,patch);
  const before=JSON.stringify(x.book);assert.equal(x.run().imported,1);
  const row=x.state.trades[0];assert.equal(row.planId,null);
  assert.equal(row.snapshotVerified,false);assert.equal(row.pnlAmount,90);
  assert.equal(JSON.stringify(x.book),before);
 }
});
test('explicit simulated or manually researched fill evidence cannot certify the automatic learning link',()=>{
 const {createFillEvidence}=require('../src/core/paper-fill-evidence');
 for(const [kind,simulated] of [['automatic-paper',true],['research-manual',false],['automatic-paper',false]]){
  const x=fixture(),e=x.book.account.events[0],fill=x.book.orders[e.orderId].events[0];
  const evidence=createFillEvidence({
   symbol:code,price:10,quoteAt:at-1000,timestamp:at-1000,receivedAt:at-500,
   source:simulated?'simulated':null,quoteSource:'tencent',mode:simulated?'simulated':'public-live-unverified',
   volumeUnit:'shares',volume:100000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true
  },{symbol:code,price:10,tradeDate:day,executionAt:at,executionKind:kind});
  fill.fillEvidence=e.fillEvidence=evidence;
  const a=x.book.account;a.eventHashes[e.eventId]=sha({orderId:e.orderId,fill,tradeDate:day});
  a.fingerprint=sha({cash:a.cash,positions:a.positions,events:a.events});
  assert.equal(x.run().imported,1);
  const linked=kind==='automatic-paper'&&!simulated;
  assert.equal(x.state.trades[0].planId,linked?x.plan.id:null);
  assert.equal(x.state.trades[0].snapshotVerified,linked);assert.equal(x.state.trades[0].pnlAmount,90);
 }
});

test('a previously verified link is quarantined when its original evidence fails and can only regain the same proof',()=>{
 const x=fixture();assert.equal(x.run().imported,1);
 const original=structuredClone(x.state.trades[0]),ledger=JSON.stringify(x.book);
 x.plan.decisionEvidence.quoteBasis.mode='historical-replay';
 const report=x.run();assert.equal(report.updated,1);assert.deepEqual(report.exitDays,['2026-11-05']);
 let row=x.state.trades[0];assert.equal(row.snapshotVerified,false);assert.notEqual(row.planVerified,true);
 assert.equal(row.planId,null);assert.deepEqual(row.factors,[]);assert.equal(row.pnlAmount,90);
 assert.equal(row.sourceFingerprint,original.sourceFingerprint);assert.equal(row.firstCollectedAt,original.createdAt);
 assert.equal(row.planEvidenceReview.status,'quarantined');
 assert.deepEqual(row.planEvidenceReview.priorProjection,original);
 const rejected=JSON.stringify(row);assert.equal(x.run().existing,1);assert.equal(JSON.stringify(x.state.trades[0]),rejected);
 delete x.plan.decisionEvidence.quoteBasis.mode;
 assert.equal(x.run().updated,1);row=x.state.trades[0];assert.equal(row.snapshotVerified,true);
 assert.equal(row.planEvidenceReview.status,'revalidated');assert.deepEqual(row.planEvidenceReview.priorProjection,original);
 assert.equal(x.run().existing,1);assert.equal(JSON.stringify(x.book),ledger);
});
test('same plan ID with altered frozen factors cannot overwrite an earlier verified learning link',()=>{
 const x=fixture();x.run();const original=structuredClone(x.state.trades[0]);
 x.plan.factors=['YZ-09'];assert.equal(x.run().updated,1);
 const row=x.state.trades[0];assert.equal(row.snapshotVerified,false);assert.equal(row.planId,null);
 assert.deepEqual(row.factors,[]);assert.equal(row.planEvidenceReview.reason,'frozen-link-changed');
 assert.deepEqual(row.planEvidenceReview.priorProjection,original);
 assert.equal(x.run().existing,1);assert.deepEqual(x.state.trades[0],row);
 x.plan.factors=['YZ-08'];assert.equal(x.run().updated,1);assert.deepEqual(x.state.trades[0].factors,['YZ-08']);
});
test('an altered optional check cannot silently retain the older verified factors',()=>{
 const x=fixture();x.plan.checkId='check-1';
 x.state.checks=[{id:'check-1',code,createdAt:new Date(at-10000).toISOString(),sampleSet:'real',factorCodes:['YZ-09']}];
 x.run();const original=structuredClone(x.state.trades[0]);x.state.checks[0].factorCodes=['YZ-10'];
 assert.equal(x.run().updated,1);assert.equal(x.state.trades[0].snapshotVerified,false);
 assert.deepEqual(x.state.trades[0].planEvidenceReview.priorProjection,original);
 assert.equal(x.run().existing,1);assert.deepEqual(x.state.trades[0].factors,[]);
});
