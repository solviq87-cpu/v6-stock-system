'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evidenceBars,historyFrom,buildEvolutionReport}=require('../src/core/intelligence-evolution');
const {VERSION,TIMEFRAME_VERSION}=require('../src/core/evolution-market-evidence');
const {observations}=require('../public/nova/shortline/backtest.mjs');
const W=require('../src/core/evolution-workflow');
const stamp=(day,time='15:00')=>Date.parse(day+'T'+time+':00+08:00');
const ASOF=stamp('2026-11-20','18:00');
const bar=(date,extra={})=>({date,code:'600000',role:'stock',period:'日K',name:'集成断言标的',source:'price-archive-unit-case',provider:'eastmoney',priceBasis:'unadjusted',knownAt:stamp(date),availableAt:date,open:10,high:12,low:9,close:11,volume:1000,...extra});
const analysis=(bars,recordedAt=ASOF,extra={},eventExtra={})=>({kind:'analysis',recordedAt,sequence:1,hash:'e'.repeat(64),data:{schemaVersion:1,symbol:'600000',name:'集成断言标的',provider:'eastmoney',priceBasis:'unadjusted',asOf:recordedAt,bars,tradeDates:bars.map(b=>b.date),systems:[],...extra},...eventExtra});

test('workspace merge deduplicates identity without backdating later optional fields',()=>{
 const first=bar('2026-11-18'),later={...first,knownAt:stamp('2026-11-19'),amount:11000};
 const event=analysis([later]),r=evidenceBars({scope:'live',bars:[first]},[event],ASOF);
 assert.equal(r.length,1);assert.equal(r[0].knownAt,first.knownAt);assert.equal(r[0].amount,undefined);
 assert.equal(r.evidenceDiagnostics.duplicates,1);assert.equal(r.evidenceDiagnostics.lateEnrichmentsOmitted,1);
 const imported=evidenceBars({bars:[]},[event],ASOF)[0];
 assert.equal(imported.knownAt,event.recordedAt);assert.equal(imported.originalKnownAt,later.knownAt);
 assert.equal(imported.workspaceEventHash,event.hash);assert.equal(imported.receiptPolicy,'first-workspace-server-receipt');
 assert.equal(observations({scope:'live',bars:[imported],catalog:[]},'2026-11-20 18:00',{all:true,causal:true}).length,0);
});

test('contradictory identities are quarantined and formal/test partitions cannot poison each other',()=>{
 const first=bar('2026-11-18'),conflicting={...first,close:10},testing={...first,sampleSet:'test',close:100,high:101};
 const r=evidenceBars({scope:'live',bars:[first,conflicting,first,testing]},[],ASOF),d=r.evidenceDiagnostics;
 assert.equal(r.length,1);assert.equal(r[0].sampleSet,'test');assert.equal(d.conflicts.length,1);assert.equal(d.quarantinedRows,3);
 assert.equal(d.sourceRows,d.admittedRows+d.duplicates+d.rejected+d.quarantinedRows);
 assert.equal(d.realRows,0);assert.equal(d.testRows,1);
 const distinct=evidenceBars({bars:[first,{...first,role:'index',code:'IX'},{...first,period:'1分钟',date:'2026-11-18 15:00'}]},[],ASOF);
 assert.equal(distinct.length,3);
});

test('workspace sample markers survive parent real labels, provider normalization and benchmark inheritance',()=>{
 const first=bar('2026-11-18');
 const cases=[
  analysis([{...first,sampleSet:'test'}],ASOF,{sampleSet:'real'}),
  analysis([first],ASOF,{}, {testSample:true}),
  analysis([first],ASOF,{simulated:true}),
  analysis([{...first,sampleSource:'synthetic-case'}],ASOF),
  analysis([],ASOF,{benchmarkSeries:{provider:'eastmoney',symbol:'IX',priceBasis:'unadjusted',simulated:true,bars:[{...first,code:'IX'}]}})
 ];
 for(const event of cases){const r=evidenceBars({scope:'live',bars:[]},[event],ASOF);assert.equal(r.length,1);assert.equal(r[0].sampleSet,'test');}
 assert.equal(evidenceBars({scope:'demo',bars:[first]},[],ASOF)[0].sampleSet,'test');
});

test('future dates, late availability, absent receipts and impossible workspace timelines are rejected',()=>{
 const b=bar('2026-11-18'),{knownAt,...unreceived}=b;
 const future={...b,date:'2026-11-21',availableAt:'2026-11-18'},late={...b,availableAt:'2026-11-21'},invalid={...b,date:'2026-02-30'};
 const badRaw=analysis([{...b,knownAt:ASOF}],ASOF,{asOf:ASOF-1});
 const impossible=analysis([b],ASOF,{asOf:ASOF+1});
 const r=evidenceBars({bars:[future,late,unreceived,invalid]},[badRaw,impossible],ASOF);
 assert.equal(r.length,0);assert.equal(r.evidenceDiagnostics.rejected,5);
});

function dailyArchive(){
 const dates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10)).filter(d=>![0,6].includes(new Date(d).getUTCDay())).slice(0,32);
 const events=dates.map((day,i)=>analysis([bar(day,{priceKnownAt:stamp(day,'15:30')})],stamp(day,'16:00'),{provider:'tencent',tradeDates:dates},{sequence:i+1}));
 return {dates,events,asOf:stamp(dates.at(-1),'18:00')};
}
test('historical diagnostics merge daily server receipts but reject a single late import and timestamp bypass',()=>{
 const {dates,events,asOf}=dailyArchive(),all=dates.map(d=>bar(d,{priceKnownAt:stamp(d,'15:30')}));
 const late=analysis(all,asOf,{provider:'tencent',tradeDates:dates});
 assert.equal(historyFrom([late],'600000',asOf),null);
 const r=historyFrom([...events,late],'600000',asOf);
 assert.equal(r.stocks[0].bars.length,32);assert.equal(r.stocks[0].bars[0].knownAt,events[0].recordedAt);
 assert.equal(r.stocks[0].bars.at(-1).knownAt,events.at(-1).recordedAt);
 assert.equal(historyFrom(events,'600000',asOf,{tradeDates:[]}),null);
});

test('historical provider selection follows effective analysis time and excludes test or conflicted days',()=>{
 const {dates,events,asOf}=dailyArchive();
 const lateOld=analysis([bar(dates[0])],asOf,{asOf:events[0].data.asOf,provider:'eastmoney',tradeDates:dates});
 assert.equal(historyFrom([...events,lateOld],'600000',asOf).provider,'tencent');
 for(const mutate of [e=>e.testSample=true,e=>e.data.simulated=true,e=>e.data.name='合成验证股票甲',e=>e.data.bars[0].sampleSet='test']){
  const polluted=structuredClone(events);mutate(polluted[15]);assert.equal(historyFrom(polluted,'600000',asOf),null);
 }
 const conflict=analysis([bar(dates[15],{close:10})],asOf,{provider:'tencent',tradeDates:dates});
 assert.equal(historyFrom([...events,conflict],'600000',asOf),null);
});

const gainSample=version=>({id:'pair-'+version,source:'settlement-archive-unit-case',factorVersion:version,evidenceHash:'a'.repeat(64),frozenAt:stamp('2026-11-10','09:19'),decisionAt:stamp('2026-11-10','09:20'),entryAt:stamp('2026-11-11','09:30'),exitAt:stamp('2026-11-12'),knownAt:stamp('2026-11-12','16:00'),trainingEnd:stamp('2026-10-20'),testStart:stamp('2026-11-01'),baselineNetReturnPct:1,enhancedNetReturnPct:2,feeBps:8,slippageBps:10,costIncluded:true});
test('report integrates same-window evidence, closed calendar cycles, similarity and isolated independent-gain versions',async()=>{
 const dates=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20'];
 const bars=dates.flatMap((d,i)=>[bar(d,{open:10+i,close:11+i,high:12+i,low:9+i,indexCode:'IX',indexTrend:'多头',themeCycle:'启动',turnover:3}),bar(d,{code:'IX',role:'index',open:100-i,close:100-i,high:101-i,low:99-i})]);
 const sessions=Array.from({length:30},(_,i)=>'2026-11-'+String(i+1).padStart(2,'0')).filter(d=>![0,6].includes(new Date(d).getUTCDay()));
 const calendar={source:'exchange-calendar-unit-case',knownAt:stamp('2026-01-01'),from:'2026-11-01',to:'2026-11-30',tradeDates:sessions,day:'2026-11-20',isOpen:true};
 const archive={scope:'live',catalog:[],bars,checks:[{id:'visible',code:'600000',knownAt:stamp('2026-11-20')},{id:'future',code:'600001',knownAt:stamp('2026-11-21')}],marketFactorGainSamples:[gainSample(VERSION),gainSample(TIMEFRAME_VERSION)],multiTimeframeGainSamples:[gainSample(TIMEFRAME_VERSION),gainSample(VERSION)]};
 const r=await buildEvolutionReport({archive,asOf:ASOF,calendar});
 assert.equal(r.code,'600000');assert.equal(r.sources.selectedCode,'600000');assert.equal(r.sources.visibleBars,10);assert.equal(r.sources.visibleChecks,1);
 assert.equal(r.market.multiTimeframe.frames.find(f=>f.period==='week').status,'closed');assert.equal(r.market.multiTimeframe.frames.find(f=>f.period==='month').status,'unknown');
 assert.equal(r.market.relativeStrength.comparisons.find(c=>c.kind==='market'&&c.window===1).status,'observed-research-only');
 assert.equal(r.similar.version,'causal-similarity-2');assert.equal(r.similar.coverage.mature+r.similar.coverage.unavailable,r.similar.neighbours.length);
 for(const projection of [r.market.relativeStrength,r.market.multiTimeframe]){assert.equal(projection.independentGain.n,1);assert.equal(projection.independentGain.status,'insufficient-sample');assert.equal(projection.independentGain.excluded.length,1);assert.equal(projection.canTrade,false);}
 assert.equal(r.market.multiTimeframe.independentGain.factorVersion,TIMEFRAME_VERSION);
 assert.ok(r.market.multiTimeframe.factors.every(f=>f.version===TIMEFRAME_VERSION));
 const future=structuredClone(archive);future.bars.push(bar('2026-11-21',{close:100,high:101}));
 const historical=await buildEvolutionReport({archive:future,asOf:ASOF,calendar});
 assert.deepEqual(historical.market,r.market);assert.deepEqual(historical.similar,r.similar);assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
});

test('stored selected-code preferences are replayed at the requested historical instant',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-market-pref-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 W.saveEvolutionPreferences(dir,{requestId:'market-pref-before',expectedRevision:0,value:{selectedCode:'600000'}},{now:stamp('2026-11-18')});
 W.saveEvolutionPreferences(dir,{requestId:'market-pref-after',expectedRevision:1,value:{selectedCode:'600001'}},{now:stamp('2026-11-21')});
 const preferences=W.readEvolutionPreferences(dir,{asOf:ASOF}),report=await buildEvolutionReport({archive:{scope:'live',bars:[bar('2026-11-20')],catalog:[]},asOf:ASOF,preferences});
 assert.equal(preferences.value.selectedCode,'600000');assert.equal(report.code,'600000');assert.equal(report.workflow.preferences.value.selectedCode,'600000');
 assert.equal(W.readEvolutionPreferences(dir,{asOf:stamp('2026-11-22')}).value.selectedCode,'600001');
});
