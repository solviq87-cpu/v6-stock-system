'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const source=fs.readFileSync(require.resolve('../src/core/market-failover'),'utf8');
const tick=Date.parse('2026-11-26T16:00:00+08:00');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-h02-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let now=tick;const calls=[],behavior=new Map(),sources=['main','backup'].map(id=>({id,provider:id,datasetId:id}));
 function success(id){const data={source:'imported',provider:id,datasetId:id,asOf:'2026-11-25',stocks:[{symbol:'600000',bars:[{close:10}]}]};
  fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(data));
  return {updated:true,asOf:data.asOf,hash:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};}
 const local={exports:{}},req=id=>id==='./market-data-center'?{createMarketDataCenter({id}){return {async sync(){calls.push(id);return behavior.has(id)?behavior.get(id)():success(id);}};},validateImport(){}}:require(id);
 new Function('module','exports','require',source)(local,local.exports,req);
 const service=local.exports.createMarketFailover({sources,directory:dir,retries:0,clock:()=>now,fetchImpl:async()=>{throw Error('no network');}});
 return {service,calls,behavior,success,clock:value=>{now=value;}};
}
test('H02 actual attempt identity, fixed reason and time without private error',async t=>{
 const f=fixture(t);f.behavior.set('main',()=>{f.clock(tick+2);throw Error('private secret');});
 const r=await f.service.sync();assert.equal(r.mode,'fallback');assert.equal(r.attempts[0].status,'adapter-threw');
 assert.equal(r.attempts[0].attemptedAt,tick);assert.equal(r.attempts[0].finishedAt,tick+2);
 assert.equal(r.attempts[1].status,'verified-original-research-receipt');assert.equal(r.canTrade,false);
 assert.doesNotMatch(JSON.stringify(r),/private secret/);assert.deepEqual(f.calls,['main','backup']);
});
test('H02 new in-flight pass is distinct from previous success; busy calls start no new work',async t=>{
 const f=fixture(t);assert.equal((await f.service.sync()).mode,'primary');
 let release;f.behavior.set('main',()=>new Promise(resolve=>{release=resolve;}));
 f.clock(tick+10);const task=f.service.sync();const during=f.service.status();
 assert.equal(during.running,true);assert.equal(during.currentPass,'in-progress');assert.equal(during.lastPassAttemptedAt,tick+10);
 assert.equal(during.currentLiveCertified,false);assert.equal((await f.service.sync()).reason,'busy');
 release(f.success('main'));await task;assert.equal(f.service.status().running,false);assert.deepEqual(f.calls,['main','main']);
});
test('H02 clock rollback after real attempt retains an unknown completion and stops fallback',async t=>{
 const f=fixture(t);f.behavior.set('main',()=>{f.clock(tick-1);return {error:'private'};});
 const r=await f.service.sync();assert.equal(r.mode,'unavailable');assert.equal(r.attempts.length,1);
 assert.equal(r.attempts[0].status,'clock-unverified');assert.equal(r.attempts[0].finishedAt,null);
 assert.deepEqual(f.calls,['main']);assert.equal(r.canTrade,false);
});
test('H02 malformed receipt and rejected persisted identity remain separate without extra work',async t=>{
 const f=fixture(t);f.behavior.set('main',()=>({updated:true,hash:'bad'}));
 assert.equal((await f.service.sync()).attempts[0].status,'invalid-receipt');
 f.behavior.set('main',()=>({...f.success('main'),asOf:'2026-11-24'}));
 const r=await f.service.sync();assert.equal(r.attempts[0].status,'persisted-evidence-rejected');
 assert.deepEqual(f.calls,['main','backup','main','backup']);assert.equal(r.mode,'fallback');assert.equal(r.canTrade,false);
});
