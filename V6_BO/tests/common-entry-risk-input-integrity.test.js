'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluateEntryRisk} = require('../src/core/common-entry-risk');

const base = {policy:{version:'b4-test',maxPositionPct:20},symbol:'600000',quantity:100,price:10,cash:10000};
const assess = patch => evaluateEntryRisk({...base,...patch});
const pending = patch => ({symbol:'600000',quantity:100,price:10,...patch});
const held = patch => ({symbol:'600001',quantity:100,...patch});
const unknownExposure = result => {
  assert.equal(result.allowed,false);
  assert.ok(result.reasonCodes.includes('MISSING_POSITION_MARKS'));
  assert.deepEqual(result.exposure,{equity:null,gross:null,single:null,sector:null,strategy:null});
};

test('valid pending buy and held shares use the same security identity and exact limit',()=>{
  const atLimit = assess({pending:[pending({symbol:600000})]});
  assert.equal(atLimit.allowed,true);
  assert.equal(atLimit.exposure.single,2000);
  const over = assess({pending:[pending({symbol:600000,quantity:101})]});
  assert.equal(over.allowed,false);
  assert.ok(over.reasonCodes.includes('SINGLE_POSITION_LIMIT'));
  const position = assess({positions:[held({symbol:600000,quantity:160})],marks:{600000:10}});
  assert.equal(position.allowed,false);
  assert.ok(position.reasonCodes.includes('SINGLE_POSITION_LIMIT'));
});

test('pending buy with unknown or coerced quantity cannot masquerade as zero exposure',()=>{
  for(const quantity of [null,undefined,'',false,true,'100',[],{}])
    unknownExposure(assess({pending:[pending({quantity})]}));
});

test('pending buy with invalid price or negative inputs is not valid exposure',()=>{
  for(const price of [null,undefined,'',false,true,'10',0,-10])
    unknownExposure(assess({pending:[pending({price})]}));
  unknownExposure(assess({pending:[pending({quantity:-100,price:-10})]}));
});

test('unknown pending or proposed security identity cannot undercount concentration',()=>{
  for(const symbol of [null,undefined,'','  ',{},[],false])
    unknownExposure(assess({pending:[pending({symbol,quantity:150})]}));
  for(const symbol of [null,undefined,'','  ',{},[],false]){
    const result=assess({symbol,pending:[pending({quantity:150})]});
    assert.equal(result.allowed,false);
    assert.ok(result.reasonCodes.includes('INVALID_ACCOUNT_INPUT'));
    assert.equal(result.exposure.single,null);
  }
});

test('malformed collection, malformed row or absent own quote stays unknown',()=>{
  for(const patch of [{positions:null},{pending:{}},{pending:[null]},{positions:[null]},
    {positions:[held({})],marks:null},{positions:[held({})],marks:Object.create({600001:10})},
    {positions:[held({symbol:null})],marks:{null:10}},{positions:[held({quantity:'100'})],marks:{600001:10}}])
    unknownExposure(assess(patch));
});

test('overflowing position and aggregate pending values cannot produce a usable exposure',()=>{
  unknownExposure(assess({positions:[held({quantity:1e308})],marks:{600001:10}}));
  unknownExposure(assess({pending:[pending({symbol:'600001',quantity:1e307}),pending({symbol:'600002',quantity:1e307})]}));
});

test('invalid proposed trade amount never reports known exposure',()=>{
  for(const patch of [{price:NaN},{quantity:Infinity},{quantity:1e308,price:10},{cash:-1},{cash:NaN}]){
    const result=assess(patch);
    assert.equal(result.allowed,false);
    assert.ok(result.reasonCodes.includes('INVALID_ACCOUNT_INPUT'));
    assert.deepEqual(result.exposure,{equity:null,gross:null,single:null,sector:null,strategy:null});
  }
});

test('zero remaining shares and fractional research allocations remain valid',()=>{
  const result=assess({quantity:2.5,price:12,pending:[pending({quantity:0})],positions:[held({quantity:2.5})],marks:{600001:12}});
  assert.equal(result.allowed,true);
  assert.deepEqual(result.exposure,{equity:10030,gross:60,single:30,sector:null,strategy:null});
});

test('sector and strategy limits use valid attributed held and pending exposure',()=>{
  const result=assess({policy:{version:'b4-test',maxSectorPct:20,maxStrategyPct:20},strategyId:'s1',positions:[held({strategyId:'s1'})],marks:{600001:10},pending:[pending({strategyId:'s1'})],sectors:{600000:'bank',600001:'bank'}});
  assert.equal(result.allowed,false);
  assert.deepEqual(result.reasonCodes,['SECTOR_EXPOSURE_LIMIT','STRATEGY_EXPOSURE_LIMIT']);
  assert.equal(result.exposure.sector,3000);
  assert.equal(result.exposure.strategy,3000);
});

test('inherited sector attribution cannot certify a sector budget',()=>{
  const result=assess({policy:{version:'b4-test',maxSectorPct:20},sectors:Object.create({600000:'bank'})});
  assert.equal(result.allowed,false);
  assert.ok(result.reasonCodes.includes('MISSING_SECTOR_CLASSIFICATION'));
  assert.equal(result.exposure.sector,null);
});

test('loss-only defensive recheck and sell exception keep original semantics',()=>{
  const policy={version:'b4-test',maxConsecutiveLosses:2};
  assert.equal(assess({policy,symbol:undefined,lossStreak:1}).allowed,true);
  assert.equal(assess({policy,symbol:undefined,lossStreak:2}).allowed,false);
  assert.equal(assess({side:'sell',pending:null}).allowed,true);
  assert.equal(assess({policy:null,pending:null}).allowed,true);
});
