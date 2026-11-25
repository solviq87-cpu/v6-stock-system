'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createFixture}=require('./helpers/v6-studio-fixture');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('real private route reads, saves with CAS, restores on both entries and preserves original ledgers',{timeout:120000},async()=>{
 const f=await createFixture({count:3});
 try{
  await f.request('/api/paper');
  const accounts=['pool','pre'].map(key=>path.join(f.tmp,'data/order-accounts',key+'.json'));
  const before=accounts.map(file=>hash(fs.readFileSync(file)));
  for(const token of ['',f.viewerToken]){
   const denied=await f.request('/api/research/evolution','GET',null,token);assert.ok([401,403].includes(denied.status)||denied.body?.locked||denied.body?.needAuth,denied.raw);assert.ok(!denied.body?.result);
  }
  const read=await f.request('/api/research/evolution?symbol=600001');assert.equal(read.status,200,read.raw);
  assert.equal(read.body.result.mode,'fayo-intelligence-evolution');assert.equal(read.body.result.canTrade,false);assert.equal(read.body.result.workflow.preferences.revision,0);
  assert.equal(read.body.result.market.financialHealth.status,'unknown');assert.match(read.headers['cache-control'],/no-store/);
  const value={...read.body.result.workflow.preferences.value,selectedCode:'600001',groups:[{id:'watch',name:'核心观察',symbols:['600001','600002']}],activeGroup:'watch',search:'600001',expanded:['market','lifecycle'],density:'compact'};
  const input={action:'preferences',requestId:'integration_preferences_1',expectedRevision:0,value};
  const saved=await f.request('/api/research/evolution','POST',input);assert.equal(saved.status,200,saved.raw);assert.equal(saved.body.result.revision,1);
  const replay=await f.request('/api/research/evolution','POST',input);assert.equal(replay.status,200,replay.raw);assert.equal(replay.body.result.reused,true);assert.equal(replay.body.result.revision,1);
  const conflict=await f.request('/api/research/evolution','POST',{...input,requestId:'integration_preferences_2'});assert.equal(conflict.status,409,conflict.raw);
  for(const entry of ['/','/m']){
   assert.equal((await f.request(entry)).status,200);
   const restored=await f.request('/api/research/evolution');assert.equal(restored.status,200,restored.raw);assert.equal(restored.body.result.workflow.preferences.revision,1);assert.deepEqual(restored.body.result.workflow.preferences.value,value);
  }
  const diagnostic=await f.request('/api/research/evolution','POST',{action:'diagnostics',requestId:'integration_diagnostic_1',symbol:'600001'});
  assert.equal(diagnostic.status,200,diagnostic.raw);assert.equal(diagnostic.body.result.status,'not-evaluated');assert.ok(diagnostic.body.recordId);
  const retry=await f.request('/api/research/evolution','POST',{action:'diagnostics',requestId:'integration_diagnostic_1',symbol:'600001'});
  assert.equal(retry.status,200,retry.raw);assert.equal(retry.body.recordId,diagnostic.body.recordId);assert.equal(retry.body.reused,true,'implicit current time does not break a network retry');
  const differentCommand=await f.request('/api/research/evolution','POST',{action:'diagnostics',requestId:'integration_diagnostic_1',symbol:'600001',horizon:'20'});
  assert.equal(differentCommand.status,422,differentCommand.raw);
  const after=await f.request('/api/research/evolution?export=1');assert.equal(after.status,200,after.raw);assert.equal(after.body.result.statistics.diagnostics.reason,diagnostic.body.result.reason);
  assert.equal(after.body.result.sources.diagnosticRecord,diagnostic.body.recordId);
  const anotherHorizon=await f.request('/api/research/evolution?horizon=20');assert.equal(anotherHorizon.status,200,anotherHorizon.raw);assert.equal(anotherHorizon.body.result.sources.diagnosticRecord,null,'a five-day diagnosis cannot certify another holding horizon');
  const historical=await f.request('/api/research/evolution?symbol=600001&asOf='+read.body.result.asOf);assert.equal(historical.status,200,historical.raw);assert.equal(historical.body.result.workflow.preferences.revision,0,'future preference receipts cannot select historical instruments');assert.equal(historical.body.result.sources.diagnosticRecord,null);
  fs.appendFileSync(path.join(f.tmp,'src/strategy/historical-indicators.js'),'\n// isolated implementation change for cache invalidation\n');
  const newCode=await f.request('/api/research/evolution');assert.equal(newCode.status,200,newCode.raw);assert.equal(newCode.body.result.sources.diagnosticRecord,null,'changed indicator code invalidates a saved diagnosis');
  assert.deepEqual(accounts.map(file=>hash(fs.readFileSync(file))),before,'report, layout, diagnostics and export never mutate authoritative accounts');
  assert.equal((await f.request('/api/research/evolution?root=public')).status,400);
 }finally{await f.close();}
});
