'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sendPrivateRiskSummary}=require('../src/core/private-risk-feishu-delivery');
const tick=Date.parse('2026-11-26T10:00:00+08:00');
const webhookUrl='https://open.feishu.cn/open-apis/bot/v2/hook/12345678-1234-1234-1234-123456789012';
function report(id='a',at=tick,severity='critical'){
 return {schemaVersion:1,mode:'manual-holding-risk-readonly',status:'evaluated',
  asOf:new Date(at).toISOString(),canTrade:false,canNotify:false,verifiedLive:false,
  alerts:[{id,code:'cost-loss',severity,canNotify:false}],
  counts:{positions:1,warningAlerts:1,withRecentSourceQuote:1,conflictingQuotes:0}};
}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-b4-risk-fresh-')),stateFile=path.join(dir,'receipt.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let wall=tick,mono=0,calls=0;
 const send=(r,now=tick)=>sendPrivateRiskSummary({report:r,now,clock:()=>wall,monotonic:()=>mono,stateFile,webhookUrl,
  enableDelivery:true,fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>({code:0})};}});
 return {stateFile,send,setWall:x=>{wall=x},setMono:x=>{mono=x},get calls(){return calls}};
}
test('expiry during reservation fsync prevents transport and retains original dedup reservation',async t=>{
 const x=fixture(t),sync=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{sync(fd);x.setMono(15001);});
 await assert.rejects(x.send(report()),/过期/);
 t.mock.restoreAll();
 assert.equal(x.calls,0);
 const pending=JSON.parse(fs.readFileSync(x.stateFile,'utf8'));
 assert.equal(pending.history.length,1);assert.equal(pending.history[0].status,'pending-unknown');
 assert.equal((await x.send(report())).status,'deduplicated-pending-unknown');
 assert.equal(x.calls,0);
});
test('wall-clock rollback during the reservation does not allow a new critical push',async t=>{
 const x=fixture(t),sync=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{sync(fd);x.setWall(tick-1);});
 await assert.rejects(x.send(report()),/时钟回退/);t.mock.restoreAll();
 assert.equal(x.calls,0);
 assert.equal(JSON.parse(fs.readFileSync(x.stateFile,'utf8')).history[0].status,'pending-unknown');
});
test('a valid earlier risk report cannot bypass the persisted latest send by changing critical identity',async t=>{
 const x=fixture(t);
 assert.equal((await x.send(report('later',tick+1000),tick+1000)).status,'gateway-accepted');
 const before=fs.readFileSync(x.stateFile,'utf8');
 await assert.rejects(x.send(report('earlier'),tick),/位于未来|时间倒退/);
 assert.equal(x.calls,1);assert.equal(fs.readFileSync(x.stateFile,'utf8'),before);
});
test('fresh new critical identity still bypasses ordinary cooldown but exact duplicates remain reserved',async t=>{
 const x=fixture(t);
 assert.equal((await x.send(report('first'))).status,'gateway-accepted');
 assert.equal((await x.send(report('second',tick+1000),tick+1000)).status,'gateway-accepted');
 assert.equal((await x.send(report('second',tick+2000),tick+2000)).status,'deduplicated-gateway-accepted');
 assert.equal(x.calls,2);
});
