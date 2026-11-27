'use strict';
// Sealed synthetic derived observations; no real orders, data or risk permissions.
const test=require('node:test'),assert=require('node:assert/strict');
const journal=require('../src/core/research-workspace-store');
const {buildPortfolioStressEvidence:stress,classifyAt}=require('../src/core/portfolio-stress-evidence');
const day='2026-11-27',now=Date.parse(day+'T10:00:00+08:00');
const a='600000',b='600001',c='600002';
const cls=(symbol,themes,extra={})=>({symbol,themes,source:'supplied-provider',sourceRecordId:day+'/'+symbol,
  version:'v1',day,knownAt:now-5000,...extra});
const pos=(symbol,value,extra={})=>({symbol,quantity:100,marketValue:value,sellableQuantity:0,todayBlockedQuantity:100,
  frozenQuantity:0,quote:{quoteAt:now},...extra});
function equity(positions=[pos(a,1000),pos(b,2000)],extra={}){
  const value=positions.reduce((sum,p)=>sum+(p.marketValue??0),0);
  const payload={schemaVersion:1,protocol:'fayo-account-equity-evidence-v1',accountId:'pool',accountEpoch:'a'.repeat(64),
    observedAt:now,day,positions,status:'complete',equity:100000,marketValue:value,observedMarketValue:value,
    source:{snapshotFingerprint:'b'.repeat(64)},cashMovements:{status:'reconciled'},canTrade:false,canNotify:false,
    accountMutated:false,manualHoldingsIncluded:false,...extra};
  return {...payload,fingerprint:journal.digest(payload)};
}
const assess=records=>classifyAt(a,records,now,day);
for(const [name,extra] of [
  ['expired', {effectiveTo:now-1}],
  ['explicit withdrawal',{retracted:true}],
  ['empty membership',{themes:[]}],
  ['invalid timestamp',{knownAt:null}],
  ['invalid version',{version:null}]
])test('C 22.11 latest '+name+' cannot resurrect superseded classification',()=>{
  const old=cls(a,['AI']),latest=cls(a,['芯片'],{knownAt:now-2000,version:'v2',...extra});
  for(const rows of [[old,latest],[latest,old]]){
    const result=assess(rows);assert.equal(result.status,'unknown');assert.equal(result.themes,null);
  }
});
test('C 22.11 future or not-yet-effective revisions do not rewrite the observation',()=>{
  const old=cls(a,['AI']);
  for(const row of [cls(a,['芯片'],{knownAt:now+1}),cls(a,['芯片'],{knownAt:now-1000,effectiveFrom:now+1}),
    cls(a,['芯片'],{day:'2026-11-26',knownAt:now-1000})]){
    assert.deepEqual(assess([old,row]).themes,['AI']);
  }
});
test('C 22.11 valid newer evidence supersedes a dated invalid old revision; conflicting current publishers remain conflict',()=>{
  const old=cls(a,['AI'],{version:null}),latest=cls(a,['芯片'],{version:'v2',knownAt:now-1000});
  assert.deepEqual(assess([old,latest]).themes,['芯片']);
  assert.equal(assess([latest,cls(a,['AI'],{source:'other-provider'})]).status,'conflict');
});
test('C 22.11 missing member classification never displays a complete group weight',()=>{
  const r=stress({equity:equity([pos(a,1000),pos(b,2000),pos(c,3000)]),classifications:[cls(a,['AI']),cls(b,['AI'])],now});
  assert.equal(r.groups[0].observedMarketValue,3000);assert.equal(r.groups[0].marketValue,null);
  assert.equal(r.groups[0].weightPct,null);assert.equal(r.groups[0].classificationComplete,false);
  const scenario=r.scenarios.find(s=>s.theme==='AI');assert.equal(scenario.estimatedLoss,null);assert.equal(scenario.coveredLossEstimate,450);
});
test('C 22.10 unknown sellability preserves known mark shock but not total liquidation cost',()=>{
  const e=equity([pos(a,1000,{sellableQuantity:null,todayBlockedQuantity:null,frozenQuantity:null}),pos(b,2000)]);
  const r=stress({equity:e,classifications:[cls(a,['AI']),cls(b,['芯片'])],now});
  const s=r.scenarios.find(x=>x.id==='liquidity-deterioration');
  assert.equal(s.status,'unknown');assert.equal(s.estimatedLoss,null);assert.equal(s.coveredLossEstimate,150);
  assert.equal(s.rows[0].markLoss,50);assert.equal(s.rows[0].additionalLiquidationCost,null);
  assert.equal(s.potentiallySellableLoss,null);assert.equal(s.temporarilyUnsellableLoss,null);
});
test('C 22.11 incomplete or stale portfolio never claims zero loss from no observed overlap',()=>{
  const classifications=[cls(a,['AI']),cls(b,['芯片'])];
  for(const [e,at] of [[equity(undefined,{cashMovements:{status:'unknown'},equity:null}),now],
    [equity(),now+15001],[equity([pos(a,null),pos(b,2000)],{status:'partial',equity:null,marketValue:null}),now],
    [equity([pos(a,1000,{sellableQuantity:null}),pos(b,2000)]),now]]){
    const r=stress({equity:e,classifications,now:at}),s=r.scenarios.find(x=>x.id==='theme-retreat');
    assert.equal(r.status,'partial');assert.equal(s.status,'unknown');assert.equal(s.estimatedLoss,null);
  }
});
test('C 22.11 genuinely complete classifications retain explicit no-overlap and actual T+1 pressure',()=>{
  const r=stress({equity:equity(),classifications:[cls(a,['AI']),cls(b,['芯片'])],now});
  const s=r.scenarios.find(x=>x.id==='theme-retreat'),liq=r.scenarios.find(x=>x.id==='liquidity-deterioration');
  assert.equal(r.status,'observed');assert.equal(s.status,'no-observed-overlap');assert.equal(s.estimatedLoss,0);
  assert.equal(liq.estimatedLoss,150);assert.equal(liq.temporarilyUnsellableLoss,150);assert.equal(liq.potentiallySellableLoss,0);
  assert.equal(liq.executionGuaranteed,false);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
});
