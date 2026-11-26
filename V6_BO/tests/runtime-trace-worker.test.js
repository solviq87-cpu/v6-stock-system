'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const trace=require('../src/core/runtime-trace');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const {runPublicFactorJob,analyzePublicFactors}=require('../src/server/public-factor-job');
const {buildSystemReadiness}=require('../src/core/system-readiness');
const rootDir=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-worker-trace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'workspace');};
function evidence(t,dispatch,execution,status){
 const rows=trace.read({recent:128}).spans.filter(row=>row.traceId===t.traceId);
 const p=rows.find(row=>row.stage===dispatch),w=rows.find(row=>row.stage===execution);
 assert.ok(p);assert.ok(w);assert.equal(p.parentSpanId,t.spanId);assert.equal(w.parentSpanId,p.spanId);
 assert.equal(w.origin,'worker-thread');assert.equal(w.status,status);assert.equal(p.status,status);
 assert.ok(Number.isFinite(w.durationMs)&&w.durationMs>=0);assert.ok(Number.isFinite(p.durationMs)&&p.durationMs>=0);
 return rows;
}
test('actual workspace worker correlates a coalesced read with one real execution receipt',async t=>{
 const root=rootDir(t);let outer;
 const result=await trace.async('task.tick',async()=>{outer=trace.capture();const p={action:'view',root,query:{},now:Date.now()};
  const one=runWorkspaceJob(p),two=runWorkspaceJob(p);assert.equal(one,two);return one;});
 assert.equal(result.ok,true);assert.equal(fs.existsSync(root),false);assert.equal('__v6WorkerTraceV1' in result,false);
 const rows=evidence(outer,'research.worker-dispatch','research.worker-execute','completed');
 assert.equal(rows.filter(row=>row.stage==='research.worker-execute').length,1);assert.doesNotMatch(JSON.stringify(rows),/fayo-worker-trace-|workspaceRoot|query/);
 const report=buildSystemReadiness({trace:trace.summary()});assert.ok(report.runtimeTrace.hooks.find(row=>row.stage==='research.worker-execute').completed>=1);
 assert.equal(report.runtimeTrace.endToEndCertified,false);
});
test('real worker authority revocation is observed as blocked, not a write or a success',async t=>{
 const root=rootDir(t);let calls=0,outer;
 const result=await trace.async('task.tick',()=>{outer=trace.capture();return runWorkspaceJob({action:'settings',root,guardWorkspaceWrite:true,input:{action:'preferences',value:{objective:'private test objective'},expectedRevision:0,requestId:'trace-worker-revocation'}},{authorize:()=>++calls===1});});
 assert.equal(result.httpStatus,403);assert.equal(calls,2);assert.equal(fs.existsSync(root),false);assert.equal('__v6WorkerTraceV1' in result,false);
 evidence(outer,'research.worker-dispatch','research.worker-execute','blocked');
});
test('pre-dispatch denial creates no worker execution evidence',async t=>{
 const root=rootDir(t);let outer;
 const result=await trace.async('task.tick',()=>{outer=trace.capture();return runWorkspaceJob({action:'settings',root,guardWorkspaceWrite:true},{authorize:()=>false});});
 assert.equal(result.httpStatus,403);assert.equal(fs.existsSync(root),false);
 const rows=trace.read({recent:128}).spans.filter(row=>row.traceId===outer.traceId);
 assert.equal(rows.find(row=>row.stage==='research.worker-dispatch').status,'blocked');assert.ok(!rows.some(row=>row.stage==='research.worker-execute'));
});
test('actual factor worker preserves research result and separate valid/invalid execution receipts',async()=>{
 const input={schemaVersion:1,stocks:[{symbol:'600001',bars:[]}],asOf:'2026-06-25'};let outer;
 const valid=await trace.async('task.tick',()=>{outer=trace.capture();return runPublicFactorJob(input);});
 assert.deepEqual(valid,{ok:true,result:analyzePublicFactors(input)});evidence(outer,'factor.worker-dispatch','factor.worker-execute','completed');
 const failed=await trace.async('task.tick',()=>{outer=trace.capture();return runPublicFactorJob({});});
 assert.deepEqual(failed,{ok:false,error:'因子输入协议无效'});evidence(outer,'factor.worker-dispatch','factor.worker-execute','failed');
});
test('worker receipt requires the active issued dispatch and rejects forged links, replays, cycles and oversized receipts',()=>{
 const tr=trace.createRuntimeTrace();let parent,receipt;
 tr.sync('research.worker-dispatch',()=>{parent=tr.capture();const root={traceId:parent.traceId,spanId:'a'.repeat(32),parentSpanId:parent.spanId,stage:'research.worker-execute',status:'completed',reasonCode:null,startedAt:1000,finishedAt:1001,durationMs:1,body:'secret raw payload',versions:{source:'secret raw source'},refs:{account:'b'.repeat(64)}};
  receipt={version:1,spans:[root]};
  assert.equal(tr.importWorkerReceipt({...parent},receipt,root.stage),false);
  assert.equal(tr.importWorkerReceipt(parent,{version:1,spans:[{...root,traceId:'f'.repeat(32)}]},root.stage),false);
  const cyclic={...root,stage:'research.stage',spanId:'c'.repeat(32),parentSpanId:'c'.repeat(32)};
  assert.equal(tr.importWorkerReceipt(parent,{version:1,spans:[root,cyclic]},root.stage),false);
  assert.equal(tr.importWorkerReceipt(parent,{version:1,spans:Array(65).fill(root)},root.stage),false);
  assert.equal(tr.importWorkerReceipt(parent,receipt,'factor.worker-execute'),false);
  assert.equal(tr.importWorkerReceipt(parent,receipt,root.stage),true);
  assert.equal(tr.importWorkerReceipt(parent,receipt,root.stage),false);
 });
 assert.equal(tr.importWorkerReceipt(parent,receipt,'research.worker-execute'),false);
 assert.equal(tr.read().spans.length,2);assert.doesNotMatch(JSON.stringify(tr.read()),/secret raw/);
 assert.equal(tr.read().spans[0].refs.account,'b'.repeat(64));
});

test('missing or malformed worker evidence retains the original result without certifying execution',()=>{
 const {receive}=require('../src/server/worker-runtime-trace');const result={ok:true,result:{observed:1}};let parent;
 trace.sync('research.worker-dispatch',span=>{parent=trace.capture();assert.equal(receive(parent,'research.worker-execute',{__v6WorkerTraceV1:true,result,receipt:null},span),result);});
 const rows=trace.read({recent:128}).spans.filter(row=>row.traceId===parent.traceId);
 assert.equal(rows.length,1);assert.equal(rows[0].status,'unknown');
 trace.sync('task.tick',()=>{const current=trace.capture();assert.equal(trace.importWorkerReceipt(current,{version:1,spans:[{traceId:current.traceId,spanId:'a'.repeat(32),parentSpanId:current.spanId,stage:'research.worker-execute',status:'completed',reasonCode:null,startedAt:1000,finishedAt:1001,durationMs:1}]},'research.worker-execute'),false);});
});
