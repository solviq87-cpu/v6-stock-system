'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {tradingFees,maxAffordableQuantity}=require('../src/core/trading-fees');
const day='2026-11-05', nextDay='2026-11-06';
const policy={version:'fee-v1',feeBps:2.5,minFee:5,sellTaxBps:5,transferBps:1,commissionScope:'order-day'};
const cents=n=>Math.round(n*100);
const calc=(over={})=>tradingFees({side:'buy',quantity:100,price:10,tradeDate:day,policy,...over});
function row(over={}){const feeEvidence=calc();return {eventId:'first',type:'fill',date:day,quantity:100,price:10,fee:feeEvidence.total,feeEvidence,...over};}
const bad=(rows,over={})=>assert.throws(()=>calc({priorFills:rows,...over}),/历史.*费用|费用证据|范围/);

test('original fill policy preserves total-once rounding and affordability',()=>{
 const p={...policy,commissionScope:'fill',feeBps:3.35,minFee:0,sellTaxBps:3.35,transferBps:3.35};
 const f=calc({side:'sell',policy:p});assert.equal(f.total,1.01);
 assert.equal(cents(f.commission)+cents(f.tax)+cents(f.transfer)+cents(f.roundingAdjustment),cents(f.total));
 assert.equal(maxAffordableQuantity({budget:1005.1,price:10,tradeDate:day,policy}),100);
 assert.equal(maxAffordableQuantity({budget:1005.09,price:10,tradeDate:day,policy}),0);
});
test('valid order-day fills retain minimum once and sum to the one-fill target',()=>{
 for(const side of ['buy','sell'])for(const p of [policy,{...policy,minFee:0,feeBps:3.35,sellTaxBps:3.35,transferBps:3.35}]){
  const prior=[];let total=0,gross=0;
  for(const [i,price] of [10,12.34,3.57,13.17,19.05].entries()){
   const f=calc({side,price,policy:p,priorFills:prior});assert.ok(f.total>=0);total+=cents(f.total);gross+=cents(f.gross);
   assert.equal(cents(f.total),cents(f.commission)+cents(f.tax)+cents(f.transfer)+cents(f.roundingAdjustment));
   prior.push({eventId:`fill-${i}`,type:'fill',date:day,quantity:100,price,fee:f.total,feeEvidence:f});
   const target=calc({side,quantity:1,price:gross/100,policy:p});assert.equal(total,cents(target.total));
  }
 }
});
test('other day or explicitly different version does not consume current minimum; non-fill events ignored',()=>{
 const old=row({date:'2026-11-04'}),other=row({feeEvidence:{...row().feeEvidence,version:'old-v0'}});
 assert.deepEqual(calc({priorFills:[old,other,{type:'cancel',date:day}]}),calc());
 assert.deepEqual(calc({tradeDate:nextDay,priorFills:[row()]}),calc({tradeDate:nextDay}));
});
test('compatibility: calculator accepts dated minimal fee rows without optional event fields',()=>{
 const f=calc();const r=calc({priorFills:[{date:day,feeEvidence:f}]});assert.equal(r.commission,0);assert.equal(r.total,.1);
});
test('inflated prior total cannot become a negative incremental fee',()=>{
 const r=row();r.feeEvidence.total=100;r.fee=100;bad([r]);
});
test('understated total and components are rejected rather than silently charged in a later fill',()=>{
 const r=row();r.feeEvidence.total=0;r.fee=0;bad([r]);
 const r2=row();r2.feeEvidence.commission=0;bad([r2]);
});
test('same-day fill missing fee evidence or version is unknown, not a fresh minimum',()=>{
 bad([row({feeEvidence:null})]);bad([row({feeEvidence:{...row().feeEvidence,version:null}})]);
});
test('fill with unknown or future trade date cannot be treated as unrelated history',()=>{
 bad([row({date:null})]);bad([row({date:'2026-02-30'})]);bad([row({date:nextDay})]);
});
test('duplicate same-day event identity is rejected even at zero fee rates',()=>{
 const p={...policy,minFee:0,feeBps:0,sellTaxBps:0,transferBps:0},f=calc({policy:p});const r=row({feeEvidence:f,fee:0});bad([r,r],{policy:p});
});
test('fee gross is bound to provided fill quantity and price, and fee to total',()=>{
 bad([row({quantity:200})]);bad([row({price:11})]);bad([row({fee:1})]);
});
test('fractional-cent prior components and false rounding adjustment fail closed',()=>{
 const r=row();r.feeEvidence.transfer=.099;bad([r]);
 const r2=row();r2.feeEvidence.roundingAdjustment=1;bad([r2]);
});
test('unsafe monetary range is rejected before any non-finite or unsafe-cent result escapes',()=>{
 assert.throws(()=>calc({quantity:1e14,price:100}),/范围/);
 assert.throws(()=>calc({policy:{...policy,minFee:1e100}}),/范围/);
});

test('non-fill events cannot be credited as fills and same-version fee metadata must agree',()=>{
 bad([row({type:'cancel'})]);
 for(const fields of [{commissionScope:'fill'},{effectiveFrom:'2026-11-01'},{rounding:'per-component'}])bad([row({feeEvidence:{...row().feeEvidence,...fields}})]);
});
test('dated schedule and its known-at boundary retain original behavior',()=>{
 const first={...policy,effectiveFrom:'2026-11-01'},second={...policy,version:'fee-v2',effectiveFrom:nextDay,minFee:10};
 const old=calc({schedules:[first,second]});assert.equal(old.version,first.version);
 const updated=calc({schedules:[first,second],tradeDate:nextDay,priorFills:[row({feeEvidence:old,fee:old.total})]});assert.equal(updated.version,second.version);assert.equal(updated.commission,10);
 assert.throws(()=>calc({schedules:[{...first,knownAt:'2026-11-05T02:00:00Z'}]}),/尚未可知/);
});
