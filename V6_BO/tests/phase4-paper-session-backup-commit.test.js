'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildSession,loadSession,saveSession,recoverSession}=require('../src/core/paper-session');
const {acquireAccountGuard}=require('../src/core/account-process-lock');
function dataset(n){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'备份提交夹具',market:'main',bars:Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000}))}]};}
function setup(t,initialize=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-backup-commit-')),file=path.join(dir,'session.json'),backup=file+'.bak';
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const first=buildSession(dataset(40)).session,second=buildSession(dataset(41),{},first).session,third=buildSession(dataset(42),{},second).session;
 if(initialize){saveSession(file,first);saveSession(file,second);}
 return {dir,file,backup,first,second,third};
}
const bytes=f=>fs.readFileSync(f);
function noTemps(x){assert.equal(fs.readdirSync(x.dir).some(n=>n.endsWith('.tmp')),false);}
function beforePrimary(t,x,mutate){
 const open=fs.openSync;let injected=false;
 t.mock.method(fs,'openSync',(filename,flags,...args)=>{
  const fd=open(filename,flags,...args);
  if(!injected&&typeof filename==='string'&&path.basename(filename).startsWith('.'+path.basename(x.file)+'.')&&filename.endsWith('.tmp')&&!filename.includes('.bak.')){injected=true;mutate();}
  return fd;
 });
 return ()=>assert.equal(injected,true);
}
test('normal save retains exactly the previous primary bytes and supports restart and explicit recovery',t=>{
 const x=setup(t),before=bytes(x.file);saveSession(x.file,x.third);
 assert.deepEqual(bytes(x.backup),before);assert.equal(loadSession(x.file).revision,3);noTemps(x);
 fs.writeFileSync(x.file,'damaged primary');assert.equal(recoverSession(x.file,{dryRun:false}).restored,true);
 assert.deepEqual(bytes(x.file),before);assert.equal(loadSession(x.file).revision,2);noTemps(x);
});
for(const [label,mutate] of [
 ['replaced inode',x=>{const other=path.join(x.dir,'replacement');fs.writeFileSync(other,'unverified replacement');fs.renameSync(other,x.backup);}],
 ['deleted backup',x=>fs.unlinkSync(x.backup)],
 ['changed bytes in the same inode',x=>fs.writeFileSync(x.backup,'changed backup')]
])test('save refuses final primary commit after newly published backup is '+label,t=>{
 const x=setup(t),before=bytes(x.file),check=beforePrimary(t,x,()=>mutate(x));
 try{assert.throws(()=>saveSession(x.file,x.third),/已变化/);check();}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),before);assert.equal(loadSession(x.file).revision,2);noTemps(x);
});
test('backup altered at its publish boundary cannot be accepted as the previous primary',t=>{
 const x=setup(t),before=bytes(x.file),rename=fs.renameSync;let injected=false;
 t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(to===x.backup&&!injected){injected=true;fs.writeFileSync(to,'wrong backup bytes');}});
 try{assert.throws(()=>saveSession(x.file,x.third),/已变化/);assert.equal(injected,true);}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),before);assert.equal(bytes(x.backup).toString(),'wrong backup bytes');noTemps(x);
});
test('a backup appearing during first initialization requires explicit review and cannot be ignored',t=>{
 const x=setup(t,false),check=beforePrimary(t,x,()=>fs.writeFileSync(x.backup,'previous account backup'));
 try{assert.throws(()=>saveSession(x.file,x.first),/已变化/);check();}finally{t.mock.restoreAll();}
 assert.equal(fs.existsSync(x.file),false);assert.equal(bytes(x.backup).toString(),'previous account backup');noTemps(x);
});
test('failed primary rename leaves the original account and its newly verified backup intact',t=>{
 const x=setup(t),before=bytes(x.file),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===x.file)throw Object.assign(Error('injected EIO'),{code:'EIO'});return rename(from,to);});
 try{assert.throws(()=>saveSession(x.file,x.third),/injected EIO/);}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),before);assert.deepEqual(bytes(x.backup),before);noTemps(x);
 saveSession(x.file,x.third);assert.equal(loadSession(x.file).revision,3);assert.deepEqual(bytes(x.backup),before);
});
test('original kernel guard still blocks a competing save before any backup or primary change',t=>{
 const x=setup(t),before=bytes(x.file),backup=bytes(x.backup),fd=acquireAccountGuard(x.file);
 try{assert.throws(()=>saveSession(x.file,x.third),/正在处理/);}finally{fs.closeSync(fd);}
 assert.deepEqual(bytes(x.file),before);assert.deepEqual(bytes(x.backup),backup);noTemps(x);
});
