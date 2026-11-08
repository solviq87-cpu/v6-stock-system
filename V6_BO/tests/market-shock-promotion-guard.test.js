'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {fixture}=require('./helpers/adaptive-fixture');
const {createRegistry}=require('../src/core/learning-profile-registry');
function datedInput(){
 const d=fixture(150);
 for(const s of d.stocks)s.bars.forEach((b,i)=>{
  const close=(s.symbol==='600000'?20:30)*1.01**i;
  Object.assign(b,{close,open:close*.9998,high:close*1.0005,low:close*.9995});
 });
 d.simulation={initialCash:100000,topN:2,holdDays:1,
  feeBps:8,slippageBps:10,sellTaxBps:5};
 return d;
}
function planFor(d,gate='required-on-promote'){
 const dates=d.stocks[0].bars.map(b=>b.date);
 return {schemaVersion:1,version:'market-shock-promotion-v1',
  trainEnd:dates[79],validationEnd:dates[114],holdoutEnd:dates.at(-1),
  ...(gate===undefined?{}:{marketGateMode:gate}),
  gates:{minClosedTrades:3,maxDrawdownPct:10,minReturnPct:0,
   minExcessReturnPct:0,costStressBps:10},
  candidates:[{id:'prior4',parameters:{learningConfig:{minimumSamples:20,priorStrength:4}}}]};
}
function context(changes=[-3.5,-4.1,-4.6],breadthPct=18){
 const now=Date.now(),observedAt=now-1000,tradeDate=new Date(now+8*3600000).toISOString().slice(0,10);
 const provider='operator-market-study';
 const index=changePct=>({changePct,source:provider,observedAt});
 return {schemaVersion:1,source:'imported',provider,tradeDate,observedAt,
  coverage:.93,breadth:{upPct:breadthPct,source:provider,observedAt},
  indices:{shanghai:index(changes[0]),shenzhen:index(changes[1]),chinext:index(changes[2])}};
}
test('frozen market guard blocks unverified or shock-time promotion, retains ledger evidence, and allows later valid promotion',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shock-promotion-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'registry'),r=createRegistry(root);
 const input=datedInput(),plan=planFor(input);
 const frozen=r.freeze(input,plan);
 assert.equal(frozen.active,'baseline');
 assert.equal(frozen.revision,1);
 assert.equal(r.evaluate(1).evaluation.selectedId,'prior4');
 assert.equal(r.testHoldout(2).holdout.eligible,true);
 const stateFile=path.join(root,'state.json'),before=fs.readFileSync(stateFile);
 assert.throws(()=>r.promote(3),/市场证据/);
 assert.throws(()=>r.promote(3,{marketContext:{...context(),source:'simulated'}}),/市场证据/);
 assert.throws(()=>r.promote(3,{marketContext:context()}),/系统性急跌/);
 assert.equal(r.status().revision,3);
 assert.equal(r.status().active,'baseline');
 assert.deepEqual(fs.readFileSync(stateFile),before,'blocked promotions must not write a registry revision');
 const healthy=context([-1,-1.5,-.6],68);
 const cli=path.resolve(__dirname,'../scripts/learning-profile.js');
 const marketFile=path.join(dir,'market.json');fs.writeFileSync(marketFile,JSON.stringify(healthy));
 const p=spawnSync(process.execPath,[cli,'promote',root,'--expected-revision','3',
   '--market-context',marketFile],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 const promoted=r.status();
 assert.equal(promoted.active,'prior4');
 assert.equal(promoted.events.length,1);
 assert.equal(promoted.events[0].marketGate.marketRegime,'not-systemic-selloff');
 assert.equal(promoted.events[0].marketGate.returnSamplesPreserved,true);
 assert.equal(promoted.events[0].marketGate.riskMonitoringRequired,true);
 assert.equal(promoted.events[0].marketGate.evidenceFingerprint.length,64);
 assert.equal(r.promote(4).revision,4,'idempotent promotion does not require a fresh input');
 assert.equal(r.rollback(4).active,'baseline','risk reducing rollback cannot be blocked by a selloff');
 assert.equal(r.verify({replay:true}).verified,true);
});
test('unknown market promotion gate modes are rejected before registry can be frozen',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shock-invalid-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=datedInput(),plan=planFor(input,'disable-risk-checks');
 assert.throws(()=>createRegistry(path.join(dir,'registry')).freeze(input,plan),/市场学习晋级门禁模式无效/);
});
