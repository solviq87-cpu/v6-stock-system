'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const sourcePath=path.resolve(__dirname,'../src/core/market-failover.js');
const sha=data=>crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const tick=Date.parse('2026-11-26T16:00:00+08:00');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-b4-failover-')),calls=[],behaviors=new Map();let now=tick;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sources=['main','backup'].map(id=>({id,provider:id+'-provider',datasetId:id+'-dataset'}));
 const data=id=>({source:'imported',provider:id+'-provider',datasetId:id+'-dataset',asOf:'2026-11-25',stocks:[{symbol:'600000',bars:[{close:10}]}]});
 const file=id=>path.join(dir,id+'.json');
 const write=(id,value=data(id))=>{fs.writeFileSync(file(id),JSON.stringify(value)+'\n');return value;};
 const ok=id=>{const value=write(id);return {updated:true,hash:sha(value),asOf:value.asOf};};
 const m={exports:{}};
 const req=id=>id==='./market-data-center'?{
  createMarketDataCenter({id}){return {async sync(){calls.push(id);return behaviors.has(id)?behaviors.get(id)():ok(id);}};},
  validateImport(value,{provider,datasetId}){if(value?.source!=='imported'||value.provider!==provider||value.datasetId!==datasetId||!Array.isArray(value.stocks)||!value.stocks.length)throw Error('fixture identity mismatch');return {};}
 }:require(id);
 new Function('require','module','exports',fs.readFileSync(sourcePath,'utf8'))(req,m,m.exports);
 const service=m.exports.createMarketFailover({sources,directory:dir,retries:0,clock:()=>now,maxCacheAgeMs:86400000});
 return {service,calls,behaviors,data,file,write,ok,setNow:v=>{now=v;}};
}
test('a primary success receipt must bind its actual persisted data before recovering primary status',async t=>{
 const x=fixture(t);x.behaviors.set('main',()=>{const r=x.ok('main');x.write('main',{...x.data('main'),asOf:'2026-11-24'});return r;});
 const r=await x.service.sync();assert.equal(r.mode,'fallback');assert.deepEqual(x.calls,['main','backup']);
 assert.equal(r.attempts[0].ok,false);assert.equal(r.data.provider,'backup-provider');assert.equal(r.canTrade,false);
 x.behaviors.delete('main');const restored=await x.service.sync();assert.equal(restored.mode,'primary');assert.equal(restored.stale,false);
});
test('busy, thrown and malformed primary replies do not abort the original fallback chain',async t=>{
 const x=fixture(t);
 for(const run of [()=>({updated:false,reason:'busy'}),()=>{throw Error('fixture unavailable');},()=>({updated:true})]){
  x.behaviors.set('main',run);const r=await x.service.sync();assert.equal(r.mode,'fallback');assert.equal(r.attempts[0].ok,false);
 }
});
test('bad successful source file cannot be reclassified as an eligible cached fallback in the same pass',async t=>{
 const x=fixture(t);x.behaviors.set('main',()=>{const r=x.ok('main');x.write('main',{...x.data('main'),asOf:'2026-11-24'});fs.utimesSync(x.file('main'),tick/1000,tick/1000);return r;});
 x.behaviors.set('backup',()=>({error:'unavailable'}));
 const r=await x.service.sync();assert.equal(r.mode,'unavailable');assert.equal(r.stale,true);assert.equal(r.data,undefined);
});
test('clock rollback during a sync cannot publish a recovered or cached feed',async t=>{
 const x=fixture(t);x.behaviors.set('main',()=>{const r=x.ok('main');x.setNow(tick-1);return r;});
 const r=await x.service.sync();assert.equal(r.mode,'unavailable');assert.equal(r.canTrade,false);assert.equal(r.data,undefined);
 assert.deepEqual(x.calls,['main']);
 x.setNow(tick+1);x.behaviors.delete('main');assert.equal((await x.service.sync()).mode,'primary');
});
test('a normal cached degraded result retains its source identity and stale flag',async t=>{
 const x=fixture(t);const value=x.write('main');fs.utimesSync(x.file('main'),(tick-1000)/1000,(tick-1000)/1000);
 x.behaviors.set('main',()=>({error:'offline'}));x.behaviors.set('backup',()=>({error:'offline'}));
 const r=await x.service.sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.stale,true);assert.deepEqual(r.data,value);
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);assert.equal(x.service.status().data,undefined);
});
