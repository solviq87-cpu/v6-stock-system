'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/adaptive-fixture');
const {runAdaptiveResearch}=require('../src/core/adaptive-market-lab');
const {adaptNativeStrategies}=require('../src/core/native-adaptive-adapter');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
function input(n=40){const x=fixture(n);for(const s of x.stocks)for(const b of s.bars)delete b.originalRuleSignals;x.nativeEvidence={schemaVersion:1};x.selectionPolicy={requireMarket:false,requireForecast:false};return x;}
function python(x,i=30,verdict='pass'){
 const date=x.stocks[0].bars[i].date,symbol='600000';return {symbol,date,observedThrough:date,knownAt:date+'T16:00:00+08:00',evaluatorVersion:'python-native/test1',provenance:'python-runtime:independent/test-run',rounds:[1,2,3].map(round=>({round,verdict,observedThrough:date,reason:'独立fixture三轮判断'}))};
}
test('automatic original rules retain independent replay, unknown coverage and distinct verdicts',()=>{
 const x=input(),r=runAdaptiveResearch(x),n=r.nativeAdaptation;
 assert.equal(n.coverage.python.unknown,80);assert.equal(n.coverage.gpt.unknown,80);assert.equal(n.canTrade,false);
 assert.equal(n.replay.mode,'audited-strategy-evidence-replay');
 const baseline=runNativeDaily({source:x.source,provider:x.provider,asOf:x.asOf,stocks:x.stocks},{generatedAt:x.decisionAt});
 assert.deepEqual(n.signals,baseline.signals);assert.deepEqual(n.replay,baseline.replay);
});
test('three-round Python pass automatically participates in adaptive learning',()=>{
 const x=input(),e=python(x);x.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};
 const r=runAdaptiveResearch(x),s=r.nativeAdaptation.signals.find(s=>s.system==='python'&&s.date===e.date&&s.symbol===e.symbol);
 assert.equal(s.verdict,'pass');assert.equal(s.provenance,e.provenance);assert.equal(r.learning.state.python.samples,1);
 assert.equal(r.learning.liveRulesChanged,false);assert.equal(r.canTrade,false);
});
test('failed Python rounds remain failed rather than unknown or active',()=>{
 const x=input(),e=python(x,30,'fail');x.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};
 const r=runAdaptiveResearch(x);assert.equal(r.learning.state.python.samples,0);assert.equal(r.nativeAdaptation.coverage.python.evaluated,1);
 assert.equal(r.nativeAdaptation.signals.find(s=>s.system==='python'&&s.date===e.date&&s.symbol===e.symbol).verdict,'fail');
});
test('late evidence never backfills a historical decision',()=>{
 const x=input(),e=python(x);e.knownAt=x.decisionAt;x.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};
 const r=runAdaptiveResearch(x);assert.equal(r.learning.state.python.samples,0);assert.equal(r.nativeAdaptation.omitted[0].reason,'NOT_KNOWN_AT_DAILY_DECISION');
 assert.equal(r.nativeAdaptation.coverage.python.unknown,80);
});
test('incomplete GPT factors remain unknown and snapshot cannot replace historical rows',()=>{
 const x=input(),date=x.stocks[0].bars[30].date,key='600000/'+date;
 const e={symbol:'600000',observedThrough:date,knownAt:date+'T16:00:00+08:00',provider:'fixture',version:'1',gptSnapshotObservedThrough:date,gptSnapshot:{trendScore:99}};
 x.nativeEvidence.snapshots={[key]:e};let r=runAdaptiveResearch(x);assert.equal(r.nativeAdaptation.coverage.gpt.unknown,80);
 e.rows=[];assert.throws(()=>runAdaptiveResearch(x),/不支持/);
});
test('automatic mode rejects manual signals, orphan keys, invalid schema and missing knownAt',()=>{
 let x=input();x.stocks[0].bars[1].originalRuleSignals={fourteen:true};assert.throws(()=>runAdaptiveResearch(x),/混用/);
 x=input();x.nativeEvidence.pythonEvidence={'600003/2026-06-01':{}};assert.throws(()=>runAdaptiveResearch(x),/未知股票/);
 x=input();x.nativeEvidence.schemaVersion=2;assert.throws(()=>runAdaptiveResearch(x),/schemaVersion/);
 x=input();const e=python(x);delete e.knownAt;x.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};assert.throws(()=>runAdaptiveResearch(x),/knownAt/);
});
test('appending future bars and evidence leaves prior native decisions and learning versions unchanged',()=>{
 const a=input(40),b=input(45);const e=python(b,42);b.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};
 const ar=runAdaptiveResearch(a),br=runAdaptiveResearch(b);
 assert.deepEqual(ar.nativeAdaptation.signals,br.nativeAdaptation.signals.filter(s=>s.date<=a.asOf));
 assert.deepEqual(ar.learning.versions,br.learning.versions.filter(s=>s.date<=a.asOf));
 const aa=adaptNativeStrategies(a,a.stocks),bb=adaptNativeStrategies(b,b.stocks);
 assert.deepEqual(aa.stocks,bb.stocks.map(s=>({...s,bars:s.bars.filter(b=>b.date<=a.asOf)})));
});
test('adaptation does not mutate caller input and rejects historically unavailable bars',()=>{
 const x=input(),before=JSON.stringify(x);runAdaptiveResearch(x);assert.equal(JSON.stringify(x),before);
 x.stocks[0].bars[20].knownAt=x.decisionAt;assert.throws(()=>runAdaptiveResearch(x),/当日决策之后/);
});
test('unfinished Python outcomes do not enter the learning state',()=>{
 const x=input(),e=python(x,39);x.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};const r=runAdaptiveResearch(x);
 assert.equal(r.nativeAdaptation.coverage.python.evaluated,1);assert.equal(r.learning.state.python.samples,0);
});
test('fixed Shanghai daily cutoff blocks same-day evening backfill after appending future history',()=>{
 const a=input(40),b=input(45),e=python(a,39);e.knownAt=e.date+'T20:00:00+08:00';
 a.nativeEvidence.pythonEvidence={[e.symbol+'/'+e.date]:e};b.nativeEvidence.pythonEvidence=structuredClone(a.nativeEvidence.pythonEvidence);
 const ar=runAdaptiveResearch(a),br=runAdaptiveResearch(b);assert.deepEqual(ar.nativeAdaptation.signals,br.nativeAdaptation.signals.filter(s=>s.date<=a.asOf));
 assert.equal(br.nativeAdaptation.omitted[0].reason,'NOT_KNOWN_AT_DAILY_DECISION');
 a.decisionAt=a.asOf+'T15:30:00+08:00';assert.throws(()=>runAdaptiveResearch(a),/16:00/);
});
module.exports={input};
