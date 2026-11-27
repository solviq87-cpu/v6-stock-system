'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {evaluateEntryRisk}=require('../src/core/common-entry-risk');
const {buildEffectiveRiskEvidence}=require('../src/core/effective-risk-evidence');
const now=Date.parse('2026-11-27T10:00:00+08:00');
const base={policy:{version:'boundary',maxPositionPct:20},symbol:'600000',quantity:10,price:10,cash:1000,marks:{600000:10}};
function unknown(x){assert.equal(x.allowed,false);assert.ok(x.reasonCodes.includes('MISSING_POSITION_MARKS'));assert.equal(x.exposure.single,null);}
function seal(b){const h=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');b.account.fingerprint=h({cash:b.account.cash,positions:b.account.positions,events:b.account.events});delete b.fingerprint;b.fingerprint=h(b);return b;}
function input(prices,{cash=100000,qty=1,orders={}}={}){
 const positions={},quotes={};
 prices.forEach((price,i)=>{const symbol=String(600000+i);positions[symbol]={quantity:qty,lots:[{quantity:qty,buyDate:'2026-11-26',price:10,sourceEventId:'opening-'+symbol}]};quotes[symbol]={symbol,price,quoteSource:'tencent',provider:'tencent',quoteAt:now,receivedAt:now,mode:'public-live-unverified',canTrade:true,tradable:true};});
 return {book:seal({schemaVersion:1,revision:1,paperOnly:true,brokerConnected:false,initialCash:100000,account:{cash,positions,events:[],eventHashes:{}},orders,feePolicy:{version:'v',feeBps:0,minFee:0,sellTaxBps:0},riskPolicy:{version:'boundary',maxPositionPct:20,maxGrossExposurePct:80}}),quotes,now};
}
const rule=(r,id)=>r.rules.find(x=>x.id===id);
function finiteTree(v){if(typeof v==='number')assert.ok(Number.isFinite(v),'nonfinite output');else if(v&&typeof v==='object')Object.values(v).forEach(finiteTree);}
function unknownRules(r){for(const id of ['maxPositionPct','maxGrossExposurePct']){const x=rule(r,id);assert.equal(x.used,null);assert.equal(x.exceeded,null);assert.notEqual(x.evidenceStatus,'available');assert.equal(x.buckets.length,0);}}
test('inherited holding identity is missing evidence, not a concentration bypass',()=>unknown(evaluateEntryRisk({...base,positions:[Object.create({symbol:'600000',quantity:100})]})));
test('inherited pending order fields are missing evidence',()=>unknown(evaluateEntryRisk({...base,cash:2000,pending:[Object.create({symbol:'600000',quantity:100,price:10})]})));
test('own nonenumerable holding fields retain the same concentration as normal rows',()=>{const r=evaluateEntryRisk({...base,positions:[Object.defineProperties({}, {symbol:{value:'600000'},quantity:{value:100}})]});assert.equal(r.allowed,false);assert.equal(r.exposure.single,1100);assert.ok(r.reasonCodes.includes('SINGLE_POSITION_LIMIT'));});
test('own nonenumerable pending fields retain the same concentration',()=>{const r=evaluateEntryRisk({...base,cash:2000,pending:[Object.defineProperties({}, {symbol:{value:'600000'},quantity:{value:100},price:{value:10}})]});assert.equal(r.allowed,false);assert.equal(r.exposure.single,1100);});
test('accessor holdings and marks are not invoked as authoritative values',()=>{const row={quantity:100};Object.defineProperty(row,'symbol',{get(){throw Error('getter should not execute');}});unknown(evaluateEntryRisk({...base,positions:[row]}));const marks={};Object.defineProperty(marks,'600000',{get(){throw Error('mark getter should not execute');}});unknown(evaluateEntryRisk({...base,positions:[{symbol:'600000',quantity:100}],marks}));});
test('ordinary exposure and original concentration limits stay unchanged',()=>{const r=evaluateEntryRisk({...base,positions:[{symbol:'600000',quantity:100}]});assert.equal(r.allowed,false);assert.equal(r.exposure.single,1100);});
test('huge but finite valuation rounding cannot output Infinity or invent unknown data',()=>{const r=buildEffectiveRiskEvidence(input([1e305]));assert.equal(r.occupancy.heldValue,1e305);assert.equal(rule(r,'maxPositionPct').used,100);assert.equal(rule(r,'maxPositionPct').exceeded,true);finiteTree(r);});
test('individual position product overflow blocks all dependent exposure evidence',()=>{const r=buildEffectiveRiskEvidence(input([1e308],{qty:2}));assert.equal(r.occupancy.heldValue,null);assert.equal(r.occupancy.equity,null);assert.equal(r.occupancy.totalExposure,null);unknownRules(r);finiteTree(r);});
test('aggregate holding overflow never reports zero percent or an all-clear rule',()=>{const r=buildEffectiveRiskEvidence(input([1e308,9e307]));assert.equal(r.occupancy.heldValue,null);assert.equal(r.occupancy.equity,null);assert.equal(r.occupancy.totalExposure,null);unknownRules(r);finiteTree(r);});
test('cash plus held equity overflow leaves both dependent rules unknown',()=>{const r=buildEffectiveRiskEvidence(input([1e308],{cash:1e308}));assert.equal(r.occupancy.equity,null);assert.equal(r.occupancy.heldValue,1e308);unknownRules(r);finiteTree(r);});
test('normal valuation and original six-decimal rounding remain compatible',()=>{const r=buildEffectiveRiskEvidence(input([10000]));assert.equal(r.occupancy.equity,110000);assert.equal(r.occupancy.heldValue,10000);assert.equal(rule(r,'maxPositionPct').used,9.090909);assert.equal(rule(r,'maxPositionPct').exceeded,false);finiteTree(r);});
