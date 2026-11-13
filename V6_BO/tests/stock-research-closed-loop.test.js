'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {observeStock,readStockObservationResearch,researchPaths}=require('../src/core/stock-observation-research');
const {createStockObservationMonitor}=require('../src/core/stock-observation-monitor');
const {readStockResearchFollowups}=require('../src/core/stock-research-followups');
const {fetchPublicContext}=require('../src/core/public-market-context');
const {enqueueStockObservation}=require('../src/core/stock-observation-queue');
const {readResearchEvidenceBundle}=require('../src/core/research-evidence-bundle');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-loop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dates=Array.from({length:36},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
 let clock=Date.parse(dates[30]+'T16:30:00+08:00'),last=30,flow=100;t.mock.method(Date,'now',()=>clock);
 const dirs={observationRoot:path.join(root,'observations'),memoryRoot:path.join(root,'memory')};
 const readCalendar=()=>({status:'available',tradeDates:dates,calendar:{from:dates[0],to:dates.at(-1)},metadata:{sha256:'a'.repeat(64)}});
 const fetchHistory=async()=>{
  const bars=dates.slice(0,last+1).map((date,i)=>({date,open:10+i*.1,close:10.05+i*.1,high:10.1+i*.1,low:9.9+i*.1,volume:10000,knownAt:clock}));
  const raw=Buffer.from(JSON.stringify(bars.map(({knownAt,...b})=>b))),rawHash=crypto.createHash('sha256').update(raw).digest('hex');
  return {status:'observed-unverified',source:'tencent',provider:'tencent',priceBasis:'unadjusted',retrievedAt:clock,rawHash,
   rawEvidence:{encoding:'base64',data:raw.toString('base64'),byteLength:raw.length,sha256:rawHash},units:{volume:'shares',amount:null},errors:[],
   provenance:{source:'tencent',requestUrl:'https://web.ifzq.gtimg.cn/appstock/app/kline/get',sourceTimestamp:null},
   stock:{symbol:'600000',source:'tencent',provider:'tencent',priceBasis:'unadjusted',observedAt:clock,bars}};
 };
 const fetchContext=async()=>fetchPublicContext({date:dates[last],symbol:'600000'},{now:()=>clock,retainRawEvidence:true,requestJson:async target=>{
  const u=new URL(target),json=u.pathname.includes('daykline')?{rc:0,data:{klines:[`${dates[last]},${flow},2,3,4,5,6,7,8,9,10,3300,0.5,12000,-0.2`]}}:
   {rc:0,data:{qdate:Number(dates[last].replaceAll('-','')),tc:0,pool:[]}};
  return {json,raw:' '+JSON.stringify(json)+'\n'};
 }});
 const deps={...dirs,now:()=>clock,readCalendar,fetchHistory,fetchContext,fetchStatus:async()=>({status:'unknown',source:'public-stock-status-evidence',symbol:'600000',observedAt:clock,dividendEvents:{absenceClaim:null},rawEvidence:[]}),fetchSectors:async()=>({status:'empty',selection:[],current:null})};
 return {root,dirs,deps,dates,get clock(){return clock;},setClock:n=>{clock=n;},setLast:n=>{last=n;},setFlow:n=>{flow=n;},readCalendar};
}
test('stock hypothesis keeps its original market evidence across corrections and archive-only restart reads',async t=>{
 const f=fixture(t),first=await observeStock({symbol:'600000',includeContext:true},f.deps);
 assert.equal(first.priceEventResearch.status,'research-observation-recorded');
 assert.equal(first.priceEventResearch.currentHypothesis.targetDate,f.dates[31]);
 assert.equal(first.analysis.direction.probability,null);assert.equal(first.priceEventResearch.currentHypothesis.probabilities,null);
 assert.equal(first.linkage.stockMainNetInflow,100);assert.equal(first.linkage.indices.shanghaiChangePct,.5);
 assert.equal(first.evidenceBundle.sourceRefs.length,5);
 for(const ref of first.evidenceBundle.sourceRefs){const bytes=fs.readFileSync(path.join(f.dirs.observationRoot,'source-responses',ref.sha256+'.json'));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256);}
 const originalHash=first.evidenceBundle.hash,initial=f.clock;f.setClock(f.clock+60000);f.setFlow(-900);
 const second=await observeStock({symbol:'600000',includeContext:true},f.deps);
 assert.equal(second.observation.revision,1);assert.notEqual(second.evidenceBundle.hash,originalHash);
 assert.equal(second.priceEventResearch.currentHypothesis.evidenceBundleHash,originalHash);
 const read=readStockObservationResearch({symbol:'600000',provider:'tencent'},f.deps);
 assert.equal(read.marketContext.funds.stock.records[0].mainNetInflow,-900);
 assert.equal(read.hypothesisEvidence.hash,originalHash);assert.equal(read.hypothesisEvidence.marketContext.funds.stock.records[0].mainNetInflow,100);
 const historical=readStockObservationResearch({symbol:'600000',provider:'tencent'},{...f.deps,now:()=>initial});
 assert.equal(historical.evidenceBundle.hash,originalHash);assert.equal(historical.linkage.stockMainNetInflow,100);
 assert.equal(read.canTrade,false);assert.equal(read.stockStatus.dividendEvents.absenceClaim,null);
});
test('without any new push the monitor revisits a target close, seals its outcome, and restores the next target',async t=>{
 const f=fixture(t),first=await observeStock({symbol:'600000'},f.deps),roots=researchPaths(f.dirs);
 assert.equal(first.watch.registered,true);
 assert.equal(readStockResearchFollowups(roots.followupRoot).counts.pending,1);
 f.setClock(Date.parse(f.dates[31]+'T16:12:00+08:00'));f.setLast(31);let captures=0;
 const capture=async intent=>{captures++;return observeStock({symbol:intent.symbol,provider:intent.provider,includeContext:false},f.deps);};
 const monitor=createStockObservationMonitor({queueRoot:path.join(f.root,'queue'),jobOptions:f.dirs},{now:()=>f.clock,capture,readCalendar:f.readCalendar});
 const one=await monitor.runOnce();assert.equal(one.processed,0);assert.equal(one.followups.processed,1);assert.equal(one.dailyResearch.processed,1);assert.equal(captures,2);
 assert.equal(readStockResearchFollowups(roots.followupRoot).counts.completed,1);
 const read=readStockObservationResearch({symbol:'600000',provider:'tencent'},f.deps);
 assert.equal(read.priceEventResearch.forwardValidation.evaluated,1);assert.equal(read.priceEventResearch.forwardValidation.independentTargetDays,1);
 assert.equal(read.priceEventResearch.forwardValidation.rawCandleMatchFrequency,null);assert.equal(read.priceEventResearch.currentHypothesis.targetDate,f.dates[32]);
 const restarted=createStockObservationMonitor({queueRoot:path.join(f.root,'queue'),jobOptions:f.dirs},{now:()=>f.clock,capture,readCalendar:f.readCalendar});
 await restarted.runOnce();assert.equal(restarted.status().researchFollowups.counts.completed,1);
 assert.equal(restarted.status().priceEventResearch.independentTargetDays,1);
});

test('a stock first observed during the session is watched after close without inventing a push',async t=>{
 const f=fixture(t);f.setLast(29);f.setClock(Date.parse(f.dates[30]+'T10:00:00+08:00'));
 const initial=await observeStock({symbol:'600000'},f.deps);
 assert.equal(initial.priceEventResearch.currentHypothesis,null);assert.equal(initial.watch.registered,true);
 f.setClock(Date.parse(f.dates[30]+'T16:12:00+08:00'));f.setLast(30);
 const monitor=createStockObservationMonitor({queueRoot:path.join(f.root,'queue'),jobOptions:f.dirs},{now:()=>f.clock,readCalendar:f.readCalendar,
  capture:intent=>observeStock({symbol:intent.symbol,provider:intent.provider},f.deps)});
 const result=await monitor.runOnce();assert.equal(result.processed,0);assert.equal(result.followups.processed,0);assert.equal(result.dailyResearch.processed,1);
 const stored=readStockObservationResearch({symbol:'600000',provider:'tencent'},f.deps);
 assert.equal(stored.priceEventResearch.currentHypothesis.targetDate,f.dates[31]);
 assert.equal(monitor.status().queue.counts.total,0);assert.equal(monitor.status().dailyResearch.counts.completed,1);
});
test('actual queued monitor capture carries signal hash through observeStock, bundle and archive-only restart',async t=>{
 const f=fixture(t),queueRoot=path.join(f.root,'queue'),signalId='c'.repeat(64);
 enqueueStockObservation(queueRoot,{symbol:'600000',decisionAt:f.clock,trigger:'push-attempt',signalRefs:[
  {code:'600000',type:'pool',ts:f.clock-1,id:signalId},{code:'600000',type:'trend',ts:f.clock-1}]});
 let calls=0,captured;
 const capture=async intent=>{
  calls++;
  captured=await observeStock({symbol:intent.symbol,includeContext:true,trigger:'push-attempt-observation',origin:{
   kind:intent.trigger,intentId:intent.id,pushDecisionAt:intent.decisionAt,signalRefs:intent.signalRefs,messageHash:intent.messageHash||null}},f.deps);
  return captured;
 };
 const monitor=createStockObservationMonitor({queueRoot},{now:()=>f.clock,capture});
 const result=await monitor.runOnce();assert.equal(result.processed,1);assert.equal(monitor.status().queue.counts.completed,1);
 assert.equal(captured.evidenceBundle.trigger.signalRefs.find(r=>r.type==='pool').id,signalId);
 assert.equal(Object.hasOwn(captured.evidenceBundle.trigger.signalRefs.find(r=>r.type==='trend'),'id'),false);
 const hash=captured.evidenceBundle.hash,roots=researchPaths(f.dirs);
 const restarted=createStockObservationMonitor({queueRoot},{now:()=>f.clock,capture});
 assert.equal((await restarted.runOnce()).processed,0);assert.equal(calls,1);
 const restored=readStockObservationResearch({symbol:'600000',provider:'tencent'},f.deps);
 assert.equal(restored.evidenceBundle.hash,hash);assert.equal(restored.evidenceBundle.trigger.signalRefs.find(r=>r.type==='pool').id,signalId);
 const file=fs.readdirSync(roots.evidenceRoot,{recursive:true}).find(n=>n.includes('objects'+path.sep)&&n.endsWith(hash+'.json'));
 const full=path.join(roots.evidenceRoot,file),raw=fs.readFileSync(full),changed=JSON.parse(raw);
 changed.trigger.signalRefs.find(r=>r.type==='pool').id='d'.repeat(64);fs.writeFileSync(full,JSON.stringify(changed));
 assert.throws(()=>readResearchEvidenceBundle(roots.evidenceRoot,{symbol:'600000',provider:'tencent',hash,asOf:f.clock}),/校验/);
 fs.writeFileSync(full,raw);assert.equal(readResearchEvidenceBundle(roots.evidenceRoot,{symbol:'600000',provider:'tencent',hash,asOf:f.clock}).hash,hash);
});

test('financial capture and 36 strategy evidence survive archive-only restart with original receipt time',async t=>{
 const f=fixture(t),{parseFinancials}=require('../src/core/public-stock-financials');let captures=0;
 const raw=Buffer.from(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:'600000',SECUCODE:'600000.SH',CURRENCY:'CNY',REPORT_DATE:'2024-12-31',NOTICE_DATE:'2025-01-15',UPDATE_DATE:'2025-01-15',ROEJQ:12,ZCFZL:40}]}}));
 const period=parseFinancials(raw,{symbol:'600000',kind:'period',receivedAt:f.clock});
 const deps={...f.deps,fetchFinancials:async()=>{captures++;return {symbol:'600000',source:'eastmoney-financials',datasets:{period},rawEvidence:[{source:'eastmoney-financials',encoding:'base64',data:raw.toString('base64'),sha256:period.rawHash,byteLength:raw.length,receivedAt:f.clock}]};}};
 const first=await observeStock({symbol:'600000',includeFinancials:true},deps);assert.equal(captures,1);assert.ok(first.research36.pipeline.derivedFields.includes('roePct'));
 f.setClock(f.clock+60000);const read=readStockObservationResearch({symbol:'600000',provider:'tencent'},deps);assert.equal(captures,1);assert.equal(read.marketContext.financials.datasets.period.receivedAt,period.receivedAt);assert.equal(read.evidenceBundle.hash,first.evidenceBundle.hash);assert.ok(read.research36.pipeline.derivedFields.includes('roePct'));assert.equal(read.research36.canTrade,false);
});
