'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperShadowReconciler:create}=require('../src/core/paper-shadow-reconciliation');
const {acquireAccountGuard}=require('../src/core/account-process-lock');
const snapshot={trades:[],account:{cash:100,realized:0,positions:{}}};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-shadow-chain-')),file=path.join(dir,'audit.jsonl');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const make=(readSnapshot=async()=>snapshot)=>create({initialCash:100,auditLogPath:file,readSnapshot});
 return {dir,file,make,runner:make()};
}
const run=(r,eventId)=>r.run({settlementId:eventId,status:'FILLED'});
const encode=rows=>rows.map(x=>JSON.stringify(x)).join('\n')+'\n';
const seal=({hash,...body})=>({...body,hash:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')});
async function seed(x){for(const id of ['a','b','c'])await run(x.runner,id);return x.runner.inspectLog();}
async function refuses(x,pattern){
 const before=fs.readFileSync(x.file);
 assert.throws(()=>x.runner.inspectLog(),pattern);
 await assert.rejects(run(x.runner,'new'),pattern);
 assert.deepEqual(fs.readFileSync(x.file),before);
}
test('deleting the first or a middle row is detected even when surviving row hashes remain valid',async t=>{
 const x=fixture(t),rows=await seed(x);
 for(const damaged of [rows.slice(1),[rows[0],rows[2]]]){fs.writeFileSync(x.file,encode(damaged));await refuses(x,/审计链/);}
});
test('reordering individually valid rows cannot be accepted as a complete chain',async t=>{
 const x=fixture(t),rows=await seed(x);fs.writeFileSync(x.file,encode([rows[0],rows[2],rows[1]]));await refuses(x,/审计链/);
});
test('duplicate settlement IDs remain invalid even with a recomputed continuous hash chain',async t=>{
 const x=fixture(t),rows=await seed(x);const duplicate=seal({...rows[2],eventId:'a',previousHash:rows[1].hash});
 fs.writeFileSync(x.file,encode([rows[0],rows[1],duplicate]));await refuses(x,/结算事件重复/);
});
test('a syntactically valid final row without its commit newline is not appended to',async t=>{
 const x=fixture(t);await run(x.runner,'a');fs.truncateSync(x.file,fs.statSync(x.file).size-1);await refuses(x,/未完整提交/);
});
test('a resealed PASS with an inconsistent result does not certify reconciliation',async t=>{
 const x=fixture(t);await run(x.runner,'a');const row=x.runner.inspectLog()[0];
 fs.writeFileSync(x.file,encode([seal({...row,result:{...row.result,ok:false}})]));await refuses(x,/对账回执/);
});
test('independent instances completing snapshots concurrently append to the current tail',async t=>{
 const x=fixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});let reads=0;
 const reader=async()=>{if(++reads===2)release();await gate;return snapshot;};
 const a=x.make(reader),b=x.make(reader);await Promise.all([run(a,'a'),run(b,'b')]);
 const rows=x.runner.inspectLog();assert.equal(rows.length,2);assert.equal(rows[0].previousHash,null);assert.equal(rows[1].previousHash,rows[0].hash);
});
test('independent instances racing the same settlement append exactly one row',async t=>{
 const x=fixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});let reads=0;
 const reader=async()=>{if(++reads===2)release();await gate;return snapshot;};
 const results=await Promise.all([run(x.make(reader),'same'),run(x.make(reader),'same')]);
 assert.equal(results.filter(r=>r.duplicate===true).length,1);assert.equal(x.runner.inspectLog().length,1);
});
test('a separately held kernel guard prevents writing; releasing it permits retry',async t=>{
 const x=fixture(t);await run(x.runner,'a');const before=fs.readFileSync(x.file),fd=acquireAccountGuard(x.file);
 try{await assert.rejects(run(x.make(),'b'),/正在处理/);assert.deepEqual(fs.readFileSync(x.file),before);}finally{fs.closeSync(fd);}
 assert.equal((await run(x.make(),'b')).status,'PASS');assert.equal(x.runner.inspectLog().length,2);
});
test('removing a previously observed tail during snapshot reading cannot pass as a new chain',async t=>{
 const x=fixture(t),rows=await seed(x);const shortened=Buffer.from(encode(rows.slice(0,2)));
 const r=x.make(async()=>{fs.writeFileSync(x.file,shortened);return snapshot;});
 await assert.rejects(run(r,'d'),/已观察审计链/);assert.deepEqual(fs.readFileSync(x.file),shortened);
});
test('audit readers and writers refuse symbolic links rather than following a different file',async t=>{
 const x=fixture(t),target=path.join(x.dir,'external.jsonl');fs.writeFileSync(target,'');fs.symlinkSync(target,x.file);
 await refuses(x,/ELOOP|符号链接|日志文件/);assert.equal(fs.statSync(target).size,0);
});
test('legitimate PASS/ALERT, restart, duplicate retry and snapshot nonmutation remain intact',async t=>{
 const x=fixture(t),before=JSON.stringify(snapshot);assert.equal((await run(x.runner,'a')).status,'PASS');
 const b=x.make(async()=>({...snapshot,account:{...snapshot.account,cash:99}}));assert.equal((await run(b,'b')).status,'ALERT');
 const restarted=x.make(async()=>{throw Error('duplicate must not read the account');});assert.equal((await run(restarted,'a')).duplicate,true);
 const rows=restarted.inspectLog();assert.equal(rows.length,2);assert.equal(rows[1].previousHash,rows[0].hash);assert.equal(JSON.stringify(snapshot),before);
});
