'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {enqueueStockObservation:enqueue,readStockObservationQueue:read,processStockObservationQueue:processQueue}=require('../src/core/stock-observation-queue');
const epoch=Date.parse('2026-01-10T08:00:00Z'),a='a'.repeat(64),b='b'.repeat(64);
const intent=(extra={})=>({symbol:'600001',decisionAt:epoch,trigger:'push-attempt',signalRefs:[{code:'600001',type:'趋势',ts:epoch-1}],...extra});
const captured=(extra={})=>({status:'captured',observation:{revision:1,observationHash:a},history:{provider:'eastmoney-public-history',rawHash:b,observedAt:epoch+999},...extra});
function temporary(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'observation-queue-'));try{const result=fn(root);if(result?.then)return result.finally(()=>fs.rmSync(root,{recursive:true,force:true}));fs.rmSync(root,{recursive:true,force:true});return result;}catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}}
function archiveFiles(root){return fs.readdirSync(root,{recursive:true}).filter(n=>/^\d{6}\.json$/.test(path.basename(n))).map(n=>path.join(root,n));}
test('enqueue is private immutable intake, actual signal identity deduplicates and makes no capture request',()=>temporary(root=>{
 const input=intent({messageHash:a,quote:{quoteSource:'tencent',quoteAt:epoch-100,receivedAt:epoch,price:10}}),original=structuredClone(input);
 const first=enqueue(root,input),second=enqueue(root,input);assert.equal(first.queued,true);assert.equal(first.reused,false);assert.equal(second.id,first.id);assert.equal(second.reused,true);assert.equal(first.canNotify,false);assert.equal(first.exactlyOnce,false);assert.equal(first.triggerStatus,'unverified');assert.deepEqual(input,original);
 const [file]=archiveFiles(root);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);
 const summary=read(root,{now:Date.now()});assert.equal(summary.counts.pending,1);assert.equal(summary.counts.attempts,0);assert.equal(summary.pending[0].status,'pending');assert.equal(JSON.stringify(summary).includes(root),false);assert.equal(JSON.stringify(summary).includes('quoteSource'),false);
 const amended=intent();amended.signalRefs[0].ts--;assert.notEqual(enqueue(root,amended).id,first.id);
 assert.notEqual(enqueue(root,intent({decisionAt:epoch+1})).id,first.id);
}));
test('signal ref ordering and duplicates do not invent a different push while genuine refs change its hash',()=>temporary(root=>{
 const refs=[{code:'600001',type:'a',ts:epoch-1},{code:'600002',type:'b',ts:epoch-2}];
 const first=enqueue(root,intent({signalRefs:refs}));const same=enqueue(root,intent({signalRefs:[refs[1],refs[0],refs[0]]}));assert.equal(same.id,first.id);assert.equal(same.reused,true);
}));
test('successful capture records true response observation time, survives restart and never requests again',async()=>temporary(async root=>{
 const queued=enqueue(root,intent());let calls=0;const now=Date.now();
 const result=await processQueue(root,{now:()=>now,capture:async job=>{calls++;assert.equal(job.id,queued.id);assert.equal(job.decisionAt,epoch);assert.equal(job.observedAt,undefined);assert.equal(job.canTrade,false);return captured();}});
 assert.equal(result.processed,1);assert.equal(result.results[0].status,'completed');assert.equal(result.results[0].result.history.observedAt,epoch+999);assert.equal(read(root,{now}).lastSuccess.id,queued.id);
 delete require.cache[require.resolve('../src/core/stock-observation-queue')];const restarted=require('../src/core/stock-observation-queue');await restarted.processStockObservationQueue(root,{capture:()=>{calls++;return captured();},now:()=>now+86400000});assert.equal(calls,1);assert.equal(restarted.readStockObservationQueue(root,{now}).counts.completed,1);
}));
test('unavailable and thrown captures retry after 60 then 120 seconds, stop at three and redact private errors',async()=>temporary(async root=>{
 enqueue(root,intent());let now=Date.now(),calls=0;const capture=async()=>{calls++;if(calls===1)return {status:'unavailable',error:root+'/secret-file'};throw Error(root+'/private/token');};
 const first=await processQueue(root,{capture,now:()=>now});assert.equal(first.results[0].attempts,1);assert.equal(first.results[0].nextAttemptAt,now+60000);
 now+=59999;assert.equal((await processQueue(root,{capture,now:()=>now})).processed,0);now++;
 const second=await processQueue(root,{capture,now:()=>now});assert.equal(second.results[0].nextAttemptAt,now+120000);now+=120000;
 const third=await processQueue(root,{capture,now:()=>now});assert.equal(third.results[0].status,'failed');assert.equal(third.results[0].nextAttemptAt,null);now+=86400000;assert.equal((await processQueue(root,{capture,now:()=>now})).processed,0);assert.equal(calls,3);
 const summary=read(root,{now});assert.equal(summary.counts.failed,1);assert.equal(summary.counts.attempts,3);assert.equal(summary.lastFailure.error,'CAPTURE_ERROR');assert.equal(JSON.stringify(summary).includes(root),false);for(const file of archiveFiles(root))assert.equal(fs.readFileSync(file,'utf8').includes(root),false);
}));
test('missing probability metadata is a success, invalid capture provenance is a retryable failure',async()=>temporary(async root=>{
 enqueue(root,intent());let now=Date.now();const invalid=await processQueue(root,{capture:async()=>({status:'captured',observation:{revision:1,observationHash:a},history:{provider:'x'}}),now:()=>now});assert.equal(invalid.results[0].error,'CAPTURE_RESULT_INVALID');now+=60000;
 const success=await processQueue(root,{capture:async()=>captured(),now:()=>now});assert.equal(success.results[0].status,'completed');assert.equal(success.results[0].result.probability,undefined);
}));
test('process guard is serial per queue and maxJobs bounds requests',async()=>temporary(async root=>{
 for(let i=0;i<3;i++)enqueue(root,intent({decisionAt:epoch+i}));let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let calls=0;
 const first=processQueue(root,{maxJobs:1,capture:async()=>{calls++;entered();await gate;return captured();}});await started;
 const concurrent=await processQueue(root,{capture:async()=>{calls++;return captured();}});assert.equal(concurrent.running,true);assert.equal(concurrent.processed,0);release();assert.equal((await first).processed,1);assert.equal(calls,1);
 assert.equal((await processQueue(root,{maxJobs:2,capture:async()=>{calls++;return captured();}})).processed,2);assert.equal(calls,3);
}));
test('queuedAt gates processing under a stale clock and failures do not retain a permanent lock',async()=>temporary(async root=>{
 enqueue(root,intent());const item=read(root).pending[0];assert.equal((await processQueue(root,{now:item.queuedAt-1,capture:async()=>captured()})).processed,0);
 await assert.rejects(processQueue(root,{now:0,capture:async()=>captured()}),/参数/);assert.equal((await processQueue(root,{capture:async()=>captured()})).processed,1);
}));
test('over-8KiB intents return blocked without archiving or deleting history',()=>temporary(root=>{
 const original=enqueue(root,intent());const refs=Array.from({length:80},(_,i)=>({code:'600001',type:'a'.repeat(80),id:String(i)+'x'.repeat(150),ts:epoch-1}));
 const result=enqueue(root,intent({signalRefs:refs}));assert.equal(result.queued,false);assert.equal(result.blocked,true);assert.equal(result.reason,'INTENT_TOO_LARGE');assert.equal(read(root).pending[0].id,original.id);assert.equal(archiveFiles(root).length,1);
}));
test('invalid intent data and private directory, file, hash or chain corruption fail closed without leaking paths',()=>temporary(root=>{
 for(const input of [intent({symbol:'../../'}),intent({trigger:'delivered'}),intent({decisionAt:Date.now()+100000}),intent({messageHash:'bad'}),intent({quote:{accountBalance:100}})])assert.throws(()=>enqueue(root,input),e=>!e.message.includes(root));
 assert.throws(()=>enqueue(path.join(root,'public','queue'),intent()),/校验/);const open=path.join(root,'open');fs.mkdirSync(open);fs.chmodSync(open,0o755);assert.throws(()=>enqueue(open,intent()),/校验/);
 const queue=path.join(root,'queue');enqueue(queue,intent());const [file]=archiveFiles(queue),raw=fs.readFileSync(file);fs.chmodSync(file,0o644);assert.throws(()=>read(queue),/校验/);fs.chmodSync(file,0o600);
 const tampered=JSON.parse(raw);tampered.intent.decisionAt--;fs.writeFileSync(file,JSON.stringify(tampered));assert.throws(()=>read(queue),/校验/);fs.writeFileSync(file,raw);
 fs.renameSync(file,path.join(path.dirname(file),'000002.json'));assert.throws(()=>read(queue),/校验/);
}));
test('symbolic links are rejected for roots, intent files and attempt directories',async()=>temporary(async root=>{
 const queue=path.join(root,'queue');const item=enqueue(queue,intent()),alias=path.join(root,'alias');fs.symlinkSync(queue,alias);assert.throws(()=>read(alias),/校验/);
 const [file]=archiveFiles(queue),original=fs.readFileSync(file);fs.unlinkSync(file);fs.symlinkSync('/etc/passwd',file);assert.throws(()=>read(queue),/校验/);fs.unlinkSync(file);fs.writeFileSync(file,original,{mode:0o600});
 fs.symlinkSync(root,path.join(queue,'attempts',item.id));await assert.rejects(processQueue(queue,{capture:async()=>captured()}),/校验/);
}));
test('attempt files are immutable, corruption is rejected and uncommitted crash files do not lock the queue',async()=>temporary(async root=>{
 const item=enqueue(root,intent()),dir=path.join(root,'attempts',item.id);fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(dir,'000001.json.0123456789abcdef.tmp'),'partial',{mode:0o600});
 await processQueue(root,{capture:async()=>captured()});const file=path.join(dir,'000001.json'),raw=fs.readFileSync(file);assert.equal(fs.statSync(file).mode&0o777,0o600);const result=JSON.parse(raw);result.result.observation.revision=2;fs.writeFileSync(file,JSON.stringify(result));assert.throws(()=>read(root),/校验/);
}));
test('unpublished temporary bytes count toward quota and oversized committed files are rejected',()=>temporary(root=>{
 enqueue(root,intent());const before=read(root).bytes,temp=path.join(root,'intents','000002.json.0123456789abcdef.tmp');fs.writeFileSync(temp,'partial',{mode:0o600});assert.equal(read(root).bytes,before+7);
 fs.unlinkSync(temp);const file=archiveFiles(root)[0];fs.writeFileSync(file,'x'.repeat(8193));assert.throws(()=>read(root),/校验/);
}));
test('snapshot accepts a strictly named stage disappearing after readdir before lstat',()=>temporary(root=>{
 enqueue(root,intent());const temp=path.join(root,'intents','000002.json.0123456789abcdef.tmp');fs.writeFileSync(temp,'partial',{mode:0o600});
 const original=fs.lstatSync;let removed=false;
 fs.lstatSync=function(file,...args){if(file===temp&&!removed){removed=true;fs.unlinkSync(temp);}return original.call(fs,file,...args);};
 try{assert.equal(read(root).counts.total,1);assert.equal(removed,true);}finally{fs.lstatSync=original;}
}));
test('snapshot still rejects a committed or illegal entry disappearing before lstat',()=>{
 for(const name of ['000001.json','000002.json.not-a-publisher.tmp'])temporary(root=>{
  enqueue(root,intent());const target=path.join(root,'intents',name);if(name!=='000001.json')fs.writeFileSync(target,'partial',{mode:0o600});
  const original=fs.lstatSync;let removed=false;
  fs.lstatSync=function(file,...args){if(file===target&&!removed){removed=true;fs.unlinkSync(target);}return original.call(fs,file,...args);};
  try{assert.throws(()=>read(root),/校验/);assert.equal(removed,true);}finally{fs.lstatSync=original;}
 });
});
test('snapshot rejects a genuine orphan attempt directory',()=>temporary(root=>{
 enqueue(root,intent());fs.mkdirSync(path.join(root,'attempts','f'.repeat(64)),{mode:0o700});assert.throws(()=>read(root),/校验/);
}));
test('snapshot rereads a legally appended parent and published child between directory snapshots',async()=>temporary(async root=>{
 enqueue(root,intent());const appended=intent({decisionAt:epoch+1});
 await temporary(async fixture=>{
  const prepared=enqueue(fixture,appended);await processQueue(fixture,{now:()=>Date.now()+60000,capture:async()=>captured()});
  const childBytes=fs.readFileSync(path.join(fixture,'attempts',prepared.id,'000001.json'));
  const original=fs.readdirSync;let inserted=false;
  fs.readdirSync=function(dir,...args){
   if(dir===path.join(root,'attempts')&&!inserted){
    inserted=true;const result=enqueue(root,appended);assert.equal(result.id,prepared.id);
    const childDir=path.join(root,'attempts',result.id);fs.mkdirSync(childDir,{mode:0o700});fs.writeFileSync(path.join(childDir,'000001.json'),childBytes,{mode:0o600});
   }
   return original.call(fs,dir,...args);
  };
  try{const result=read(root);assert.equal(inserted,true);assert.equal(result.counts.total,2);assert.equal(result.counts.completed,1);assert.equal(result.completed[0].id,prepared.id);}finally{fs.readdirSync=original;}
 });
}));
test('snapshot append refresh cannot hide an actual orphan or remove prior history',()=>temporary(root=>{
 enqueue(root,intent());let appendedBytes,appendedId;
 temporary(fixture=>{
  fs.mkdirSync(path.join(fixture,'intents'),{mode:0o700});fs.mkdirSync(path.join(fixture,'attempts'),{mode:0o700});
  fs.copyFileSync(path.join(root,'intents','000001.json'),path.join(fixture,'intents','000001.json'));
  appendedId=enqueue(fixture,intent({decisionAt:epoch+1})).id;
  appendedBytes=fs.readFileSync(path.join(fixture,'intents','000002.json'));
 });
 fs.mkdirSync(path.join(root,'attempts','f'.repeat(64)),{mode:0o700});
 const original=fs.readdirSync;let inserted=false;
 fs.readdirSync=function(dir,...args){
  if(dir===path.join(root,'attempts')&&!inserted){
   inserted=true;
   // Publish authentic bytes prepared through the public enqueue API, while
   // retaining the unrelated orphan that the subsequent refresh must reject.
   const stage=path.join(root,'intents','000002.json.0123456789abcdef.tmp');
   fs.writeFileSync(stage,appendedBytes,{mode:0o600});fs.linkSync(stage,path.join(root,'intents','000002.json'));fs.unlinkSync(stage);
   fs.mkdirSync(path.join(root,'attempts',appendedId),{mode:0o700});
  }
  return original.call(fs,dir,...args);
 };
 try{assert.throws(()=>read(root),/校验/);assert.equal(inserted,true);assert.equal(fs.existsSync(path.join(root,'intents','000001.json')),true);assert.equal(fs.existsSync(path.join(root,'intents','000002.json')),true);}finally{fs.readdirSync=original;}
}));
test('snapshot append refresh is bounded under continuously advancing publishers',()=>temporary(root=>{
 enqueue(root,intent());const original=fs.readdirSync;let inserted=0,insidePublisher=false;
 fs.readdirSync=function(dir,...args){
  if(dir===path.join(root,'attempts')&&!insidePublisher){
   insidePublisher=true;
   try{const added=enqueue(root,intent({decisionAt:epoch+(++inserted)}));fs.mkdirSync(path.join(root,'attempts',added.id),{mode:0o700});}finally{insidePublisher=false;}
  }
  return original.call(fs,dir,...args);
 };
 try{assert.throws(()=>read(root),/校验/);assert.equal(inserted,4);}finally{fs.readdirSync=original;}
 assert.equal(read(root).counts.total,5);
}));
test('killing an in-flight worker leaves no permanent lock and another process can capture the same intent',async()=>temporary(async root=>{
 enqueue(root,intent());const modulePath=require.resolve('../src/core/stock-observation-queue');
 const script=`const {processStockObservationQueue}=require(${JSON.stringify(modulePath)});processStockObservationQueue(process.argv[1],{capture:async()=>{process.stdout.write('ready\\n');await new Promise(()=>{setInterval(()=>{},1000);});}});`;
 const child=spawn(process.execPath,['-e',script,root],{stdio:['ignore','pipe','pipe']});let readyResolve,readyReject,output='';const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});child.stdout.on('data',data=>{output+=data;if(output.includes('ready\n'))readyResolve();});child.on('error',readyReject);child.on('exit',code=>{if(!output.includes('ready\n'))readyReject(Error('worker stopped before capture '+code));});
 const timeout=setTimeout(()=>readyReject(Error('worker readiness timeout')),10000);try{await ready;const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;assert.equal(read(root).counts.attempts,0);assert.equal((await processQueue(root,{capture:async()=>captured()})).processed,1);assert.equal(read(root).counts.completed,1);}finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill();}
}));
test('enqueue publication has bounded retries and preserves prior committed history',()=>temporary(root=>{
 const first=enqueue(root,intent()),link=fs.linkSync;let calls=0;fs.linkSync=()=>{calls++;const error=Error('conflict');error.code='EEXIST';throw error;};
 try{const blocked=enqueue(root,intent({decisionAt:epoch+1}));assert.equal(blocked.blocked,true);assert.equal(blocked.reason,'QUEUE_PUBLICATION_CONFLICT');assert.equal(calls,5);}finally{fs.linkSync=link;}
 assert.equal(read(root).counts.total,1);assert.equal(read(root).pending[0].id,first.id);
}));
test('intent capacity is 1000, duplicates still reuse the archive at capacity',()=>temporary(root=>{
 // Build a valid archive through the public API so the limit is exercised against real records.
 const first=enqueue(root,intent());for(let i=1;i<1000;i++)assert.equal(enqueue(root,intent({decisionAt:epoch+i})).queued,true);
 const blocked=enqueue(root,intent({decisionAt:epoch+1000}));assert.equal(blocked.reason,'QUEUE_CAPACITY');assert.equal(blocked.queued,false);assert.equal(enqueue(root,intent()).id,first.id);assert.equal(enqueue(root,intent()).reused,true);assert.equal(read(root).counts.total,1000);
}));
test('cross-process racing capture may execute twice but publishes exactly one attempt and never sends a notification',async()=>temporary(async root=>{
 const item=enqueue(root,intent()),barrier=path.join(os.tmpdir(),'queue-barrier-'+crypto.randomBytes(8).toString('hex')),modulePath=require.resolve('../src/core/stock-observation-queue');
 const script=`const fs=require('node:fs'),{processStockObservationQueue}=require(${JSON.stringify(modulePath)});processStockObservationQueue(process.argv[1],{capture:async()=>{process.stdout.write('ready\\n');const end=Date.now()+10000;while(!fs.existsSync(process.argv[2])){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}return ${JSON.stringify(captured())};}}).then(r=>process.stdout.write(JSON.stringify(r)+'\\n')).catch(e=>{process.stderr.write(e.message);process.exitCode=1;});`;
 const workers=[];for(let i=0;i<2;i++){
  const child=spawn(process.execPath,['-e',script,root,barrier],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('ready\n'))readyResolve();});child.stderr.on('data',data=>{stderr+=data;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code?reject(Error(stderr||'child failed')):resolve(JSON.parse(stdout.trim().split('\n').at(-1))));});workers.push({child,ready,done});
 }
 try{await Promise.all(workers.map(w=>w.ready));fs.writeFileSync(barrier,'go');const results=await Promise.all(workers.map(w=>w.done));assert.equal(results.filter(r=>r.results[0].published).length,1);assert.equal(results.every(r=>r.exactlyOnce===false),true);assert.equal(read(root).counts.attempts,1);assert.equal(read(root).completed[0].id,item.id);}
 finally{try{fs.unlinkSync(barrier);}catch{}for(const w of workers)if(w.child.exitCode===null)w.child.kill();}
}));
