'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyRiskFilter,inspectCandidateAmount,prepareCandidateRisk}=require('../src/strategy/risk-filter');
const run=(raw={},strict=false,normalized={amount:0,liquidityScore:30})=>prepareCandidateRisk(normalized,raw,{requireLiquidityEvidence:strict});
test('missing, zero and invalid amount are distinct',()=>{
 for(const raw of [{},{amount:null},{amount:''},{amount:' '}])assert.equal(inspectCandidateAmount(raw).status,'missing');
 assert.equal(inspectCandidateAmount({amount:0,amountUnit:'CNY'}).amountYuan,0);
 assert.equal(inspectCandidateAmount({'成交额':'0'}).status,'zero');
 for(const amount of [false,[],[1e8],{},-1,NaN,Infinity])assert.equal(inspectCandidateAmount({amount}).status,'invalid');
});
test('amount aliases must agree',()=>{
 assert.equal(inspectCandidateAmount({amount:5e6,'成交额':'5000000',amountUnit:'CNY'}).amountYuan,5e6);
 const r=run({amount:5e6,'成交额':1e8});
 assert.equal(r.risk.liquidity.status,'conflict');assert.equal(r.risk.pass,false);assert.equal(r.snapshot.amount,null);
});
test('explicit incompatible or conflicting units are blocked',()=>{
 for(const patch of [{amountUnit:'USD'},{amountUnit:'CNY',quoteUnits:{amount:'USD'}},{amountUnit:'USD',quoteUnits:{amount:'CNY'}}]){
  const r=run({amount:1e8,...patch});assert.equal(r.risk.pass,false);assert.equal(r.snapshot.amount,null);
 }
});
test('missing amount cannot manufacture a zero mark or measured liquidity score',()=>{
 const r=run();assert.equal(r.snapshot.amount,null);assert.equal(r.snapshot.liquidityScore,null);assert.equal(r.risk.pass,true);
 const zero=run({amount:0,amountUnit:'CNY'});assert.equal(zero.snapshot.amount,0);assert.equal(zero.snapshot.liquidityScore,0);assert.equal(zero.risk.pass,false);
});
test('strict mode uses the original 5 million yuan boundary',()=>{
 for(const amount of [0,1,4999999])assert.equal(run({amount,amountUnit:'CNY',liquidityScore:100},true,{liquidityScore:100}).risk.pass,false);
 assert.equal(run({amount:5e6,amountUnit:'CNY'},true).risk.pass,true);
 assert.equal(run({amount:1e8,amountUnit:'CNY'},true).risk.pass,true);
});
test('strict mode requires a declared yuan unit or normalized adapter contract',()=>{
 assert.equal(run({amount:1e8},true).risk.pass,false);
 assert.equal(run({amount:1e8,quoteSource:'eastmoney',quoteMode:'public-live-unverified'},true).risk.pass,true);
 assert.equal(run({amount:1e8,quoteSource:['eastmoney'],quoteMode:'public-live-unverified'},true).risk.pass,false);
 assert.equal(run({volume:1e8,price:10},true).risk.pass,false);
});
test('legacy research keeps soft warning and discloses unspecified unit',()=>{
 const r=run({amount:1e5});assert.equal(r.risk.pass,true);assert.equal(r.risk.liquidity.unitBasis,'legacy-unspecified');
 assert.equal(r.risk.liquidity.amountYuan,null);assert.equal(r.risk.reasons.includes('成交额流动性不足'),true);
});
test('legacy risk filter retains its original contract and hard blocks',()=>{
 assert.equal(applyRiskFilter({amount:0}).pass,true);
 for(const flag of [{isST:true},{suspended:true},{tradable:false},{riskScore:85}])assert.equal(run({amount:1e8,amountUnit:'CNY'},true,flag).risk.pass,false);
});
