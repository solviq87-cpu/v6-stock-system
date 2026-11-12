'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),
 os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {registerResearchWatch:register,processResearchWatchlist:processWatch,
 readResearchWatchlist:read}=require('../src/core/stock-research-watchlist');
const t=s=>Date.parse(s+'+08:00'),a='a'.repeat(64),b='b'.repeat(64),
 dates=['2026-01-05','2026-01-06','2026-01-09','2026-01-12','2026-01-13'];
const calendar=()=>({status:'available',tradeDates:dates,metadata:{sha256:a}});
function temporary(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-watch-'));
 try{const result=fn(root);if(result?.then)return result.finally(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.rmSync(root,{recursive:true,force:true});return result;
 }catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}}
function intent(extra={}){return {symbol:'600001',provider:'eastmoney',registeredAt:t('2026-01-05T11:00:00'),...extra};}
function capture(now=t('2026-01-05T16:10:00'),targetDate='2026-01-05',extra={}){
 return {status:'captured',asOf:now,history:{provider:'eastmoney',source:'eastmoney',rawHash:a,retrievedAt:now},
  stock:{symbol:'600001',provider:'eastmoney',source:'eastmoney',priceBasis:'unadjusted',observedAt:now,
   bars:[{date:targetDate,open:10,high:12,low:9,close:11,volume:100,knownAt:t(targetDate+'T15:11:00')}]},
  observation:{observationHash:b,revision:1},priceEventResearch:{status:'research-observation-recorded',revision:1},...extra};
}
const call=(root,now,callback=async()=>capture(now))=>processWatch(root,{now,readCalendar:calendar,capture:callback});
const records=root=>fs.readdirSync(root,{recursive:true}).filter(n=>/^\d{6}\.json$/.test(path.basename(n))).map(n=>path.join(root,n));
test('intraday observation creates permanent explicit watch; close seals once and next session remains watched',async()=>temporary(async root=>{
 const initial=register(root,intent());assert.equal(initial.registered,true);
 const duplicate=register(root,intent({registeredAt:t('2026-01-05T12:00:00')}));
 assert.equal(duplicate.reused,true);assert.equal(duplicate.registeredAt,intent().registeredAt);
 let calls=0;const due=t('2026-01-05T16:10:00');
 assert.equal((await call(root,due-1,async()=>{calls++;return capture(due);})).processed,0);
 const first=await call(root,due,async job=>{calls++;assert.equal(job.targetDate,'2026-01-05');
  assert.equal(job.registeredAt,intent().registeredAt);assert.equal(job.source,'eastmoney');
  assert.equal(job.canNotify,false);return capture(due);});
 assert.equal(first.results[0].status,'completed');assert.equal(first.results[0].proof.bar.date,'2026-01-05');
 assert.equal((await call(root,due+60000,async()=>{calls++;return capture(due);})).processed,0);
 const next=t('2026-01-06T16:10:00');
 assert.equal((await call(root,next,async()=>{calls++;return capture(next,'2026-01-06');})).results[0].status,'completed');
 assert.equal(calls,2);assert.equal(read(root).counts.watches,1);assert.equal(read(root).counts.completed,2);
 for(const file of records(root)){assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);}
}));
test('Friday close can be captured across weekend before Monday open, never after it or for late registrations',async()=>{
 await temporary(async root=>{
  register(root,intent({registeredAt:t('2026-01-09T12:00:00')}));
  const now=t('2026-01-11T12:00:00');
  assert.equal((await call(root,now,async()=>capture(now,'2026-01-09'))).results[0].status,'completed');
 });
 await temporary(async root=>{
  register(root,intent({registeredAt:t('2026-01-12T10:00:00')}));let requests=0;
  assert.equal((await call(root,t('2026-01-12T10:01:00'),async()=>{requests++;return capture();})).processed,0);
  assert.equal((await call(root,t('2026-01-12T16:09:59'),async()=>{requests++;return capture();})).processed,0);
  assert.equal(requests,0);
  const now=t('2026-01-12T16:10:00');
  assert.equal((await call(root,now,async()=>capture(now,'2026-01-12'))).results[0].status,'completed');
 });
 await temporary(async root=>{
  register(root,intent({registeredAt:t('2026-01-09T12:00:00')}));
  assert.equal((await call(root,t('2026-01-12T09:30:00'),async()=>{throw Error('must not fetch Friday');})).processed,0);
 });
});
test('missing or malformed explicit calendar causes no request and no guessed weekday',async()=>temporary(async root=>{
 register(root,intent());let calls=0;
 for(const cal of [{status:'unavailable'}, {status:'available',tradeDates:['2026-01-05']},
  {status:'available',tradeDates:['2026-01-06','2026-01-05']},
  {status:'available',tradeDates:['2026-02-30','2026-03-01']}]){
  const result=await processWatch(root,{now:t('2026-01-05T16:10:00'),readCalendar:()=>cal,
   capture:async()=>{calls++;return capture();}});
  assert.equal(result.processed,0);assert.equal(result.status,'waiting-explicit-calendar');
 }
 assert.equal(calls,0);assert.equal(read(root).counts.attempts,0);
}));
test('five failed session attempts use 20/40/60/60 minute backoff then unknown; next session continues',async()=>temporary(async root=>{
 register(root,intent());let now=t('2026-01-05T16:10:00'),calls=0;
 for(let i=1;i<=5;i++){
  const result=await call(root,now,async()=>{calls++;return {status:'unavailable'};}),row=result.results[0];
  assert.equal(row.attempt,i);assert.equal(row.status,i===5?'unknown':'pending');
  if(i<5){assert.equal(row.nextAttemptAt-now,Math.min(60,20*i)*60000);
   assert.equal((await call(root,row.nextAttemptAt-1,async()=>{calls++;return capture();})).processed,0);now=row.nextAttemptAt;}
 }
 assert.equal(calls,5);assert.equal((await call(root,now+60000)).processed,0);
 assert.equal(read(root).counts.unknown,1);
 const next=t('2026-01-06T16:10:00');
 assert.equal((await call(root,next,async()=>capture(next,'2026-01-06'))).results[0].status,'completed');
 assert.equal(read(root).counts.unknown,1);assert.equal(read(root).counts.completed,1);
}));
test('target date, provider, timestamps and sealed research are independently required without state metadata',async()=>{
 const alters=[r=>r.stock.bars[0].date='2026-01-02',r=>r.stock.provider='tencent',
  r=>r.history.provider='tencent',r=>r.stock.bars[0].knownAt=t('2026-01-05T11:00:00'),
  r=>r.stock.observedAt=r.stock.bars[0].knownAt-1,r=>r.history.retrievedAt++,
  r=>r.stock.bars[0].closed=false,r=>r.stock.bars[0].source='tencent',
  r=>r.observation.observationHash='invalid',r=>delete r.priceEventResearch,
  r=>r.priceEventResearch.status='failed',r=>r.priceEventResearch={status:'unchanged',revision:1}];
 for(const alter of alters)await temporary(async root=>{
  register(root,intent());const response=capture();alter(response);
  assert.equal((await call(root,t('2026-01-05T16:10:00'),async()=>response)).results[0].status,'pending');
  assert.equal(read(root).counts.completed,0);
 });
 await temporary(async root=>{
  register(root,intent());const response=capture();response.priceEventResearch={status:'no-eligible-prospective-hypothesis',revision:0};
  assert.equal((await call(root,t('2026-01-05T16:10:00'),async()=>response)).results[0].status,'completed');
 });
 await temporary(async root=>{
  register(root,intent());const response=capture();response.priceEventResearch={status:'unchanged',revision:1,
   currentHypothesis:{signalDate:'2026-01-05',targetDate:'2026-01-06',hypothesisHash:a}};
  assert.equal((await call(root,t('2026-01-05T16:10:00'),async()=>response)).results[0].status,'completed');
 });
});
test('sources have separate watches, max one fetch per tick and restart retains success and retry state',async()=>temporary(async root=>{
 register(root,intent());register(root,intent({provider:'tencent'}));
 let calls=0;const now=t('2026-01-05T16:10:00');
 const response=job=>{const r=capture(now);for(const obj of [r.stock,r.history]){obj.provider=job.provider;obj.source=job.provider;}return r;};
 const first=await call(root,now,async job=>{calls++;return response(job);});assert.equal(first.processed,1);
 delete require.cache[require.resolve('../src/core/stock-research-watchlist')];
 const restarted=require('../src/core/stock-research-watchlist');
 const second=await restarted.processResearchWatchlist(root,{now,readCalendar:calendar,capture:async job=>{calls++;return response(job);}});
 assert.equal(second.processed,1);assert.equal(calls,2);assert.equal(read(root).counts.completed,2);
 await assert.rejects(processWatch(root,{now,readCalendar:calendar,maxJobs:2,capture:async()=>capture()}),/参数/);
}));
test('invalid registration, symlinks, hash corruption and oversize files fail closed',()=>temporary(root=>{
 for(const input of [intent({registeredAt:Date.now()+1000}),intent({provider:'auto'}),intent({symbol:'bad'}),
  {...intent(),pushAttemptHash:a},{...intent(),targetDate:'2026-01-05'}])assert.throws(()=>register(root,input),/校验/);
 register(root,intent());const alias=root+'-alias';fs.symlinkSync(root,alias);
 try{assert.throws(()=>read(alias),/校验/);}finally{fs.unlinkSync(alias);}
 const file=records(root)[0],bytes=fs.readFileSync(file),record=JSON.parse(bytes);
 record.watch.registeredAt--;fs.writeFileSync(file,JSON.stringify(record));assert.throws(()=>read(root),/校验/);
 fs.writeFileSync(file,bytes);fs.chmodSync(file,0o644);assert.throws(()=>read(root),/校验/);
 fs.chmodSync(file,0o600);fs.writeFileSync(file,'x'.repeat(2049));assert.throws(()=>read(root),/校验/);
}));
test('symbol capacity keeps existing intents reusable and provider switches independent',()=>temporary(root=>{
 for(let i=0;i<100;i++)assert.equal(register(root,intent({symbol:String(600000+i)})).registered,true);
 assert.equal(register(root,intent({symbol:'600100'})).reason,'WATCH_SYMBOL_CAPACITY');
 assert.equal(register(root,intent({symbol:'600000',provider:'tencent'})).registered,true);
 assert.equal(register(root,intent({symbol:'600000'})).reused,true);
 assert.equal(read(root).counts.symbols,100);assert.equal(read(root).counts.watches,101);
}));
test('1000 immutable history records stop processing while retaining watches and completed evidence',async()=>temporary(async root=>{
 for(let i=0;i<20;i++)register(root,intent({symbol:String(600001+i)}));
 const due=t('2026-01-05T16:10:00');
 await call(root,due,async job=>{const r=capture(due);r.stock.symbol=job.symbol;return r;});
 const state=read(root),template=state.completed[0],watch=state.watches,
  order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?
   Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x,
  encode=x=>JSON.stringify(order(x)),hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
 let previous=template.recordHash;
 for(let i=1;i<1000;i++){
  const w=watch[i%20],date=new Date(Date.parse('2026-01-06')+Math.floor(i/20)*86400000).toISOString().slice(0,10),
   next=new Date(Date.parse(date)+86400000).toISOString().slice(0,10),time=t(date+'T16:10:00'),
   {recordHash,...event}=structuredClone(template);
  event.sequence=i+1;event.previousHash=previous;event.watchId=w.id;
  event.id=hash([w.id,date]);event.job={...template.job,symbol:w.symbol,provider:w.provider,
   registeredAt:w.registeredAt,targetDate:date,nextSessionDate:next,dueAt:time,nextSessionOpenAt:t(next+'T09:30:00')};
  event.startedAt=time;event.completedAt=time;event.proof={...event.proof,symbol:w.symbol,
   targetDate:date,observedAt:time,retrievedAt:time,bar:{...event.proof.bar,date,knownAt:t(date+'T15:11:00')}};
  const record={...event,recordHash:hash(event)};previous=record.recordHash;
  fs.writeFileSync(path.join(root,'history',String(i+1).padStart(6,'0')+'.json'),encode(record),{flag:'wx',mode:0o600});
 }
 assert.equal(read(root).counts.attempts,1000);let calls=0;
 const result=await call(root,t('2026-03-02T16:10:00'),async()=>{calls++;return capture();});
 assert.equal(result.status,'watch-history-capacity');assert.equal(calls,0);
 assert.equal(register(root,intent()).reused,true);assert.equal(read(root).counts.watches,20);
}));
test('aggregate temporary bytes count toward 16MiB and never trigger capture when over capacity',async()=>temporary(async root=>{
 register(root,intent());
 // Crash leftovers are bounded and counted, even though they are not intents.
 const content=Buffer.alloc(8192,32);
 for(let i=0;i<2048;i++)fs.writeFileSync(path.join(root,'history',
  String(i+1).padStart(6,'0')+'.json.0123456789abcdef.tmp'),content,{mode:0o600});
 assert.throws(()=>read(root),/校验/);let calls=0;
 await assert.rejects(call(root,t('2026-01-05T16:10:00'),async()=>{calls++;return capture();}),/校验/);
 assert.equal(calls,0);
}));
test('crash temporary files do not become intent, serial guard releases and failures hide raw errors',async()=>temporary(async root=>{
 register(root,intent());const tmp=path.join(root,'history','000001.json.0123456789abcdef.tmp');
 fs.writeFileSync(tmp,'unfinished',{mode:0o600});let release,ready;
 const gate=new Promise(r=>release=r),entered=new Promise(r=>ready=r),now=t('2026-01-05T16:10:00');
 const first=call(root,now,async()=>{ready();await gate;throw Error(root+'/secret');});await entered;
 assert.equal((await call(root,now)).running,true);release();
 assert.equal((await first).results[0].reason,'CAPTURE_ERROR');
 assert.equal(JSON.stringify(read(root)).includes(root),false);
 const next=now+20*60000;
 assert.equal((await call(root,next,async()=>capture(next))).results[0].status,'completed');
 assert.equal(read(root).counts.attempts,2);
}));
test('publisher cleanup between directory listing and lstat only permits exact temporary names to disappear',()=>{
 const disappearDuringScan=(dir,file,action)=>{
  const original=fs.readdirSync;let removed=false;
  fs.readdirSync=function(input,...args){const names=original.call(this,input,...args);
   if(String(input)===dir&&names.includes(path.basename(file))){fs.unlinkSync(file);removed=true;}
   return names;
  };
  try{action();assert.equal(removed,true);}finally{fs.readdirSync=original;}
 };
 temporary(root=>{
  register(root,intent());const dir=path.join(root,'history'),file=path.join(dir,'000001.json.0123456789abcdef.tmp');
  fs.writeFileSync(file,'stage',{mode:0o600});
  disappearDuringScan(dir,file,()=>{assert.equal(read(root).counts.watches,1);assert.equal(read(root).counts.attempts,0);});
 });
 temporary(root=>{
  register(root,intent());const [file]=records(root);
  disappearDuringScan(path.dirname(file),file,()=>assert.throws(()=>read(root),/校验/));
 });
 temporary(root=>{
  register(root,intent());const dir=path.join(root,'history'),file=path.join(dir,'000001.json.invalid.tmp');
  fs.writeFileSync(file,'invalid stage',{mode:0o600});
  disappearDuringScan(dir,file,()=>assert.throws(()=>read(root),/校验/));
 });
});
test('surviving temporary files retain strict permissions and individual size limits',()=>temporary(root=>{
 register(root,intent());const file=path.join(root,'history','000001.json.0123456789abcdef.tmp');
 fs.writeFileSync(file,'stage',{mode:0o600});fs.chmodSync(file,0o644);
 assert.throws(()=>read(root),/校验/);fs.chmodSync(file,0o600);
 fs.writeFileSync(file,'x'.repeat(8193));assert.throws(()=>read(root),/校验/);
}));
test('parent-first publication between collection scans produces a consistent snapshot; real orphan history still rejects',async()=>temporary(async root=>{
 register(root,intent());const now=t('2026-01-05T16:10:00');await call(root,now);
 register(root,intent({symbol:'600002'}));
 await call(root,now,async job=>{const r=capture(now);r.stock.symbol=job.symbol;return r;});
 const wdir=path.join(root,'watches'),hdir=path.join(root,'history'),
  parent=path.join(wdir,'000002.json'),child=path.join(hdir,'000002.json'),
  parentBytes=fs.readFileSync(parent),childBytes=fs.readFileSync(child);
 // Restore the earlier valid fixture, then publish the already-validated
 // parent/child pair in the same order as independent live writers.
 fs.unlinkSync(child);fs.unlinkSync(parent);
 const original=fs.readdirSync;let published=false,first;
 fs.readdirSync=function(input,...args){const names=original.call(this,input,...args);
  if(!published&&[wdir,hdir].includes(String(input))){
   published=true;first=String(input);
   fs.writeFileSync(parent,parentBytes,{flag:'wx',mode:0o600});
   fs.writeFileSync(child,childBytes,{flag:'wx',mode:0o600});
  }
  return names;
 };
 try{
  const snapshot=read(root);assert.equal(published,true);assert.equal(first,hdir);
  assert.equal(snapshot.counts.watches,2);assert.equal(snapshot.counts.completed,1);
 }finally{fs.readdirSync=original;}
 assert.equal(read(root).counts.completed,2);
 fs.unlinkSync(parent);assert.throws(()=>read(root),/校验/);
}));
async function concurrentCompletion(root){
 register(root,intent());const modulePath=require.resolve('../src/core/stock-research-watchlist'),
  now=t('2026-01-05T16:10:00'),barrier=path.join(os.tmpdir(),'watch-barrier-'+crypto.randomBytes(8).toString('hex'));
 const script=`const fs=require('node:fs'),m=require(${JSON.stringify(modulePath)});m.processResearchWatchlist(process.argv[1],{now:${now},readCalendar:()=>(${JSON.stringify(calendar())}),capture:async()=>{process.stdout.write('ready\\n');while(!fs.existsSync(process.argv[2]))await new Promise(r=>setTimeout(r,10));return ${JSON.stringify(capture())};}}).then(r=>process.stdout.write(JSON.stringify(r)+'\\n')).catch(e=>{process.stderr.write(e.message);process.exitCode=1;});`;
 const workers=[];
 for(let i=0;i<2;i++){
  const child=spawn(process.execPath,['-e',script,root,barrier],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('ready\n'))resolveReady();});
  child.stderr.on('data',data=>stderr+=data);child.on('error',rejectReady);
  const done=new Promise((resolve,reject)=>child.on('exit',code=>{
   if(!stdout.includes('ready\n'))rejectReady(Error(stderr||'no ready'));
   code?reject(Error(stderr||'child failed')):resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
  }));done.catch(()=>{});workers.push({child,ready,done});
 }
 let timer;try{
  await Promise.race([Promise.all(workers.map(w=>w.ready)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),10000);})]);
  fs.writeFileSync(barrier,'go');const results=await Promise.all(workers.map(w=>w.done));
  assert.equal(results.filter(r=>r.results[0].published).length,1);assert.equal(read(root).counts.completed,1);
  assert.equal(read(root).counts.attempts,1);
 }finally{clearTimeout(timer);try{fs.unlinkSync(barrier);}catch{}for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill();}
}
test('two processes can fetch twice but CAS stores one immutable session completion across 20 publication races',async()=>{
 for(let round=0;round<20;round++)await temporary(concurrentCompletion);
});
