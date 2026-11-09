'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareRiskSummary,sendPrivateRiskSummary}=require('../src/core/private-risk-feishu-delivery');
const URL='https://open.feishu.cn/open-apis/bot/v2/hook/12345678-1234-1234-1234-123456789012';
const tick=Date.parse('2026-11-09T14:00:00+08:00');
function report({alerts=[{id:'600001:cost-loss',symbol:'600001',code:'loss-warning',
 severity:'warning',message:'private-123456',canNotify:false}]}={}){
 return {schemaVersion:1,mode:'manual-holding-risk-readonly',status:'evaluated',
 asOf:new Date(tick).toISOString(),canTrade:false,canNotify:false,verifiedLive:false,
 alerts,counts:{positions:1,warningAlerts:alerts.filter(a=>['warning','critical'].includes(a.severity)).length,
 withRecentSourceQuote:1,conflictingQuotes:0}};
}
function workspace(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-feishu-safe-'));
 return Promise.resolve().then(()=>fn(path.join(dir,'receipt.json'))).finally(()=>
  fs.rmSync(dir,{recursive:true,force:true}));
}
test('private risk digest never reveals symbol or personal text and rejects stale evidence',()=>{
 const r=prepareRiskSummary(report(),{now:tick});
 assert.equal(r.actionable,true);
 assert.equal(r.containsPositions,false);
 assert.doesNotMatch(JSON.stringify(r),/600001|private-123456/);
 assert.throws(()=>prepareRiskSummary(report(),{now:tick+15001}),/过期/);
 const x=report();x.canNotify=true;
 assert.throws(()=>prepareRiskSummary(x,{now:tick}),/协议/);
});
test('only explicit opt-in may call an official Feishu gateway, and same digest is never resent',()=>workspace(async stateFile=>{
 let calls=0;
 const fetchImpl=async (url,init)=>{
  calls++;
  assert.equal(url,URL);
  assert.equal(init.method,'POST');
  assert.ok(init.signal);
  assert.doesNotMatch(init.body,/600001|private-123456/);
  assert.match(init.body,/V6 本机只读风险观察/);
  return {ok:true,status:200,json:async()=>({code:0})};
 };
 const first=await sendPrivateRiskSummary({report:report(),webhookUrl:URL,
   stateFile,fetchImpl,now:tick});
 assert.equal(first.status,'dry-run');assert.equal(calls,0);
 const sent=await sendPrivateRiskSummary({report:report(),webhookUrl:URL,
   stateFile,fetchImpl,now:tick,enableDelivery:true});
 assert.equal(sent.status,'gateway-accepted');
 assert.equal(sent.deliveredToDevice,false);
 assert.equal(calls,1);
 const repeated=await sendPrivateRiskSummary({report:report(),webhookUrl:URL,
   stateFile,fetchImpl,now:tick,enableDelivery:true});
 assert.equal(repeated.status,'deduplicated-gateway-accepted');
 assert.equal(calls,1);
 assert.match(fs.readFileSync(stateFile,'utf8'),/gateway-accepted/);
 assert.doesNotMatch(fs.readFileSync(stateFile,'utf8'),/600001|private-123456/);
}));
test('unknown network outcome is reserved and does not resend on process restart',()=>workspace(async stateFile=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;throw Error('connection reset');};
 const a=await sendPrivateRiskSummary({report:report(),webhookUrl:URL,
  stateFile,fetchImpl,now:tick,enableDelivery:true});
 assert.equal(a.status,'pending-unknown');
 const b=await sendPrivateRiskSummary({report:report(),webhookUrl:URL,
  stateFile,fetchImpl,now:tick,enableDelivery:true});
 assert.equal(b.status,'deduplicated-pending-unknown');
 assert.equal(calls,1);
}));
test('invalid webhook, linked state file, corrupt record and stale lock fail closed',()=>workspace(async stateFile=>{
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({code:0})};};
 const opts={report:report(),webhookUrl:URL,stateFile,fetchImpl,now:tick,enableDelivery:true};
 await assert.rejects(()=>sendPrivateRiskSummary({...opts,
  webhookUrl:'https://example.com/steal'}),/飞书/);
 fs.writeFileSync(stateFile,'{"broken":true}');
 await assert.rejects(()=>sendPrivateRiskSummary(opts),/损坏/);
 fs.rmSync(stateFile);
 fs.writeFileSync(stateFile+'.lock','pending');
 await assert.rejects(()=>sendPrivateRiskSummary(opts),/EEXIST/);
 fs.rmSync(stateFile+'.lock');
 fs.symlinkSync(path.join(path.dirname(stateFile),'target'),stateFile);
 await assert.rejects(()=>sendPrivateRiskSummary(opts),/不安全/);
 assert.equal(calls,0);
}));
test('stale/unknown-only prices do not trigger network delivery',()=>workspace(async stateFile=>{
 const unknown={id:'600001:quote-gap',symbol:'600001',code:'quote-gap',
 severity:'unknown',message:'source invalid',canNotify:false};
 const a=await sendPrivateRiskSummary({report:report({alerts:[unknown]}),
  webhookUrl:URL,stateFile,now:tick,enableDelivery:true,fetchImpl:()=>{throw Error('must not call')}});
 assert.equal(a.status,'no-actionable-risk');
 assert.equal(fs.existsSync(stateFile),false);
}));
