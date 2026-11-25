'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {acquireProcessLock,releaseProcessLock}=require('../src/core/process-file-lock');
const {withAccountLock}=require('../src/core/account-process-lock');
const modulePath=require.resolve('../src/core/process-file-lock');
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-lock-race-'));return {root,file:path.join(root,'book'),lock:path.join(root,'book.lock')};};
const childCode=String.raw`const {acquireProcessLock,releaseProcessLock}=require(process.argv[1]);const lock=process.argv[2],mode=process.argv[3];let handle;try{handle=acquireProcessLock(lock);process.stdout.write('acquired\n');}catch{process.stdout.write('busy\n');process.exit(0);}if(mode==='crash')process.exit(0);if(mode==='hold'){process.stdin.resume();process.stdin.once('end',()=>releaseProcessLock(handle,lock));}else releaseProcessLock(handle,lock);`;
function start(lock,mode){const child=spawn(process.execPath,['-e',childCode,modulePath,lock,mode],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out.trim()):reject(Error(err||'child failed '+code)));});}
test('two protocol users share the original stable kernel guard',()=>{
 const x=fixture();try{
  const handle=acquireProcessLock(x.lock);assert.throws(()=>withAccountLock(x.file,()=>0),/正在处理/);
  const p=spawnSync(process.execPath,['-e',childCode,modulePath,x.lock,'once'],{encoding:'utf8',timeout:3000});assert.equal(p.stdout.trim(),'busy');
  assert.equal(releaseProcessLock(handle,x.lock),true);assert.equal(fs.existsSync(x.lock),false);assert.equal(fs.existsSync(x.file+'.guard'),true);
  assert.equal(withAccountLock(x.file,()=>{assert.throws(()=>acquireProcessLock(x.lock),/并发写入/);return 17;}),17);
 }finally{fs.rmSync(x.root,{recursive:true,force:true});}
});
function hold(lock){
 const child=spawn(process.execPath,['-e',childCode,modulePath,lock,'hold'],{stdio:['pipe','pipe','pipe']});let out='';
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',b=>{out+=b;if(out.includes('\n'))resolve(out.trim());});child.once('error',reject);child.once('close',()=>{if(!out.includes('\n'))reject(Error('child exited before signal'));});});
 const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 child.stdin.on('error',()=>{});return {child,ready,done};
}
test('crashed owner recovery admits only one concurrent process',{timeout:10000},async()=>{
 const x=fixture();let crashed,a,b;try{
  crashed=hold(x.lock);assert.equal(await crashed.ready,'acquired');crashed.child.kill('SIGKILL');assert.equal((await crashed.done).signal,'SIGKILL');
  assert.equal(fs.existsSync(x.lock),true);
  a=hold(x.lock);b=hold(x.lock);const results=await Promise.all([a.ready,b.ready]);assert.deepEqual(results.sort(),['acquired','busy']);
  a.child.stdin.end();b.child.stdin.end();assert.equal((await a.done).code,0);assert.equal((await b.done).code,0);
  assert.equal(fs.existsSync(x.lock),false);assert.equal(await start(x.lock,'once'),'acquired');
 }finally{for(const p of [crashed,a,b])if(p&&p.child.exitCode===null&&p.child.signalCode===null)p.child.kill('SIGKILL');fs.rmSync(x.root,{recursive:true,force:true});}
});
test('stale release handle cannot delete a newly acquired lock',()=>{
 const x=fixture();try{
  const old=acquireProcessLock(x.lock);assert.equal(releaseProcessLock(old,x.lock),true);
  const current=acquireProcessLock(x.lock);assert.equal(releaseProcessLock(old,x.lock),false);assert.equal(fs.existsSync(x.lock),true);
  assert.throws(()=>acquireProcessLock(x.lock),/并发写入/);assert.equal(releaseProcessLock(current,x.lock),true);
 }finally{fs.rmSync(x.root,{recursive:true,force:true});}
});
test('malformed or symlink PID evidence fails closed without unlinking it',()=>{
 const x=fixture();try{
  fs.writeFileSync(x.lock,'broken');assert.throws(()=>acquireProcessLock(x.lock),/无法核验/);assert.equal(fs.readFileSync(x.lock,'utf8'),'broken');
  fs.unlinkSync(x.lock);const target=path.join(x.root,'unrelated');fs.writeFileSync(target,'private');fs.symlinkSync(target,x.lock);
  assert.throws(()=>acquireProcessLock(x.lock),/无法核验/);assert.equal(fs.lstatSync(x.lock).isSymbolicLink(),true);assert.equal(fs.readFileSync(target,'utf8'),'private');
  assert.throws(()=>withAccountLock(x.file,()=>0),/旧锁/);
 }finally{fs.rmSync(x.root,{recursive:true,force:true});}
});
