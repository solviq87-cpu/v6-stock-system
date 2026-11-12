'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {observeStock,readStockObservationResearch,archiveRawEvidence}=require('../src/core/stock-observation-research');
function fixture(){
 const dates=Array.from({length:32},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
 const clock=Date.parse(dates[30]+'T16:30:00+08:00');
 const bars=dates.slice(0,31).map((date,i)=>({date,open:10+i*.1,close:10.05+i*.1,high:10.1+i*.1,low:9.9+i*.1,volume:10000}));
 return {dates,clock,bars};
}
function response(f,clock,patch={}){
 const raw=Buffer.from(JSON.stringify({symbol:'600000',prices:f.bars})+'\n'),sha=crypto.createHash('sha256').update(raw).digest('hex');
 return {status:'observed-unverified',source:'tencent',provider:'tencent',priceBasis:'unadjusted',retrievedAt:clock,rawHash:sha,
  rawEvidence:{encoding:'base64',data:raw.toString('base64'),byteLength:raw.length,sha256:sha},units:{volume:'shares',amount:null},errors:[],
  provenance:{source:'tencent',rawHash:sha,firstObservedAt:clock,sourceTimestamp:null},
  stock:{symbol:'600000',name:null,source:'tencent',provider:'tencent',priceBasis:'unadjusted',observedAt:clock,bars:f.bars.map(b=>({...b,knownAt:clock}))},...patch};
}
const calendar=f=>()=>({status:'available',tradeDates:f.dates,calendar:{from:f.dates[0],to:f.dates.at(-1)},
 metadata:{source:'isolated-explicit-calendar',sha256:'a'.repeat(64)},nextTradeDate:f.dates.at(-1)});
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-observation-research-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,observationRoot:path.join(root,'observations'),memoryRoot:path.join(root,'memory')};}
test('one click archives real bytes and current shapes without inventing historical eligibility',async t=>{
 const dirs=setup(t),f=fixture();t.mock.method(Date,'now',()=>f.clock);
 const r=await observeStock({symbol:'600000',provider:'tencent'}, {...dirs,now:()=>f.clock,readCalendar:calendar(f),fetchHistory:async()=>response(f,f.clock)});
 assert.equal(r.status,'captured');assert.equal(r.observation.changed,true);assert.equal(r.stock.bars.length,31);
 assert.equal(r.analysis.direction.probability,null);assert.equal(r.analysis.direction.samples,0);assert.equal(r.currentFormation.status,'price-only-unverified');
 assert.equal(r.currentFormation.patterns.usable,true);assert.ok(r.readiness.blockers.length);assert.equal(r.canTrade,false);assert.equal(r.memory.status,'saved');
 const raw=response(f,f.clock).rawEvidence;assert.equal(fs.readFileSync(path.join(dirs.observationRoot,'source-responses',raw.sha256+'.json')).toString(),Buffer.from(raw.data,'base64').toString());
 assert.ok(!Object.hasOwn(r,'rawEvidence'));assert.equal(r.stock.bars[0].knownAt,f.clock);assert.equal(r.stock.bars[0].corporateAction,undefined);
});
test('duplicate capture keeps original knownAt/revision, while correction cannot change earlier reads',async t=>{
 const dirs=setup(t),f=fixture();let clock=f.clock;t.mock.method(Date,'now',()=>clock);
 const deps={...dirs,now:()=>clock,readCalendar:calendar(f),fetchHistory:async()=>response(f,clock)};
 const first=await observeStock({symbol:'600000'},deps);clock+=60000;
 const duplicate=await observeStock({symbol:'600000'},deps);assert.equal(duplicate.observation.changed,false);assert.equal(duplicate.observation.revision,1);
 assert.equal(duplicate.stock.observedAt,first.stock.observedAt);assert.equal(duplicate.history.retrievedAt,clock);assert.equal(duplicate.stock.bars[0].knownAt,f.clock);
 assert.equal(duplicate.memory.reused,true);
 const before=readStockObservationResearch({symbol:'600000',provider:'tencent'},{...deps,now:()=>f.clock});
 f.bars.at(-1).close+=.02;clock+=60000;
 const correction=await observeStock({symbol:'600000'},deps);assert.equal(correction.observation.revision,2);assert.equal(correction.stock.bars.at(-1).knownAt,clock);
 const replay=readStockObservationResearch({symbol:'600000',provider:'tencent'},{...deps,now:()=>f.clock});assert.deepEqual(replay.stock,before.stock);
 assert.equal(readStockObservationResearch({symbol:'600000',provider:'eastmoney'},deps).status,'empty');
});
test('unchanged source observations can repair failed research publication without backdating a prediction',async t=>{
 const dirs=setup(t),f=fixture();let clock=f.clock;t.mock.method(Date,'now',()=>clock);
 fs.mkdirSync(dirs.memoryRoot,{mode:0o700});fs.chmodSync(dirs.memoryRoot,0o755);
 const deps={...dirs,now:()=>clock,readCalendar:calendar(f),fetchHistory:async()=>response(f,clock)};
 const failed=await observeStock({symbol:'600000'},deps);assert.equal(failed.memory.status,'failed');assert.equal(failed.observation.revision,1);
 fs.chmodSync(dirs.memoryRoot,0o700);clock+=60000;
 const repaired=await observeStock({symbol:'600000'},deps);assert.equal(repaired.observation.changed,false);assert.equal(repaired.memory.status,'saved');
 assert.equal(repaired.memory.revision,1);assert.equal(repaired.asOf,clock);
 const {readStockMemory}=require('../src/core/stock-intelligence-memory');const read=readStockMemory(dirs.memoryRoot,'600000');
 assert.equal(read.revisions[0].decisionAt,clock);assert.equal(read.frozenPredictionOutcomes.length,0);
 assert.equal(repaired.calendar.nextTradeDate,repaired.analysis.targetDate);
});
test('missing or unsupported calendar still stores prices, never derives open dates from their rows',async t=>{
 const dirs=setup(t),f=fixture();t.mock.method(Date,'now',()=>f.clock);
 const r=await observeStock({symbol:'600000'}, {...dirs,now:()=>f.clock,readCalendar:()=>({status:'unavailable',reason:'unverified-calendar'}),fetchHistory:async()=>response(f,f.clock)});
 assert.equal(r.status,'captured');assert.equal(r.analysis,null);assert.equal(r.calendar.status,'unavailable');assert.equal(r.currentFormation.calendarContinuityVerified,false);
 assert.deepEqual(r.readiness.blockers,['unverified-calendar']);
});
test('unsupported units retain source bytes without forging a usable bar or memory',async t=>{
 const dirs=setup(t),f=fixture();t.mock.method(Date,'now',()=>f.clock);
 const r=await observeStock({symbol:'600000'}, {...dirs,now:()=>f.clock,fetchHistory:async()=>response(f,f.clock,{status:'unknown'})});
 assert.equal(r.status,'unavailable');assert.equal(r.stock,null);assert.ok(r.sourceEvidence.sha256);assert.equal(fs.existsSync(dirs.memoryRoot),false);
});
test('invalid inputs never fetch and tampered raw bytes or public/symlink paths never publish',async t=>{
 const dirs=setup(t),f=fixture();t.mock.method(Date,'now',()=>f.clock);let calls=0;
 const deps={...dirs,now:()=>f.clock,fetchHistory:async()=>{calls++;return response(f,f.clock);}};
 await assert.rejects(()=>observeStock({symbol:'../config'},deps));assert.equal(calls,0);
 const raw=response(f,f.clock).rawEvidence;assert.throws(()=>archiveRawEvidence(dirs.observationRoot,{...raw,sha256:'b'.repeat(64)}),/哈希/);
 assert.throws(()=>archiveRawEvidence(path.join(dirs.root,'public'),raw),/公开/);
 fs.mkdirSync(dirs.observationRoot,{mode:0o700});fs.symlinkSync(dirs.observationRoot,path.join(dirs.root,'alias'));
 assert.throws(()=>archiveRawEvidence(path.join(dirs.root,'alias'),raw),/符号链接/);
});
