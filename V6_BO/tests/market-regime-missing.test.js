'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMarket } = require('../src/core/market-regime');

test('missing market fields use the same neutral fallback whether omitted or null/blank/invalid', () => {
  const base = classifyMarket({});
  const missing = [undefined, null, '', '  ', 'unknown', NaN, Infinity, true, false];
  for (const value of missing) {
    for (const key of ['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore']) {
      assert.deepEqual(classifyMarket({ [key]: value }), base, key + '=' + String(value));
    }
  }
});

test('real numeric zero remains zero and valid numeric strings stay supported', () => {
  assert.equal(classifyMarket({riskScore:0}).inputs.risk, 0);
  assert.equal(classifyMarket({riskScore:'0'}).inputs.risk, 0);
  assert.equal(classifyMarket({riskScore:'75'}).inputs.risk, 75);
});
