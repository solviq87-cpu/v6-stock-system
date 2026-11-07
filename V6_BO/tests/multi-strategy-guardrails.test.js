'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMultiStrategy } = require('../src/core/multi-strategy-engine');

const strongRule={field:'trendScore',op:'>=',value:60,weight:100};

test('invalid minimum-score configuration cannot create a winning strategy', () => {
  for (const minScore of [undefined,null,'',-1]) {
    const result=evaluateMultiStrategy({
      snapshot:{trendScore:90,riskScore:0},
      strategies:[{name:'broken',family:'trend',rules:[strongRule],minScore}]
    });
    assert.equal(result.pass,false);
    assert.equal(result.finalScore,0);
    assert.equal(result.strategies[0].adjusted,0);
    assert.equal(result.topDrivers.length,0);
  }
});

test('invalid strategy does not artificially increase a valid strategy score', () => {
  const result=evaluateMultiStrategy({
    snapshot:{trendScore:90,riskScore:0},
    strategies:[
      {name:'valid',family:'trend',rules:[strongRule],minScore:100},
      {name:'broken',family:'trend',rules:[strongRule]}
    ]
  });
  assert.equal(result.strategies.find(s=>s.name==='broken').adjusted,0);
  assert.equal(result.strategies.find(s=>s.name==='valid').pass,true);
  assert.deepEqual(result.topDrivers.map(s=>s.strategy),['valid']);
  assert.equal(result.finalScore,50);
});

test('empty and zero-hit strategies never appear as winners', () => {
  const result=evaluateMultiStrategy({
    snapshot:{trendScore:40,riskScore:0},
    strategies:[
      {name:'empty',family:'trend',rules:[],minScore:0},
      {name:'miss',family:'trend',rules:[strongRule],minScore:0}
    ]
  });
  assert.equal(result.pass,false);
  assert.deepEqual(result.topDrivers,[]);
});
