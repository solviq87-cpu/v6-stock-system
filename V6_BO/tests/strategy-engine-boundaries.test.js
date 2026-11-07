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
