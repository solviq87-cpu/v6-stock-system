'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {assertUnadjustedExecutionPriceBasis}=require('../src/core/historical-execution-price-basis');
const {validateDataset,runValidatedBacktest}=require('../src/core/historical-validation');
const {evaluateResearchSuite}=require('../src/core/research-validation-suite');
const {replayPaperAccount}=require('../src/core/paper-replay');
const {buildSession,validateSession}=require('../src/core/paper-session');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function sample(){
 const dates=Array.from({length:110},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
 return {source:'imported',provider:'eastmoney-public-history',datasetId:'em-unit-fixture',
  asOf:dates.at(-1),stocks:[{code:'600000',market:'main',bars:dates.map((date,i)=>{
   const close=10+i*.015;return {date,open:close,high:close+.2,low:close-.2,
    close,volume:100000};
  })}]};
}
test('qfq/hfq are fine for shape-only research but never for simulated fills, P&L or paper sessions',()=>{
 for(const mode of ['qfq','hfq']){
  const history=sample();
  history.priceAdjustment={mode,provider:'test-research'};
  assert.equal(validateDataset(history).stocks,1,'K-line research still keeps adjusted datasets readable');
  assert.throws(()=>runValidatedBacktest(history),/未复权/);
  assert.throws(()=>evaluateResearchSuite(history,{windows:2,testDays:20}),/未复权/);
  assert.throws(()=>replayPaperAccount(history),/未复权/);
  assert.throws(()=>buildSession(history),/未复权/);
 }
});
test('explicit top-level priceBasis and malformed adjustment cannot be ignored',()=>{
 for(const value of ['qfq','hfq',null,'adjusted']){
  const data=sample();data.priceBasis=value;
  assert.throws(()=>assertUnadjustedExecutionPriceBasis(data),/未复权/);
 }
 for(const adjustment of [null,{},'unadjusted',{mode:'qfq'},{mode:'unknown'}]){
  const data=sample();data.priceAdjustment=adjustment;
  assert.throws(()=>assertUnadjustedExecutionPriceBasis(data),/未复权/);
 }
});
test('vendor fqt/adjustflag contradicting an unadjusted mode is refused before paper execution',()=>{
 for(const provider of ['eastmoney-public-history-fqt-1','eastmoney-public-history-fqt-2',
  'baostock-adjustflag-1','baostock-adjustflag-2']){
  const data=sample();data.priceAdjustment={mode:'unadjusted',provider};
  assert.throws(()=>runValidatedBacktest(data),/矛盾/);
 }
});
test('explicit unadjusted source remains usable only for offline, non-trading research',()=>{
 const data=sample();
 data.priceBasis='unadjusted';
 data.priceAdjustment={mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'};
 assert.equal(assertUnadjustedExecutionPriceBasis(data).basis,'declared-unadjusted-unverified');
 assert.equal(runValidatedBacktest(data).releaseEligible,false);
 assert.equal(evaluateResearchSuite(data,{windows:2,testDays:20}).canTrade,false);
 assert.equal(replayPaperAccount(data).canTrade,false);
 assert.equal(buildSession(data).session.canTrade,false);
});
test('legacy omitted basis remains backward-readable, but never becomes externally verified',()=>{
 const data=sample();
 const audit=assertUnadjustedExecutionPriceBasis(data);
 assert.equal(audit.basis,'legacy-undeclared-unverified');
 assert.equal(audit.verifiedExternal,false);
 assert.equal(audit.canTrade,false);
 assert.equal(buildSession(data).session.verifiedLive,false);
});
test('re-sealing a stored replay with newly declared adjusted history cannot bypass restore checks',()=>{
 const data=sample();data.priceAdjustment={mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'};
 const stored=buildSession(data).session;
 const tampered=structuredClone(stored);
 tampered.history.priceAdjustment={mode:'qfq',provider:'eastmoney-public-history-fqt-1'};
 tampered.historyHash=sha(tampered.history);
 tampered.report.fingerprint=tampered.historyHash;
 tampered.report.provenance.datasetFingerprint=tampered.historyHash;
 tampered.reportHash=sha(tampered.report);
 assert.throws(()=>validateSession(tampered),/完整性/);
});
