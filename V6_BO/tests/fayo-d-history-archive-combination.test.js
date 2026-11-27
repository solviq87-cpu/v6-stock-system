'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createMarketFailover}=require('../src/core/market-failover');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const E=require('../src/core/market-data-evidence');
const tick=Date.parse('2025-02-10T16:00:00+08:00');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const data=(provider='eastmoney-public-history',end=41,observedAt=tick-1000)=>({
 source:'imported',provider,datasetId:provider+'-d27',asOf:new Date(Date.UTC(2025,0,end)).toISOString().slice(0,10),observedAt,
 priceAdjustment:{mode:'unadjusted',provider},factorVersion:'raw-v1',volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
 stocks:[{symbol:'600000',bars:Array.from({length:end},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000,amount:10000,suspended:false}))}]
});
const bytes=d=>Buffer.from(JSON.stringify(d,null,2));
function fixture(t,{maxCacheAgeMs=10000}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d27-chain-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sources=['eastmoney-public-history','baostock'].map((provider,i)=>({id:i?'backup':'main',provider,datasetId:provider+'-d27',
  url:'https://'+(i?'backup':'primary')+'.example.org/history',evidenceRoot:path.join(dir,(i?'backup':'main')+'.evidence')}));
 const payloads=new Map(sources.map(s=>[s.url,bytes(data(s.provider))])),calls=[];
 let now=tick;
 const fetchImpl=async url=>{calls.push(url);if(!payloads.has(url))throw Error('fixture offline');const raw=payloads.get(url);
  return {status:200,ok:true,url,headers:{get:k=>k==='content-type'?'application/json':k==='content-length'?String(raw.length):null},
   body:(async function*(){yield raw;})()};};
 const file=id=>path.join(dir,id+'.json'),src=id=>sources.find(s=>s.id===id),root=id=>src(id).evidenceRoot;
 const create=(extra={})=>createMarketFailover({sources,directory:dir,retries:0,fetchImpl,clock:()=>now,maxCacheAgeMs,...extra});
 const set=(id,value)=>payloads.set(src(id).url,Buffer.isBuffer(value)?value:bytes(value));
 const offline=id=>payloads.delete(src(id).url),touch=id=>fs.utimesSync(file(id),now/1000,now/1000);
 const receipts=id=>E.readReceipts(root(id),{provider:src(id).provider,datasetId:src(id).datasetId,verifyRaw:true});
 const asOf=(id,decisionAt=now)=>E.readMarketDataAsOf({root:root(id),provider:src(id).provider,datasetId:src(id).datasetId,decisionAt});
 const blob=(id,ref)=>path.join(root(id),'blobs',ref.sha256+'.bin');
 return {dir,sources,create,src,root,file,set,offline,touch,receipts,asOf,blob,calls,setNow:v=>{now=v;},clock:()=>now,fetchImpl};
}
test('real importer raw archive, latest admission and published projection share identity without confusing the two hashes',async t=>{
 const f=fixture(t),raw=bytes(data()),r=await f.create().sync();
 assert.equal(r.mode,'primary',JSON.stringify(r.attempts));assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
 const list=f.receipts('main');assert.equal(list.length,1);
 assert.equal(r.archiveEvidence.archiveHash,list[0].hash);assert.equal(r.archiveEvidence.dataVersion,digest(raw));
 assert.notEqual(digest(raw),digest(JSON.stringify(r.data)));
 assert.equal(E.readRaw(f.root('main'),list[0].data.rawEvidence).equals(raw),true);
 assert.deepEqual(JSON.parse(fs.readFileSync(f.file('main'),'utf8')),r.data);
 assert.equal(f.asOf('main',tick-1).status,'unavailable-at-decision');
 assert.equal(f.asOf('main').archiveHash,list[0].hash);
});
test('exact repeated import at the same receipt clock is idempotent and keeps original bytes',async t=>{
 const f=fixture(t),service=f.create(),a=await service.sync(),b=await service.sync();
 assert.equal(a.mode,'primary');assert.equal(b.mode,'primary');assert.equal(b.updated,false);
 assert.equal(a.archiveEvidence.archiveHash,b.archiveEvidence.archiveHash);
 assert.equal(f.receipts('main').length,1);
 assert.equal(fs.readdirSync(path.join(f.root('main'),'blobs')).length,1);
});
test('offline restart uses actual archived receipt and refuses an expired payload after touching the projection',async t=>{
 const f=fixture(t);assert.equal((await f.create().sync()).mode,'primary');
 f.offline('main');f.offline('backup');f.setNow(tick+3000);f.touch('main');
 const r=await f.create().sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.cacheAgeMs,4000);
 assert.equal(r.archiveEvidence.receivedAt,tick);assert.equal(r.canTrade,false);
 f.setNow(tick+20000);f.touch('main');assert.equal((await f.create().sync()).mode,'unavailable');
});
test('independent original reference is archived and a contradictory subsequent pair cannot replace valid output',async t=>{
 const f=fixture(t),secondary=path.join(f.dir,'reference.json');
 fs.writeFileSync(secondary,bytes(data('baostock')));
 const sources=[{...f.sources[0],secondaryFile:secondary},f.sources[1]];
 f.offline('backup');
 const service=f.create({sources}),a=await service.sync();assert.equal(a.mode,'primary',JSON.stringify(a.attempts));
 const old=fs.readFileSync(f.file('main'),'utf8'),first=f.receipts('main')[0];assert.ok(first.data.independentReference);
 assert.equal(E.readRaw(f.root('main'),first.data.independentReference.rawEvidence).equals(bytes(data('baostock'))),true);
 const bad=data('baostock');bad.stocks[0].bars[0].close=10.9;
 fs.writeFileSync(secondary,bytes(bad));f.setNow(tick+1000);f.touch('main');
 const b=await service.sync();assert.equal(b.mode,'cached-degraded');assert.equal(b.archiveEvidence.archiveHash,first.hash);
 assert.equal(fs.readFileSync(f.file('main'),'utf8'),old);
 assert.deepEqual(f.receipts('main').map(e=>e.data.status),['admitted','quarantined']);
 assert.equal(f.asOf('main').archiveHash,first.hash);
});
test('corruption in an older quarantine blocks main recovery even when latest raw is intact, without poisoning an independent backup',async t=>{
 const f=fixture(t);f.set('main',Buffer.from('{broken JSON'));assert.equal((await f.create().sync()).mode,'fallback');
 const q=f.receipts('main')[0];assert.equal(q.data.status,'quarantined');
 f.setNow(tick+1000);f.set('main',data());assert.equal((await f.create().sync()).mode,'primary');
 assert.equal(f.receipts('main').length,2);
 const projection=fs.readFileSync(f.file('main'),'utf8');
 f.offline('main');f.offline('backup');f.setNow(tick+2000);f.touch('main');f.touch('backup');
 fs.writeFileSync(f.blob('main',q.data.rawEvidence),Buffer.from('x'.repeat(q.data.rawEvidence.byteLength)));
 assert.throws(()=>f.asOf('main'),/哈希/);
 const r=await f.create().sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.sourceId,'backup');
 assert.equal(fs.readFileSync(f.file('main'),'utf8'),projection);assert.equal(r.canTrade,false);
});
test('an admitted receipt whose projection rename failed cannot promote old output; exact retry recovers without duplicating the receipt',async t=>{
 const f=fixture(t);f.offline('backup');f.set('main',data('eastmoney-public-history',40));
 const service=f.create();assert.equal((await service.sync()).mode,'primary');const old=fs.readFileSync(f.file('main'),'utf8');
 f.setNow(tick+1000);f.touch('main');f.set('main',data());
 const rename=fs.renameSync;let fired=false;
 fs.renameSync=(from,to)=>{if(to===f.file('main')){fired=true;throw Error('fixture interrupted output rename');}return rename(from,to);};
 try{const blocked=await service.sync();assert.equal(fired,true);assert.equal(blocked.mode,'unavailable');}
 finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(f.file('main'),'utf8'),old);
 const events=f.receipts('main');assert.equal(events.length,2);assert.equal(events[1].data.status,'admitted');
 const restored=await service.sync();assert.equal(restored.mode,'primary');assert.equal(restored.archiveEvidence.archiveHash,events[1].hash);
 assert.equal(f.receipts('main').length,2);assert.equal(restored.data.stocks[0].bars.length,41);assert.equal(restored.canTrade,false);
});
