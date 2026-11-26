'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createRuntimeTrace}=require('../src/core/runtime-trace');
const {buildSystemReadiness}=require('../src/core/system-readiness');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),realRequire=require('node:module').createRequire(require.resolve('../server.js'));
function fn(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return (source.slice(a-6,a)==='async '?'async ':'')+source.slice(a,b);}
const now=Date.parse('2026-11-26T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function harness(overrides={}){
 const trace=createRuntimeTrace({clock:()=>now});
 const c=vm.createContext({Date:Clock,require:path=>path==='./src/core/runtime-trace'?trace:realRequire(path),console:{log(){},error(){}},APP_VER:'fixture',...overrides});
 return {trace,c,load:(...names)=>{for(const name of names)vm.runInContext(fn(name),c);}};
}
const quote={code:'600001',price:10,quoteAt:now-1000,receivedAt:now,quoteSource:'eastmoney',canTrade:true,mainInflow:500000};
function tickFixture({rows=[quote],error,running=false}={}){
 let fetches=0,strategies=0,patrol=0;
 const h=harness({S:{loop:{running,tickCount:0},candidatePool:[],sectors:[],inflowHistory:new Map(),fundDays:new Map(),klines:new Map([[quote.code,{rows:Array(25).fill({})}]])},
  PAPER:{pool:{positions:{[quote.code]:{shares:100}}},pre:{positions:{}}},monitorCodes:[],fastStockWatch:{read:()=>[]},
  em:{fetchBatchSnapshot:async()=>{fetches++;if(error)throw error;return rows;}},publishFastStockMoves(){},ingestPx(){},fundsHistoryObservation:()=>({t:now}),
  A:{isNearLimitUp:()=>false,trendCheck:()=>{strategies++;return null;}},paperPrices:()=>new Map(),paperCheckAll:()=>{patrol++;},auctionPhase:()=>0});
 h.load('tick');return {...h,calls:()=>({fetches,strategies,patrol})};
}
test('actual tick connects fetched original quote, executed strategy and root without replacing holding patrol',async()=>{
 const h=tickFixture();await h.c.tick();assert.deepEqual(h.calls(),{fetches:1,strategies:1,patrol:1},h.c.S.loop.lastError);assert.equal(h.c.S.loop.tickCount,1);assert.equal(h.c.S.loop.running,false);
 const rows=h.trace.read().spans,root=rows.find(r=>r.stage==='task.tick');assert.equal(root.status,'completed');
 for(const stage of ['market.snapshot','strategy.evaluate']){const row=rows.find(r=>r.stage===stage);assert.equal(row.parentSpanId,root.spanId);assert.equal(row.traceId,root.traceId);}
 assert.equal(rows.find(r=>r.stage==='strategy.evaluate').calls,1);assert.equal(h.trace.read().active,0);
});
test('actual tick retains failure, missing quote and busy outcomes without running extra business work',async()=>{
 const failed=tickFixture({error:Error('private fixture path')});await failed.c.tick();assert.equal(failed.c.S.loop.running,false);assert.equal(failed.calls().strategies,0);
 assert.ok(failed.trace.read().spans.every(r=>r.status==='failed'));assert.doesNotMatch(JSON.stringify(failed.trace.read()),/private fixture path/);
 const empty=tickFixture({rows:[]});await empty.c.tick();assert.equal(empty.trace.read().spans.find(r=>r.stage==='market.snapshot').status,'unknown');assert.equal(empty.calls().patrol,1);assert.equal(empty.calls().strategies,0);
 const busy=tickFixture({running:true});await busy.c.tick();assert.deepEqual(busy.calls(),{fetches:0,strategies:0,patrol:0});assert.equal(busy.c.S.loop.running,true);assert.equal(busy.trace.read().spans[0].reasonCode,'ALREADY_RUNNING');
 const stale=tickFixture({rows:[{...quote,quoteAt:now-15001}]});await stale.c.tick();assert.equal(stale.calls().strategies,0);assert.equal(stale.calls().patrol,1);
});
test('actual rebuild root records provider failure and leaves original exception intact',async()=>{
 const error=Error('private original error'),h=harness({S:{stocks:[]},setAllStocks(){},em:{fetchAllStocks:async()=>{throw error;}}});h.load('rebuildPool');
 await assert.rejects(h.c.rebuildPool(),e=>e===error);const [provider,root]=h.trace.read().spans;assert.equal(provider.stage,'market.universe');assert.equal(root.stage,'task.pool');assert.equal(provider.parentSpanId,root.spanId);assert.equal(root.status,'failed');assert.equal(h.trace.read().active,0);
});
test('actual merged digest links selected origins only, not dropped signals or ambient timer root',()=>{
 const sends=[],h=harness({INTRADAY:{buf:new Map(),parts:[],timer:1,firstAt:0,lastSent:now},INTRADAY_MAX_ITEMS:1,ALERT_RANK:{},alertScore:r=>r.score,
  freezeRecommendationRows:rows=>rows,freezeNewsRecommendationRows:()=>[],buildAlertsReport:()=> 'fixture digest',pushAll:(msg,force,opt)=>{sends.push({msg,force,opt});return true;}});
 h.load('enqueueIntraday','enqueueIntradayMsg','flushIntraday');const contexts={};
 h.trace.sync('task.tick',()=>{contexts.keep=h.trace.capture();h.c.enqueueIntraday([{code:'600001',type:'a',score:5,ts:now}]);});
 h.trace.sync('task.tick',()=>{contexts.drop=h.trace.capture();h.c.enqueueIntraday([{code:'600002',type:'b',score:1,ts:now}]);});
 h.trace.sync('task.pool',()=>{contexts.part=h.trace.capture();h.c.enqueueIntradayMsg('fixture part',{});});
 h.trace.sync('task.tick',()=>{contexts.ambient=h.trace.capture();h.c.flushIntraday();});
 const digest=h.trace.read().spans.find(r=>r.stage==='notification.digest');assert.equal(sends.length,1);assert.equal(sends[0].opt.private,true);
 assert.deepEqual(digest.links.map(r=>r.spanId).sort(),[contexts.keep.spanId,contexts.part.spanId].sort());assert.equal(digest.parentSpanId,null);assert.notEqual(digest.traceId,contexts.ambient.traceId);
 assert.ok(!h.trace.read().spans.some(r=>r.stage==='notification.delivery'));assert.equal(h.c.INTRADAY.buf.size,0);
});
test('original editor readiness receives aggregate executed hooks but neither private payloads nor delivery certification',()=>{
 let mono=0;const trace=createRuntimeTrace({clock:()=>now,monotonic:()=>++mono});trace.sync('task.tick',()=>trace.sync('market.snapshot',()=>{}, {versions:{source:'private fixture'}}));
 const input=trace.summary();const result=buildSystemReadiness({now,trace:input});const stage=result.runtimeTrace.hooks.find(r=>r.stage==='market.snapshot');
 assert.equal(stage.samples,1);assert.equal(stage.timedSamples,1);assert.equal(stage.p50Ms,1);assert.equal(result.runtimeTrace.endToEndCertified,false);assert.equal(result.runtimeTrace.receiverDeliveryCertified,false);
 assert.equal(result.runtimeTrace.hooks.find(r=>r.stage==='notification.delivery').status,'not-observed');assert.doesNotMatch(JSON.stringify(result.runtimeTrace),/private fixture|traceId|spanId|refs|versions/);
 const invalid=structuredClone(input);invalid.hooks.find(r=>r.stage==='market.snapshot').completed=999;assert.equal(buildSystemReadiness({now,trace:invalid}).runtimeTrace.hooks.find(r=>r.stage==='market.snapshot').status,'not-observed');
});
