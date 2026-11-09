'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evaluateManualHoldingRisks:evaluate,readManualHoldingWatchFile:readFile}
 =require('../src/core/manual-holding-risk-watch');
const now=Date.parse('2026-11-09T06:30:00Z');
const input=()=>({schemaVersion:1,mode:'manual-holding-watch',positions:[
 {symbol:'600001',name:'手动观察甲',cost:10,shares:1000,weightPct:32},
 {symbol:'000001',name:'手动观察乙',cost:20,shares:500,weightPct:12},
 {symbol:'300001',name:'手动观察丙',cost:8,shares:200,weightPct:5}
],quotes:[
 {symbol:'600001',price:8.8,quoteAt:now-2000,quoteSource:'eastmoney'},
 {symbol:'000001',price:16,quoteAt:now-500,quoteSource:'tencent'}
]});
test('two source-timed prices produce cost-risk signals and a missing price stays unknown',()=>{
 const original=input(),before=structuredClone(original);
 const r=evaluate(original,{now});
 assert.equal(r.mode,'manual-holding-risk-readonly');
 assert.equal(r.status,'evaluated');
 assert.equal(r.providerVerified,false);
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.equal(r.writesAccount,false);assert.equal(r.autoOrders,false);
 assert.equal(r.counts.withRecentSourceQuote,2);
 assert.equal(r.counts.missingOrUnusableQuotes,1);
 assert.equal(r.positions[0].drawdownFromCostPct,-12);
 assert.equal(r.positions[1].drawdownFromCostPct,-20);
 assert.equal(r.positions[2].drawdownFromCostPct,null);
 assert.equal(r.positions[2].price,null);
 assert.ok(r.alerts.some(a=>a.id==='600001:cost-loss'&&a.severity==='warning'));
 assert.ok(r.alerts.some(a=>a.id==='000001:cost-loss'&&a.severity==='critical'));
 assert.ok(r.alerts.some(a=>a.id==='600001:concentration'&&a.severity==='warning'));
 assert.ok(r.alerts.some(a=>a.id==='300001:quote-gap'&&a.severity==='unknown'));
 assert.ok(r.alerts.every(a=>a.canNotify===false));
 assert.deepEqual(original,before);
 assert.deepEqual(evaluate(original,{now}),r,'unchanged polling must be idempotent');
});
test('untrusted time and source reject quote-derived PnL instead of inventing zero or a stale alert',()=>{
 const cases=[
  {quoteAt:now-15001}, {quoteAt:now+1},
  {quoteAt:Date.parse('2026-11-06T06:29:59Z')},
  {quoteAt:now-1000,quoteSource:'simulated-market'},
  {quoteAt:now-1000,quoteSource:'readOnlyBackup'},
  {quoteAt:now-1000,proxy:true},
  {quoteAt:now-1000,simulated:true},
  {quoteAt:now-1000,suspended:true},
  {quoteAt:now-1000,tradable:false},
  {quoteAt:now-1000,readOnlyBackup:true},
  {quoteAt:now-1000,quoteSource:''},
  {quoteAt:now-1000,price:0}
 ];
 for(const bad of cases){
  const data=input();data.quotes[0]={...data.quotes[0],...bad};
  const r=evaluate(data,{now});
  assert.equal(r.positions[0].drawdownFromCostPct,null,JSON.stringify(bad));
  assert.equal(r.positions[0].price,null);
  assert.equal(r.positions[0].quoteStatus,'quote-unusable');
  assert.ok(r.alerts.some(a=>a.id==='600001:quote-gap'));
  assert.ok(!r.alerts.some(a=>a.id==='600001:cost-loss'));
  assert.ok(r.alerts.some(a=>a.id==='600001:concentration'),
    'hand-entered concentration remains visible even when price is unavailable');
 }
});
test('missing weights never mean 0% and negative profit does not hide research alerts',()=>{
 const data=input();data.positions[0].weightPct=undefined;
 const r=evaluate(data,{now});
 assert.equal(r.positions[0].weightPct,null);
 assert.ok(!r.alerts.some(a=>a.id==='600001:concentration'));
 assert.ok(r.alerts.some(a=>a.id==='600001:cost-loss'));
 data.quotes[0].price=11;
 const rise=evaluate(data,{now});
 assert.equal(rise.positions[0].drawdownFromCostPct,10);
 assert.ok(!rise.alerts.some(a=>a.id==='600001:cost-loss'));
});
test('invalid costs, duplicated securities and quote conflicts fail closed',()=>{
 for(const change of [
  d=>{d.positions[0].cost=0;},
  d=>{d.positions[0].cost=Infinity;},
  d=>{d.positions[0].shares=0;},
  d=>{d.positions[0].symbol='bad';},
  d=>{d.positions.push({...d.positions[0]});},
  d=>{d.positions[1].weightPct=99;},
  d=>{d.quotes.push({...d.quotes[0],price:19});},
  d=>{d.mode='broker-trade';},
  d=>{d.schemaVersion=2;}
 ]){const d=input();change(d);assert.throws(()=>evaluate(d,{now}));}
 assert.throws(()=>evaluate(input(),{now:0}));
});
test('private on-disk watch is read-only, rejects symlinks, and forgets invalid/stale inputs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-holding-watch-'));
 const file=path.join(dir,'private.json'),link=path.join(dir,'alias.json');
 try{
  assert.equal(readFile(null,{now}).status,'unconfigured');
  fs.writeFileSync(file,JSON.stringify(input()),{mode:0o600});
  const before=fs.readFileSync(file,'utf8');
  assert.equal(readFile(file,{now}).counts.withRecentSourceQuote,2);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  fs.symlinkSync(file,link);
  assert.equal(readFile(link,{now}).status,'unavailable');
  assert.equal(readFile(file,{now:now+20000}).counts.withRecentSourceQuote,0);
  fs.writeFileSync(file,'{bad');
  const gone=readFile(file,{now});
  assert.equal(gone.status,'unavailable');
  assert.deepEqual(gone.positions,[]);
  assert.deepEqual(gone.alerts,[]);
  assert.ok(!JSON.stringify(gone).includes('600001'));
  assert.ok(!JSON.stringify(gone).includes(file));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
