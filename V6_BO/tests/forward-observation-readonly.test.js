'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeCohort,evaluateForward}=require('../src/core/forward-signal-observer');
const {readForwardObservation,validReport}=require('../src/core/forward-observation-readonly');
function actualProtocol(){
 const dates=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09'];
 const feed={source:'imported',provider:'test-fixture-only',datasetId:'local-audit',priceBasis:'unadjusted'};
 const signalAt=Date.parse('2026-11-02T16:05:00+08:00');
 const cohort=freezeCohort({schemaVersion:1,feed,signals:[{
  signalId:'s-1',symbol:'600001',system:'fourteen',cohort:'条件1',
  provenance:'test-only',signalDate:dates[0],signalAt,baselineClose:10
 }]},{now:Date.parse('2026-11-02T18:00:00+08:00')});
 const observedAt=Date.parse('2026-11-09T16:05:00+08:00');
 const report=evaluateForward(cohort,{schemaVersion:1,feed,asOf:dates.at(-1),observedAt,
  calendar:dates,stocks:[{symbol:'600001',corporateActions:[],bars:dates.map((date,i)=>({
   date,close:10+i,volume:100,suspended:false
  }))}]},{now:observedAt+1000});
 return report;
}
function temporary(action){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-forward-ro-'));
 try{return action(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('existing freeze/evaluate output projects unchanged, without inventing returns',()=>{
 const r=actualProtocol();
 assert.equal(validReport(r,Date.parse('2026-11-10T00:00:00+08:00')),true);
 assert.equal(r.records[0].windows[0].status,'observed');
 assert.equal(r.records[0].windows[3].status,'calendar-incomplete');
 assert.equal(r.records[0].windows[3].priceReturnPct,null);
});
test('read requires explicit private absolute regular file, never a website path or symlink',()=>{
 temporary(dir=>{
  const file=path.join(dir,'report.json'),site=path.join(dir,'public');
  fs.mkdirSync(site);
  fs.writeFileSync(file,JSON.stringify(actualProtocol()));
  const options={file,staticRoot:site,now:Date.parse('2026-11-10T00:00:00+08:00')};
  assert.equal(readForwardObservation(),null,'feature disabled by default');
  assert.equal(readForwardObservation({...options,file:'relative/report.json'}),null);
  const r=readForwardObservation(options);
  assert.equal(r.mode,'forward-signal-price-observation');
  assert.equal(r.records.length,1);
  assert.equal(readForwardObservation({...options,staticRoot:dir}),null,'no publicly served input');
  const target=path.join(site,'public.json');fs.copyFileSync(file,target);
  assert.equal(readForwardObservation({...options,file:target}),null);
  const link=path.join(dir,'link.json');fs.symlinkSync(file,link);
  assert.equal(readForwardObservation({...options,file:link}),null);
 });
});
test('fixture/simulated feed and modified observation protocols cannot be presented as imported live results',()=>{
 const base=actualProtocol(),now=Date.parse('2026-11-10T00:00:00+08:00');
 const invalids=[
  {feed:{...base.feed,source:'fixture'}},
  {feed:{...base.feed,source:'simulated'}},
  {verifiedLive:true},
  {canTrade:true},
  {returnBasis:'net-backtest-profit'},
  {cohortFingerprint:'bad'},
  {observedAt:now+60000},
  {asOf:'2026-11-31'},
  {records:[{...base.records[0],signalId:'same'},{...base.records[0],signalId:'same'}]},
  {records:[{...base.records[0],windows:base.records[0].windows.map((w,i)=>i===2?{
   ...w,status:'observed',targetDate:'2026-12-01',priceReturnPct:900
  }:w)}]},
  {records:[{...base.records[0],windows:base.records[0].windows.map((w,i)=>i===3?{
   ...w,status:'calendar-incomplete',priceReturnPct:0
  }:w)}]}
 ];
 for(const patch of invalids)assert.equal(validReport({...base,...patch},now),false,JSON.stringify(patch).slice(0,160));
});
test('corrupted, oversized or missing evidence fails closed and leaves no data',()=>{
 temporary(dir=>{
  const file=path.join(dir,'report.json');
  const options={file,staticRoot:path.join(dir,'public'),now:Date.parse('2026-11-10T00:00:00+08:00')};
  assert.equal(readForwardObservation(options),null);
  fs.writeFileSync(file,'{');
  assert.equal(readForwardObservation(options),null);
  fs.writeFileSync(file,JSON.stringify({...actualProtocol(),feed:{source:'fixture'}}));
  assert.equal(readForwardObservation(options),null);
  fs.writeFileSync(file,'x'.repeat(1024*1024+1));
  assert.equal(readForwardObservation(options),null);
 });
});
test('server retains same cached candidate data for viewer; report only attaches to editor GET',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const route=s.slice(s.indexOf("if (p === '/api/quant-picks')"),s.indexOf("if (p === '/api/auction-resonance')"));
 assert.match(route,/req\.method === 'GET' && isEditorReq\(req\)/);
 assert.match(route,/process\.env\.V6_FORWARD_OBSERVATION_FILE/);
 assert.match(route,/readForwardObservation/);
 assert.match(route,/forwardTracking/);
 assert.match(route,/\{\.\.\.d, forwardTracking:/);
 assert.doesNotMatch(route,/d\.forwardTracking\s*=/,'no cache mutation which can leak editor report to viewers');
 assert.doesNotMatch(route,/method\s*:\s*['"]POST|force\s*:\s*true/);
});
