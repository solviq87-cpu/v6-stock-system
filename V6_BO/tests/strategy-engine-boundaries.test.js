'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRule, evaluateStrategy } = require('../src/core/strategy-engine');

test('missing and invalid snapshot values never pass numeric rules', () => {
  for (const value of [undefined, null, '', 'N/A', NaN, Infinity, true]) {
    assert.equal(evaluateRule({price:value},{field:'price',op:'<',value:10}),false);
  }
  assert.equal(evaluateRule({}, {field:'price',op:'<',value:10}),false);
});
test('missing or invalid thresholds fail closed', () => {
  for (const value of [undefined, null, '', 'bad']) {
    assert.equal(evaluateRule({price:5},{field:'price',op:'>',value}),false);
  }
  assert.equal(evaluateRule({price:5},{field:'price',op:'between',min:undefined,max:10}),false);
  assert.equal(evaluateRule({price:5},{field:'price',op:'between',min:10,max:1}),false);
});
test('normal numeric and numeric-string rules retain expected results', () => {
  assert.equal(evaluateRule({price:5},{field:'price',op:'<',value:10}),true);
  assert.equal(evaluateRule({price:'5'},{field:'price',op:'between',min:'1',max:'10'}),true);
  assert.equal(evaluateRule({price:10},{field:'price',op:'>=',value:10}),true);
  assert.equal(evaluateRule({price:5},{field:'price',op:'>',value:10}),false);
});
test('empty strategy cannot pass; normal weighted score still passes', () => {
  assert.equal(evaluateStrategy({}, {rules:[],minScore:0}).pass,false);
  const result=evaluateStrategy({price:12},{rules:[{field:'price',op:'>',value:10,weight:2}],minScore:2});
  assert.equal(result.pass,true);
  assert.equal(result.score,2);
});


test('whitespace-only data is not interpreted as zero', () => {
  assert.equal(evaluateRule({price:'  '},{field:'price',op:'<',value:10}),false);
  assert.equal(evaluateRule({price:5},{field:'price',op:'>',value:'   '}),false);
});
test('no matching rules or zero-weight matches cannot select at a zero threshold', () => {
  const missing={rules:[{field:'price',op:'>',value:10,weight:25}],minScore:0};
  assert.equal(evaluateStrategy({price:5},missing).pass,false);
  const zeroWeight={rules:[{field:'price',op:'>',value:10,weight:0}],minScore:0};
  assert.equal(evaluateStrategy({price:11},zeroWeight).pass,false);
  assert.equal(evaluateStrategy({price:11},{rules:[{field:'price',op:'>',value:10,weight:20}],minScore:0}).pass,true);
});
test('absent, invalid or negative minimum scores fail closed', () => {
  const rule={field:'price',op:'>',value:10,weight:20};
  for(const minScore of [undefined,null,'',' ',NaN,-1]) {
    assert.equal(evaluateStrategy({price:11},{rules:[rule],minScore}).pass,false);
  }
  assert.equal(evaluateStrategy({price:11},{rules:[rule],minScore:'20'}).pass,true);
});
