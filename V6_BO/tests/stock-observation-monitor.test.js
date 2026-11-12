'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createStockObservationMonitor}=require('../src/core/stock-observation-monitor');
const {enqueueStockObservation}=require('../src/core/stock-observation-queue');
const success=()=>({status:'captured',observation:{revision:1,observationHash:'a'.repeat(64)},history:{provider:'tencent',rawHash:'b'.repeat(64)}});
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-monitor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('durable intent survives monitor recreation and a completed capture is never fetched again',async t=>{
 const root=setup(t),decisionAt=Date.now();enqueueStockObservation(root,{symbol:'600000',decisionAt,trigger:'push-attempt'});
 let calls=0;const first=createStockObservationMonitor({queueRoot:root},{capture:async()=>{calls++;return success();}});
 assert.equal((await first.runOnce()).processed,1);assert.equal(first.status().queue.counts.completed,1);assert.equal(calls,1);
 const restarted=createStockObservationMonitor({queueRoot:root},{capture:async()=>{calls++;return success();}});
 assert.equal((await restarted.runOnce()).processed,0);assert.equal(calls,1);assert.equal(restarted.status().canTrade,false);
});
test('monitor coalesces concurrent wakes, and stop waits for its active capture',async t=>{
 const root=setup(t);enqueueStockObservation(root,{symbol:'600000',decisionAt:Date.now(),trigger:'push-attempt'});
 let release,calls=0,stopped=false;
 const monitor=createStockObservationMonitor({queueRoot:root},{capture:()=>{calls++;return new Promise(resolve=>{release=()=>resolve(success());});}});
 const one=monitor.runOnce(),two=monitor.runOnce();assert.equal(one,two);assert.equal(calls,1);
 const stop=monitor.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);release();await stop;
 assert.equal(stopped,true);assert.equal(monitor.status().inFlight,false);assert.equal(monitor.status().queue.counts.completed,1);
});
test('production push observer is admitted after gates and observer failure cannot change delivery',async()=>{
 const src=fs.readFileSync(require.resolve('../server'),'utf8'),start=src.indexOf('function pushAll('),end=src.indexOf('\n}\n',start)+2;
 for(const mode of ['allowed','throw','replica','quota','quiet','disabled']){
  const logs=[],observed=[];
  const ctx={process:{env:{V6_AUTO_STOCK_OBSERVATIONS:mode==='disabled'?'0':'1'}},S:{config:{qqMail:{}}},redactSecrets:v=>v,extractStockCodes:()=>['600000'],
   inManualPush:()=>false,isReplica:()=>mode==='replica',msgGate:()=>({ok:mode!=='quota',kind:'fixture',why:'fixture'}),MSG_STAT:{blocked:0},
   inQuietHours:()=>mode==='quiet',quietWindow:()=>({start:0,end:360}),_hhmm:v=>v,sseSend(){},sseSendEdit(){},
   queuePushedStockObservations:(text,codes)=>{observed.push({text,codes});if(mode==='throw')throw Error('fixture disk full');},
   mailReady:()=>true,feishuReady:()=>true,feishuSend:(_text,cb)=>cb(true,'fixture receipt'),sendResultUnknown:()=>false,
   sendQQMail:()=>Promise.resolve(),pushLog:(status,text,extra)=>logs.push({status,text,extra}),_pushLast:null,console:{log(){},error(){}}};
  vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);ctx.pushAll('600000 fixture stock',false,{public:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observed.length,['allowed','throw'].includes(mode)?1:0,mode);
  if(['allowed','throw','disabled'].includes(mode)){assert.equal(ctx._pushLast.sent,true,mode);assert.ok(logs.some(l=>l.status.startsWith('✅')),mode);}
 }
});
