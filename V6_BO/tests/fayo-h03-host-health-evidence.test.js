'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../deploy/windows-host/host-runtime'),'utf8');
function harness({before=true,after=true,sourceMismatch=false,changedRecord=false,changedVersion=false,foreign=false,oldBoot=false,healthy=true}={}){
 const meta={sourceSha:'a'.repeat(40),manifestHash:'b'.repeat(64)};
 const state={pid:1234,startTime:'200',bootId:'boot',exe:'/usr/bin/node',port:8787,sourceSha:sourceMismatch?'c'.repeat(40):meta.sourceSha,mode:'normal'};
 let probes=0,metaReads=0,stateReads=0,checks=0,released=0;
 const ctx={dependencies:()=>({node:{ok:true}}),dependencyGate:()=>{},metadata:()=>{metaReads++;return metaReads>1&&changedVersion?{...meta,sourceSha:'d'.repeat(40)}:meta;},
 processState:()=>{stateReads++;return stateReads>1&&changedRecord?{...state,pid:4321}:state;},
 safeStartup:()=>meta,updateGuard:()=>{},lock:()=>()=>{released++;},
 ownedProcess:()=>{checks++;return checks===1?before:after;},
 processIdentity:()=>foreign?{bootId:oldBoot?'earlier':'boot'}:null,
 health:async()=>{probes++;return healthy;},requireThat:(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});},fs:{existsSync:()=>true},process:{env:{}}};
 const a=source.indexOf('async function start('),b=source.indexOf('async function stop(',a);assert.ok(a>=0&&b>a);vm.runInNewContext(source.slice(a,b),ctx);
 return {run:()=>ctx.checkHost({root:'/fixture'}),start:()=>ctx.start({root:'/fixture'}),probes:()=>probes,checks:()=>checks,released:()=>released};
}
test('H03 check does not report a daemon that exits during its health probe as healthy',async()=>{const h=harness({after:false});await assert.rejects(h.run(),e=>e.code==='server-exited');assert.equal(h.probes(),1);});
test('H03 check rejects a running source that differs from the installed source before probing',async()=>{const h=harness({sourceMismatch:true});await assert.rejects(h.run(),e=>e.code==='running-source-mismatch');assert.equal(h.probes(),0);});
test('H03 check rejects an installation version changing during its health probe',async()=>{await assert.rejects(harness({changedVersion:true}).run(),e=>e.code==='running-source-mismatch');});
test('H03 check rejects a replacement process record during its health probe',async()=>{await assert.rejects(harness({changedRecord:true}).run(),e=>e.code==='process-record-changed');});
test('H03 check does not claim a same-boot foreign PID is safely stopped',async()=>{const h=harness({before:false,foreign:true});await assert.rejects(h.run(),e=>e.code==='stale-process-record');assert.equal(h.probes(),0);});
test('H03 check keeps confirmed absent and earlier-boot records stopped without probing',async()=>{for(const options of [{before:false},{before:false,foreign:true,oldBoot:true}]){const h=harness(options);const r=await h.run();assert.equal(r.code,'stopped');assert.equal(r.health,false);assert.equal(h.probes(),0);}});
test('H03 stable owned process retains positive or negative actual health response',async()=>{for(const healthy of [true,false]){const h=harness({healthy});const r=await h.run();assert.equal(r.code,'running');assert.equal(r.health,healthy);assert.equal(h.checks(),2);assert.equal(r.phoneConnected,false);}});
test('H03 repeated start rejects a stale running source and releases original control lock',async()=>{const h=harness({sourceMismatch:true});await assert.rejects(h.start(),e=>e.code==='running-source-mismatch');assert.equal(h.probes(),0);assert.equal(h.released(),1);});
test('H03 repeated start rejects exit during health check without starting another process',async()=>{const h=harness({after:false});await assert.rejects(h.start(),e=>e.code==='server-exited');assert.equal(h.probes(),1);assert.equal(h.released(),1);});
test('H03 repeated start keeps original stable process and releases lock',async()=>{const h=harness();const r=await h.start();assert.equal(r.code,'already-running');assert.equal(r.health,true);assert.equal(h.released(),1);});
