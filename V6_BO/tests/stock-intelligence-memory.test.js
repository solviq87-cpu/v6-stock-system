'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {analyzeStockHistory,appendSnapshot,readStockMemory}=require('../src/core/stock-intelligence-memory');
function fixture(n=130){
 const dates=Array.from({length:n+2},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
 let close=10;const bars=dates.slice(0,n).map((date,i)=>{
  const previous=close;close=+(close*(i%9===0?.98:1.008)).toFixed(4);
  return {date,open:previous,high:Math.max(previous,close)+.01,low:Math.min(previous,close)-.01,close,volume:10000,knownAt:Date.parse(date+'T15:01:00+08:00'),statusKnownAt:date+'T09:00:00+08:00',suspended:false,tradable:true,isST:false,corporateAction:false,limitReferencePrice:previous,limitUpPrice:+(previous*1.1).toFixed(2),limitKnownAt:date+'T09:00:00+08:00',noPriceLimit:false};
 });
 const asOf=Date.parse(dates[n-1]+'T16:00:00+08:00');return {stock:{symbol:'600001',name:'研究样本',source:'imported-test',priceBasis:'unadjusted',observedAt:asOf,bars},tradeDates:dates,asOf};
}
function analyze(f,extra={}){return analyzeStockHistory(f.stock,{tradeDates:f.tradeDates,asOf:f.asOf,...extra});}
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stock-intelligence-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('empirical direction and explicit limit labels carry counts, uncertainty and rolling baseline evaluation',()=>{
 const f=fixture(),r=analyze(f);assert.ok(r.direction.samples>=20);assert.ok(r.direction.probability>.5);assert.ok(r.direction.confidenceInterval[0]<r.direction.probability);assert.ok(r.direction.confidenceInterval[1]>r.direction.probability);
 assert.equal(r.limitUp.wins,0);assert.equal(r.limitUp.samples,r.direction.samples);assert.ok(r.limitUp.probability>0&&r.limitUp.probability<.1);
 assert.ok(r.direction.outOfSample.evaluated>0);assert.ok(Number.isFinite(r.direction.outOfSample.brier));assert.ok(Number.isFinite(r.direction.outOfSample.baselineBrier));assert.equal(r.canTrade,false);assert.equal(r.patterns.symbol,'600001');
});
test('changing future observations cannot change a prefix forecast and late-known/unclosed rows are excluded',()=>{
 const f=fixture(),prefix=fixture(80),first=analyze(prefix);
 f.stock.observedAt=prefix.asOf;for(let i=80;i<f.stock.bars.length;i++){const b=f.stock.bars[i];b.close*=2;b.high=Math.max(b.close,b.open)+1;}
 const replay=analyze(f,{asOf:prefix.asOf});assert.deepEqual(replay.direction,first.direction);assert.deepEqual(replay.limitUp,first.limitUp);
 const late=fixture();late.stock.bars.at(-1).knownAt=late.asOf+1;assert.equal(analyze(late).coverage.closedKnown,129);
 const intraday=fixture();intraday.asOf=Date.parse(intraday.stock.bars.at(-1).date+'T14:30:00+08:00');intraday.stock.observedAt=intraday.asOf;assert.equal(analyze(intraday).coverage.closedKnown,129);
});
test('missing status/knownAt/basis and absent explicit limit metadata never manufacture probabilities',()=>{
 for(const field of ['knownAt','statusKnownAt','suspended','tradable','isST','corporateAction']){const f=fixture();for(const b of f.stock.bars)delete b[field];assert.equal(analyze(f).direction.probability,null,field);}
 const f=fixture();delete f.stock.priceBasis;assert.equal(analyze(f).direction.probability,null);
 const noLimits=fixture();for(const b of noLimits.stock.bars)delete b.limitReferencePrice;assert.ok(analyze(noLimits).direction.probability!==null);assert.equal(analyze(noLimits).limitUp.probability,null);
 const adjusted=fixture();adjusted.stock.priceBasis='forward-adjusted';assert.equal(analyze(adjusted).limitUp.probability,null);
 const few=fixture(30);assert.equal(analyze(few).direction.probability,null);
 const unknownLimit=fixture();for(const b of unknownLimit.stock.bars)delete b.noPriceLimit;assert.equal(analyze(unknownLimit).limitUp.probability,null);
 for(const value of [0,-1,'1969-12-31T23:59:59Z']){
  const status=fixture();for(const b of status.stock.bars)b.statusKnownAt=value;assert.equal(analyze(status).direction.probability,null);
  const limits=fixture();for(const b of limits.stock.bars)b.limitKnownAt=value;assert.equal(analyze(limits).limitUp.probability,null);
 }
 const beforeReceipt=fixture();beforeReceipt.stock.observedAt=Date.parse(beforeReceipt.stock.bars.at(-1).date+'T15:00:00+08:00');assert.equal(analyze(beforeReceipt).coverage.closedKnown,129);
 const futureReceipt=fixture();futureReceipt.stock.observedAt=futureReceipt.asOf+1;assert.equal(analyze(futureReceipt).coverage.closedKnown,0);
});
test('explicit calendar gaps, duplicate dates, mixed price bases and corporate actions cannot create comparable samples',()=>{
 const duplicate=fixture();duplicate.stock.bars[10].date=duplicate.stock.bars[9].date;assert.throws(()=>analyze(duplicate),/重复/);
 const mismatch=fixture();mismatch.tradeDates.splice(10,1);assert.throws(()=>analyze(mismatch),/交易日历/);
 const mixed=fixture();mixed.stock.bars[20].priceBasis='adjusted';assert.throws(()=>analyze(mixed),/口径/);
 const gap=fixture();gap.stock.bars=gap.stock.bars.filter((_,i)=>i%10!==0);assert.equal(analyze(gap).direction.probability,null);
 const actions=fixture();for(const b of actions.stock.bars)b.corporateAction={split:2};assert.equal(analyze(actions).direction.probability,null);
 const suspended=fixture();for(const b of suspended.stock.bars)b.suspended=true;assert.equal(analyze(suspended).direction.probability,null);
});
test('private immutable revisions are idempotent, corrections retained, historical forecasts never become prospective',()=>temp(root=>{
 const f=fixture(),forecast=analyze(f),args={stock:f.stock,forecast,decisionAt:f.asOf,context:{market:{status:'unknown'}}};
 const first=appendSnapshot(root,args),again=appendSnapshot(root,args);assert.equal(first.revision,1);assert.equal(again.reused,true);
 assert.equal(fs.statSync(path.join(root,'600001')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(root,'600001','000001.json')).mode&0o777,0o600);
 const corrected=structuredClone(f);corrected.stock.bars[25].close+=.001;const second=appendSnapshot(root,{stock:corrected.stock,forecast:analyze(corrected),decisionAt:f.asOf});assert.equal(second.revision,2);
 const result=readStockMemory(root,'600001');assert.equal(result.totalRevisions,2);assert.equal(result.revisions[0].eventHash,first.eventHash);assert.equal(result.frozenPredictionOutcomes.length,0);assert.equal(result.forwardValidation.direction.brier,null);
 const bad=structuredClone(forecast);bad.direction.probability=.999;assert.throws(()=>appendSnapshot(root,{...args,forecast:bad}),/不一致/);
 assert.equal(readStockMemory(root,'600001',{asOf:f.asOf}).totalRevisions,0);assert.equal(readStockMemory(root,'600001',{limit:1}).revisions.length,1);
}));
test('tampering, symlink traversal, unexpected files and future appends fail closed',()=>temp(root=>{
 const f=fixture(),args={stock:f.stock,forecast:analyze(f),decisionAt:f.asOf};appendSnapshot(root,args);
 const file=path.join(root,'600001','000001.json'),original=fs.readFileSync(file,'utf8');const record=JSON.parse(original);record.stock.bars[0].close=999;fs.writeFileSync(file,JSON.stringify(record));assert.throws(()=>readStockMemory(root,'600001'),/完整性/);assert.throws(()=>appendSnapshot(root,args),/完整性/);fs.writeFileSync(file,original);
 const unexpected=path.join(root,'600001','unrecognized.tmp');fs.writeFileSync(unexpected,'');assert.throws(()=>readStockMemory(root,'600001'),/损坏/);assert.throws(()=>appendSnapshot(root,args),/损坏/);fs.unlinkSync(unexpected);
 const alias=path.join(root,'alias');fs.symlinkSync(root,alias);assert.throws(()=>readStockMemory(alias,'600001'),/符号/);
 assert.throws(()=>appendSnapshot(root,{...args,decisionAt:Date.now()+60000}),/未来/);assert.throws(()=>readStockMemory(root,'../600001'));
 assert.throws(()=>readStockMemory(path.join(root,'public'),'600001'),/公开/);
}));
test('only subsequently appended outcomes score frozen predictions, and corrections cannot rewrite the first score',t=>temp(root=>{
 const f=fixture(),forecast=analyze(f);let clock=f.asOf;t.mock.method(Date,'now',()=>clock);
 appendSnapshot(root,{stock:f.stock,forecast,decisionAt:clock});assert.equal(readStockMemory(root,'600001').frozenPredictionOutcomes.length,0);
 clock+=1000;appendSnapshot(root,{stock:f.stock,forecast,decisionAt:f.asOf,context:{note:'same prediction, additional context'}});
 const next=fixture(131);clock=next.asOf;appendSnapshot(root,{stock:next.stock,decisionAt:clock});
 const read=readStockMemory(root,'600001'),direction=read.frozenPredictionOutcomes.find(o=>o.kind==='direction');assert.ok(direction);assert.equal(direction.probability,forecast.direction.probability);assert.equal(direction.outcome,1);assert.equal(direction.brier,(forecast.direction.probability-1)**2);assert.equal(read.forwardValidation.direction.evaluated,1);assert.equal(read.forwardValidation.limitUp.evaluated,1);assert.equal(read.totalRevisions,3);assert.equal(direction.revision,1);
 const correction=structuredClone(next);correction.stock.bars.at(-1).close*=.9;correction.stock.bars.at(-1).low=correction.stock.bars.at(-1).close-.1;clock+=1000;correction.stock.observedAt=clock;appendSnapshot(root,{stock:correction.stock,decisionAt:clock});
 assert.deepEqual(readStockMemory(root,'600001').frozenPredictionOutcomes,read.frozenPredictionOutcomes);
}));

test('dated causal amount survives normalization for patterns without importing current board identity',()=>temp(root=>{
 const f=fixture(30),last=f.stock.bars.at(-1),previous=f.stock.bars.at(-2);
 for(const b of f.stock.bars)b.amount=100000000;
 Object.assign(last,{market:'main',limitPct:10,ipoNoLimit:false});
 Object.assign(last,{open:previous.close,close:previous.close*1.08,high:previous.close*1.08+.01,low:previous.close-.01,volume:30000,amount:300000000});
 Object.assign(f.stock,{market:'main',limitPct:10,isST:false,noPriceLimit:false,ipoNoLimit:false});
 const result=analyze(f),check=id=>result.patterns.checks.find(c=>c.id===id);
 assert.equal(check('breakout20_liquid').status,'matched');
 assert.equal(check('limit_up_shakeout_main').status,'insufficient_data','current board identity must not fill missing historical evidence');
 appendSnapshot(root,{stock:f.stock,forecast:result,decisionAt:f.asOf});
 const saved=readStockMemory(root,'600001').revisions[0].stock;
 assert.equal(saved.bars.at(-1).amount,300000000);assert.equal(saved.bars.at(-1).market,'main');assert.equal(saved.bars.at(-1).limitPct,10);assert.equal(saved.bars.at(-1).ipoNoLimit,false);assert.equal(saved.bars[0].market,undefined);assert.equal(saved.market,undefined);
 const unknown=structuredClone(f);unknown.stock.bars.at(-1).amount=null;
 assert.equal(analyze(unknown).patterns.checks.find(c=>c.id==='breakout20_liquid').status,'insufficient_data');
 const future=structuredClone(f);future.stock.bars.at(-1).knownAt=future.asOf+1;
 assert.equal(analyze(future).patterns.checks.find(c=>c.id==='breakout20_liquid').status,'not_matched');
 for(const bad of [-1,'300000000',Infinity]){const invalid=structuredClone(f);invalid.stock.bars.at(-1).amount=bad;assert.throws(()=>analyze(invalid),/成交额/);}
}));

test('publication CAS prevents forks and a killed writer cannot lock or hide committed history',{timeout:15000},async t=>{
 const {spawn}=require('node:child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-memory-cas-')),children=[];
 t.after(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});});
 const f=fixture(),args={stock:f.stock,forecast:analyze(f),decisionAt:f.asOf};appendSnapshot(root,args);
 const input=path.join(root,'worker-input.json');fs.writeFileSync(input,JSON.stringify(args));
 const moduleFile=require.resolve('../src/core/stock-intelligence-memory');
 const script=`const fs=require('node:fs'),{appendSnapshot}=require(${JSON.stringify(moduleFile)});
 const [root,input,barrier,id]=process.argv.slice(1),args=JSON.parse(fs.readFileSync(input,'utf8'));
 const publish=fs.linkSync;fs.linkSync=(a,b)=>{process.send({type:'ready'});const until=Date.now()+6000;while(!fs.existsSync(barrier)){if(Date.now()>until)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return publish(a,b);};
 try{const result=appendSnapshot(root,{...args,context:{worker:id}});process.send({type:'done',ok:true,revision:result.revision});}catch(error){process.send({type:'done',ok:false,code:error.code,message:error.message});}process.disconnect();`;
 function worker(id,barrier){
  const child=spawn(process.execPath,['-e',script,root,input,barrier,id],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
  let readyResolve,readyReject,doneResolve,doneReject,errors='';
  const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}),done=new Promise((a,b)=>{doneResolve=a;doneReject=b;});
  child.stderr.on('data',chunk=>errors+=chunk);child.on('message',m=>{if(m.type==='ready')readyResolve();else if(m.type==='done')doneResolve(m);});
  child.on('error',error=>{readyReject(error);doneReject(error);});
  child.on('exit',code=>{if(code){const error=Error(errors||'worker failed '+code);readyReject(error);doneReject(error);}});
  return {child,ready,done};
 }
 const barrier=path.join(root,'publish-now'),first=worker('first',barrier),second=worker('second',barrier);
 await Promise.all([first.ready,second.ready]);fs.writeFileSync(barrier,'go');
 const results=await Promise.all([first.done,second.done]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'EEXIST');
 assert.equal(readStockMemory(root,'600001').totalRevisions,2);
 const crashed=worker('crashed',path.join(root,'never-publish'));crashed.done.catch(()=>{});await crashed.ready;
 const stopped=new Promise(resolve=>crashed.child.once('exit',resolve));crashed.child.kill('SIGKILL');await stopped;
 assert.ok(fs.readdirSync(path.join(root,'600001')).some(n=>/^000003\.json\.[a-f0-9]{16}\.tmp$/.test(n)));
 assert.equal(readStockMemory(root,'600001').totalRevisions,2);
 // A legacy empty lock from an older interrupted writer is no longer an authority.
 fs.writeFileSync(path.join(root,'600001','.lock'),'');
 assert.equal(appendSnapshot(root,{...args,context:{recovered:true}}).revision,3);
 const recovered=readStockMemory(root,'600001');assert.equal(recovered.totalRevisions,3);assert.equal(recovered.revisions[2].previousHash,recovered.revisions[1].eventHash);
});
test('raw history without availability/status metadata is retained, while unsafe provenance cannot be stored',()=>temp(root=>{
 const f=fixture();for(const b of f.stock.bars){delete b.knownAt;delete b.statusKnownAt;delete b.tradable;}
 const forecast=analyze(f);assert.equal(forecast.direction.probability,null);appendSnapshot(root,{stock:f.stock,forecast,decisionAt:f.asOf});assert.equal(readStockMemory(root,'600001').revisions[0].stock.bars.length,130);
 const mixed=structuredClone(f);mixed.stock.bars[0].priceBasis='adjusted';assert.throws(()=>appendSnapshot(root,{stock:mixed.stock,decisionAt:f.asOf}),/口径/);
 const provider=structuredClone(f);provider.stock.bars[0].source='another-provider';assert.throws(()=>appendSnapshot(root,{stock:provider.stock,decisionAt:f.asOf}),/提供者/);
}));
