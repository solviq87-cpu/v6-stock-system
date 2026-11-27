'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');
const modulePath=require.resolve('../src/core/market-request-governor');
const tick=Date.parse('2026-11-26T16:00:00+08:00');
const EM='https://push2.eastmoney.com/api/qt/stock/get';
const TX='https://qt.gtimg.cn/q=sh600000';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d25-process-'));
 fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'cooldown.json');
 function child(action,at=tick,status=429,target=EM){
  const script=`
const fs=require('node:fs');
const [modulePath,file,action,at,status,target]=process.argv.slice(1);
const {createMarketRequestGovernor}=require(modulePath);
(async()=>{
 if(action==='crash-lock'){const fd=fs.openSync(file+'.lock','wx',0o600);fs.closeSync(fd);process.exit(19);}
 if(action==='corrupt'){fs.writeFileSync(file,'corrupt-from-child',{mode:0o600});return;}
 const g=createMarketRequestGovernor({stateFile:file,now:()=>Number(at),minIntervalMs:0});
 let calls=0,receipt;
 try{
  if(action==='restrict')g.checkResponse(target,Number(status),{});
  else receipt=await g.run(target,()=>{calls++;return 'fixture-only';});
 }catch(e){receipt={code:e.code,status:e.status,resumeAt:e.resumeAt,stateUnavailable:e.stateUnavailable===true};}
 console.log(JSON.stringify({receipt,calls,state:g.state(target)}));
})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const r=spawnSync(process.execPath,['-e',script,modulePath,file,action,String(at),String(status),target],{
   encoding:'utf8',timeout:10000,maxBuffer:65536,
   env:{...process.env,V6_MARKET_REQUEST_STATE_DIR:path.join(dir,'unused-singleton')}
  });
  if(r.error)throw r.error;
  if(action==='crash-lock'){assert.equal(r.status,19,r.stderr);return;}
  assert.equal(r.status,0,r.stderr);
  return action==='corrupt'?null:JSON.parse(r.stdout);
 }
 return {file,child};
}
for(const status of [429,403])test('persisted HTTP '+status+' blocks a separate process until its original expiry',t=>{
 const h=fixture(t),initial=h.child('restrict',tick,status),until=tick+(status===429?60000:900000);
 assert.equal(initial.receipt.resumeAt,until);assert.equal(initial.calls,0);
 const before=fs.readFileSync(h.file,'utf8');
 const blocked=h.child('request',until-1,status);
 assert.equal(blocked.receipt.code,'MARKET_RESTRICTED');assert.equal(blocked.receipt.resumeAt,until);assert.equal(blocked.calls,0);
 const ready=h.child('request',until,status);
 assert.equal(ready.receipt,'fixture-only');assert.equal(ready.calls,1);
 assert.equal(fs.readFileSync(h.file,'utf8'),before);
});
test('a process that exits leaving the exclusive lock does not reopen the source after restart',t=>{
 const h=fixture(t);h.child('crash-lock');
 const r=h.child('request');assert.equal(r.receipt.code,'MARKET_RESTRICTED');assert.equal(r.receipt.stateUnavailable,true);
 assert.equal(r.calls,0);assert.equal(fs.existsSync(h.file+'.lock'),true);assert.equal(fs.existsSync(h.file),false);
});
test('another process can publish cooldown evidence visible to an already running governor',t=>{
 const h=fixture(t),g=createMarketRequestGovernor({stateFile:h.file,now:()=>tick,minIntervalMs:0});
 assert.equal(g.state(TX).cooldownUntil,0);
 h.child('restrict',tick,429,TX);
 assert.equal(g.state(TX).cooldownUntil,tick+60000);
 assert.equal(g.state(EM).cooldownUntil,0);
});
test('a state file corrupted by another process fences the active result and subsequent requests',async t=>{
 const h=fixture(t),g=createMarketRequestGovernor({stateFile:h.file,now:()=>tick,minIntervalMs:0});
 let finish,calls=0;
 const p=g.run(EM,()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const result=p.then(value=>({value}),error=>({error}));
 h.child('corrupt');finish('physical task completed');
 const settled=await result;assert.equal(settled.value,undefined);assert.equal(settled.error?.stateUnavailable,true);
 assert.equal(g.state(EM).active,0);assert.equal(g.state(EM).stateUnavailable,true);
 await assert.rejects(g.run(TX,()=>{calls++;}),e=>e.code==='MARKET_RESTRICTED'&&e.stateUnavailable===true);
 assert.equal(calls,1);
});
