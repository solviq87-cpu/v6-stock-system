'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {auditRegisteredSourceReadiness,auditRuntimeSourceUsage}=require('../src/core/data-source-readiness-audit');
const {createRuntimeAcceptance}=require('../src/core/runtime-acceptance');
const day='2026-11-23',start=Date.parse(day+'T09:30:00+08:00'),sha='a'.repeat(40);
const route=(report,id)=>report.routes.find(r=>r.id===id);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-source-usage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=start,mode='live',revision=sha,quotes=[];
 const clock=()=>now,calendar=()=>({status:'available',tradeDates:[day,'2026-11-24'],metadata:{source:'isolated-calendar',runtimeEligible:true,sha256:'b'.repeat(64),from:day,to:'2026-11-24'}});
 const ops=createRuntimeAcceptance({root,clock,calendar,canWrite:()=>true,env:{NODE_ENV:'production'},
  release:()=>({verifiedInstalled:true,sourceSha:revision}),collect:async()=>({mode,market:{expectedSymbols:quotes.length,quotes:quotes.map((q,i)=>({code:String(600001+i),price:10,quoteAt:now-1000,receivedAt:now,canTrade:true,...q}))}})});
 return {root,ops,read:()=>auditRuntimeSourceUsage({runtimeRoot:root,asOf:now+60000}),setQuotes:q=>{quotes=q;},setNow:n=>{now=n;},setMode:m=>{mode=m;},setRevision:s=>{revision=s;}};
}
test('all existing registry routes retain a declaration stage without claiming actual use',()=>{
 const r=auditRegisteredSourceReadiness({asOf:start});
 assert.equal(r.routes.length,122);assert.deepEqual(r.summary.byDeclaredIntegrationKind,{'named-adapter':19,candidate:98,'operator-import':3,'authorized-gateway':2});
 assert.ok(r.routes.every(x=>x.declaredAdapter&&x.runtimeUsage.status==='not-checked'&&x.runtimeUsage.adapterInvocationVerified===false));
 assert.equal(r.runtimeUsage.matchedSourceLabels,null);
 const eia=route(r,'us-eia');
 assert.equal(eia.declaredAdapter,'eia-spot-daily.js');
 assert.equal(eia.declaredIntegrationKind,'named-adapter');
 assert.equal(eia.access,'credentials-required');
 assert.equal(eia.phases.authorization,'unknown');
 assert.equal(eia.integration.productionEnabled,null);
 assert.equal(eia.canTrade,false);
});
test('the original private journal proves only sampled exact labels, not wrappers or downstream trading',async t=>{
 const f=fixture(t);f.setQuotes([{source:'eastmoney'},{source:'tencent'},{source:'unregistered-label'}]);
 assert.equal((await f.ops.tick()).liveEligible,true);
 const file=path.join(f.root,day+'.jsonl'),before=fs.readFileSync(file),names=fs.readdirSync(f.root);
 const r=await f.read();assert.equal(r.runtimeUsage.reviewedDays,1);assert.equal(r.runtimeUsage.matchedSourceLabels,2);assert.equal(r.runtimeUsage.unregisteredSampleRows,1);
 assert.equal(route(r,'eastmoney').runtimeUsage.status,'exact-source-label-observed');
 assert.equal(route(r,'tencent').runtimeUsage.sampledDays,1);
 assert.equal(route(r,'akshare-em-daily').runtimeUsage.status,'not-established-by-bounded-sample');
 assert.equal(route(r,'akshare-em-daily').runtimeUsage.sampledDays,null);
 assert.equal(route(r,'eastmoney').runtimeUsage.downstreamUse,'unknown');
 assert.equal(r.runtimeUsage.allRouteUsageVerified,false);assert.equal(r.canTrade,false);assert.equal(r.summary.productionActiveSourcesVerified,0);
 assert.doesNotMatch(JSON.stringify(r),/600001|unregistered-label|fayo-source-usage-/);
 assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(f.root),names);
});
test('isolated input and mixed revisions do not establish production source observations',async t=>{
 const f=fixture(t);f.setQuotes([{source:'eastmoney'}]);f.setMode('isolated');
 assert.equal((await f.ops.tick()).liveEligible,false);assert.equal((await f.read()).runtimeUsage.matchedSourceLabels,0);
 f.setMode('live');f.setNow(start+60000);assert.equal((await f.ops.tick()).liveEligible,true);
 f.setRevision('c'.repeat(40));f.setNow(start+600000);assert.equal((await f.ops.tick()).liveEligible,true);
 const r=await f.read();assert.equal(r.runtimeUsage.skippedDays,1);assert.equal(r.runtimeUsage.matchedSourceLabels,0);
});
test('last qualified daily sample and bounded first ten symbols never imply absent labels were unused',async t=>{
 const f=fixture(t);f.setQuotes([{source:'eastmoney'}]);await f.ops.tick();
 f.setNow(start+60000);f.setQuotes([...Array.from({length:10},()=>({source:'tencent'})),{source:'eastmoney'}]);
 assert.equal((await f.ops.tick()).liveEligible,true);const r=await f.read();
 assert.equal(r.runtimeUsage.partialDays,1);assert.equal(r.runtimeUsage.matchedSourceLabels,1);
 assert.equal(route(r,'tencent').runtimeUsage.sampledDays,1);assert.equal(route(r,'eastmoney').runtimeUsage.sampledDays,null);
});
test('empty root, unsafe root and corrupt journal remain explicit; no audit creates a runtime journal',async t=>{
 const f=fixture(t),absent=path.join(f.root,'not-created');
 const r=await auditRuntimeSourceUsage({runtimeRoot:absent,asOf:start});assert.equal(r.runtimeUsage.status,'no-qualified-sample-reviewed');assert.equal(fs.existsSync(absent),false);
 await assert.rejects(auditRuntimeSourceUsage({runtimeRoot:'relative',asOf:start}),/绝对私有目录/);
 await assert.rejects(auditRuntimeSourceUsage({runtimeRoot:path.join(f.root,'public'),asOf:start}),/public-root-forbidden/);
 f.setQuotes([{source:'tencent'}]);await f.ops.tick();const file=path.join(f.root,day+'.jsonl');fs.appendFileSync(file,'{');
 await assert.rejects(f.read(),/incomplete-write/);
});
test('existing CLI accepts an explicit private runtime root without enabling a source or creating files',t=>{
 const f=fixture(t),absent=path.join(f.root,'not-created'),cli=path.join(__dirname,'../scripts/audit-data-source-readiness.js');
 const r=spawnSync(process.execPath,[cli,'--runtime-root',absent],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).runtimeUsage.matchedSourceLabels,0);assert.equal(fs.existsSync(absent),false);
 const invalid=spawnSync(process.execPath,[cli,'--runtime-root','relative'],{encoding:'utf8',timeout:10000});assert.equal(invalid.status,2);assert.equal(invalid.stdout,'');
});
