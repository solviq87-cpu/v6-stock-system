'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyFeedDiscrepancies:classify}=require('../src/core/feed-discrepancy-quarantine');
const fp=i=>i.toString(16).padStart(64,'0');
function report(n,consensus,{a='A',b='B',mode='qfq',timestamped=true,asOf}={}){
 return {schemaVersion:1,mode:'independent-feed-shape-and-value-consensus',
  canTrade:false,verifiedExternal:false,releaseReady:false,
  consensus,discrepancies:consensus?0:2,comparedBars:39,
  asOf:asOf??new Date(Date.UTC(2026,0,n)).toISOString().slice(0,10),
  priceAdjustmentMode:mode,timestampComparable:timestamped,
  observationSkewMs:timestamped?500:null,
  primary:{provider:a,datasetId:'set-'+n,fingerprint:fp(2*n+1)},
  secondary:{provider:b,datasetId:'set-'+n,fingerprint:fp(2*n+2)}};
}
test('independent fingerprint pairs produce research-only pair isolation without price selection',()=>{
 const r=classify([report(1,false),report(2,true,{a:'B',b:'A'}),report(3,false)]);
 assert.equal(r.pairs[0].status,'quarantined-pair');
 assert.equal(r.pairs[0].reports,3);assert.equal(r.pairs[0].failures,2);
 assert.equal(r.pairs[0].distinctAsOfDays,3);
 assert.equal(r.pairs[0].disagreementDays,2);
 assert.equal(r.pairs[0].attribution,'unknown');
 assert.equal(r.pairs[0].providerIndependenceVerified,false);
 assert.equal(r.canAutoSelectProvider,false);assert.equal(r.canTrade,false);
});
test('replay of identical evidence never accumulates a fake quarantine',()=>{
 const one=report(1,false);
 const r=classify([one,structuredClone(one),one]);
 assert.equal(r.pairs[0].reports,1);assert.equal(r.pairs[0].failures,1);
 assert.equal(r.pairs[0].duplicatesIgnored,2);
 assert.equal(r.pairs[0].status,'insufficient-evidence');
});
test('mutating conclusion or timestamp on identical fingerprints refuses contradictory evidence',()=>{
 const first=report(1,false), changed={...first,consensus:true,discrepancies:0};
 assert.throws(()=>classify([first,changed]),/来源指纹的核对证据相互矛盾/);
 assert.throws(()=>classify([first,{...first,observationSkewMs:501}]),/来源指纹的核对证据相互矛盾/);
});
test('adjustment modes and distinct unordered provider pairs do not pollute each other',()=>{
 const r=classify([
  report(1,false,{a:'A / B',b:'C'}),
  report(2,false,{a:'A',b:'B / C'}),
  report(3,false,{mode:'qfq'}),
  report(4,false,{mode:'hfq'})
 ]);
 assert.equal(r.pairs.length,4);
 assert.ok(r.pairs.every(x=>x.reports===1&&x.status==='insufficient-evidence'));
});
test('bad report, inconsistent conclusion, unauthenticated fingerprint and clock all fail closed',()=>{
 const invalid=[
  {consensus:false},
  {...report(1,false),consensus:true},
  {...report(1,false),releaseReady:true},
  {...report(1,false),canTrade:true},
  {...report(1,false),priceAdjustmentMode:'mixed'},
  {...report(1,false),observationSkewMs:300001},
  {...report(1,false),primary:{...report(1,false).primary,fingerprint:'bad'}},
  {...report(1,false),primary:{...report(1,false).primary,provider:'A '}},
 ];
 for(const x of invalid)assert.throws(()=>classify([x]));
 assert.throws(()=>classify([report(1,false)],{minimumReports:0}),/门槛/);
});
test('time evidence is reported, not fabricated; one disagreement is never enough',()=>{
 const r=classify([report(1,false,{timestamped:false}),report(2,true,{timestamped:false}),report(3,true)]);
 assert.equal(r.pairs[0].timestampedReports,1);
 assert.equal(r.pairs[0].status,'observed-pair');
 assert.equal(r.providerIndependenceVerified,false);
});

test('distinct fingerprints on one as-of date cannot fabricate three independent days',()=>{
 const same='2026-03-02';
 const reports=[report(1,false,{asOf:same}),report(2,false,{asOf:same}),
  report(3,false,{asOf:same})];
 const r=classify(reports).pairs[0];
 assert.equal(r.reports,3);
 assert.equal(r.distinctAsOfDays,1);
 assert.equal(r.disagreementDays,1);
 assert.equal(r.status,'insufficient-evidence');
});
test('opposite conclusions on one as-of day are flagged, not promoted',()=>{
 const same='2026-03-02';
 const result=classify([report(1,false,{asOf:same}),
  report(2,true,{asOf:same}),report(3,false,{asOf:'2026-03-03'})]).pairs[0];
 assert.equal(result.status,'conflicting-day-evidence');
 assert.deepEqual(result.conflictingAsOfDays,[same]);
 assert.equal(result.canAutoSelectProvider,false);
});
test('legacy undated comparison files remain visible but cannot satisfy the day threshold',()=>{
 const older=[report(1,false),report(2,false),report(3,false)];
 for(const r of older)delete r.asOf;
 const result=classify(older).pairs[0];
 assert.equal(result.legacyUndatedReports,3);
 assert.equal(result.distinctAsOfDays,0);
 assert.equal(result.status,'insufficient-evidence');
});
test('same fingerprint pair cannot be relabeled with a different as-of or invalid date',()=>{
 const first=report(1,false);
 assert.throws(()=>classify([first,{...first,asOf:'2026-02-02'}]),
  /来源指纹的核对证据相互矛盾/);
 for(const bad of ['2026-02-30','2026/02/01','2026-03-99',null]){
  assert.throws(()=>classify([{...report(1,false),asOf:bad}]),/结构/);
 }
});
