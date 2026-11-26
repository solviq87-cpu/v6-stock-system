'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildSession,loadSession,saveSession,recoverSession}=require('../src/core/paper-session');
const {acquireAccountGuard}=require('../src/core/account-process-lock');
function dataset(n){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'恢复隔离样本',market:'main',bars:Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000}))}]};}
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-b4-recovery-')),file=path.join(dir,'session.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const first=buildSession(dataset(40)).session;saveSession(file,first);
 const second=buildSession(dataset(41),{},first).session;saveSession(file,second);
 const third=buildSession(dataset(42),{},second).session;
 return {dir,file,backup:file+'.bak',first,second,third};
}
function bytes(f){return fs.readFileSync(f);}
function rejectWithoutOverwrite(x,fn,pattern){
 const old=bytes(x.file),backup=bytes(x.backup);
 assert.throws(fn,pattern);assert.deepEqual(bytes(x.file),old);assert.deepEqual(bytes(x.backup),backup);
}
function ioError(){return Object.assign(Error('injected EIO'),{code:'EIO'});}
test('session save and explicit recovery share the original kernel account guard',t=>{
 const x=setup(t),fd=acquireAccountGuard(x.file);
 try{
  rejectWithoutOverwrite(x,()=>saveSession(x.file,x.third),/正在处理/);
  fs.writeFileSync(x.file,'damaged while locked');
  rejectWithoutOverwrite(x,()=>recoverSession(x.file,{dryRun:false}),/正在处理/);
 }finally{fs.closeSync(fd);}
 assert.equal(recoverSession(x.file,{dryRun:false}).restored,true);
 assert.equal(loadSession(x.file).revision,1);
});
test('corrupt existing backup is preserved instead of overwritten by a new snapshot',t=>{
 const x=setup(t);fs.writeFileSync(x.backup,'{damaged backup');
 rejectWithoutOverwrite(x,()=>saveSession(x.file,x.third),/完整性|JSON/);
 rejectWithoutOverwrite(x,()=>recoverSession(x.file,{dryRun:false}),/完整性|JSON/);
});
test('a valid but unrelated backup is never silently replaced',t=>{
 const x=setup(t),other=dataset(40);other.stocks[0].code='000002';
 fs.writeFileSync(x.backup,JSON.stringify(buildSession(other).session));
 rejectWithoutOverwrite(x,()=>saveSession(x.file,x.third),/股票历史|股票池|来源|备份/);
});
test('missing primary with a preserved backup requires explicit recovery, not initialization',t=>{
 const x=setup(t);fs.unlinkSync(x.file);const before=bytes(x.backup);
 assert.throws(()=>saveSession(x.file,x.first),/备份存在/);
 assert.equal(fs.existsSync(x.file),false);assert.deepEqual(bytes(x.backup),before);
 const names=fs.readdirSync(x.dir).sort();assert.equal(recoverSession(x.file).restored,false);
 assert.deepEqual(fs.readdirSync(x.dir).sort(),names);
 assert.equal(recoverSession(x.file,{dryRun:false}).restored,true);assert.deepEqual(bytes(x.file),before);
});
test('read-only session loader refuses symlink and oversized sparse file before reading payload',t=>{
 const x=setup(t),link=path.join(x.dir,'linked.json'),large=path.join(x.dir,'large.json');fs.symlinkSync(x.file,link);
 assert.throws(()=>loadSession(link),/符号链接|ELOOP/);
 fs.closeSync(fs.openSync(large,'wx'));fs.truncateSync(large,60*1024*1024+1);
 const read=fs.readSync,readFile=fs.readFileSync;let reads=0;
 t.mock.method(fs,'readSync',(...args)=>{reads++;return read(...args);});
 t.mock.method(fs,'readFileSync',(f,...args)=>{if(f===large)reads++;return readFile(f,...args);});
 assert.throws(()=>loadSession(large),/超过60MB/);assert.equal(reads,0);
});
test('an unreadable current snapshot is an I/O failure, not permission to restore an older account',t=>{
 const x=setup(t),before=bytes(x.file),backup=bytes(x.backup),open=fs.openSync,readFile=fs.readFileSync;
 t.mock.method(fs,'openSync',(f,...args)=>{if(f===x.file)throw ioError();return open(f,...args);});
 t.mock.method(fs,'readFileSync',(f,...args)=>{if(f===x.file)throw ioError();return readFile(f,...args);});
 try{assert.throws(()=>recoverSession(x.file),/injected EIO/);assert.throws(()=>recoverSession(x.file,{dryRun:false}),/injected EIO/);}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),before);assert.deepEqual(bytes(x.backup),backup);
 assert.equal(fs.readdirSync(x.dir).some(n=>n.includes('.corrupt.')),false);
});
test('a failed final recovery rename leaves the damaged primary at its original name and preserves an exact archive',t=>{
 const x=setup(t),damaged=Buffer.from('{damaged \u0000 bytes');fs.writeFileSync(x.file,damaged);
 const backup=bytes(x.backup),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===x.file)throw ioError();return rename(from,to);});
 try{assert.throws(()=>recoverSession(x.file,{dryRun:false}),/injected EIO/);}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),damaged);assert.deepEqual(bytes(x.backup),backup);
 const archives=fs.readdirSync(x.dir).filter(n=>n.startsWith(path.basename(x.file)+'.corrupt.'));
 assert.equal(archives.length,1);assert.deepEqual(bytes(path.join(x.dir,archives[0])),damaged);
 assert.equal(recoverSession(x.file,{dryRun:false}).restored,true);assert.deepEqual(bytes(x.file),backup);
 assert.equal(loadSession(x.file).revision,1);
});
test('a backup replaced after validation cannot be re-read as unchecked recovery data',t=>{
 const x=setup(t),damaged=Buffer.from('bad primary');fs.writeFileSync(x.file,damaged);
 const original=bytes(x.backup),open=fs.openSync;let injected=false;
 t.mock.method(fs,'openSync',(f,flags,...args)=>{
  const fd=open(f,flags,...args);
  if(typeof f==='string'&&path.basename(f).startsWith('.'+path.basename(x.file)+'.')&&f.endsWith('.tmp')&&!f.includes('.corrupt.')&&!injected){
   injected=true;fs.writeFileSync(x.backup,'unvalidated replacement');
  }
  return fd;
 });
 try{assert.throws(()=>recoverSession(x.file,{dryRun:false}),/已变化/);assert.equal(injected,true);}finally{t.mock.restoreAll();}
 assert.deepEqual(bytes(x.file),damaged);assert.equal(bytes(x.backup).toString(),'unvalidated replacement');
 fs.writeFileSync(x.backup,original);assert.equal(recoverSession(x.file,{dryRun:false}).restored,true);assert.deepEqual(bytes(x.file),original);
});
