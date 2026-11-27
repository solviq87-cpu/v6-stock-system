'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const E=require('../src/core/market-data-evidence');
const moduleFile=require.resolve('../src/core/market-data-evidence');
const tick=Date.parse('2025-02-10T16:00:00+08:00');
const scope={provider:'fixture-history-provider',datasetId:'fixture-history-dataset'};
// The worker calls the actual receipt API. Only the test hook controlling the
// moment of the real journal link is injected to make contention reproducible.
const worker=String.raw`
const fs=require('node:fs'),path=require('node:path');
const [moduleFile,root,encoded,hold]=process.argv.slice(1),input=JSON.parse(encoded);
const E=require(moduleFile);
if(hold==='hold'){
 const link=fs.linkSync;
 fs.linkSync=function(from,to){
  if(path.dirname(to)===path.join(root,'events')&&/^\d{6}\.json$/.test(path.basename(to))){
   fs.writeFileSync(path.join(root,'test-ready'),'ready');
   const deadline=Date.now()+8000;
   while(!fs.existsSync(path.join(root,'test-release'))){
    if(Date.now()>deadline)throw Error('fixture release timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
   }
  }
  return link.call(fs,from,to);
 };
}
try{
 const event=E.appendReceipt({...input,root,raw:Buffer.from(input.raw,'utf8')});
 console.log(JSON.stringify({ok:true,hash:event.hash,reused:event.reused,version:event.data.version}));
}catch(error){console.log(JSON.stringify({ok:false,error:error.message,code:error.code??null}));}
`;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d28-native-archive-'));
 const root=path.join(dir,'archive'),children=new Set();
 t.after(async()=>{for(const child of children){try{child.kill('SIGKILL');}catch{}} await Promise.allSettled([...children].map(c=>c.finished));fs.rmSync(dir,{recursive:true,force:true});});
 function input(raw,receivedAt=tick,extra={}){return {...scope,status:'quarantined',raw,receivedAt,reason:'fixture response isolated',...extra};}
 function start(raw,receivedAt=tick,{hold=false,extra={}}={}){
  const child=spawn(process.execPath,['-e',worker,moduleFile,root,JSON.stringify(input(raw,receivedAt,extra)),hold?'hold':'normal'],{stdio:['ignore','pipe','pipe']});
  children.add(child);let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  child.finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{children.delete(child);resolve({code,signal,stdout,stderr});});});
  // Keep teardown safe if the worker is deliberately killed before returning JSON.
  const result=child.finished.then(r=>{assert.equal(r.code,0,r.stderr||r.stdout);return JSON.parse(r.stdout);});result.catch(()=>{});
  return {child,result,finished:child.finished};
 }
 const append=(raw,receivedAt=tick,extra={})=>E.appendReceipt({...input(raw,receivedAt,extra),root,raw:Buffer.from(raw)});
 const read=(options={})=>E.readReceipts(root,{...scope,verifyRaw:true,...options});
 const blobs=()=>fs.readdirSync(path.join(root,'blobs')).filter(x=>/^[a-f0-9]{64}\.bin$/.test(x));
 const events=()=>fs.readdirSync(path.join(root,'events')).filter(x=>/^\d{6}\.json$/.test(x));
 const rawFile=ref=>path.join(root,'blobs',ref.sha256+'.bin');
 async function ready(){const deadline=Date.now()+5000;while(!fs.existsSync(path.join(root,'test-ready'))){assert.ok(Date.now()<deadline,'worker did not reach original journal link');await new Promise(r=>setTimeout(r,10));}}
 return {root,append,start,read,blobs,events,rawFile,ready,release:()=>fs.writeFileSync(path.join(root,'test-release'),'release')};
}
test('native archive survives process restart and exact retry keeps one original receipt and blob',async t=>{
 const f=fixture(t),a=await f.start('{bad-wire-json').result,b=await f.start('{bad-wire-json').result;
 assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(b.reused,true);assert.equal(b.hash,a.hash);
 const rows=f.read();assert.equal(rows.length,1);assert.equal(f.blobs().length,1);assert.equal(rows[0].data.canTrade,false);
 assert.equal(rows[0].data.receivedAt,tick);assert.equal(E.readRaw(f.root,rows[0].data.rawEvidence).toString(),'{bad-wire-json');
 assert.equal(E.readMarketDataAsOf({root:f.root,...scope,decisionAt:tick}).status,'unavailable-at-decision');
});
test('cross-process reused request id with changed bytes cannot overwrite or append',async t=>{
 const f=fixture(t),extra={requestId:'d28-explicit-retry-id'},a=await f.start('raw-one',tick,{extra}).result;
 assert.equal(a.ok,true);const b=await f.start('raw-two',tick,{extra}).result;
 assert.equal(b.ok,false);assert.match(b.error,/冲突/);assert.equal(f.events().length,1);assert.equal(f.blobs().length,1);
 assert.equal(f.read()[0].hash,a.hash);assert.equal(E.readRaw(f.root,f.read()[0].data.rawEvidence).toString(),'raw-one');
});
test('two native writers cannot publish concurrently under the original journal flock; explicit retry extends the chain',async t=>{
 const f=fixture(t),a=f.start('held-first',tick,{hold:true});await f.ready();
 const blocked=await f.start('competing-second',tick+1).result;
 assert.equal(blocked.ok,false);assert.match(blocked.error,/账户正在处理其他请求/);assert.equal(f.events().length,0);
 f.release();const committed=await a.result;assert.equal(committed.ok,true);
 const retry=await f.start('competing-second',tick+1).result;assert.equal(retry.ok,true);
 const rows=f.read();assert.equal(rows.length,2);assert.equal(rows[1].previousHash,committed.hash);assert.equal(rows[1].hash,retry.hash);
 assert.equal(rows[1].data.version,2);assert.equal(f.blobs().length,2);
});
test('killed writer before event publication leaves no visible receipt; kernel lock releases and exact retry recovers',async t=>{
 const f=fixture(t),a=f.start('crash-before-journal',tick,{hold:true});await f.ready();
 assert.equal(f.events().length,0);assert.equal(f.blobs().length,1);
 a.child.kill('SIGKILL');const stopped=await a.finished;assert.equal(stopped.signal,'SIGKILL');
 assert.equal(f.read().length,0);assert.ok(fs.existsSync(path.join(f.root,'events','workspace.guard')));
 const recovered=await f.start('crash-before-journal').result;assert.equal(recovered.ok,true);assert.equal(f.read().length,1);
 assert.equal(f.blobs().length,1);assert.equal(f.read()[0].data.version,1);assert.equal(f.read()[0].hash,recovered.hash);
});
test('older damaged original bytes block later archive access and new writes without modifying the journal',async t=>{
 const f=fixture(t),a=f.append('old-original'),b=f.append('new-original',tick+1);
 const before=f.events().map(n=>fs.readFileSync(path.join(f.root,'events',n),'utf8'));
 fs.writeFileSync(f.rawFile(a.data.rawEvidence),Buffer.alloc(a.data.rawEvidence.byteLength,120));
 assert.throws(()=>f.read(),/哈希/);
 const blocked=await f.start('another-original',tick+2).result;assert.equal(blocked.ok,false);assert.match(blocked.error,/哈希/);
 assert.deepEqual(f.events().map(n=>fs.readFileSync(path.join(f.root,'events',n),'utf8')),before);
 assert.equal(E.readRaw(f.root,b.data.rawEvidence).toString(),'new-original');assert.equal(f.blobs().length,2);
});
test('historical cutoff preserves visible receipt scope and does not borrow future or other-series evidence',t=>{
 const f=fixture(t),a=f.append('earlier'),b=f.append('later',tick+1);
 f.append('other-dataset',tick+2,{datasetId:'fixture-other-dataset'});
 assert.deepEqual(f.read({asOf:tick}).map(e=>e.hash),[a.hash]);
 assert.equal(f.read().length,2);assert.equal(f.read({datasetId:'fixture-other-dataset'}).length,1);
 fs.writeFileSync(f.rawFile(b.data.rawEvidence),Buffer.alloc(b.data.rawEvidence.byteLength,121));
 assert.deepEqual(f.read({asOf:tick}).map(e=>e.hash),[a.hash]);assert.throws(()=>f.read(),/哈希/);
 assert.equal(E.readMarketDataAsOf({root:f.root,...scope,decisionAt:tick}).status,'unavailable-at-decision');
});
