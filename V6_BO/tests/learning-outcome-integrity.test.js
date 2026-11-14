'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../src/core/learning-outcome-integrity');
const now=Date.parse('2026-11-11T16:00:00+08:00');
const bar=date=>({date,open:10,high:11,low:9,close:10.5,volume:100,pct:5});
const feed=()=>({src:'synthetic',adjust:'qfq',receivedAt:now,rows:[bar('2026-11-09'),bar('2026-11-10')]});
test('requires the exact supported next session, finalized complete bars and known basis',()=>{
 const signal={date:'20261109'};assert.equal(I.usableBars(signal,feed(),now).target,'2026-11-10');
 for(const mutate of [k=>k.rows[1].date='2026-11-12',k=>k.rows[1].volume=0,k=>delete k.rows[1].close,k=>k.adjust=null,k=>k.receivedAt=Date.parse('2026-11-10T14:00:00+08:00')]){const k=feed();mutate(k);assert.equal(I.usableBars(signal,k,now),null);}
 assert.equal(I.nextDay('20270104'),null);
});
test('legacy outcomes remain present but quarantined; current proof must match calendar',()=>{
 const s={date:'20261109',nd:{date:'20261112',hit:true,nextPct:5,maxGain:5,closeGain:2,openGap:0}};
 assert.equal(I.validNext(s),false);assert.equal(s.nd.hit,true);
 s.nd.date='20261110';s.nd.integrity={version:'calendar-final-ohlcv-v1',targetDate:'2026-11-10'};assert.equal(I.validNext(s),true);
});
test('status distinguishes invalid legacy from pending, void and hindsight',()=>{
 const s=[{type:'trend',date:'20261109',nd:{date:'20261112'}},{type:'trend',date:'20261109'}, {type:'trend',void:true},{type:'trend',resolved:{mode:'历史回测'}},{type:'zt'}];
 assert.deepEqual(I.status(s,{state:'idle'}).counts,{total:5,pending:1,matured:0,live:2,backtest:1,posthoc:1,void:1,invalid:1,malformed:0});
});
test('push multiplier excludes invalid, historical, posthoc and missing values and requires 10 valid',()=>{
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8'),code=src.slice(src.indexOf('function pushLearnStats()'),src.indexOf('function pushIntensityOf('));
 const mk=(pct,extra={})=>({date:'20261109',type:'trend',code:'600000',nd:{date:'20261110',integrity:{version:'calendar-final-ohlcv-v1',targetDate:'2026-11-10'},nextPct:pct,maxGain:1,closeGain:1,openGap:0,hit:false},...extra});
 const signals=[mk(1),...Array.from({length:9},()=>mk(null)),...Array.from({length:10},()=>mk(9,{resolved:{mode:'历史回测'}}))];
 const context={S:{learn:{signals}},A:{limitPctOf:()=>10},LearningIntegrity:I,isLiveSample:s=>s.resolved?.mode!=='历史回测',_pushLearnCache:{t:0,map:{}}};
 vm.runInNewContext(code+';globalThis.run=pushLearnStats',context);let r=context.run().trend;assert.equal(r.n,1);assert.equal(r.mult,1);
 context.S.learn.signals=Array.from({length:9},()=>mk(-10));context._pushLearnCache.t=0;r=context.run().trend;assert.equal(r.n,9);assert.equal(r.mult,1);
});
test('real next-day function preserves a legacy result and only replaces it with a verified session',()=>{
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8'),code=src.slice(src.indexOf('function resolveNextDay('),src.indexOf('// 用K线回验信号'));
 const clock={usableBars:(s,k)=>I.usableBars(s,k,now),validNext:I.validNext};
 const ctx={LearningIntegrity:clock,A:{isLimitUp:()=>false,isOneLineBoard:()=>false},HIT_THR:3};
 vm.runInNewContext(code+';globalThis.run=resolveNextDay',ctx);
 const old={date:'20261112',hit:true},signal={date:'20261109',code:'600000',nd:old};
 const gap=feed();gap.rows[1].date='2026-11-12';assert.equal(ctx.run(signal,gap),false);assert.equal(signal.nd,old);
 assert.equal(ctx.run(signal,feed()),true);assert.equal(signal.ndLegacy,old);assert.equal(signal.nd.date,'20261110');assert.equal(I.validNext(signal),true);assert.equal(ctx.run(signal,feed()),false);
});
test('shared operation prevents concurrent manual and automatic runs and reports failed save',async()=>{
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=src.indexOf('let learningOperation = '),end=src.indexOf('// ── 全A股走势自主学习引擎',start),code=src.slice(start,end);
 let release;const task=new Promise(r=>{release=r});
 const ctx={S:{learn:{signals:[]}},LearningIntegrity:I,isLiveSample:()=>true,seedLearnFromHistoryImpl:()=>task,resolveSignalsDeepImpl:async()=>{throw Error('sensitive path');}};
 vm.runInNewContext(code+';globalThis.seed=seedLearnFromHistory;globalThis.force=resolveSignalsDeep;globalThis.status=learningStatus',ctx);
 const first=ctx.seed();await assert.rejects(ctx.force(),{code:'LEARNING_BUSY'});release({added:0});await first;
 await assert.rejects(ctx.force(),/sensitive path/);const status=ctx.status();assert.equal(status.operation.state,'failed');assert.equal(status.operation.error,'学习任务未完成，请稍后重试');assert.ok(!JSON.stringify(status).includes('sensitive path'));
});
test('auction completion requires the actual session, finite values and both booleans',()=>{
 const s={type:'auczt',date:'20261109',resolved:{}};assert.equal(I.hasOutcome(s),false);
 s.resolved={date:'20261110',nextPct:1,maxGain:2,hit:false,limitUp:false};assert.equal(I.hasOutcome(s),false);
 s.resolved.date='20261109';assert.equal(I.hasOutcome(s),true);s.resolved.hit=null;assert.equal(I.hasOutcome(s),false);
 const bad=I.status([null,{type:'__proto__',date:'20261109'}, {type:'auczt',date:'20261109',resolved:{}}],{});
 assert.equal(bad.counts.malformed,1);assert.equal(bad.counts.invalid,1);assert.equal(bad.byType.__proto__.pending,1);
});
test('real auction repair preserves malformed old data and uses final same-day bar',()=>{
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8'),code=src.slice(src.indexOf('function resolveWithKline('),src.indexOf('// ⚠️ 口径分离'));
 class FakeDate extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}getHours(){return 16;}getMinutes(){return 0;}}
 const ctx={Date:FakeDate,LearningIntegrity:I,normDate:d=>String(d||'').replace(/-/g,''),A:{isLimitUp:()=>false},HIT_THR:3};vm.runInNewContext(code+';globalThis.run=resolveWithKline',ctx);
 const old={date:'20261109'},sig={type:'auczt',date:'20261109',price:10,code:'600000',resolved:old};
 assert.equal(ctx.run(sig,feed()),true);assert.equal(sig.resolvedLegacy,old);assert.equal(I.validSameDay(sig),true);
});
test('deep receipt counts actual successful fetches, not requested codes',async()=>{
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8'),code=src.slice(src.indexOf('async function resolveSignalsDeepImpl('),src.indexOf('// One shared lock'));
 const sigs=[{code:'600000'},{code:'600001'}],klines=new Map();
 const ctx={S:{learn:{signals:sigs},klines},LearningIntegrity:{hasOutcome:()=>false},resolveWithKline:()=>false,resolveNextDay:()=>false,
 em:{pool:async(codes,fn)=>Promise.all(codes.map(fn)),fetchKline:async code=>code==='600000'?{rows:[{}]}:null},klineSet:(c,k)=>klines.set(c,k)};
 vm.runInNewContext(code+';globalThis.run=resolveSignalsDeepImpl',ctx);const r=await ctx.run(2);assert.equal(r.attempted,2);assert.equal(r.fetched,1);assert.equal(r.pending,2);
});
test('valid timing does not invent missing event outcomes or erase quality diagnostics',()=>{
 const signal={date:'20261109',nd:{date:'20261110',integrity:{version:'calendar-final-ohlcv-v1',targetDate:'2026-11-10'},nextPct:1,maxGain:4,closeGain:1,openGap:0,quality:'fake'}};
 assert.equal(I.temporalNext(signal),true);assert.equal(I.validNext(signal),false);assert.equal(I.hasOutcome(signal),false);
});
