'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {prepareRiskSummary,sendPrivateRiskSummary}=require('../src/core/private-risk-feishu-delivery');
const {parse,createRiskMonitor,main}=require('../scripts/private-risk-monitor');
const URL='https://open.feishu.cn/open-apis/bot/v2/hook/12345678-1234-1234-1234-123456789012';
const epoch=Date.parse('2026-11-09T10:00:00+08:00');
const sha=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
function report(id,now,severity='warning'){
 const alert={id,symbol:id.startsWith('b')?'600002':'600001',
  code:severity==='critical'?'weight-critical':'weight-warning',
  severity,canNotify:false};
 return {schemaVersion:1,mode:'manual-holding-risk-readonly',
  status:'evaluated',asOf:new Date(now).toISOString(),
  verifiedLive:false,canTrade:false,canNotify:false,alerts:[alert],
  counts:{positions:1,warningAlerts:1,withRecentSourceQuote:0,conflictingQuotes:0}};
}
function space(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-risk-journal-'));
 return Promise.resolve().then(()=>fn(root)).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}
const sender=async()=>({ok:true,status:200,json:async()=>({code:0})});
test('A→B→A on same day sends A only once across process restarts',()=>space(async root=>{
 const stateFile=path.join(root,'journal.json');
 let calls=0;
 const fetchImpl=async()=>{calls++;return sender();};
 const send=(id,now)=>sendPrivateRiskSummary({report:report(id,now),
  stateFile,webhookUrl:URL,fetchImpl,enableDelivery:true,now});
 assert.equal((await send('a-one',epoch)).status,'gateway-accepted');
 assert.equal((await send('b-two',epoch+121000)).status,'gateway-accepted');
 assert.equal((await send('a-one',epoch+242000)).status,'deduplicated-gateway-accepted');
 assert.equal(calls,2);
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.equal(state.schemaVersion,2);assert.equal(state.history.length,2);
 assert.doesNotMatch(JSON.stringify(state),/600001|600002|a-one|b-two/);
 assert.equal(state.digest,sha({schemaVersion:2,mode:state.mode,history:state.history}));
}));
test('v1 receipt remains reserved even after a different risk upgrades file to v2',()=>space(async root=>{
 const stateFile=path.join(root,'receipt.json'),summary=prepareRiskSummary(report('a-one',epoch),{now:epoch});
 const old={schemaVersion:1,mode:'v6-private-feishu-gateway-receipt',
  day:summary.day,fingerprint:summary.legacyFingerprint,status:'pending-unknown',at:epoch};
 fs.writeFileSync(stateFile,JSON.stringify(old));
 let requests=0;
 const fetchImpl=async()=>{requests++;return sender();};
 const send=(id,now)=>sendPrivateRiskSummary({report:report(id,now),
  stateFile,webhookUrl:URL,fetchImpl,enableDelivery:true,now});
 assert.equal((await send('a-one',epoch)).status,'deduplicated-pending-unknown');
 assert.equal(requests,0);
 assert.equal((await send('b-two',epoch+121000)).status,'gateway-accepted');
 assert.equal((await send('a-one',epoch+242000)).status,'deduplicated-pending-unknown');
 assert.equal(requests,1);
}));
test('short-term duplicate changes have a cooldown; a new critical escalation can bypass',()=>space(async root=>{
 const stateFile=path.join(root,'journal.json');
 let requests=0;
 const fetchImpl=async()=>{requests++;return sender();};
 const send=(id,now,severity='warning')=>sendPrivateRiskSummary({
  report:report(id,now,severity),stateFile,webhookUrl:URL,fetchImpl,
  enableDelivery:true,now});
 assert.equal((await send('a-one',epoch)).status,'gateway-accepted');
 assert.equal((await send('b-two',epoch+30000)).status,'cooldown');
 assert.equal((await send('c-three',epoch+31000,'critical')).status,'gateway-accepted');
 assert.equal(requests,2);
}));
test('daily cap bounds an oscillating monitor; corrupted journal is rejected before HTTP',()=>space(async root=>{
 const stateFile=path.join(root,'journal.json');
 let requests=0;
 const fetchImpl=async()=>{requests++;return sender();};
 for(let i=0;i<12;i++){
  const now=epoch+i*121000;
  const x=await sendPrivateRiskSummary({report:report('risk-'+i,now),
   stateFile,webhookUrl:URL,fetchImpl,enableDelivery:true,now});
  assert.equal(x.status,'gateway-accepted');
 }
 const more=await sendPrivateRiskSummary({report:report('risk-13',epoch+12*121000),
  stateFile,webhookUrl:URL,fetchImpl,enableDelivery:true,now:epoch+12*121000});
 assert.equal(more.status,'daily-limit');assert.equal(requests,12);
 const x=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 x.history[0].status='gateway-rejected';
 fs.writeFileSync(stateFile,JSON.stringify(x));
 await assert.rejects(()=>sendPrivateRiskSummary({report:report('risk-14',epoch+13*121000),
  stateFile,webhookUrl:URL,fetchImpl,enableDelivery:true,now:epoch+13*121000}),/损坏/);
 assert.equal(requests,12);
}));
test('monitor argument gate and concurrency never overlap or expose private paths',async()=>{
 const holdings=path.join(os.tmpdir(),'private-holdings.json');
 const receipt=path.join(os.tmpdir(),'private-receipt.json');
 assert.throws(()=>parse([holdings,receipt,'--interval-ms','5000']),/监控模式/);
 assert.throws(()=>parse([holdings,receipt,'--monitor','--interval-ms','100']),/5至60秒/);
 const config=parse([holdings,receipt,'--monitor','--interval-ms','5000','--send']);
 let resolve,started=0;
 const running=new Promise(r=>resolve=r);
 const mon=createRiskMonitor(config,{env:{V6_RISK_NOTIFY_CONSENT:'YES'},
  run:async argv=>{started++;assert.deepEqual(argv,[holdings,receipt,'--send']);
   await running;return {status:'gateway-accepted',gatewayAccepted:true,
    counts:{positions:1,critical:1,warning:0,unknown:0}};}});
 const a=mon.tick(),b=await mon.tick();
 assert.equal(b.status,'busy');assert.equal(started,1);
 resolve();
 const done=await a;
 assert.equal(done.status,'gateway-accepted');assert.equal(done.gatewayAccepted,true);
 assert.equal(done.deliveredToDevice,false);
 assert.doesNotMatch(JSON.stringify(done),/holdings|receipt|webhook|600001/);
 mon.stop();assert.equal((await mon.tick()).status,'stopped');
 const denied=createRiskMonitor(config,{env:{},run:()=>{throw Error('must not call')}});
 assert.equal((await denied.tick()).status,'input-or-gateway-error');
});
test('one-shot monitor stays dry-run and shows only summary counts',async()=>{
 const holdings=path.join(os.tmpdir(),'private-holdings.json');
 const receipt=path.join(os.tmpdir(),'private-receipt.json');
 const result=await main([holdings,receipt],{env:{},runner:async argv=>{
  assert.deepEqual(argv,[holdings,receipt]);
  return {status:'dry-run',gatewayAccepted:false,counts:{positions:7,critical:1,warning:1,unknown:2}};
 }});
 assert.deepEqual(result.counts,{positions:7,critical:1,warning:1,unknown:2});
 assert.equal(result.deliveredToDevice,false);
});
