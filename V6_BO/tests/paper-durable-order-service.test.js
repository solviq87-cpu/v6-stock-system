'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDurablePaperOrderService}=require('../src/core/paper-durable-order-service');
const day='2026-11-05';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-durable-'));const file=path.join(dir,'orders.json');return {file,service:()=>createDurablePaperOrderService({file,initialCash:100000})}}
test('部分成交撤单资金释放、重启后账本完全一致、幂等',()=>{
 const {service}=fixture();let a=service();const submit={id:'cmd1',action:'submit',args:{id:'order1',side:'BUY',code:'600000',quantity:300,limitPrice:10,tradingDay:day}};
 a.execute(submit);assert.equal(a.read().snapshot.reservedCash>0,true);
 a.execute({id:'cmd2',action:'fill',args:{orderId:'order1',fill:{quantity:100,price:9.5,tradingDay:day}}});
 const before=a.read();assert.equal(before.snapshot.orders[0].status,'PARTIALLY_FILLED');
 a=service();assert.deepEqual(a.read(),before);
 a.execute({id:'cmd3',action:'cancel',args:{orderId:'order1',options:{tradingDay:day}}});
 const after=a.read();assert.equal(after.snapshot.reservedCash,0);assert.equal(after.snapshot.positions['600000'].shares,100);assert.equal(after.snapshot.orders[0].status,'CANCELLED');assert.equal(after.ok,true);
 a=service();assert.deepEqual(a.read(),after);assert.equal(a.execute(submit).idempotent,true);
 assert.throws(()=>a.execute({...submit,args:{...submit.args,quantity:200}}),/冲突/);
});
test('非法写入不污染内存与磁盘',()=>{const {file,service}=fixture();const a=service();const original=a.read();assert.throws(()=>a.execute({id:'bad',action:'fill',args:{orderId:'missing',fill:{quantity:100,price:10,tradingDay:day}}}));assert.deepEqual(a.read(),original);assert.equal(fs.existsSync(file),false)});
test('账本损坏必须拒绝恢复，不静默重置',()=>{const {file,service}=fixture();const a=service();a.execute({id:'x',action:'submit',args:{id:'o',side:'BUY',code:'600000',quantity:100,limitPrice:10,tradingDay:day}});fs.writeFileSync(file,'{"schemaVersion":1,"commands":[]}');assert.throws(()=>service(),/校验失败/)});
test('同一API视图适用于电脑与手机，均为只读快照',()=>{const {service}=fixture();const a=service();const desktop=JSON.parse(JSON.stringify(a.read()));const mobile=JSON.parse(JSON.stringify(a.read()));assert.deepEqual(desktop,mobile);assert.equal(desktop.brokerConnected,false);assert.equal(desktop.legacyAccountMutated,false)});

const {spawn}=require('node:child_process');
const {once}=require('node:events');
const crypto=require('node:crypto');
const servicePath=require.resolve('../src/core/paper-durable-order-service');
const lockPath=require.resolve('../src/core/account-process-lock');
const submit=(id,orderId=id)=>({id,action:'submit',args:{id:orderId,side:'BUY',code:'600000',quantity:300,limitPrice:10,tradingDay:day}});
const fill=(id,orderId)=>({id,action:'fill',args:{orderId,fill:{quantity:100,price:9.5,tradingDay:day}}});
const checksum=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function cleanFixture(t){const x=fixture();t.after(()=>fs.rmSync(path.dirname(x.file),{recursive:true,force:true}));return x;}
async function childReady(t,code,args){
 const child=spawn(process.execPath,['-e',code,...args],{stdio:['pipe','pipe','pipe']});
 const closed=once(child,'close');let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',s=>{stderr+=s;});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;});
 await new Promise((resolve,reject)=>{
  let out='';const timer=setTimeout(()=>reject(Error('child ready timeout: '+stderr)),5000);
  child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('READY\n')){clearTimeout(timer);resolve();}});
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',()=>{clearTimeout(timer);reject(Error('child exited before ready: '+stderr));});
 });
 return {child,closed,stderr:()=>stderr};
}

test('two instances opened before first write retain both orders and observe latest revision',t=>{
 const x=cleanFixture(t),a=x.service(),b=x.service();a.execute(submit('a'));b.execute(submit('b'));
 const current=x.service().read();assert.equal(current.revision,2);assert.deepEqual(current.snapshot.orders.map(o=>o.id),['a','b']);
 assert.deepEqual(a.read(),current);assert.deepEqual(b.read(),current);
});

test('stale instance cannot overwrite a partial fill with a cancel based on old state',t=>{
 const x=cleanFixture(t),a=x.service();a.execute(submit('a'));const b=x.service();a.execute(fill('f','a'));
 b.execute({id:'c',action:'cancel',args:{orderId:'a',options:{tradingDay:day}}});
 const current=x.service().read();assert.equal(current.revision,3);assert.equal(current.snapshot.positions['600000'].shares,100);assert.equal(current.snapshot.orders[0].filledQuantity,100);assert.equal(current.snapshot.reservedCash,0);assert.equal(current.ok,true);
});

test('idempotent retry or conflicting ID across independent instances uses latest durable journal',t=>{
 const x=cleanFixture(t),a=x.service(),b=x.service();const event=submit('a');a.execute(event);const bytes=fs.readFileSync(x.file);
 assert.equal(b.execute(event).idempotent,true);assert.deepEqual(fs.readFileSync(x.file),bytes);
 assert.throws(()=>b.execute(submit('a','other')),/冲突/);assert.deepEqual(fs.readFileSync(x.file),bytes);
});

test('existing instance rejects tampered file on read, new command and identical retry without repair',t=>{
 const x=cleanFixture(t),a=x.service();const event=submit('a');a.execute(event);fs.writeFileSync(x.file,'{"schemaVersion":1,"commands":[]}');const bytes=fs.readFileSync(x.file);
 for(const op of [()=>a.read(),()=>a.execute(submit('b')),()=>a.execute(event)]){assert.throws(op,/校验失败/);assert.deepEqual(fs.readFileSync(x.file),bytes);}
});

test('observed ledger cannot disappear or be replaced by a valid but truncated journal during a live session',t=>{
 const x=cleanFixture(t),a=x.service();a.execute(submit('a'));const before=fs.readFileSync(x.file);a.execute(fill('f','a'));fs.writeFileSync(x.file,before);
 assert.throws(()=>a.read(),/历史.*变化/);assert.throws(()=>a.execute(submit('b')),/历史.*变化/);assert.deepEqual(fs.readFileSync(x.file),before);
 fs.unlinkSync(x.file);assert.throws(()=>a.execute(submit('b')),/历史.*变化/);assert.equal(fs.existsSync(x.file),false);
});

test('a valid rewritten history is not accepted by an already-open service',t=>{
 const x=cleanFixture(t),a=x.service();a.execute(submit('a'));const record=JSON.parse(fs.readFileSync(x.file,'utf8'));
 record.commands[0].args.id='replacement';const item=record.commands[0];item.fingerprint=checksum({action:item.action,args:item.args});record.checksum=checksum({options:record.options,commands:record.commands});fs.writeFileSync(x.file,JSON.stringify(record));const bytes=fs.readFileSync(x.file);
 assert.throws(()=>a.execute(submit('b')),/历史.*变化/);assert.deepEqual(fs.readFileSync(x.file),bytes);
});

test('a child opened before parent write does not overwrite the parent journal', {timeout:10000},async t=>{
 const x=cleanFixture(t);const code=`const {createDurablePaperOrderService}=require(process.argv[1]);const a=createDurablePaperOrderService({file:process.argv[2],initialCash:100000});console.log('READY');process.stdin.once('data',()=>{try{a.execute(JSON.parse(process.argv[3]));process.exitCode=0;}catch(e){console.error(e);process.exitCode=1;}process.stdin.destroy();});`;
 const {child,closed,stderr}=await childReady(t,code,[servicePath,x.file,JSON.stringify(submit('child'))]);x.service().execute(submit('parent'));child.stdin.end('go\n');const [exit]=await closed;assert.equal(exit,0,stderr());assert.deepEqual(x.service().read().snapshot.orders.map(o=>o.id),['parent','child']);
});

test('real foreign guard blocks write and SIGKILL releases guard for an intact retry', {timeout:10000},async t=>{
 const x=cleanFixture(t),a=x.service();a.execute(submit('a'));const bytes=fs.readFileSync(x.file);
 const code=`const {acquireAccountGuard}=require(process.argv[1]);const fd=acquireAccountGuard(process.argv[2]);console.log('READY');process.stdin.resume();`;
 const {child,closed}=await childReady(t,code,[lockPath,x.file]);try{assert.throws(()=>a.execute(fill('f','a')),/其他请求/);assert.deepEqual(fs.readFileSync(x.file),bytes);}finally{child.kill('SIGKILL');await closed;}
 assert.equal(a.execute(fill('f','a')).revision,2);assert.equal(x.service().read().snapshot.positions['600000'].shares,100);
});

test('dangling symlink is rejected rather than replaced by a new ledger',t=>{
 const x=cleanFixture(t);fs.symlinkSync(path.join(path.dirname(x.file),'missing'),x.file);
 assert.throws(()=>x.service(),/不安全的账本文件/);assert.equal(fs.lstatSync(x.file).isSymbolicLink(),true);
});

test('a command exceeding readable journal capacity cannot poison a previously valid file',t=>{
 const x=cleanFixture(t),a=x.service();a.execute(submit('a'));const bytes=fs.readFileSync(x.file);const b=submit('b');b.args.note='x'.repeat(16*1024*1024);
 assert.throws(()=>a.execute(b),/容量上限/);assert.deepEqual(fs.readFileSync(x.file),bytes);assert.equal(x.service().read().revision,1);
});
