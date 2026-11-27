'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
const {adaptNativeStrategies}=require('../src/core/native-adaptive-adapter');
const {projectFourteenEvidence}=require('../src/core/native-fourteen-evidence');
const dates=Array.from({length:70},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10)),date=dates[68],symbol='600000';
const at=(d,t='15:30:00')=>Date.parse(d+'T'+t+'+08:00');
const history={source:'simulated',asOf:dates.at(-1),stocks:[{code:symbol,bars:dates.map(d=>({date:d,open:10,high:10.1,low:9.9,close:10,volume:10000,amount:1e8}))}]};
const evidence=patch=>({symbol,date,knownAt:at(date),source:'isolated-fixture',stock:{limitUpCount:0,breakCount:0,amount:1e8,sealAmount:0},
 sector:{pct:3,ztCount:5},auction:{auctionAmount:5e7,auctionPct:4.5},lhb:{whale:true,whaleNet:1e7,why:'fixture'},...patch});
const snapshot=e=>({symbol,observedThrough:date,knownAt:at(date),floatCap:5e9,fourteenEvidence:e});
const run=e=>runNativeDaily(history,{snapshots:{[symbol+'/'+date]:snapshot(e)}});
const row=e=>run(e).details[68].results.fourteen;
test('known zero consecutive boards and valid same-session native evidence restore evaluated replay',()=>{
 const r=run(evidence()),f=r.details[68].results.fourteen;
 assert.equal(f.verdict,'pass');assert.equal(f.exclusionPending,false);
 assert.equal(f.snapshotEvidence.source,'isolated-fixture');
 assert.equal(r.signals.find(s=>s.system==='fourteen'&&s.date===date).evaluatorVersion,'v6-fourteen-native-2');
 assert.equal(r.canTrade,false);
});
test('missing original count remains unknown and known four boards remains rejected',()=>{
 const x=evidence();delete x.stock.limitUpCount;
 assert.equal(row(x).verdict,'unknown');assert.equal(row(x).exclusionPending,true);
 assert.equal(row(evidence({stock:{limitUpCount:4}})).verdict,'fail');
 for(const bad of [null,undefined,-1,'0',1.5])assert.equal(row(evidence({stock:{limitUpCount:bad}})).verdict,'unknown');
});
test('other-stock, other-day, missing provenance and later evidence never restore native admission',()=>{
 for(const patch of [{symbol:'600001'},{date:dates[67]},{source:''},{knownAt:at(dates[69])},{knownAt:at(date,'16:00:00')},
  {stock:{limitUpCount:0,price:1}},{stock:{limitUpCount:0,code:'600001'}},{auction:{auctionAmount:5e7,auctionPct:4.5,knownAt:at(dates[69])}}]){
  const f=row(evidence(patch));assert.equal(f.verdict,'unknown',JSON.stringify(patch));assert.equal(f.snapshotEvidence,null);
 }
});
test('direct projection rejects explicit artificial data in non-synthetic history',()=>{
 const e=evidence({simulated:true}),s=snapshot(e),opt={symbol,date,cutoff:at(date,'16:00:00')};
 assert.equal(projectFourteenEvidence(s,opt),null);
 assert.equal(projectFourteenEvidence(s,{...opt,allowSynthetic:true}).stock.limitUpCount,0);
});
test('adaptive 16:00 boundary does not adopt a later nested receipt',()=>{
 const stocks=history.stocks.map(s=>({...s,bars:s.bars.map(b=>({...b,knownAt:b.date+'T15:10:00+08:00'}))}));
 const e=evidence({knownAt:date+'T16:00:00+08:00'}),s={...snapshot(e),knownAt:date+'T16:00:00+08:00',provider:'fixture',version:'1'};
 const input={...history,decisionAt:history.asOf+'T16:00:00+08:00',nativeEvidence:{schemaVersion:1,snapshots:{[symbol+'/'+date]:s}}};
 let a=adaptNativeStrategies(input,stocks);
 assert.equal(a.audit.signals.find(x=>x.system==='fourteen'&&x.date===date).verdict,'pass');
 s.fourteenEvidence={...e,knownAt:date+'T16:00:01+08:00'};
 a=adaptNativeStrategies(input,stocks);
 assert.equal(a.audit.signals.find(x=>x.system==='fourteen'&&x.date===date).verdict,'unknown');
 assert.ok(a.audit.omitted.some(x=>x.reason==='FOURTEEN_EVIDENCE_NOT_KNOWN_AT_DAILY_DECISION'));
});
