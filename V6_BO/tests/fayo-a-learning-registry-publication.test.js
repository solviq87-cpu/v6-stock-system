'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {fixture}=require('./helpers/adaptive-fixture'),{createRegistry}=require('../src/core/learning-profile-registry');
// Synthetic historical prices, not a production strategy or a live account.
function setup(t,{marketGate=false,noCandidate=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-a36-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'registry'),file=path.join(root,'state.json'),input=fixture(150);
 for(const stock of input.stocks)stock.bars.forEach((b,i)=>{const c=(stock.symbol==='600000'?20:30)*1.01**i;Object.assign(b,{close:c,open:c*.9998,high:c*1.0005,low:c*.9995});});
 input.simulation={initialCash:100000,topN:2,holdDays:1,feeBps:8,slippageBps:10,sellTaxBps:5};
 const dates=input.stocks[0].bars.map(b=>b.date),plan={schemaVersion:1,version:'a36-synthetic',trainEnd:dates[79],validationEnd:dates[114],holdoutEnd:dates.at(-1),gates:{minClosedTrades:noCandidate?999:3,maxDrawdownPct:10,minReturnPct:0,minExcessReturnPct:0,costStressBps:10},candidates:[{id:'prior4',parameters:{learningConfig:{minimumSamples:20,priorStrength:4}}}],...(marketGate?{marketGateMode:'required-on-promote'}:{})};
 const r=createRegistry(root);r.freeze(input,plan);return {r,root,file,plan};
}
function ready(t,options){const x=setup(t,options);x.r.evaluate(1);x.r.testHoldout(2);return x;}
function context(){const observedAt=Date.now(),provider='synthetic-context',tradeDate=new Date(observedAt+8*3600000).toISOString().slice(0,10),row={source:provider,observedAt};return {schemaVersion:1,source:'imported',provider,tradeDate,observedAt,coverage:1,breadth:{...row,upPct:60},indices:{shanghai:{...row,changePct:1},shenzhen:{...row,changePct:1}}};}
function state(x){return JSON.parse(fs.readFileSync(x.file,'utf8'));}
function save(x,s){delete s.fingerprint;s.fingerprint=crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');fs.writeFileSync(x.file,JSON.stringify(s)+'\n');}
// Freeze the synthetic market clock and inject a change after the staged file fsync.
const T=Date.parse('2026-11-27T10:00:00+08:00');
function clock(t){let now=T;t.mock.method(Date,'now',()=>now);return value=>{now=value;};}
function afterStage(t,action){const sync=fs.fsyncSync;let calls=0;t.mock.method(fs,'fsyncSync',fd=>{sync(fd);if(++calls===1)action();});}
function noStage(x){assert.ok(!fs.readdirSync(x.root).some(n=>n.endsWith('.tmp')));}
function unchanged(x,before){assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.r.status().active,'baseline');noStage(x);}
test('A36 fresh stable market evidence publishes exactly one promotion and keeps idempotent retry',t=>{clock(t);const x=ready(t,{marketGate:true}),c=context(),p=x.r.promote(3,{marketContext:c});assert.equal(p.active,'prior4');assert.equal(p.events.length,1);assert.equal(x.r.promote(4).revision,4);assert.equal(x.r.verify({replay:true}).active,'prior4');noStage(x);});
test('A36 market receipt expiring during fsync must not activate the candidate',t=>{const set=clock(t),x=ready(t,{marketGate:true}),c=context(),before=fs.readFileSync(x.file);afterStage(t,()=>set(T+90*60000+1));assert.throws(()=>x.r.promote(3,{marketContext:c}),/过期/);unchanged(x,before);set(T);assert.equal(x.r.promote(3,{marketContext:c}).active,'prior4');});
test('A36 market receipt crossing the China calendar day during staging is rejected',t=>{const set=clock(t);set(Date.parse('2026-11-27T23:59:59+08:00'));const x=ready(t,{marketGate:true}),c=context(),before=fs.readFileSync(x.file);afterStage(t,()=>set(Date.parse('2026-11-28T00:00:00+08:00')));assert.throws(()=>x.r.promote(3,{marketContext:c}),/过期/);unchanged(x,before);});
test('A36 a market shock appearing after evidence review cannot publish',t=>{clock(t);const x=ready(t,{marketGate:true}),c=context(),before=fs.readFileSync(x.file);afterStage(t,()=>{c.breadth.upPct=10;c.indices.shanghai.changePct=-4;c.indices.shenzhen.changePct=-4;});assert.throws(()=>x.r.promote(3,{marketContext:c}),/急跌/);unchanged(x,before);});
test('A36 a changed but still non-shock market receipt cannot replace the sealed evidence',t=>{clock(t);const x=ready(t,{marketGate:true}),c=context(),before=fs.readFileSync(x.file);afterStage(t,()=>{c.indices.shanghai.changePct=2;});assert.throws(()=>x.r.promote(3,{marketContext:c}),/证据发布前变化/);unchanged(x,before);});
test('A36 clock rollback between market review and publication fails closed even when receipt remains fresh',t=>{const set=clock(t),x=ready(t,{marketGate:true});set(T-1000);const c=context();set(T);const before=fs.readFileSync(x.file);afterStage(t,()=>set(T-500));assert.throws(()=>x.r.promote(3,{marketContext:c}),/时钟回退/);unchanged(x,before);});
test('A36 an unexpected valid older state snapshot during publication is not overwritten',t=>{const x=setup(t);x.r.evaluate(1);const old=fs.readFileSync(x.file);x.r.testHoldout(2);afterStage(t,()=>fs.writeFileSync(x.file,old));assert.throws(()=>x.r.promote(3),/发布前状态变化/);assert.deepEqual(fs.readFileSync(x.file),old);assert.equal(x.r.status().revision,2);noStage(x);});
test('A36 damage to a frozen input while staging cannot publish a new active pointer',t=>{const x=ready(t),before=fs.readFileSync(x.file),inputFile=path.join(x.root,'input.json');afterStage(t,()=>fs.writeFileSync(inputFile,'{}'));assert.throws(()=>x.r.promote(3),/来源或版本/);assert.deepEqual(fs.readFileSync(x.file),before);assert.throws(()=>x.r.status(),/来源或版本/);noStage(x);});
test('A36 rollback remains available without current market evidence and retains old receipts',t=>{const set=clock(t),x=ready(t,{marketGate:true}),p=x.r.promote(3,{marketContext:context()});set(T+24*3600000);const r=x.r.rollback(4);assert.equal(r.active,'baseline');assert.deepEqual(r.events[0],p.events[0]);assert.equal(r.events[1].type,'rollback');assert.equal(x.r.activeProfile(5).id,'baseline');noStage(x);});
