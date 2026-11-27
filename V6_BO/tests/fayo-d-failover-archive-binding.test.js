'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const tick=Date.parse('2026-11-26T16:00:00+08:00');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=data=>digest(JSON.stringify(data));
// The original importer and archive API are controlled boundary fixtures.
// The actual failover implementation, disk files, bytes and hashes are native.
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d26-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sources=['main','backup'].map(id=>({id,provider:id+'-provider',datasetId:id+'-dataset'}));
 const file=id=>path.join(dir,id+'.json'),root=id=>file(id)+'.evidence';
 const data=id=>({source:'imported',provider:id+'-provider',datasetId:id+'-dataset',asOf:'2026-11-25',stocks:[{symbol:'600000',bars:[{close:10}]}]});
 const write=(id,value=data(id))=>{fs.writeFileSync(file(id),JSON.stringify(value)+'\n');fs.utimesSync(file(id),tick/1000,tick/1000);return value;};
 function archive(id,value=data(id),patch={}){
  fs.mkdirSync(root(id),{recursive:true,mode:0o700});
  const raw=Buffer.from(JSON.stringify(value,null,2)),dataVersion=digest(raw);
  fs.writeFileSync(path.join(root(id),'raw.bin'),raw,{mode:0o600});
  const receipt={status:'available-research-snapshot',researchOnly:true,canTrade:false,archiveHash:digest('receipt-'+id),dataVersion,
   receivedAt:tick-3000,availableAt:tick-1000,...patch};
  fs.writeFileSync(path.join(root(id),'receipt.json'),JSON.stringify(receipt),{mode:0o600});return receipt;
 }
 const behaviors=new Map(),calls=[],reads=[];let onRead=null;
 const offline=()=>({updated:false,error:'offline'});
 function create(extra={}){
  const m={exports:{}},req=id=>id==='./market-data-center'?{
   createMarketDataCenter({id}){return {async sync(){calls.push(id);return (behaviors.get(id)||offline)();}};},
   validateImport(value,{provider,datasetId}){if(value?.source!=='imported'||value.provider!==provider||value.datasetId!==datasetId)throw Error('fixture identity mismatch');return {};}
  }:id==='./market-data-evidence'?{
   readMarketDataAsOf({root,provider,datasetId,decisionAt}){
    reads.push({root,provider,datasetId,decisionAt});
    const receipt=JSON.parse(fs.readFileSync(path.join(root,'receipt.json'),'utf8'));
    const raw=fs.readFileSync(path.join(root,'raw.bin'));if(digest(raw)!==receipt.dataVersion)throw Error('fixture archive raw hash mismatch');
    const archived=JSON.parse(raw.toString('utf8'));onRead?.();return {...receipt,decisionAt,data:archived};
   }
  }:require(id);
  new Function('require','module','exports',fs.readFileSync(path.resolve(__dirname,'../src/core/market-failover.js'),'utf8'))(req,m,m.exports);
  return m.exports.createMarketFailover({sources,directory:dir,retries:0,clock:()=>tick,maxCacheAgeMs:10000,...extra});
 }
 return {sources,file,root,data,write,archive,create,behaviors,calls,reads,setOnRead:fn=>{onRead=fn;}};
}
test('restart restores only the archived original receipt time, not file mtime or archive replay time',async t=>{
 const f=fixture(t),d=f.write('main'),receipt=f.archive('main',d);
 const r=await f.create().sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.cacheAgeMs,3000);
 assert.equal(r.cacheAgeBasis,'original-archived-receipt-bounded-by-local-and-source-times');
 assert.deepEqual(r.archiveEvidence,{archiveHash:receipt.archiveHash,dataVersion:receipt.dataVersion,receivedAt:receipt.receivedAt,availableAt:receipt.availableAt});
 assert.equal(r.stale,true);assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
 assert.deepEqual(f.reads,[{root:f.root('main'),provider:'main-provider',datasetId:'main-dataset',decisionAt:tick}]);
});
test('touch or later review cannot renew stale original evidence; independently archived backup is selected',async t=>{
 const f=fixture(t);f.archive('main',f.write('main'),{receivedAt:tick-20000,availableAt:tick});
 f.archive('backup',f.write('backup'));
 const r=await f.create().sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.sourceId,'backup');assert.equal(r.cacheAgeMs,3000);
 assert.equal(r.data.provider,'backup-provider');assert.equal(r.canTrade,false);
});
test('missing configured root, invalid directory or lost previously seen archive cannot downgrade to legacy',async t=>{
 const f=fixture(t);const d=f.write('main');
 const sources=[{...f.sources[0],evidenceRoot:f.root('main')},f.sources[1]];
 assert.equal((await f.create({sources}).sync()).mode,'unavailable');
 fs.writeFileSync(f.root('main'),'not-directory');assert.equal((await f.create().sync()).mode,'unavailable');fs.unlinkSync(f.root('main'));
 fs.symlinkSync(f.file('main'),f.root('main'));assert.equal((await f.create().sync()).mode,'unavailable');fs.unlinkSync(f.root('main'));
 f.archive('main',d);const service=f.create();assert.equal((await service.sync()).mode,'cached-degraded');
 fs.rmSync(f.root('main'),{recursive:true,force:true});assert.equal((await service.sync()).mode,'unavailable');
});
test('changed projection, corrupt raw bytes, no admission and impossible receipt metadata fail closed',async t=>{
 const f=fixture(t),d=f.write('main');f.archive('main',d);
 f.write('main',{...d,asOf:'2026-11-24'});assert.equal((await f.create().sync()).mode,'unavailable');f.write('main',d);
 fs.writeFileSync(path.join(f.root('main'),'raw.bin'),'damaged');assert.equal((await f.create().sync()).mode,'unavailable');
 for(const p of [{status:'unavailable-at-decision'},{receivedAt:tick+1},{availableAt:tick+1},{archiveHash:'bad'},{canTrade:true}]){
  f.archive('main',d,p);assert.equal((await f.create().sync()).mode,'unavailable');
 }
 assert.equal(fs.readFileSync(f.file('main'),'utf8'),JSON.stringify(d)+'\n');
});
test('current importer success must bind its published file and exact admitted receipt before primary recovery',async t=>{
 const f=fixture(t),d=f.write('main'),a=f.archive('main',d),b=f.write('backup'),ab=f.archive('backup',b);
 const result=(data,receipt)=>({updated:true,hash:hash(data),asOf:data.asOf,evidence:{id:receipt.archiveHash,status:'admitted',availableAt:receipt.availableAt,dataVersion:receipt.dataVersion}});
 f.behaviors.set('main',()=>result(d,{...a,archiveHash:digest('unrelated')}));f.behaviors.set('backup',()=>result(b,ab));
 const service=f.create();let r=await service.sync();assert.equal(r.mode,'fallback');assert.equal(r.sourceId,'backup');assert.equal(r.attempts[0].ok,false);
 f.behaviors.set('main',()=>result(d,a));r=await service.sync();assert.equal(r.mode,'primary');assert.equal(r.archiveEvidence.archiveHash,a.archiveHash);
 assert.equal(service.status().data,undefined);assert.equal(r.canTrade,false);
});
test('file replacement during archive verification is refused; truly unarchived legacy history is labelled',async t=>{
 const f=fixture(t),d=f.write('main');f.archive('main',d);
 f.setOnRead(()=>f.write('main',{...d,asOf:'2026-11-24'}));assert.equal((await f.create().sync()).mode,'unavailable');
 f.setOnRead(null);fs.rmSync(f.root('main'),{recursive:true,force:true});f.write('main',d);
 const r=await f.create().sync();assert.equal(r.mode,'cached-degraded');assert.equal(r.cacheAgeBasis,'legacy-file-time-only-unverified');
 assert.equal(r.archiveEvidence,null);assert.equal(r.stale,true);assert.equal(r.canTrade,false);
});
