'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {advancePriceEventResearch:advance,readPriceEventResearch:read,OBJECTIVE}=require('../src/core/price-event-research-agent');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const dates=Array.from({length:90},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)); // Explicit synthetic calendar, not market evidence.
const at=(d,t='16:30:00')=>Date.parse(d+'T'+t+'+08:00');
function input(n=30,{symbol='600000',provider='fixture',source='fixture',decisionAt=at(dates[n-1]),knownAt}={}){
 const bars=dates.slice(0,n).map((date,i)=>({date,open:10+i*.01,close:10.005+i*.01,high:10.02+i*.01,low:9.99+i*.01,volume:10000,knownAt:knownAt??at(date,'16:00:00')}));
 return {stock:{symbol,provider,source,priceBasis:'unadjusted',observedAt:decisionAt,bars},decisionAt,tradeDates:[...dates],observationHash:sha('observation-'+n),evidenceBundleHash:sha('evidence-'+n)};
}
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'price-event-agent-'));let clock=at(dates[29]);t.mock.method(Date,'now',()=>clock);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,setClock:t=>{clock=t;}};}
function files(root){return fs.readdirSync(root,{recursive:true}).filter(n=>/^\d{6}\.json$/.test(path.basename(n))).map(n=>path.join(root,n)).sort();}
test('real freeze then later candle receipt closes the first hypothesis and freezes the next without creating returns',t=>{
 const {root,setClock}=setup(t),first=advance(root,input());
 assert.equal(first.objective,OBJECTIVE);assert.equal(first.currentHypothesis.targetDate,dates[30]);assert.equal(first.currentHypothesis.probabilities,null);assert.equal(first.pendingTargets.length,1);assert.equal(first.forwardValidation.evaluated,0);assert.equal(first.canTrade,false);assert.equal(first.canNotify,false);
 assert.equal(first.currentHypothesis.evidenceBundleHash,sha('evidence-30'));assert.match(first.currentHypothesis.codeFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(first.pendingTargets[0].createdAt,first.currentHypothesis.recordedAt);assert.equal(first.pendingTargets[0].calendarHash,first.currentHypothesis.calendarHash);
 assert.deepEqual(read(root).pendingTargets,first.pendingTargets,'restart scheduling uses actual frozen creation time and calendar hash');
 setClock(at(dates[30]));const next=advance(root,input(31));assert.equal(next.forwardValidation.evaluated,1);assert.equal(next.forwardValidation.independentTargetDays,1);assert.equal(next.forwardValidation.rawCandleMatchFrequency,null);assert.equal(next.currentHypothesis.targetDate,dates[31]);assert.equal(next.pendingTargets.length,1);assert.equal(next.version.stage,'collecting-frozen-outcomes');
 const summary=read(root,{symbol:'600000',provider:'fixture'});assert.equal(summary.streams.length,1);assert.equal(JSON.stringify(summary).includes(root),false);assert.equal(JSON.stringify(summary).includes('priceReturn'),false);assert.equal(fs.statSync(files(root)[0]).mode&0o777,0o600);
});
test('observed turnover and volume reach pattern detection while unknown or future turnover cannot become evidence',t=>{
 const {root}=setup(t),args=input();
 for(const b of args.stock.bars)b.amount=100000000;
 const last=args.stock.bars.at(-1);last.volume=50000;last.amount=300000000;last.close=last.open*1.08;last.high=last.close+.01;last.amountKnownAt=args.decisionAt;
 const known=advance(path.join(root,'known'),args);assert.ok(known.currentHypothesis.matchedPatternIds.includes('breakout20_liquid'));
 const absent=structuredClone(args);delete absent.stock.bars.at(-1).amount;delete absent.stock.bars.at(-1).amountKnownAt;
 const unknown=advance(path.join(root,'unknown'),absent);assert.equal(unknown.currentHypothesis.matchedPatternIds.includes('breakout20_liquid'),false);
 const future=structuredClone(args);future.stock.bars.at(-1).amountKnownAt=args.decisionAt+1;assert.throws(()=>advance(path.join(root,'future'),future),/成交额实际/);
 const invalid=structuredClone(args);invalid.stock.bars.at(-1).amount=-1;assert.throws(()=>advance(path.join(root,'negative'),invalid),/成交额/);
});
test('bootstrap historical download can freeze now but never creates past hypotheses or labels',t=>{
 const {root}=setup(t),args=input(30,{knownAt:at(dates[29])}),r=advance(root,args);
 assert.equal(r.forwardValidation.evaluated,0);assert.equal(r.pendingTargets.length,1);assert.equal(r.currentHypothesis.decisionAt,args.decisionAt);assert.equal(r.currentHypothesis.targetDate,dates[30]);
 const event=JSON.parse(fs.readFileSync(files(root)[0]));assert.equal(event.state.hypotheses.length,1);assert.equal(event.state.outcomes.length,0);
});
test('duplicates are idempotent and subsequent corrected target data cannot rewrite the first score',t=>{
 const {root,setClock}=setup(t);advance(root,input());assert.equal(advance(root,input()).status,'unchanged');assert.equal(files(root).length,1);
 setClock(at(dates[30]));const next=input(31),original=advance(root,next),file=files(root)[1],bytes=fs.readFileSync(file,'utf8');
 setClock(at(dates[30])+60000);const correction=input(31,{decisionAt:at(dates[30])+60000});const b=correction.stock.bars.at(-1);b.close=b.open-.005;b.knownAt=correction.decisionAt;correction.observationHash=sha('corrected');
 const revised=advance(root,correction);assert.deepEqual(revised.forwardValidation,original.forwardValidation);assert.equal(revised.correctionCount,1);assert.equal(revised.currentHypothesis.hypothesisHash,original.currentHypothesis.hypothesisHash);assert.equal(fs.readFileSync(file,'utf8'),bytes);
 assert.equal(advance(root,correction).status,'unchanged');assert.equal(read(root,{asOf:at(dates[30])}).streams[0].correctionCount,0);
});
test('twenty independent prospective target days unlock conditional research statistics only from the matured prefix',t=>{
 const {root,setClock}=setup(t);let r=advance(root,input());
 for(let n=31;n<=50;n++){setClock(at(dates[n-1]));r=advance(root,input(n));if(n<50){assert.equal(r.currentHypothesis.probabilities,null);assert.equal(r.version.number,1);}}
 assert.equal(r.forwardValidation.independentTargetDays,20);assert.equal(r.version.stage,'research-statistics-ready');assert.equal(r.version.number,2);assert.equal(r.currentHypothesis.probabilities.up,1);assert.equal(r.currentHypothesis.probabilities.down,0);assert.equal(r.currentHypothesis.probabilities.flat,0);assert.equal(r.currentHypothesis.trainingOutcomeHashes.length,20);assert.equal(r.currentHypothesis.trainedThrough,dates[49]);assert.equal(r.forwardValidation.brier,null);
 setClock(at(dates[50]));const evaluated=advance(root,input(51));assert.equal(evaluated.forwardValidation.brierEvaluated,1);assert.equal(evaluated.forwardValidation.brier,0);assert.equal(evaluated.version.number,3);assert.equal(evaluated.productionWeightsChanged,false);
});
test('multiple stocks or providers on one date never manufacture independent days or share trained probabilities',t=>{
 const {root,setClock}=setup(t);for(const symbol of ['600000','600001'])advance(root,input(30,{symbol}));advance(root,input(30,{provider:'other'}));
 setClock(at(dates[30]));for(const symbol of ['600000','600001'])advance(root,input(31,{symbol}));advance(root,input(31,{provider:'other'}));
 const r=read(root);assert.equal(r.streams.length,3);assert.equal(r.independentTargetDays,1);for(const s of r.streams){assert.equal(s.forwardValidation.independentTargetDays,1);assert.equal(s.currentHypothesis.probabilities,null);}
});
test('overnight and weekend freezing use the next declared session, while late recording and open-session replays do not',t=>{
 const {root,setClock}=setup(t),args=input();args.tradeDates=[...dates.slice(0,30),'2025-02-03','2025-02-04'];args.decisionAt=at('2025-02-01','03:00:00');args.stock.observedAt=args.decisionAt;setClock(args.decisionAt);
 const r=advance(root,args);assert.equal(r.currentHypothesis.targetDate,'2025-02-03');assert.equal(r.pendingTargets[0].dueAt,at('2025-02-03','16:10:00'));
 const late=input(30,{symbol:'600001'});setClock(late.decisionAt+61000);assert.equal(advance(root,late).currentHypothesis,null);
 const replay=input(30,{symbol:'600002'});setClock(at(dates[60]));assert.equal(advance(root,replay).currentHypothesis,null);
 const opened=input(30,{symbol:'600003',decisionAt:at(dates[30],'09:31:00')});setClock(opened.decisionAt);assert.equal(advance(root,opened).currentHypothesis,null);
});
test('future clocks, mixed sources, adjusted prices, bad evidence and fabricated pre-close availability fail closed',t=>{
 const {root,setClock}=setup(t);
 for(const mutate of [x=>x.decisionAt++,x=>x.stock.observedAt++,x=>x.stock.bars.at(-1).knownAt=x.decisionAt+1,x=>x.stock.bars.at(-1).knownAt=at(dates[29],'14:00:00'),x=>x.stock.bars[0].source='other',x=>x.stock.bars.at(-1).closed=false,x=>x.stock.bars.at(-1).isClosed=false,x=>x.stock.priceBasis='forward-adjusted',x=>x.evidenceBundleHash='not-hash',x=>x.tradeDates[3]=x.tradeDates[2]]){const a=input();mutate(a);assert.throws(()=>advance(root,a));}
 advance(root,input());setClock(at(dates[30]));assert.throws(()=>advance(root,input(31,{source:'other'})),/来源/);
 const empty=path.join(root,'absent');assert.equal(read(empty).status,'empty');assert.equal(fs.existsSync(empty),false);
});
test('first target observation must be closed and actually received after the frozen decision',t=>{
 const {root,setClock}=setup(t);advance(root,input());
 const pre=input(31,{decisionAt:at(dates[30],'15:30:00')});pre.stock.bars.at(-1).knownAt=at(dates[30],'15:10:00');setClock(pre.decisionAt);assert.equal(advance(root,pre).forwardValidation.evaluated,0);
 setClock(at(dates[30]));assert.equal(advance(root,input(31)).forwardValidation.evaluated,1);
});
test('private paths, corrupt hashes, symlinks and bounded CAS failure preserve the existing history',t=>{
 const {root,setClock}=setup(t);assert.throws(()=>advance(path.join(root,'public'),input()),/公开/);advance(root,input());
 const [file]=files(root),bytes=fs.readFileSync(file,'utf8');const event=JSON.parse(bytes);event.state.hypotheses[0].prediction='down';fs.writeFileSync(file,JSON.stringify(event));assert.throws(()=>read(root),/完整性/);fs.writeFileSync(file,bytes);
 const alias=path.join(os.tmpdir(),'price-event-alias-'+crypto.randomBytes(8).toString('hex'));fs.symlinkSync(root,alias);try{assert.throws(()=>read(alias),/类型/);}finally{fs.unlinkSync(alias);}
 setClock(at(dates[30]));const original=fs.linkSync;let calls=0;fs.linkSync=()=>{calls++;const error=Error('CAS');error.code='EEXIST';throw error;};try{assert.throws(()=>advance(root,input(31)),/并发/);assert.equal(calls,5);}finally{fs.linkSync=original;}
 assert.equal(files(root).length,1);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(advance(root,input(31)).forwardValidation.evaluated,1);
});
test('two real processes racing the same freeze publish one hypothesis and a single chain revision',{timeout:15000},async t=>{
 const {spawn}=require('node:child_process'),{root}=setup(t),store=path.join(root,'store'),barrier=path.join(root,'publish');
 const modulePath=require.resolve('../src/core/price-event-research-agent'),args=input(),children=[];
 t.after(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 const script=`const fs=require('node:fs');Date.now=()=>Number(process.argv[2]);const {advancePriceEventResearch}=require(${JSON.stringify(modulePath)}),link=fs.linkSync;
 fs.linkSync=(...args)=>{process.send({ready:true});const deadline=performance.now()+6000;while(!fs.existsSync(process.argv[4])){if(performance.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return link(...args);};
 try{process.send({result:advancePriceEventResearch(process.argv[3],JSON.parse(process.argv[1]))});}catch(error){process.send({error:error.message});process.exitCode=1;}process.disconnect();`;
 function start(){
  const child=spawn(process.execPath,['-e',script,JSON.stringify(args),String(args.decisionAt),store,barrier],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
  let readyResolve,readyReject,doneResolve,doneReject,stderr='';const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}),done=new Promise((a,b)=>{doneResolve=a;doneReject=b;});
  child.stderr.on('data',v=>stderr+=v);child.on('message',m=>{if(m.ready)readyResolve();if(m.result)doneResolve(m.result);if(m.error){readyReject(Error(m.error));doneReject(Error(m.error));}});
  child.on('error',e=>{readyReject(e);doneReject(e);});child.on('exit',code=>{if(code){readyReject(Error(stderr));doneReject(Error(stderr));}});return {ready,done};
 }
 const a=start(),b=start();await Promise.all([a.ready,b.ready]);fs.writeFileSync(barrier,'publish');const results=await Promise.all([a.done,b.done]);
 assert.deepEqual(results.map(r=>r.status).sort(),['research-observation-recorded','unchanged']);assert.equal(files(store).length,1);const result=read(store);assert.equal(result.pendingTargets.length,1);assert.equal(result.streams[0].revision,1);
});
test('large repeated-state chains read and advance in a bounded heap while historical reads still validate the tail',{timeout:60000},t=>{
 const {spawnSync}=require('node:child_process'),{root,setClock}=setup(t);
 const original=advance(root,input());setClock(at(dates[30]));advance(root,input(31));
 const initial=files(root),dir=path.dirname(initial[0]);let prior=JSON.parse(fs.readFileSync(initial.at(-1),'utf8'));
 const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 const encode=x=>JSON.stringify(canonical(x));let total=initial.reduce((n,f)=>n+fs.statSync(f).size,0);
 // Synthetic source corrections preserve the genuine frozen hypotheses and
 // first score. Each immutable event repeats its growing audit state, as the
 // on-disk protocol does; no padding or altered size limits are needed.
 for(let revision=3;revision<=422;revision++){
  const {eventHash:previousHash,...body}=prior,recordedAt=prior.recordedAt+1;
  for(let j=0;j<2;j++)body.state.corrections.push({hypothesisHash:original.currentHypothesis.hypothesisHash,
   barHash:sha('correction-'+revision+'-'+j),knownAt:recordedAt,observedAt:recordedAt,recordedAt,
   observationHash:sha('source-'+revision+'-'+j),evidenceBundleHash:sha('bundle-'+revision+'-'+j),originalOutcomeUnchanged:true});
  Object.assign(body,{revision,previousHash,recordedAt,decisionAt:recordedAt});
  prior={...body,eventHash:sha(encode(body))};const raw=encode(prior);total+=Buffer.byteLength(raw);
  assert.ok(Buffer.byteLength(raw)<1024*1024);fs.writeFileSync(path.join(dir,String(revision).padStart(6,'0')+'.json'),raw,{mode:0o600});
 }
 assert.ok(total>64*1024*1024&&total<128*1024*1024,'fixture exercises a real large chain inside the protocol quota');
 const modulePath=require.resolve('../src/core/price-event-research-agent'),args=input(32);
 const script=`const assert=require('node:assert/strict');Date.now=()=>Number(process.argv[3]);
 const api=require(${JSON.stringify(modulePath)}),root=process.argv[1];
 assert.equal(api.readPriceEventResearch(root,{asOf:Number(process.argv[4])}).streams[0].revision,1);
 assert.equal(api.readPriceEventResearch(root).streams[0].revision,422);
 const result=api.advancePriceEventResearch(root,JSON.parse(process.argv[2]));
 assert.equal(result.revision,423);assert.equal(result.forwardValidation.evaluated,2);
 assert.equal(result.status,'research-observation-recorded');`;
 const child=spawnSync(process.execPath,['--max-old-space-size=32','-e',script,root,JSON.stringify(args),String(args.decisionAt),String(original.currentHypothesis.recordedAt)],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
 assert.equal(child.status,0,child.stderr||String(child.error||child.signal));
 const last=files(root).at(-1),tail=JSON.parse(fs.readFileSync(last,'utf8'));tail.state.outcomes[0].matched=!tail.state.outcomes[0].matched;
 fs.writeFileSync(last,JSON.stringify(tail));setClock(args.decisionAt);
 assert.throws(()=>read(root,{asOf:original.currentHypothesis.recordedAt}),/完整性/,'a historical selection must not skip a corrupt later revision');
});
