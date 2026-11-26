'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayStrategyEvidence:replay}=require('../src/core/strategy-evidence-replay');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:35,stocks:[{code:'000001',market:'main',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
const signal=(i,patch={})=>({system:'fourteen',symbol:'000001',date:dates[i],observedThrough:dates[i],verdict:'pass',provenance:'native-test-fixture',evaluatorVersion:'v1',...patch});
const bundle=signals=>({source:'test-fixture',generatedAt:'2026-11-05T00:00:00Z',signals});
const run=signals=>replay(history,bundle(signals));
test('malformed observation cutoffs cannot masquerade as earlier calendar dates',()=>{
 for(const observedThrough of ['',' ','2025-02-29','2026-01-00','2026-01-0','2026-01-02T00:00:00Z']){
  assert.throws(()=>run([signal(32,{observedThrough})]),/观察截止日期/,JSON.stringify(observedThrough));
 }
});
test('native evaluator version must be a bounded nonblank canonical string',()=>{
 for(const evaluatorVersion of [' ','\t','v1\nnext',' v1','v1 ',42,null,'v'.repeat(257)]){
  assert.throws(()=>run([signal(32,{evaluatorVersion})]),/评估器版本/,JSON.stringify(evaluatorVersion));
 }
});
test('each replay window retains the exact signal observation cutoff and evaluator version',()=>{
 const items=[signal(31,{observedThrough:dates[30],evaluatorVersion:'native/v1'}),signal(33,{evaluatorVersion:'native/v2'}),signal(35,{evaluatorVersion:'native/v3'})];
 const before=JSON.stringify(items),r=run(items);
 for(const [window,i] of [['inSample',0],['unassigned',1],['outOfSample',2]]){
  const record=r.windows[window].records[0];
  assert.equal(record.signalDate,items[i].date);
  assert.equal(record.observedThrough,items[i].observedThrough);
  assert.equal(record.evaluatorVersion,items[i].evaluatorVersion);
  assert.equal(record.provenance,items[i].provenance);
 }
 assert.equal(JSON.stringify(items),before);assert.equal(r.canTrade,false);
});
test('mixed native versions stay visible and do not masquerade as a single version evaluation',()=>{
 const r=run([signal(30,{evaluatorVersion:'native/v2'}),signal(31,{evaluatorVersion:'native/v1'}),signal(35,{evaluatorVersion:'native/v3'})]);
 const a=r.windows.inSample.systems.fourteen,b=r.windows.outOfSample.systems.fourteen,c=r.windows.inSample.systems.gpt;
 assert.deepEqual(a.evaluatorVersions,['native/v1','native/v2']);assert.equal(a.mixedEvaluatorVersions,true);
 assert.match(a.metricsNote,/混合评估器版本/);
 assert.deepEqual(b.evaluatorVersions,['native/v3']);assert.equal(b.mixedEvaluatorVersions,false);
 assert.deepEqual(c.evaluatorVersions,[]);assert.equal(c.mixedEvaluatorVersions,false);
});
test('existing future cutoff rejection and honest dated research controls remain intact',()=>{
 assert.throws(()=>run([signal(32,{observedThrough:dates[33]})]),/未来数据/);
 const r=run([signal(31,{observedThrough:dates[30]})]);
 assert.equal(r.windows.inSample.systems.fourteen.evidenceCount,1);
 assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
});
