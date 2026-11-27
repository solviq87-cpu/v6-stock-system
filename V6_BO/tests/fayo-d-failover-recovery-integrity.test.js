'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');
const sourcePath=path.resolve(__dirname,'../src/core/market-failover.js');
const tick=Date.parse('2026-11-26T16:00:00+08:00'),sha=d=>crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
function fixture(t,{retries=0,maxCacheAgeMs=86400000,requestGovernor,fetchImpl}={}){
 let now=tick,badClock=false;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d20-')),calls=[],behaviors=new Map();
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sources=['main','backup'].map((id,i)=>({id,provider:id+'-provider',datasetId:id+'-dataset',url:i?'https://qt.gtimg.cn/history':'https://push2his.eastmoney.com/history'}));
 const data=id=>({source:'imported',provider:id+'-provider',datasetId:id+'-dataset',asOf:'2026-11-25',stocks:[{symbol:'600000',bars:[{close:10}]}]});
 const file=id=>path.join(dir,id+'.json'),write=(id,d=data(id))=>{fs.writeFileSync(file(id),JSON.stringify(d));fs.utimesSync(file(id),tick/1000,tick/1000);return d;};
 const ok=id=>{const d=write(id);return {updated:true,hash:sha(d),asOf:d.asOf};};
 const offline=()=>({updated:false,error:'offline'});
 const m={exports:{}},req=id=>id==='./market-data-center'?{
  createMarketDataCenter(options){const {id}=options;return {async sync(){calls.push(id);return behaviors.has(id)?behaviors.get(id)(options):ok(id);}};},
  validateImport(d,{provider,datasetId}){if(d?.source!=='imported'||d.provider!==provider||d.datasetId!==datasetId)throw Error('identity mismatch');return {};}
 }:require(id);
 new Function('require','module','exports',fs.readFileSync(sourcePath,'utf8'))(req,m,m.exports);
 const create=opts=>m.exports.createMarketFailover({sources,directory:dir,retries,maxCacheAgeMs,fetchImpl:fetchImpl??(async()=>{throw Error('not called')}),requestGovernor,clock:()=>{if(badClock)throw Error('clock');return now;},...opts});
 return {service:create(),create,calls,behaviors,data,file,write,ok,offline,sources,setNow:x=>{now=x;},throwClock:x=>{badClock=x;}};
}
test('normal primary to backup and recovered primary keeps separate source identity',async t=>{const f=fixture(t);f.behaviors.set('main',f.offline);assert.equal((await f.service.sync()).mode,'fallback');f.behaviors.delete('main');const r=await f.service.sync();assert.equal(r.mode,'primary');assert.equal(r.canTrade,false);assert.deepEqual(f.calls,['main','backup','main']);});
test('a swallowed child clock rollback cannot continue fallback even after later recovery',async t=>{const f=fixture(t);f.behaviors.set('main',o=>{f.setNow(tick-1);try{o.clock()}catch{}f.setNow(tick+1);return f.offline();});assert.equal((await f.service.sync()).mode,'unavailable');assert.deepEqual(f.calls,['main']);f.behaviors.delete('main');assert.equal((await f.service.sync()).mode,'primary');});
test('throwing clock fails closed without physical calls',async t=>{const f=fixture(t);f.throwClock(true);assert.equal((await f.service.sync()).mode,'unavailable');assert.equal(f.calls.length,0);});
test('malformed successful receipt cannot be reclassified as cache',async t=>{const f=fixture(t);f.behaviors.set('main',()=>{f.write('main');return {updated:true,hash:'bad'};});f.behaviors.set('backup',f.offline);assert.equal((await f.service.sync()).mode,'unavailable');});
test('receipt asOf must match its persisted source date',async t=>{const f=fixture(t);f.behaviors.set('main',()=>({...f.ok('main'),asOf:'2026-11-24'}));assert.equal((await f.service.sync()).mode,'fallback');});
test('declared old original receipt cannot be refreshed by touching its file',async t=>{const f=fixture(t,{maxCacheAgeMs:10000});f.write('main',{...f.data('main'),observedAt:tick-20000});f.behaviors.set('main',f.offline);f.behaviors.set('backup',f.offline);assert.equal((await f.service.sync()).mode,'unavailable');});
test('previously verified file hash cannot silently change on failed acquisition',async t=>{const f=fixture(t);await f.service.sync();f.write('main',{...f.data('main'),asOf:'2026-11-24'});f.behaviors.set('main',f.offline);f.behaviors.set('backup',f.offline);assert.equal((await f.service.sync()).mode,'unavailable');});
test('legacy cache is explicitly mtime-only, never live or trading evidence',async t=>{const f=fixture(t);f.write('main');f.behaviors.set('main',f.offline);f.behaviors.set('backup',f.offline);const r=await f.service.sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.cacheAgeBasis,'legacy-file-time-only-unverified');assert.equal(r.originalObservationAt,null);assert.equal(r.stale,true);assert.equal(r.canTrade,false);});
test('caller mutation cannot corrupt internal attempts or source status',async t=>{const f=fixture(t),r=await f.service.sync();r.attempts[0].ok=false;assert.equal(f.service.status().attempts[0].ok,true);const s=f.service.status();s.attempts.length=0;assert.equal(f.service.status().attempts.length,1);});
test('case-folded file IDs cannot collide across source routes',t=>{const f=fixture(t);assert.throws(()=>f.create({sources:[{...f.sources[0],id:'MAIN'},f.sources[0]]}),/ID/);});
test('shared governor prevents a restricted source retry, allows independent backup and recovers at expiry',async t=>{
 let time=tick,mainCalls=0;const governor=createMarketRequestGovernor({now:()=>time,minIntervalMs:0});
 const f=fixture(t,{retries:2,requestGovernor:governor,fetchImpl:async url=>{if(url.includes('eastmoney')){mainCalls++;return {status:mainCalls===1?429:200,headers:{'Retry-After':'60'}};}return {status:200};}});
 for(const id of ['main','backup'])f.behaviors.set(id,async o=>{try{await o.fetchImpl(o.url,{});return f.ok(id);}catch{return f.offline();}});
 let r=await f.service.sync();assert.equal(r.mode,'fallback');assert.equal(mainCalls,1);assert.equal(r.attempts[0].status,'restricted');
 r=await f.service.sync();assert.equal(r.mode,'fallback');assert.equal(mainCalls,1);
 time+=60000;f.setNow(time);r=await f.service.sync();assert.equal(r.mode,'primary');assert.equal(mainCalls,2);
});
test('shared governor clock rollback fences already active success',async()=>{let at=tick,finish;const g=createMarketRequestGovernor({now:()=>at,minIntervalMs:0});const p=g.run('https://qt.gtimg.cn/',()=>new Promise(r=>{finish=r;}));const result=p.then(()=>null,e=>e);at--;finish('old');const e=await result;assert.equal(e?.code,'MARKET_RESTRICTED');assert.equal(g.state('https://qt.gtimg.cn/').stateUnavailable,true);});
test('a rollback detected by another family fences already active success even if time recovers',async()=>{let at=tick,finish;const g=createMarketRequestGovernor({now:()=>at,minIntervalMs:0});const p=g.run('https://qt.gtimg.cn/',()=>new Promise(r=>{finish=r;}));const result=p.then(()=>null,e=>e);at--;g.state('https://push2.eastmoney.com/');at+=10;finish('old');assert.equal((await result)?.code,'MARKET_RESTRICTED');});
test('state refresh exposes restrictions written by another governor before a new request',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d20-state-'));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'cooldown.json');
 const a=createMarketRequestGovernor({stateFile:file,now:()=>tick,minIntervalMs:0}),b=createMarketRequestGovernor({stateFile:file,now:()=>tick,minIntervalMs:0});
 assert.throws(()=>b.checkResponse('https://qt.gtimg.cn/',429,{}));assert.equal(a.state('https://qt.gtimg.cn/').cooldownUntil,tick+60000);
});
