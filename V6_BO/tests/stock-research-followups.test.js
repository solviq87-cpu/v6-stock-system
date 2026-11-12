'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {scheduleStockResearchFollowup:schedule,processStockResearchFollowups:processFollowups,readStockResearchFollowups:read}=require('../src/core/stock-research-followups');
const t=s=>Date.parse(s+'+08:00'),createdAt=t('2026-01-05T16:30:00'),dueAt=t('2026-01-06T16:10:00'),a='a'.repeat(64),b='b'.repeat(64);
function job(extra={}){return {symbol:'600001',provider:'eastmoney',priceBasis:'unadjusted',targetDate:'2026-01-06',dueAt,hypothesisHash:a,calendarHash:b,createdAt,...extra};}
function capture(extra={}){return {status:'captured',history:{provider:'eastmoney',rawHash:b,retrievedAt:dueAt},observation:{revision:2,observationHash:a},stock:{symbol:'600001',source:'eastmoney',provider:'eastmoney',priceBasis:'unadjusted',observedAt:dueAt-1000,bars:[{date:'2026-01-06',open:10,high:12,low:9,close:11,volume:100,knownAt:t('2026-01-06T15:11:00')}]},...extra};}
function enqueueAt(root,input=job(),time=createdAt){const original=Date.now;Date.now=()=>time;try{return schedule(root,input);}finally{Date.now=original;}}
function temporary(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-followups-'));try{const result=fn(root);if(result?.then)return result.finally(()=>fs.rmSync(root,{recursive:true,force:true}));fs.rmSync(root,{recursive:true,force:true});return result;}catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}}
function files(root){return fs.readdirSync(root,{recursive:true}).filter(n=>/^\d{6}\.json$/.test(path.basename(n))).map(n=>path.join(root,n));}
test('frozen parent, explicit source and calendar identify an immutable private revisit independent of later pushes',()=>temporary(root=>{
 const input=job(),original=structuredClone(input),first=enqueueAt(root,input);assert.equal(first.scheduled,true);assert.equal(first.exactlyOnce,false);assert.equal(first.canNotify,false);assert.deepEqual(input,original);
 assert.equal(enqueueAt(root,input,dueAt+86400000).id,first.id);assert.equal(enqueueAt(root,input,dueAt+86400000).reused,true);
 assert.notEqual(enqueueAt(root,job({hypothesisHash:b})).id,first.id);assert.notEqual(enqueueAt(root,job({calendarHash:a})).id,first.id);assert.notEqual(enqueueAt(root,job({provider:'tencent'})).id,first.id);
 const [file]=files(root);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);assert.equal(read(root,{now:createdAt}).counts.pending,4);assert.equal(read(root,{now:createdAt}).counts.due,0);
}));
test('next-session post-close revisit runs without another push and completes only for the actual target',async()=>temporary(async root=>{
 enqueueAt(root);let calls=0;
 assert.equal((await processFollowups(root,{now:dueAt-1,capture:async()=>{calls++;return capture();}})).processed,0);assert.equal(calls,0);
 const result=await processFollowups(root,{now:dueAt,capture:async intent=>{calls++;assert.equal(intent.createdAt,createdAt);assert.equal(intent.provider,'eastmoney');assert.equal(intent.targetDate,'2026-01-06');assert.equal(intent.observedAt,undefined);return capture();}});
 assert.equal(result.processed,1);assert.equal(result.results[0].status,'completed');assert.equal(result.results[0].proof.hypothesisHash,a);assert.equal(result.results[0].proof.calendarHash,b);assert.equal(result.results[0].proof.bar.knownAt,t('2026-01-06T15:11:00'));
 await processFollowups(root,{now:dueAt+86400000,capture:async()=>{calls++;return capture();}});assert.equal(calls,1);assert.equal(read(root,{now:dueAt}).counts.completed,1);
}));
test('restart can schedule a previously frozen missed target and content observations may precede the new retrieval',async()=>temporary(async root=>{
 const later=dueAt+2*86400000;enqueueAt(root,job(),later);const queued=read(root,{now:later}).pending[0];assert.equal(queued.createdAt,createdAt);assert.equal(queued.enqueuedAt,later);
 delete require.cache[require.resolve('../src/core/stock-research-followups')];const restarted=require('../src/core/stock-research-followups');const response=capture();response.history.retrievedAt=later; // same target content, new real response
 const result=await restarted.processStockResearchFollowups(root,{now:later,capture:async()=>response});assert.equal(result.results[0].status,'completed');assert.equal(result.results[0].proof.observedAt,dueAt-1000);assert.equal(result.results[0].proof.retrievedAt,later);assert.equal(result.results[0].proof.bar.knownAt,t('2026-01-06T15:11:00'));
}));
test('HTTP success without target remains pending, retries are bounded to three/hour and five total then unknown',async()=>temporary(async root=>{
 enqueueAt(root);let now=dueAt,calls=0;const starts=[];
 for(let i=0;i<5;i++){
  const result=await processFollowups(root,{now:()=>now,capture:async()=>{calls++;starts.push(now);const r=capture();r.stock.bars[0].date='2026-01-05';return r;}}),row=result.results[0];assert.equal(row.reason,'TARGET_MISSING');assert.equal(row.status,i===4?'unknown':'pending');
  if(i<4){const next=row.nextAttemptAt;assert.ok(next-now>=1200000);assert.equal((await processFollowups(root,{now:next-1,capture:async()=>{calls++;return capture();}})).processed,0);now=next;}
 }
 assert.equal(calls,5);for(const start of starts)assert.ok(starts.filter(s=>s>=start&&s<start+3600000).length<=3);assert.equal((await processFollowups(root,{now:now+86400000,capture:async()=>capture()})).processed,0);assert.equal(read(root,{now}).counts.unknown,1);
}));
test('provider, row source, price basis, identity and clocks cannot turn a stale bar into a mature label',async()=>{
 const alterations=[r=>r.history.provider='tencent',r=>r.stock.source='tencent',r=>r.stock.bars[0].provider='tencent',r=>r.stock.priceBasis='forward-adjusted',r=>r.stock.symbol='600002',r=>r.stock.bars[0].knownAt=createdAt,r=>r.stock.bars[0].knownAt=t('2026-01-06T14:30:00'),r=>r.stock.bars[0].closed=false,r=>r.stock.observedAt=r.stock.bars[0].knownAt-1,r=>r.history.retrievedAt=r.stock.observedAt-1,r=>r.history.retrievedAt=dueAt+1,r=>r.stock.bars.push({...r.stock.bars[0]}),r=>r.observation.observationHash='bad'];
 for(const alter of alterations)await temporary(async root=>{enqueueAt(root);const response=capture();alter(response);const result=await processFollowups(root,{now:dueAt,capture:async()=>response});assert.equal(result.results[0].status,'pending');assert.equal(read(root,{now:dueAt}).counts.completed,0);});
});
test('scheduling rejects guessed cutoffs, future or post-open freeze times, unknown providers and paths',()=>temporary(root=>{
 for(const input of [job({dueAt:dueAt-60000}),job({targetDate:'2026-02-30'}),job({createdAt:t('2026-01-06T09:30:00')}),job({createdAt:createdAt+1}),job({provider:'auto'}),job({source:'tencent'}),job({priceBasis:'forward-adjusted'}),job({url:'https://example.com'}),job({path:'/private'})])assert.throws(()=>enqueueAt(root,input),/校验/);
 // An explicit calendar date is accepted even on a weekend; this module never
 // invents trading dates by weekday arithmetic. The parent owns calendar proof.
 const targetDate='2026-01-10';assert.equal(enqueueAt(root,job({targetDate,dueAt:t(targetDate+'T16:10:00')})).scheduled,true);
}));
test('capture failures record safe reasons, no private error paths and immutable attempt files',async()=>temporary(async root=>{
 enqueueAt(root);const result=await processFollowups(root,{now:dueAt,capture:async()=>{throw Error(root+'/private-token');}});assert.equal(result.results[0].reason,'CAPTURE_ERROR');assert.equal(JSON.stringify(read(root,{now:dueAt})).includes(root),false);
 for(const file of files(root)){assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readFileSync(file,'utf8').includes(root),false);}
}));
test('serial guard and maxJobs bound requests; process errors release the guard',async()=>temporary(async root=>{
 enqueueAt(root);enqueueAt(root,job({symbol:'600002'}));let release,entered;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const first=processFollowups(root,{now:dueAt,maxJobs:1,capture:async()=>{entered();await gate;return capture();}});await ready;const other=await processFollowups(root,{now:dueAt,capture:async()=>capture()});assert.equal(other.running,true);assert.equal(other.processed,0);release();assert.equal((await first).processed,1);
 await assert.rejects(processFollowups(root,{now:0,capture:async()=>capture()}),/参数/);assert.equal((await processFollowups(root,{now:dueAt,capture:async()=>({status:'unavailable'})})).processed,1);
}));
test('private directories, symlinks, oversize records and hash tampering fail closed',async()=>temporary(async root=>{
 assert.throws(()=>enqueueAt(path.join(root,'public','followup')),/校验/);const open=path.join(root,'open');fs.mkdirSync(open);fs.chmodSync(open,0o755);assert.throws(()=>enqueueAt(open),/校验/);
 const queue=path.join(root,'queue');enqueueAt(queue);const alias=path.join(root,'alias');fs.symlinkSync(queue,alias);assert.throws(()=>read(alias),/校验/);
 const file=files(queue)[0],original=fs.readFileSync(file);fs.chmodSync(file,0o644);assert.throws(()=>read(queue),/校验/);fs.chmodSync(file,0o600);
 const changed=JSON.parse(original);changed.job.targetDate='2026-01-07';fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>read(queue),/校验/);fs.writeFileSync(file,original);
 await processFollowups(queue,{now:dueAt,capture:async()=>capture()});const attempt=files(queue).find(f=>f.includes(path.sep+'attempts'+path.sep)),raw=fs.readFileSync(attempt);const proof=JSON.parse(raw);proof.proof.bar.knownAt=createdAt;fs.writeFileSync(attempt,JSON.stringify(proof));assert.throws(()=>read(queue),/校验/);fs.writeFileSync(attempt,raw);
 fs.writeFileSync(attempt,'x'.repeat(2049));assert.throws(()=>read(queue),/校验/);
}));
test('publication retries are bounded, crash leftovers cannot lock future processing',async()=>temporary(async root=>{
 const first=enqueueAt(root),link=fs.linkSync;let calls=0;fs.linkSync=()=>{calls++;const e=Error('conflict');e.code='EEXIST';throw e;};
 try{const blocked=enqueueAt(root,job({symbol:'600002'}));assert.equal(blocked.reason,'FOLLOWUP_PUBLICATION_CONFLICT');assert.equal(calls,5);}finally{fs.linkSync=link;}
 const dir=path.join(root,'attempts',first.id);fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(dir,'000001.json.0123456789abcdef.tmp'),'unfinished',{mode:0o600});const before=read(root,{now:dueAt}).bytes;assert.ok(before>0);assert.equal((await processFollowups(root,{now:dueAt,capture:async()=>capture()})).results[0].status,'completed');
}));
test('1000 intent bound preserves existing history and idempotent duplicates',()=>temporary(root=>{
 const digest=n=>crypto.createHash('sha256').update(String(n)).digest('hex');const first=enqueueAt(root);
 const file=files(root)[0],template=JSON.parse(fs.readFileSync(file,'utf8')),dir=path.dirname(file);
 const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
 const encode=x=>JSON.stringify(ordered(x)),sha=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');let previousHash=template.recordHash;
 // A valid immutable chain fixture avoids 1000 quadratic schedule scans; the
 // actual capacity rejection/reuse below still validates every archived record.
 for(let i=1;i<1000;i++){const {recordHash,...event}=template;event.job={...template.job,hypothesisHash:digest(i)};const {createdAt:freeze,...identity}=event.job;event.id=sha(identity);event.queueRevision=i+1;event.previousHash=previousHash;const record={...event,recordHash:sha(event)};previousHash=record.recordHash;fs.writeFileSync(path.join(dir,String(i+1).padStart(6,'0')+'.json'),encode(record),{flag:'wx',mode:0o600});}
 assert.equal(enqueueAt(root,job({hypothesisHash:digest(1001)})).reason,'FOLLOWUP_CAPACITY');assert.equal(enqueueAt(root).id,first.id);assert.equal(enqueueAt(root).reused,true);assert.equal(read(root,{now:dueAt}).counts.total,1000);
}));
test('a backwards processing clock cannot publish maturity and does not retain the serial guard',async()=>temporary(async root=>{
 enqueueAt(root);let now=dueAt;await assert.rejects(processFollowups(root,{now:()=>now,capture:async()=>{now--;return capture();}}),/校验/);assert.equal(read(root,{now:dueAt}).counts.attempts,0);
 assert.equal((await processFollowups(root,{now:dueAt,capture:async()=>capture()})).results[0].status,'completed');
}));
test('SIGKILL during a source request leaves no permanent lock and restart recaptures the frozen target',async()=>temporary(async root=>{
 enqueueAt(root);const modulePath=require.resolve('../src/core/stock-research-followups');
 const script=`const {processStockResearchFollowups}=require(${JSON.stringify(modulePath)});processStockResearchFollowups(process.argv[1],{now:${dueAt},capture:async()=>{process.stdout.write('ready\\n');await new Promise(()=>setInterval(()=>{},1000));}});`;
 const child=spawn(process.execPath,['-e',script,root],{stdio:['ignore','pipe','pipe']});let output='',readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});child.stdout.on('data',data=>{output+=data;if(output.includes('ready\n'))readyResolve();});child.on('error',readyReject);child.on('exit',code=>{if(!output.includes('ready\n'))readyReject(Error('worker stopped '+code));});
 const timeout=setTimeout(()=>readyReject(Error('worker readiness timeout')),10000);try{await ready;const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;assert.equal(read(root,{now:dueAt}).counts.attempts,0);assert.equal((await processFollowups(root,{now:dueAt,capture:async()=>capture()})).results[0].status,'completed');}finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill();}
}));
test('two processes may fetch twice but CAS publishes only one immutable completion',async()=>temporary(async root=>{
 enqueueAt(root);const modulePath=require.resolve('../src/core/stock-research-followups'),barrier=path.join(os.tmpdir(),'research-followup-barrier-'+crypto.randomBytes(8).toString('hex'));
 const script=`const fs=require('node:fs'),{processStockResearchFollowups}=require(${JSON.stringify(modulePath)});processStockResearchFollowups(process.argv[1],{now:${dueAt},capture:async()=>{process.stdout.write('ready\\n');const deadline=Date.now()+10000;while(!fs.existsSync(process.argv[2])){if(Date.now()>deadline)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}return ${JSON.stringify(capture())};}}).then(result=>process.stdout.write(JSON.stringify(result)+'\\n')).catch(e=>{process.stderr.write(e.message);process.exitCode=1;});`;
 const workers=[];for(let i=0;i<2;i++){const child=spawn(process.execPath,['-e',script,root,barrier],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('ready\n'))readyResolve();});child.stderr.on('data',data=>{stderr+=data;});child.on('error',readyReject);const done=new Promise((resolve,reject)=>child.on('exit',code=>{if(!stdout.includes('ready\n'))readyReject(Error(stderr||'child stopped'));code?reject(Error(stderr||'child failed')):resolve(JSON.parse(stdout.trim().split('\n').at(-1)));}));done.catch(()=>{});workers.push({child,ready,done});}
 let timeout;try{await Promise.race([Promise.all(workers.map(w=>w.ready)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('readiness timeout')),12000);})]);fs.writeFileSync(barrier,'go');const results=await Promise.all(workers.map(w=>w.done));assert.equal(results.filter(r=>r.results[0].published).length,1);assert.equal(read(root,{now:dueAt}).counts.completed,1);assert.equal(read(root,{now:dueAt}).counts.attempts,1);assert.equal(results.every(r=>r.exactlyOnce===false),true);}finally{clearTimeout(timeout);try{fs.unlinkSync(barrier);}catch{}for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill();}
}));
