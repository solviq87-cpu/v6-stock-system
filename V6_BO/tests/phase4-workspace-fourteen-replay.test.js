'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {diagnosticInputsFromEvents}=require('../src/core/evolution-research-statistics');
const {nativePointInTime}=require('../src/core/research-causal-diagnostics');
const {projectFourteenEvidence}=require('../src/core/native-fourteen-evidence');
const symbol='600001',dates=Array.from({length:70},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const date=dates[68],key=symbol+'/'+date,at=(d,t='16:00:00')=>Date.parse(d+'T'+t+'+08:00');
const history={source:'imported',provider:'tencent',asOf:dates.at(-1),stocks:[{code:symbol,bars:dates.map(d=>({date:d,open:10,high:10.1,low:9.9,close:10,volume:10000,amount:100000000}))}]};
const e=patch=>({symbol,date,knownAt:at(date,'15:30:00'),source:'provider:archived-original',
 stock:{limitUpCount:0,breakCount:0,sealAmount:0,amount:100000000,floatCap:5e9},...patch});
const event=(proof=e(),recordedAt=at(date),patch={})=>({kind:'analysis',sequence:1,recordedAt,data:{symbol,tradeDate:date,
 asOf:Math.min(recordedAt,at(date)),provider:'tencent',priceBasis:'unadjusted',nativeInputs:{fourteen:proof},...patch}});
const project=events=>diagnosticInputsFromEvents(events,history,{asOf:at(dates.at(-1))});
const snap=proof=>({symbol,observedThrough:date,knownAt:at(date),fourteenEvidence:proof});
const evaluate=(snapshots,announcements=[])=>nativePointInTime({history,snapshots,announcements},date).details.at(-1).results.fourteen;
test('archive preserves original count, identity and receipt instead of dropping the native evidence',()=>{
 const first=event(),before=JSON.stringify(first),p=project([first]),s=p.snapshots[key];
 assert.deepEqual(s.fourteenEvidence,first.data.nativeInputs.fourteen);
 assert.equal(s.knownAt,first.recordedAt);assert.equal(s.fourteenEvidence.knownAt,at(date,'15:30:00'));
 assert.equal(JSON.stringify(first),before);assert.notEqual(s.fourteenEvidence,first.data.nativeInputs.fourteen);
 const result=evaluate(p.snapshots);assert.equal(result.snapshotEvidence.knownAt,at(date,'15:30:00'));
 assert.equal(result.exclusionPending,false);
});
test('first archive receipt cannot be filled by a later revision and a next-day receipt cannot backdate the bundle',()=>{
 const first=event(undefined,at(date),{nativeInputs:{}}),later=event(e(),at(date,'17:00:00'));
 later.sequence=2;assert.equal(project([later,first]).snapshots[key],undefined);
 const next=project([event(e(),at(dates.at(-1)))]);
 assert.equal(next.snapshots[key]?.fourteenEvidence,undefined);
 assert.equal(evaluate(next.snapshots).verdict,'unknown');
});
test('invalid original source and premature or contradictory close evidence do not confirm the count',()=>{
 for(const proof of [e({symbol:'600002'}),e({source:'synthetic-fixture'}),e({knownAt:at(date,'14:59:59')}),
  e({sourceTimestamp:at(date,'14:00:00')}),e({knownAt:at(dates.at(-1))}),e({stock:{limitUpCount:0,price:1}})]){
  assert.equal(project([event(proof)]).snapshots[key]?.fourteenEvidence,undefined);
 }
 assert.equal(projectFourteenEvidence({...snap(e()),knownAt:undefined},{symbol,date,cutoff:at(date)}),null);
});
test('recursive time filtering cannot hide an invalid child section and restore original count',()=>{
 const bad=e({auction:{auctionAmount:100000000,auctionPct:4,knownAt:at(dates.at(-1))}});
 const result=evaluate({[key]:snap(bad)});
 assert.equal(result.snapshotEvidence,null);assert.equal(result.verdict,'unknown');
 const good=e({auction:{auctionAmount:100000000,auctionPct:4}});
 assert.equal(evaluate({[key]:snap(good)}).snapshotEvidence.source,good.source);
});
test('announcement cannot provide or replace the original streak bundle',()=>{
 const doc={symbol,observedThrough:date,availableAt:at(date,'15:20:00'),receivedAt:at(date,'15:40:00'),
 snapshot:{fourteenEvidence:e({stock:{limitUpCount:4}})}};
 assert.equal(evaluate({},[doc]).snapshotEvidence,null);
 const result=evaluate({[key]:snap(e())},[doc]);
 assert.equal(result.exclusionPending,false);assert.equal(result.excluded.length,0);
 assert.equal(result.snapshotEvidence.knownAt,at(date,'15:30:00'));
});
