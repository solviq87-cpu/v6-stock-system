'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewDerivativeRisk}=require('../src/core/public-market-context');
const YEAR=365*86400000,T=Date.parse('2026-11-27T14:50:00+08:00');
const h='a'.repeat(64),provider='research-source',datasetId='dataset-derivatives',underlyingId='CSI300';
const received=(at=T-1000)=>({provider,datasetId,observedAt:at,receivedAt:at+100,receiptHash:h});
const common={underlyingId,currency:'CNY',unit:'index-points'};
const expiry=T+YEAR,near=T+YEAR/2;
const contract=(contractId,kind,expiryAt,bid,ask,more={})=>({...received(),...common,contractId,kind,expiryAt,bid,ask,
 settlement:'cash',contractKnownAt:T-86400000,contractReceiptHash:'b'.repeat(64),...more});
const carry=(expiryAt,rate=0.02,dividendYield=0.02)=>({...received(T-86400000),underlyingId,currency:'CNY',
 expiryAt,rate,dividendYield,basis:'continuous-rate-and-yield'});
function fixture(){
 return {schemaVersion:1,source:'imported',provider,datasetId,underlyingId,asOf:T,
  model:'black-scholes-merton',dayCount:'ACT/365F',snapshotReceiptHash:'c'.repeat(64),
  scope:{provider,datasetId,underlyingId,usage:'private-derivatives-research',
   permissionRef:'test-only-declared-scope',knownAt:T-2*86400000,validUntil:T+86400000,allowedKinds:['option','future']},
  spot:{...received(),...common,value:100},
  carry:[carry(near),carry(expiry)],
  options:[contract('near','option',near,5.5,5.65,{exercise:'European',right:'call',strike:100}),
   contract('far','option',expiry,11.5,11.9,{exercise:'European',right:'call',strike:100}),
   contract('put','option',near,3.2,3.4,{exercise:'European',right:'put',strike:95}),
   contract('call','option',near,2.0,2.2,{exercise:'European',right:'call',strike:10000/95})],
  futures:[contract('future','future',expiry,101,102)],
  termPairs:[{nearId:'near',farId:'far'}],skewPairs:[{putId:'put',callId:'call'}]};
}
const run=p=>reviewDerivativeRisk(p,{asOf:T});
const assertNear=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<=tol, String(a)+' vs '+String(b));
const safe=r=>{
 for(const k of ['authorizationVerified','sourceVerified','liveDataVerified','modelIndependentlyValidated','canTrade','canTrain','canNotify'])
  assert.equal(r[k],false);
 assert.equal(r.riskPreference,null);assert.equal(r.researchOnly,true);
};
test('F28.1 known European BSM benchmark, bid/mid/ask roots and explicit carry',()=>{
 const p=fixture();p.options=[contract('benchmark','option',expiry,9.2170055,9.2370055,{exercise:'European',right:'call',strike:100})];
 p.carry=[carry(expiry,.05,.02)];p.termPairs=[];p.skewPairs=[];
 const r=run(p),a=r.options[0];safe(r);
 assert.equal(a.status,'conditional-model-implied');assertNear(a.volatility.mid,.2);
 assert.ok(a.volatility.bid<a.volatility.mid&&a.volatility.mid<a.volatility.ask);
 assertNear(a.forwardReference,100*Math.exp(.03));assert.equal(a.evidenceRefs.carry,h);
});
test('F28.1 rejects impossible prices, stale or crossed quotes, unsupported exercise, missing carry and low vega',()=>{
 for(const mutate of [
  p=>{p.options[0].bid=120;p.options[0].ask=121},
  p=>{p.options[0].bid=6;p.options[0].ask=5},
  p=>{p.options[0].bid=1;p.options[0].ask=5},
  p=>{p.options[0].observedAt=T-15001;p.options[0].receivedAt=T-15000},
  p=>{p.options[0].exercise='American'},
  p=>{p.options[0].strike=1000;p.options[0].bid=0.000000001;p.options[0].ask=0.000000001},
  p=>{p.options[0].expiryAt=T},
  p=>{p.options[0].contractKnownAt=T},
  p=>{p.options[0].contractReceiptHash='missing'},
  p=>{p.carry=p.carry.filter(x=>x.expiryAt!==near)},
  p=>{p.carry.push({...p.carry[0]})},
  p=>{p.carry[0].receivedAt=T},
  p=>{p.carry[0].basis='simple-rate'},
  p=>{p.options[0].synthetic=true}
 ]){
  const p=fixture();mutate(p);const r=run(p);safe(r);
  assert.equal(r.options[0].status,'unknown');assert.equal(r.options[0].volatility,undefined);
  assert.equal(r.termStructure[0].farMinusNear,null);
 }
});
test('F28.2 explicit comparable maturities preserve bid ask difference envelope',()=>{
 const p=fixture(),r=run(p);safe(r);
 const near=r.options[0].volatility,far=r.options[1].volatility,t=r.termStructure[0];
 assert.equal(t.status,'conditional-matched-moneyness');
 assertNear(t.farMinusNear.mid,far.mid-near.mid);
 assertNear(t.farMinusNear.lower,far.bid-near.ask);assertNear(t.farMinusNear.upper,far.ask-near.bid);
 assert.ok(t.farMinusNear.mid>0);
 p.options[1].strike=105;
 const bad=run(p);assert.equal(bad.termStructure[0].status,'unknown');
 assert.equal(bad.termStructure[0].farMinusNear,null);
});
test('F28.2 reversed tenor, different option right and missing quote never produce a term slope',()=>{
 for(const mutate of [
  p=>{p.termPairs=[{nearId:'far',farId:'near'}]},
  p=>{p.options[1].right='put'},
  p=>{p.options[1].receiptHash='bad'}
 ]){
  const p=fixture();mutate(p);assert.equal(run(p).termStructure[0].farMinusNear,null);
 }
});
test('F28.3 same-expiry symmetric forward moneyness put-minus-call is conditional, no PCR or direction signal',()=>{
 const p=fixture(),r=run(p),s=r.skew[0],put=r.options[2].volatility,call=r.options[3].volatility;
 safe(r);assert.equal(s.status,'conditional-symmetric-otm-skew');
 assertNear(s.putMinusCall.mid,put.mid-call.mid);
 assertNear(s.putMinusCall.lower,put.bid-call.ask);
 assertNear(s.putMinusCall.upper,put.ask-call.bid);
 p.options[3].strike=110;
 assert.equal(run(p).skew[0].putMinusCall,null);
});
test('F28.3 wrong expiry, call/put reversal or unusable liquidity remains unknown',()=>{
 for(const mutate of [
  p=>{p.options[3].expiryAt=expiry},
  p=>{p.skewPairs=[{putId:'call',callId:'put'}]},
  p=>{p.options[3].bid=1;p.options[3].ask=4}
 ]){
  const p=fixture();mutate(p);assert.equal(run(p).skew[0].putMinusCall,null);
 }
});
test('F28.4/F08.4 common spot-future basis uses declared carry and quote bounds, no arbitrage claim',()=>{
 const p=fixture();p.carry[1]=carry(expiry,.05,.02);
 const r=run(p),b=r.basis[0];safe(r);
 assert.equal(b.status,'conditional-carry-reference');
 assertNear(b.rawBasisPoints,1.5);assertNear(b.carryFairReference,100*Math.exp(.03));
 assertNear(b.carryAdjustedPoints,101.5-b.carryFairReference);
 assertNear(b.carryAdjustedBounds.lower,101-b.carryFairReference);
 assertNear(b.carryAdjustedBounds.upper,102-b.carryFairReference);
 assert.equal(b.realizedCarry,null);assert.equal(b.executionCost,null);assert.equal(b.arbitrageVerified,false);
 for(const mutate of [
  p=>{p.carry[1].dividendYield=null},
  p=>{p.futures[0].underlyingId='other-index'},
  p=>{p.futures[0].unit='CNY'},
  p=>{p.futures[0].receivedAt=T+1},
  p=>{p.futures[0].expiryAt=T}
 ]){
  const q=fixture();mutate(q);const b=run(q).basis[0];
  assert.equal(b.status,'unknown');assert.equal(b.rawBasisPct,undefined);
 }
});
test('F28 all functions stay unavailable without explicit scope, original point-in-time evidence and unambiguous contracts',()=>{
 const r=reviewDerivativeRisk();safe(r);assert.equal(r.status,'unknown');
 for(const mutate of [
  p=>{delete p.scope},p=>{p.scope.validUntil=T},p=>{p.scope.knownAt=T},
  p=>{p.scope.datasetId='another'},p=>{p.scope.allowedKinds=['option']},
  p=>{p.spot.observedAt=T-15001},p=>{p.spot.receivedAt=T+1},p=>{p.spot.receiptHash='bad'},
  p=>{p.spot.provider='another'},p=>{p.options[1].contractId=p.options[0].contractId},
  p=>{p.termPairs.push({...p.termPairs[0]})},p=>{p.options=Array(65).fill(p.options[0])},
  p=>{p.asOf=T-1},p=>{p.model='unidentified'},p=>{p.simulated=true}
 ]){
  const p=fixture();mutate(p);const r=run(p);safe(r);
  assert.equal(r.status,'unknown');assert.deepEqual(r.options,[]);assert.deepEqual(r.basis,[]);
 }
});
test('F28 review is opt-in and leaves source snapshot and normal context collector intact',()=>{
 const p=fixture(),before=JSON.stringify(p);const r=run(p);safe(r);
 assert.equal(r.status,'conditional-research');assert.equal(JSON.stringify(p),before);
 r.options[0].volatility.mid=999;assert.notEqual(run(p).options[0].volatility.mid,999);
 assert.equal(typeof require('../src/core/public-market-context').fetchPublicContext,'function');
});
