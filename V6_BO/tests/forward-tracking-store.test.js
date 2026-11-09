'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {runOnce,readSnapshot,readJson}=require('../src/core/forward-tracking-store');
const {parse}=require('../scripts/forward-tracking-cloud');
const at=d=>Date.parse(d+'T16:00:00+08:00');
const dates=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
function fixture(){
 const feed={source:'imported',provider:'offline-unit-test-not-certified',datasetId:'demo-cohort',priceBasis:'unadjusted'};
 const cohort=freezeCohort({schemaVersion:1,feed,signals:[{signalId:'immutable-001',symbol:'600001',
  system:'fourteen',cohort:'条件甲',provenance:'offline-test-only',
  signalDate:dates[0],signalAt:at(dates[0]),baselineClose:10}]},{now:at(dates[0])+1000});
 function market(end=1,values=dates.map((_,i)=>10+i)){
  return {schemaVersion:1,feed,asOf:dates[end],observedAt:at(dates[end]),calendar:dates,
   stocks:[{symbol:'600001',corporateActions:[],bars:dates.slice(0,end+1).map((date,i)=>({
    date,close:values[i],volume:100+i,suspended:false}))}]};
 }
 return {cohort,market};
}
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-forward-cloud-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,file:path.join(dir,'private','current.json')};
}
test('durable restart: same evidence idempotent, next trading day matures without replacing frozen signals',t=>{
 const {file,dir}=temp(t),f=fixture(),first=runOnce({cohort:f.cohort,market:f.market(1),stateFile:file,now:at(dates[1])+1000});
 assert.equal(first.changed,true);assert.equal(first.revision,1);
 assert.equal(readSnapshot(file).report.records[0].windows[0].status,'observed');
 assert.equal(readSnapshot(file).report.records[0].windows[1].status,'pending');
 const again=runOnce({cohort:f.cohort,market:f.market(1),stateFile:file,now:at(dates[1])+1000});
 assert.equal(again.changed,false);assert.equal(again.revision,1);
 const second=runOnce({cohort:f.cohort,market:f.market(5),stateFile:file,now:at(dates[5])+1000});
 assert.equal(second.revision,2);
 const saved=readSnapshot(file);
 assert.equal(saved.report.records[0].windows[1].status,'observed');
 assert.equal(saved.report.records[0].windows[1].priceReturnPct,50);
 assert.equal(saved.audit.groups[0].windows[2].observedCount,0);
 assert.equal(saved.audit.groups[0].windows[2].positiveFractionPct,null);
 assert.equal(fs.readdirSync(path.join(dir,'private','forward-tracking-history')).length,2);
 assert.equal(fs.statSync(file).mode&0o777,0o600);
});
test('backdated updates or rewritten observed returns cannot overwrite existing sealed archive',t=>{
 const {file}=temp(t),f=fixture();
 runOnce({cohort:f.cohort,market:f.market(5),stateFile:file,now:at(dates[5])+1000});
 const before=fs.readFileSync(file,'utf8');
 assert.throws(()=>runOnce({cohort:f.cohort,market:f.market(1),stateFile:file,
  now:at(dates[5])+1000}),/更旧/);
 const changed=f.market(6);changed.stocks[0].bars[1].close=90;
 assert.throws(()=>runOnce({cohort:f.cohort,market:changed,stateFile:file,
  now:at(dates[6])+1000}),/倒退或改价/);
 assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('corrupt archive rejects reads and cannot be overwritten by a new run',t=>{
 const {file}=temp(t),f=fixture();
 runOnce({cohort:f.cohort,market:f.market(1),stateFile:file,now:at(dates[1])+1000});
 const data=JSON.parse(fs.readFileSync(file,'utf8'));data.report.records[0].windows[0].priceReturnPct=999;
 fs.writeFileSync(file,JSON.stringify(data));
 assert.throws(()=>readSnapshot(file),/完整性/);
 assert.throws(()=>runOnce({cohort:f.cohort,market:f.market(5),stateFile:file,
  now:at(dates[5])+1000}),/完整性/);
});
test('untrusted fixture/simulated source and links to hidden state are rejected',t=>{
 const {file,dir}=temp(t),f=fixture();
 f.cohort.feed.source='fixture';
 assert.throws(()=>runOnce({cohort:f.cohort,market:f.market(1),stateFile:file}),/明确导入/);
 const actual=path.join(dir,'real');fs.mkdirSync(actual);
 const link=path.join(dir,'alias');fs.symlinkSync(actual,link,'dir');
 assert.throws(()=>readSnapshot(path.join(link,'report.json')),/符号链接/);
});
test('existing process lock cannot trigger duplicate writes',t=>{
 const {file}=temp(t),f=fixture();fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file+'.lock','active');
 assert.throws(()=>runOnce({cohort:f.cohort,market:f.market(1),stateFile:file}),/禁止并发/);
 assert.equal(fs.existsSync(file),false);
});
test('cloud worker parsing supports bounded polling only and never implicit market access',()=>{
 assert.equal(parse(['once','/a','/b','/c']).mode,'once');
 assert.equal(parse(['watch','/a','/b','/c','--interval','15000']).interval,15000);
 assert.throws(()=>parse(['watch','/a','/b','/c','--interval','100']),/轮询/);
 assert.throws(()=>parse(['once','/a','/b','/c','--interval','15000']),/once/);
});
