'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const sourcePath=path.resolve(__dirname,'../src/core/native-strategy-daily-runner.js');
const originalRequire=createRequire(sourcePath);
const pack=require('../strategies/a-share-strategy-pack.json');
const fields=[...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))];
const date='2025-02-09',symbol='000001',cutoff=Date.parse(date+'T23:59:59.999+08:00'),received=cutoff-1000;
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history={source:'imported',provider:'research-provider',datasetId:'daily-data',asOf:date,
 stocks:[{symbol,bars:dates.map(d=>({date:d,open:10,high:11,low:9,close:10,volume:1000}))}]};
const key=symbol+'/'+date;
const base=()=>({symbol,observedThrough:date,knownAt:received,
 gptSnapshotObservedThrough:date,gptSnapshot:Object.fromEntries(fields.map(k=>[k,80])),
 market:Object.fromEntries(['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'].map(k=>[k,80])),
 sector:{score:80},auction:{score:80},profitRatio:0.3,mainInflow:100,thsNetAmt:100,
 fundsSourceTimestamp:received-10,fundsRetrievedAt:received,
 fundDays:[{date:'2025-02-07',main:100,retrievedAt:received}],sectorInfo:{secZT:3}});
const py=()=>({symbol,date,observedThrough:date,evaluatorVersion:'python-native/v1',provenance:'python-runtime:fixture-receipt',
 rounds:[1,2,3].map(round=>({round,verdict:'pass',reason:'recorded',observedThrough:date,receivedAt:received}))});
function run(extra=base(),python=py()){
 const calls={fourteen:[],bazi:[],gpt:[]},m={exports:{}};
 // Exercise the actual data admission runner with strict observation spies at
 // the three scoring boundaries. The real Python evidence validator, fourteen
 // projector, historical dataset validator and configuration are not mocked.
 const req=id=>id==='../../myrules'?{evaluateOne(x){calls.fourteen.push(x);return {items:[{i:11,unknown:false}],known:8,unknown:0,hits:8,excluded:[],exclusionPending:[],verdict:'pass'};}}:
  id==='../../bazi'?{evaluate(x){calls.bazi.push(x);return {total:90,insufficient:[],coverage:{criticalMissing:[]},verdict:'可介入'};}}:
  id==='./multi-strategy-engine'?{evaluateMultiStrategy(x){calls.gpt.push(x);return {pass:true,finalScore:90,regime:{regime:'neutral'}};}}:
  id==='./strategy-evidence-replay'?{replayStrategyEvidence(){return {researchOnly:true};}}:originalRequire(id);
 new Function('require','module','exports',fs.readFileSync(sourcePath,'utf8'))(req,m,m.exports);
 const result=m.exports.runNativeDaily(history,{snapshots:{[key]:extra},pythonEvidence:{[key]:python}});
 return {result,rows:result.details.at(-1).results,calls,stock:calls.fourteen.at(-1),funds:calls.bazi.at(-1)};
}
test('same-session direct evidence still reaches all four native boundaries without enabling trading',()=>{
 const r=run();for(const k of ['fourteen','bazi','gpt','python'])assert.equal(r.rows[k].verdict,'pass');
 assert.equal(r.result.canTrade,false);assert.equal(r.result.verifiedLive,false);assert.equal(r.calls.gpt.length,1);
 assert.equal(r.funds.mainInflow,100);assert.equal(r.stock.auction.score,80);
});
test('nested late or wrong-security GPT factor evidence cannot reach the original GPT scorer',()=>{
 for(const patch of [{receivedAt:cutoff+1},{symbol:'600000'},{sourceConflict:true},{synthetic:true}]){
  const x=base();Object.assign(x.gptSnapshot,patch);const r=run(x);
  assert.equal(r.calls.gpt.length,0);assert.equal(r.rows.gpt.verdict,'unknown');assert.equal(r.rows.fourteen.verdict,'pass');assert.equal(r.rows.python.verdict,'pass');
 }
});
test('market snapshot late publication or contradictory observation clock cannot supply GPT environment',()=>{
 for(const patch of [{observedAt:cutoff+1},{observedAt:received,availableAt:received-1},{conflict:true}]){
  const x=base();Object.assign(x.market,patch);const r=run(x);
  assert.equal(r.calls.gpt.length,0);assert.equal(r.rows.gpt.verdict,'unknown');assert.equal(r.rows.bazi.verdict,'pass');
 }
});
test('dated fund rows and explicit receipt aliases cannot be backdated or silently borrowed',()=>{
 let x=base();x.fundDays[0].retrievedAt=cutoff+1;let r=run(x);assert.equal(r.funds.fundDays,undefined);assert.equal(r.rows.bazi.verdict,'unknown');
 for(const patch of [{fundsRetrievedAt:cutoff+1},{fundsRetrievedAt:received-100},{fundsSourceConflict:true}]){
  x={...base(),...patch};r=run(x);assert.equal(r.funds.mainInflow,undefined);assert.equal(r.funds.thsNetAmt,undefined);assert.equal(r.rows.bazi.verdict,'unknown');assert.equal(r.rows.gpt.verdict,'pass');
 }
});
test('fourteen legacy and nested declared evidence is not passed through a later receipt or wrong symbol',()=>{
 const x=base();x.auction={score:99,receivedAt:cutoff+1};x.profitRatio={value:0.9,code:'600000'};
 x.sector={score:90,sourceConflict:true};const r=run(x);
 for(const k of ['auction','profitRatio','sector'])assert.equal(r.stock[k],undefined);
 assert.equal(r.rows.fourteen.verdict,'unknown');assert.equal(r.rows.bazi.verdict,'pass');assert.equal(r.rows.gpt.verdict,'pass');
});
test('late, wrong-security or synthetic Python round is unknown without erasing other native results',()=>{
 for(const patch of [{receivedAt:cutoff+1},{symbol:'600000'},{simulated:true}]){
  const p=py();Object.assign(p.rounds[1],patch);const r=run(base(),p);
  assert.equal(r.rows.python.verdict,'unknown');assert.equal(r.rows.gpt.verdict,'pass');assert.equal(r.rows.fourteen.verdict,'pass');assert.equal(r.rows.bazi.verdict,'pass');
  assert.equal(r.result.signals.find(s=>s.system==='python'&&s.date===date).verdict,'unknown');
 }
});
