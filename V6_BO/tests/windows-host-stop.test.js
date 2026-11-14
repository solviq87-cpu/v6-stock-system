'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../deploy/windows-host/host-runtime'),'utf8');
function harness({exitAt=Infinity,jump=0,signalError=null,inspectionErrorAfterSignal=false}={}){
 let elapsed=0,wall=100000,released=0,removed=0,signals=0,alive=true,sleeps=0;
 const state={pid:12345},root='/fixture/private';
 const c={path,metadata:()=>({sourceSha:'fixture'}),lock:()=>()=>{released++;},processState:()=>state,
  ownedProcess:()=>{if(inspectionErrorAfterSignal&&signals)throw Object.assign(Error('unknown process state'),{code:'process-inspection-failed'});return alive&&elapsed<exitAt;},archiveStoppedRecord:()=>false,
  Date:{now:()=>wall},performance:{now:()=>elapsed},
  process:{kill:()=>{signals++;if(signalError){if(signalError==='ESRCH')alive=false;throw Object.assign(Error(signalError),{code:signalError});}}},
  fs:{unlinkSync:file=>{assert.equal(file,path.join(root,'run/process.json'));removed++;}},
  requireThat:(condition,code)=>{if(!condition)throw Object.assign(Error(code),{code});},
  sleep:async ms=>{if(++sleeps>110)throw Error('stop exceeded bounded wait');elapsed+=ms;wall+=ms+jump;}};
 const start=source.indexOf('async function stop('),end=source.indexOf('function parseArgs(',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),c);
 return {run:()=>c.stop({root}),state:()=>({elapsed,released,removed,signals,sleeps})};
}
test('backward wall clock cannot extend stop timeout or erase the live process record',async()=>{
 const h=harness({jump:-60000});
 await assert.rejects(h.run(),e=>e.code==='stop-timeout');
 assert.deepEqual(h.state(),{elapsed:5000,released:1,removed:0,signals:1,sleeps:100});
});
test('forward wall clock does not shorten the grace period for an exiting service',async()=>{
 const h=harness({exitAt:150,jump:3600000});const r=await h.run();
 assert.equal(r.code,'stopped');assert.deepEqual(h.state(),{elapsed:150,released:1,removed:1,signals:1,sleeps:3});
});
test('exit between ownership check and SIGTERM finishes cleanup without another signal',async()=>{
 const h=harness({signalError:'ESRCH'});const r=await h.run();
 assert.equal(r.code,'stopped');assert.deepEqual(h.state(),{elapsed:0,released:1,removed:1,signals:1,sleeps:0});
});
test('signal permission failures preserve the PID record and release the controller lock',async()=>{
 const h=harness({signalError:'EPERM'});
 await assert.rejects(h.run(),e=>e.code==='EPERM');
 assert.deepEqual(h.state(),{elapsed:0,released:1,removed:0,signals:1,sleeps:0});
});
test('uncertain process state after SIGTERM preserves the record and releases the lock',async()=>{
 const h=harness({inspectionErrorAfterSignal:true});
 await assert.rejects(h.run(),e=>e.code==='process-inspection-failed');
 assert.deepEqual(h.state(),{elapsed:0,released:1,removed:0,signals:1,sleeps:0});
});
