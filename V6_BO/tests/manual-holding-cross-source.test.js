'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evaluateManualHoldingRisks:evaluate,readManualHoldingWatchFile:readFile}
 =require('../src/core/manual-holding-risk-watch');
const now=Date.parse('2026-11-09T07:50:00Z');
function sample(){
 return {schemaVersion:1,mode:'manual-holding-watch',
  positions:[{symbol:'600001',name:'虚构股票',cost:10,shares:1000,weightPct:32}],
  quotes:[{symbol:'600001',price:8.8,quoteAt:now-1000,quoteSource:'eastmoney'}],
  crossCheckQuotes:[{symbol:'600001',price:8.81,quoteAt:now-2000,quoteSource:'tencent'}]};
}
test('two declared independent same-day source prices within tolerance permit unverified research only',()=>{
 const input=sample(),before=structuredClone(input);
 const r=evaluate(input,{now}),p=r.positions[0];
 assert.equal(r.status,'evaluated');
 assert.equal(p.crossCheckStatus,'agree-unverified');
 assert.equal(p.quoteStatus,'recent-provider-unverified');
 assert.equal(p.price,8.8);assert.equal(p.drawdownFromCostPct,-12);
 assert.ok(p.crossSourceDifferenceBps>0&&p.crossSourceDifferenceBps<=50);
 assert.ok(r.alerts.some(x=>x.code==='loss-warning'));
 assert.ok(r.alerts.some(x=>x.code==='weight-warning'));
 assert.equal(r.counts.conflictingQuotes,0);
 assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.equal(r.providerVerified,false);assert.equal(r.exchangeVerified,false);
 assert.equal(r.autoOrders,false);
 assert.deepEqual(input,before);
});
test('conflicting current prices quarantine both cost PnL and actionable price loss alerts, but keep explicit concentration',()=>{
 const data=sample();data.crossCheckQuotes[0].price=9.5;
 const r=evaluate(data,{now}),p=r.positions[0];
 assert.equal(p.quoteStatus,'source-conflict');
 assert.equal(p.crossCheckStatus,'price-conflict');
 assert.equal(p.price,null);assert.equal(p.drawdownFromCostPct,null);
 assert.equal(p.quoteAt,null);assert.equal(p.quoteSource,null);
 assert.equal(r.counts.withRecentSourceQuote,0);
 assert.equal(r.counts.missingOrUnusableQuotes,1);
 assert.equal(r.counts.conflictingQuotes,1);
 assert.ok(r.alerts.some(x=>x.id==='600001:cross-source-conflict'));
 assert.ok(r.alerts.some(x=>x.id==='600001:concentration'));
 assert.ok(!r.alerts.some(x=>x.id==='600001:cost-loss'));
 assert.ok(r.alerts.every(x=>x.canNotify===false));
});
test('missing, stale, synthetic or self-correlated second source cannot certify the primary',()=>{
 const cases=[
  {mutate:d=>delete d.crossCheckQuotes,expected:'not-provided'},
  {mutate:d=>d.crossCheckQuotes[0].quoteAt=now-20000,expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].quoteAt=now+1,expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].quoteSource='SIMULATED',expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].quoteSource='EASTMONEY',expected:'same-source-not-independent'},
  {mutate:d=>d.crossCheckQuotes[0].simulated=true,expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].proxy=true,expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].readOnlyBackup=true,expected:'secondary-unusable'},
  {mutate:d=>d.crossCheckQuotes[0].suspended=true,expected:'secondary-unusable'}
 ];
 for(const {mutate,expected} of cases){
  const data=sample();mutate(data);
  const r=evaluate(data,{now}),p=r.positions[0];
  assert.equal(p.crossCheckStatus,expected,JSON.stringify(data));
  assert.equal(p.price,8.8,'invalid second source must not supply a fallback quote');
  assert.equal(p.drawdownFromCostPct,-12);
  assert.equal(r.providerVerified,false);
 }
});
test('valid second source cannot bypass an expired, simulated or missing primary quote',()=>{
 for(const change of [
  d=>d.quotes[0].quoteAt=now-30000,
  d=>d.quotes[0].quoteAt=now+1,
  d=>d.quotes[0].quoteSource='simulated',
  d=>d.quotes.length=0
 ]){
  const d=sample();change(d);
  const p=evaluate(d,{now}).positions[0];
  assert.equal(p.crossCheckStatus,'primary-unusable');
  assert.equal(p.drawdownFromCostPct,null);assert.equal(p.price,null);
 }
});
test('cross-source price difference uses symmetric basis points without rounding away large conflicts',()=>{
 const base=sample(),p=base.quotes[0].price;
 base.crossCheckQuotes[0].price=p*1.004;
 const ok=evaluate(base,{now});
 assert.equal(ok.positions[0].crossCheckStatus,'agree-unverified');
 base.crossCheckQuotes[0].price=p*1.01;
 const bad=evaluate(base,{now});
 assert.equal(bad.positions[0].crossCheckStatus,'price-conflict');
 assert.ok(bad.positions[0].crossSourceDifferenceBps>50);
 // At the threshold, the displayed 2-decimal BPS may read 50.00,
 // but the unrounded comparison must still quarantine a 50.004 BPS difference.
 base.crossCheckQuotes[0].price=p/(1-50.004/10000);
 const edge=evaluate(base,{now});
 assert.equal(edge.positions[0].crossCheckStatus,'price-conflict');
 assert.equal(edge.positions[0].crossSourceDifferenceBps,50);
 assert.equal(edge.positions[0].price,null);
});
test('duplicate or malformed crosscheck rows fail closed instead of picking favorable evidence',()=>{
 for(const change of [
  d=>d.crossCheckQuotes='invalid',
  d=>d.crossCheckQuotes.push({...d.crossCheckQuotes[0]}),
  d=>d.crossCheckQuotes[0].symbol='not-code',
  d=>d.crossCheckQuotes=Array.from({length:101},()=>({symbol:'600001'}))
 ]){
  const d=sample();change(d);assert.throws(()=>evaluate(d,{now}));
 }
});
test('private file reread never retains prior conflicted price after source changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-crossquote-'));
 const file=path.join(dir,'manual.json');
 try{
  const data=sample();data.crossCheckQuotes[0].price=10.5;
  fs.writeFileSync(file,JSON.stringify(data),{mode:0o600});
  assert.equal(readFile(file,{now}).positions[0].quoteStatus,'source-conflict');
  data.crossCheckQuotes[0].price=8.81;
  fs.writeFileSync(file,JSON.stringify(data));
  assert.equal(readFile(file,{now}).positions[0].drawdownFromCostPct,-12);
  assert.equal(readFile(file,{now:now+30000}).positions[0].price,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
