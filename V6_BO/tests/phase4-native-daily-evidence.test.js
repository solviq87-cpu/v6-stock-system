'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
const pack=require('../strategies/a-share-strategy-pack.json');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
const date=dates[38],key='000001/'+date;
const scores=()=>Object.fromEntries([...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))].map(k=>[k,k==='riskScore'?0:90]));
const market=()=>({breadthScore:70,indexTrendScore:70,marketVolumeScore:70,riskScore:0,volatilityScore:20,sentimentScore:70});
const context=patch=>({symbol:'000001',observedThrough:date,gptSnapshotObservedThrough:date,gptSnapshot:scores(),market:market(),...patch});
const at=(d,t='16:00:00')=>Date.parse(d+'T'+t+'+08:00');
const run=patch=>runNativeDaily(history,{snapshots:{[key]:context(patch)}});
const result=patch=>run(patch).details[38].results;
function py(patch={}){
 return {symbol:'000001',date,observedThrough:date,evaluatorVersion:'python-native/fixture-v1',
 provenance:'python-runtime:isolated-fixture',rounds:[1,2,3].map(round=>({round,verdict:'pass',reason:'测试回执',observedThrough:date})),...patch};
}
test('direct native entry rejects overrides of historical rows and immutable identity',()=>{
 for(const patch of [{rows:[]},{bars:history.stocks[0].bars},{price:1},{code:'600000'},{ctx:{}},{stock:{}}])
  assert.throws(()=>run(patch),/快照不得覆盖/);
});
test('GPT abstains when any market environment input is missing or outside its domain',()=>{
 for(const m of [undefined,{}, {...market(),riskScore:-1},{...market(),volatilityScore:101},{...market(),breadthScore:'70'}])
  assert.equal(result({market:m}).gpt.verdict,'unknown');
 assert.equal(result({marketObservedThrough:dates[39]}).gpt.verdict,'unknown');
});
test('out-of-range GPT factor values never become a native strategy verdict',()=>{
 for(const riskScore of [-1,101,NaN,Infinity]){
  assert.equal(result({gptSnapshot:{...scores(),riskScore}}).gpt.verdict,'unknown');
 }
 assert.equal(result({gptSnapshot:Object.create(scores())}).gpt.verdict,'unknown');
});
test('explicitly late or malformed original snapshots cannot backfill old decisions',()=>{
 for(const patch of [{knownAt:at(dates[39])},{availableAt:at(dates[39])},{receivedAt:'not-a-time'},{recordedAt:null}]){
  const r=result(patch);assert.equal(r.gpt.verdict,'unknown');
 }
 assert.equal(result({knownAt:at(date)}).gpt.verdict,'pass');
 assert.equal(result({knownAt:date+'T16:00:00+08:00'}).gpt.verdict,'pass');
});
test('future dated fund history cannot change the native eight-word result',()=>{
 const baseline=result({}).bazi;
 const future=[{date:dates[37],main:1e8},{date,main:1e8},{date:dates[39],main:1e8}];
 const late=[{date:dates[36],main:1e8},{date:dates[37],main:1e8},{date,main:1e8,knownAt:at(dates[39])}];
 // Rejected evidence must leave every original native result field identical.
 // The new diagnostic fields are required, not part of the native score.
 assert.equal(baseline.verdict,'unknown');
 assert.equal(baseline.evidenceComplete,false);
 assert.equal(Object.hasOwn(baseline,'rejectedDataInputs'),false);
 assert.equal(Object.hasOwn(baseline,'sourceEvidenceVerified'),false);
 const assertRejected=(patch,expectedGap)=>{
  const {rejectedDataInputs,sourceEvidenceVerified,...native}=result(patch).bazi;
  assert.deepEqual(native,baseline);
  assert.deepEqual(rejectedDataInputs,[expectedGap]);
  assert.equal(sourceEvidenceVerified,false);
 };
 for(const fundDays of [future,late])assertRejected({fundDays},'fundDays');
 assertRejected({mainInflow:1e8,fundsSourceTimestamp:at(dates[39])},'fundReceipt');
});
test('late or invalid Python receipts remain unknown rather than creating historical passes',()=>{
 for(const knownAt of [at(dates[39]),'not-a-time',null]){
  const r=runNativeDaily(history,{pythonEvidence:{[key]:py({knownAt})}});
  assert.equal(r.details[38].results.python.verdict,'unknown');
 }
 const good=runNativeDaily(history,{pythonEvidence:{[key]:py({knownAt:date+'T20:00:00+08:00'})}});
 assert.equal(good.details[38].results.python.verdict,'pass');
});
test('legitimate same-day GPT inputs preserve original native score and distinct evaluator version',()=>{
 const r=run({knownAt:date+'T16:00:00+08:00'});
 const expected=require('../src/core/multi-strategy-engine').evaluateMultiStrategy({snapshot:scores(),market:market(),strategies:pack.strategies});
 assert.equal(r.details[38].results.gpt.score,expected.finalScore);
 assert.equal(r.details[38].results.gpt.verdict,expected.pass?'pass':'fail');
 const s=r.signals.find(x=>x.system==='gpt'&&x.date===date);
 assert.equal(s.evaluatorVersion,'v6-native-daily-2');
 assert.equal(r.canTrade,false);
});
test('absence of optional evidence remains unknown and preserves native coverage totals',()=>{
 const r=runNativeDaily(history);
 assert.equal(r.coverage.gpt.unknown,40);assert.equal(r.coverage.python.unknown,40);
 for(const c of Object.values(r.coverage))assert.equal(c.evaluated+c.unknown,40);
 assert.equal(r.signals.length,160);
});

test('GPT nested factors and market evidence cannot be later than the historical session or parent receipt',()=>{
 for(const patch of [
  {gptSnapshot:{...scores(),knownAt:at(dates[39])}},
  {market:{...market(),sourceTimestamp:at(dates[39])}},
  {market:{...market(),observedThrough:dates[39]}},
  {gptSnapshot:{...scores(),symbol:'600000'}},
  {knownAt:at(date,'16:00:00'),market:{...market(),receivedAt:at(date,'17:00:00')}},
  {market:{...market(),availableAt:null}}
 ])assert.equal(result(patch).gpt.verdict,'unknown');
 const valid=result({knownAt:at(date),gptSnapshot:{...scores(),knownAt:at(date)},market:{...market(),date,knownAt:at(date)}});
 assert.equal(valid.gpt.verdict,'pass');
});
test('Python round-level late or foreign evidence remains unknown even with an on-time parent',()=>{
 for(const patch of [{knownAt:at(dates[39])},{observedAt:null},{symbol:'600000'},{tradeDate:dates[39]},{receivedAt:at(date,'17:00:00')} ]){
  const entry=py({knownAt:at(date)});
  entry.rounds[1]={...entry.rounds[1],...patch};
  const r=runNativeDaily(history,{pythonEvidence:{[key]:entry}});
  assert.equal(r.details[38].results.python.verdict,'unknown');
 }
 const entry=py({knownAt:at(date)});
 entry.rounds=entry.rounds.map(r=>({...r,symbol:'000001',knownAt:at(date)}));
 assert.equal(runNativeDaily(history,{pythonEvidence:{[key]:entry}}).details[38].results.python.verdict,'pass');
});
