'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const filename=path.join(__dirname,'../src/server/advanced-account-risk-job.js');
const source=fs.readFileSync(filename,'utf8');
function runtime({response='message',timeout=false}={}){
 const inputs=[],terminations=[];
 class Worker extends EventEmitter{
  constructor(file,options){
   super();inputs.push(options);
   if(response==='message')queueMicrotask(()=>this.emit('message',{mode:'advanced-account-risk-readonly',status:'observed',accounts:[],canTrade:false,writesAccount:false}));
   else if(response==='error')queueMicrotask(()=>this.emit('error',Error('private-path-and-secret')));
  }
  async terminate(){terminations.push(true);}
 }
 const module={exports:{}};
 const realRequire=require('node:module').createRequire(filename);
 new Function('module','exports','__filename','require','setTimeout','clearTimeout',source)(
  module,module.exports,filename,name=>name==='node:worker_threads'?{Worker,isMainThread:true}:realRequire(name),
  timeout?fn=>{queueMicrotask(fn);return 1;}:setTimeout,timeout?()=>{}:clearTimeout);
 return {run:module.exports.runAdvancedAccountRiskJob,inputs,terminations};
}
function context(){const requestAt=Date.now();return {root:path.resolve('/tmp/fayo-worker-budget'),requestAt,day:aShareCalendarDate(requestAt),marketOpen:true,continuous:true,replica:false,quotes:{}};}
function row(){const now=Date.now();return {quote:{code:'600000',price:10,quoteAt:now,receivedAt:now,quoteSource:'source',canTrade:true},limitDown:false,suspended:false};}
test('invalid and oversized quote contexts never start a worker or clone ignored fields',async()=>{
 const x=runtime(),normal=context();
 for(const bad of [
  {...normal,requestAt:Date.now()+60000},
  {...normal,requestAt:Date.now()-6000},
  {...normal,day:'2000-01-01'},
  {...normal,historyRoot:'relative-history'},
  {...normal,marketOpen:false,continuous:true},
  {...normal,quotes:{'600000':{...row(),quote:{...row().quote,quoteMode:'x'.repeat(100000)}}}},
  {...normal,quotes:Object.fromEntries(Array.from({length:221},(_,i)=>[String(600000+i),row()]))},
 ])assert.equal((await x.run(bad)).status,'invalid-context');
 assert.equal(x.inputs.length,0);
 const raw=row();raw.quote.mode='research-only';raw.extra='unrelated-large-blob'.repeat(10000);
 const result=await x.run({...context(),quotes:{'600000':raw},unrelated:'private-secret'.repeat(10000)});
 assert.equal(result.status,'observed');assert.equal(x.inputs.length,1);
 const input=x.inputs[0].workerData.input;
 assert.equal(input.quotes['600000'].quote.mode,'research-only','restriction-bearing provenance must survive projection');
 assert.equal(Object.hasOwn(input,'unrelated'),false);assert.equal(Object.hasOwn(input.quotes['600000'],'extra'),false);
 assert.ok(Buffer.byteLength(JSON.stringify(input))<2000);
});
function workerRead(input,{history,advance=0,historyError=false}={}){
 const calls=[],messages=[],accountOptions=[];let clock=input.requestAt;
 const book={account:{positions:{'600000':{quantity:100}}}};
 const module={exports:{}},realRequire=require('node:module').createRequire(filename);
 const fakeRequire=name=>{
  if(name==='node:worker_threads')return {isMainThread:false,workerData:{kind:'advanced-account-risk-readonly',input},parentPort:{postMessage:result=>messages.push(result)}};
  if(name==='node:fs')return {lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,size:100})};
  if(name==='../core/paper-application-service')return {createPaperApplicationService:options=>{accountOptions.push(options);return {read:()=>book};}};
  if(name==='../core/advanced-account-risk')return {unavailable:(account,reason)=>({account,status:'unknown',reason}),accountExitDiagnostics:(snapshot,options)=>({status:'observed-unverified',...options})};
  if(name==='../core/center-history')return {readCenterHistory:options=>{calls.push(options);clock+=advance;if(historyError)throw Error('private history path');return history;}};
  return realRequire(name);
 };
 class Clock extends Date{static now(){return clock;}}
 new Function('module','exports','__filename','require','setTimeout','clearTimeout','Date',source)(module,module.exports,filename,fakeRequire,setTimeout,clearTimeout,Clock);
 return {calls,messages,accountOptions};
}
test('worker alone reads bounded held/plan history from the server root and rechecks elapsed quote time',()=>{
 const input={...context(),requestAt:Date.parse('2026-11-25T02:00:00Z'),day:'2026-11-25',historyRoot:'/tmp/server-owned-center-history',portfolioContext:{history:{bars:[{source:'caller-forged'}]},plans:{pool:[{code:'600001'},...Array.from({length:30},(_,i)=>({code:String(600002+i)}))],pre:[]}}};
 const history={bars:[{code:'600000',source:'archive-provider',knownAt:input.requestAt-1000,archiveHash:'a'.repeat(64)}],coverage:{governance:{status:'observed-with-source-clock-gaps',captures:1,quarantine:{captures:0,entries:[]}}}};
 const x=workerRead(input,{history,advance:6000});
 assert.equal(x.calls.length,2);assert.equal(x.calls[0].root,input.historyRoot);assert.equal(x.calls[0].now,input.requestAt);
 assert.deepEqual(x.calls[0].codes.slice(0,2),['600000','600001']);assert.equal(x.calls[0].codes.length,20);
 assert.deepEqual(x.calls[1].codes,['600000']);assert.ok(x.accountOptions.every(options=>options.readOnly===true));
 const pool=x.messages[0].accounts[0];assert.equal(pool.portfolioContext.history.bars[0].source,'archive-provider');
 assert.deepEqual(x.messages[0].governance.pool,history.coverage.governance);
 assert.equal(pool.continuous,false);assert.equal(pool.now,input.requestAt+6000);
 assert.equal(input.portfolioContext.history.bars[0].source,'caller-forged','input object is not mutated');
});
test('unavailable history preserves the original account diagnostic without using caller history',()=>{
 const input={...context(),historyRoot:'/tmp/server-owned-center-history',portfolioContext:{history:{bars:[{source:'caller-forged'}]}}};
 const failed=workerRead(input,{historyError:true});
 assert.equal(failed.messages[0].status,'observed');
 assert.equal(failed.messages[0].accounts[0].portfolioContext.history.coverage.reason,'ORIGINAL_HISTORY_READ_UNAVAILABLE');
 assert.doesNotMatch(JSON.stringify(failed.messages),/private history path|caller-forged/);
 const missing=workerRead({...input,historyRoot:undefined});
 assert.equal(missing.calls.length,0);assert.equal(missing.messages[0].accounts[0].portfolioContext.history,undefined);
});
test('portfolio evidence is copied within budget and an oversized optional dataset preserves account-only reads',async()=>{
 const x=runtime(),evidence={history:{bars:[{code:'600000',date:'2026-11-24',close:10,knownAt:Date.now()-1000,archiveHash:'a'.repeat(64)}]},plans:[]};
 assert.equal((await x.run({...context(),portfolioContext:evidence})).status,'observed');
 const copied=x.inputs[0].workerData.input;
 assert.equal(copied.portfolioContextStatus,'bounded');
 assert.equal(copied.portfolioContext.history.bars[0].archiveHash,'a'.repeat(64));
 assert.notEqual(copied.portfolioContext,evidence);
 for(const bad of [
  {history:{bars:Array.from({length:16001},()=>({}))}},
  {history:{bars:[{source:'x'.repeat(2049)}]}},
  {history:{bars:Array.from({length:6000},()=>({source:'x'.repeat(1500)}))}},
 ]){
  assert.equal((await x.run({...context(),portfolioContext:bad})).status,'observed');
  const payload=x.inputs.at(-1).workerData.input;
  assert.equal(payload.portfolioContextStatus,'invalid-or-over-budget');assert.equal(Object.hasOwn(payload,'portfolioContext'),false);
 }
});
test('timeouts and worker errors release the single slot without exposing private paths or errors',async()=>{
 for(const options of [{response:'error'},{response:'none',timeout:true}]){
  const x=runtime(options),first=x.run(context());
  assert.equal((await x.run(context())).status,'busy');
  const result=await first;
  assert.equal(result.status,options.timeout?'timeout':'worker-error');assert.equal(x.terminations.length,1);
  assert.doesNotMatch(JSON.stringify(result),/private-path|secret|fayo-worker-budget/);
  assert.equal((await x.run(context())).status,result.status);assert.equal(x.terminations.length,2);
 }
});
