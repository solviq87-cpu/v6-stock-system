'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse,tick,readState,seal,main}=require('../scripts/sector-capture-supervisor');
const start=Date.parse('2026-11-10T10:02:00+08:00'),end=start+60000,
 finish=end+5000,day='2026-11-10';
function fixture(){
 const rows=[],stocks=[],groups=[[2,3,4,4,5],[15,12,-1,-2,-3],[-4,-3,-2,-1,0]];
 for(let j=0;j<3;j++)for(let i=0;i<5;i++){
  const code=String(600001+j*100+i);
  rows.push({updateDate:'2026-11-09',code:'sh.'+code,
   industry:['硬件设备','数字经济','医疗服务'][j],
   industryClassification:'证监会行业分类'});
  stocks.push({code,pctChange:groups[j][i],vendorQuoteAt:end-5000});
 }
 return {
  raw:{schemaVersion:1,source:'baostock:query_stock_industry',completed:true,
   standard:'证监会行业分类',updateDate:'2026-11-09',
   observedAt:start-60000,declaredRows:15,rows},
  calendar:{source:'imported',
   tradeDates:['2026-11-06','2026-11-09',day]},
  snapshot:{source:'eastmoney-clist-unverified-live',date:day,universeSize:15,
   startedAt:new Date(start).toISOString(),retrievedAt:new Date(end).toISOString(),
   verifiedLive:false,stocks}
 };
}
function setup(opts={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-supervisor-'));
 const data=fixture(),classificationFile=path.join(dir,'industry.json'),
  calendarFile=path.join(dir,'calendar.json'),
  outputRoot=path.join(dir,'private-archive'),file=path.join(dir,'config.json');
 fs.writeFileSync(classificationFile,JSON.stringify(data.raw));
 fs.writeFileSync(calendarFile,JSON.stringify(data.calendar));
 const config={
  schemaVersion:1,mode:'sector-capture-supervisor',
  classificationFile,calendarFile,outputRoot,
  intervalMs:300000,maxDailyAttempts:5,tripFailures:3,...opts
 };
 fs.writeFileSync(file,JSON.stringify(config));
 return {...data,dir,file,config,outputRoot,
  status:()=>parse(['status',file]),once:()=>parse(['once',file,'--allow-research-fetch'])};
}
const cleanup=x=>fs.rmSync(x.dir,{recursive:true,force:true});
const deps=x=>({now:start,clock:()=>finish,fetchSnapshot:async()=>x.snapshot});
test('status is read-only; both manual and watch network mode require explicit opt-in',async()=>{
 const x=setup();let calls=0;
 try{
  const status=await main(['status',x.file],{now:start,
   fetchSnapshot:async()=>{calls++;throw Error('network forbidden');}});
  assert.equal(status.status,'read-only-status');
  assert.equal(status.wouldBlock,null);
  assert.equal(status.attempts,0);
  assert.equal(status.canTrade,false);
  assert.equal(calls,0);assert.equal(fs.existsSync(x.outputRoot),false);
  assert.throws(()=>parse(['once',x.file]),/用法/);
  assert.throws(()=>parse(['watch',x.file]),/用法/);
  assert.throws(()=>parse(['status',x.file,'--allow-research-fetch']),/用法/);
  assert.equal(fs.existsSync(x.outputRoot),false);
 }finally{cleanup(x);}
});
test('opted-in one-shot delegates one snapshot and seals daily circuit state',async()=>{
 const x=setup();let calls=0;
 try{
  const conf=x.once();
  const out=await tick(conf,{...deps(x),fetchSnapshot:async()=>{calls++;return x.snapshot;}});
  assert.equal(out.status,'research-capture-succeeded-unverified');
  assert.equal(out.captureAttempts,1);assert.equal(calls,1);
  assert.equal(out.attempts,1);assert.equal(out.consecutiveFailures,0);
  assert.equal(out.verifiedLive,false);assert.equal(out.canTrade,false);
  assert.equal(out.rankedSectors,3);
  const state=readState(conf,start);
  assert.equal(state.inFlight,false);assert.equal(state.lastOutcome,'success');
  assert.equal(fs.statSync(conf.stateFile).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(x.outputRoot,'snapshots',day,String(end)+'.json')),true);
  assert.equal(fs.existsSync(path.join(x.outputRoot,'.sector-capture-supervisor.lock')),false);
  const recheck=await tick(conf,{now:start+120000,
   fetchSnapshot:async()=>{calls++;throw Error('should not request');}});
  assert.equal(recheck.status,'blocked-minimum-interval');
  assert.equal(recheck.captureAttempts,0);assert.equal(calls,1);
  const second=await tick(x.status(),{now:start+120000});
  assert.equal(second.status,'read-only-status');
  assert.equal(second.wouldBlock,'blocked-minimum-interval');
 }finally{cleanup(x);}
});
test('after three provider failures breaker opens for the day, including after process restart',async()=>{
 const x=setup();let calls=0;
 try{
  const conf=x.once();
  for(let i=0;i<3;i++){
   const out=await tick(conf,{now:start+i*300000,
    fetchSnapshot:async()=>{calls++;throw Error('HTTP 502');}});
   assert.equal(out.consecutiveFailures,i+1);
   assert.equal(out.failureCategory,'provider-unavailable');
   assert.equal(out.captureAttempts,1);
   assert.equal(out.status,i===2?'blocked-circuit-open':'research-capture-failed');
  }
  const another=x.once();
  const again=await tick(another,{now:start+3*300000,
   fetchSnapshot:async()=>{calls++;return x.snapshot;}});
  assert.equal(again.status,'blocked-circuit-open');
  assert.equal(again.captureAttempts,0);
  assert.equal(calls,3);
  assert.equal(readState(another,start+3*300000).breakerOpen,true);
 }finally{cleanup(x);}
});
test('provider HTTP 429 and 403 trip breaker immediately, without leaking response data',async()=>{
 for(const code of [429,403]){
  const x=setup();let calls=0;
  try{
   const r=await tick(x.once(),{now:start,fetchSnapshot:async()=>{
    calls++;throw Error('HTTP '+code+' top-secret-bearer-token');
   }});
   assert.equal(r.status,'blocked-circuit-open');
   assert.equal(r.failureCategory,'provider-rate-or-permission');
   assert.equal(r.consecutiveFailures,1);
   assert.equal(JSON.stringify(r).includes('top-secret'),false);
   assert.equal(calls,1);
  }finally{cleanup(x);}
 }
});
test('daily budget limits requests independently of the five-minute throttle',async()=>{
 const x=setup({maxDailyAttempts:1});
 try{
  const conf=x.once();
  await tick(conf,deps(x));
  const r=await tick(conf,{now:start+300000,
   fetchSnapshot:async()=>{throw Error('daily budget exceeded');}});
  assert.equal(r.status,'blocked-daily-budget');
  assert.equal(r.captureAttempts,0);
  assert.equal(readState(conf,start+300000).attempts,1);
 }finally{cleanup(x);}
});
test('unknown trading day, weekend, lunch pause and invalid classification never fetch',async()=>{
 const x=setup();let calls=0;
 try{
  const f=async()=>{calls++;throw Error('cannot call');};
  const noon=await tick(x.once(),{now:Date.parse('2026-11-10T12:01:00+08:00'),fetchSnapshot:f});
  assert.equal(noon.status,'paused-preflight');
  assert.equal(noon.captureAttempts,0);
  const dayAfter=await tick(x.once(),{now:Date.parse('2026-11-11T10:02:00+08:00'),fetchSnapshot:f});
  assert.equal(dayAfter.preflightStatus,'blocked-trading-calendar');
  x.raw.observedAt=start+1000;
  fs.writeFileSync(x.config.classificationFile,JSON.stringify(x.raw));
  const invalid=await tick(x.once(),{now:start,fetchSnapshot:f});
  assert.equal(invalid.preflightStatus,'blocked-classification');
  assert.equal(calls,0);assert.equal(fs.existsSync(x.outputRoot),false);
 }finally{cleanup(x);}
});
test('unresolved in-flight journal, tampering and changed config block further requests',async()=>{
 const x=setup();let calls=0;
 try{
  const conf=x.once();
  const first=await tick(conf,{now:start,fetchSnapshot:async()=>{calls++;throw Error('HTTP 502');}});
  assert.equal(first.status,'research-capture-failed');
  const saved=readState(conf,start+300000);
  const unfinished={...saved,inFlight:true,lastOutcome:'started'};
  fs.writeFileSync(conf.stateFile,JSON.stringify(seal(unfinished))+'\n');
  const blocked=await tick(conf,{now:start+300000,
   fetchSnapshot:async()=>{calls++;return x.snapshot;}});
  assert.equal(blocked.status,'blocked-unfinished-attempt');
  assert.equal(calls,1);
  const corrupt=JSON.parse(fs.readFileSync(conf.stateFile,'utf8'));
  corrupt.attempts=777;
  fs.writeFileSync(conf.stateFile,JSON.stringify(corrupt)+'\n');
  await assert.rejects(tick(conf,{now:start+300000}),/熔断状态损坏/);
  assert.equal(calls,1);
  const modified={...x.config,intervalMs:600000};
  fs.writeFileSync(x.file,JSON.stringify(modified));
  await assert.rejects(tick(x.status(),{now:start+300000}),/配置被更换|熔断状态损坏/);
 }finally{cleanup(x);}
});
test('concurrent writer lock blocks, and lock file is never silently replaced',async()=>{
 const x=setup();let calls=0;
 try{
  const conf=x.once();
  fs.mkdirSync(x.outputRoot);fs.writeFileSync(conf.lockFile,'other-pid');
  const out=await tick(conf,{...deps(x),fetchSnapshot:async()=>{calls++;return x.snapshot;}});
  assert.equal(out.status,'blocked-supervisor-lock');
  assert.equal(out.captureAttempts,0);assert.equal(calls,0);
  assert.equal(fs.readFileSync(conf.lockFile,'utf8'),'other-pid');
 }finally{cleanup(x);}
});
test('invalid interval, excessive budget, public path or symlink fail before network',()=>{
 const x=setup();
 try{
  for(const mutation of [
   o=>o.intervalMs=2000,
   o=>o.maxDailyAttempts=200,
   o=>o.tripFailures=0,
   o=>o.outputRoot=path.join(x.dir,'public','secret')
  ]){
   const invalid={...x.config};mutation(invalid);
   fs.writeFileSync(x.file,JSON.stringify(invalid));
   assert.throws(()=>x.once());
  }
  const link=path.join(x.dir,'config-alias.json');fs.symlinkSync(x.file,link);
  assert.throws(()=>parse(['status',link]),/符号链接/);
 }finally{cleanup(x);}
});
