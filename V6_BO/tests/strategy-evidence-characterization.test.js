'use strict';

// Isolated characterization tests: no production writes or network access.
// Run: node --test tests/strategy-evidence-characterization.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRule, evaluateStrategy } = require('../src/core/strategy-engine');
const { normalizeStock } = require('../src/strategy/snapshot-normalizer');
const { evaluateMultiStrategy } = require('../src/core/multi-strategy-engine');
const { evaluatePlaybooks } = require('../src/strategy/research-playbook-engine');

test('raw rule refuses missing, null, empty and boolean inputs; preserves genuine zero', () => {
  const rule = { field: 'x', op: '===', value: 0 };
  for (const x of [undefined, null, '', ' ', false, true, NaN]) {
    assert.equal(evaluateRule({ x }, rule), false);
  }
  assert.equal(evaluateRule({ x: 0 }, rule), true);
});

test('invalid threshold and empty rules cannot pass', () => {
  const rule = { id: 'a', field: 'x', op: '>=', value: 1, weight: 20 };
  for (const minScore of [undefined, null, '', false, -1]) {
    assert.equal(evaluateStrategy({ x: 10 }, { rules: [rule], minScore }).pass, false);
  }
  assert.equal(evaluateStrategy({ x: 10 }, { rules: [], minScore: 0 }).pass, false);
});

test('normalizer retains genuine zero risk and defaults missing risk to neutral', () => {
  assert.equal(normalizeStock({ riskScore: 0 }).riskScore, 0);
  assert.equal(normalizeStock({ riskScore: null }).riskScore, 50);
  assert.equal(normalizeStock({}).riskScore, 50);
});

test('research playbooks never request automatic trading without history', () => {
  const result = evaluatePlaybooks({ code: '600000', bars: [] });
  assert.equal(result.matched, 0);
  assert.ok(result.playbooks.length > 0);
  for (const item of result.playbooks) {
    assert.equal(item.autoTrade, false);
    assert.notEqual(item.status, 'candidate');
  }
});

test('multi-strategy with no configured strategies does not pass', () => {
  const result = evaluateMultiStrategy({ snapshot: {}, market: {}, strategies: [] });
  assert.equal(result.pass, false);
  assert.equal(result.finalScore, 0);
});

test('negative strategy weight cannot reverse aggregate contributions', () => {
  const strategy = {
    name: 'negative-weight', family: 'trend', strategyWeight: -2, minScore: 10,
    rules: [{ field: 'x', op: '>=', value: 1, weight: 20 }]
  };
  const result = evaluateMultiStrategy({ snapshot: { x: 2 }, strategies: [strategy] });
  assert.equal(result.pass, false);
  assert.equal(result.finalScore, 0);
  assert.equal(result.strategies[0].strategyWeight, 0);
});

test('zero-weight passing strategy is not counted as an aggregate winner', () => {
  const strategy = {
    name: 'zero-weight', family: 'trend', strategyWeight: 0, minScore: 10,
    rules: [{ field: 'x', op: '>=', value: 1, weight: 20 }]
  };
  const result = evaluateMultiStrategy({ snapshot: { x: 2 }, strategies: [strategy] });
  assert.equal(result.strategies[0].pass, true);
  assert.equal(result.pass, false);
  assert.equal(result.finalScore, 0);
});

test('strict feed gate blocks candidate when source and bars are absent', () => {
  const { evaluateCandidate } = require('../src/strategy/strategy-service');
  const stock = { code: '600000', trendScore: 95, relativeStrengthScore: 95, maAlignmentScore: 95 };
  const result = evaluateCandidate({
    stock, market: {},
    factorOptions: { requireFeedValidation: true, enforceFeedGate: true }
  });
  assert.equal(result.feedBlocked, true);
  assert.equal(result.pass, false);
  assert.ok(result.feedQuality.errors.length > 0);
});

test('invalid negative strategy weight cannot override a positive strategy', () => {
  const good = { name: 'good', family: 'trend', strategyWeight: 1, minScore: 10,
    rules: [{ field: 'x', op: '>=', value: 1, weight: 20 }] };
  const invalid = { name: 'invalid', family: 'reversal', strategyWeight: -100, minScore: 10,
    rules: [{ field: 'y', op: '>=', value: 1, weight: 20 }] };
  const single = evaluateMultiStrategy({ snapshot: { x: 2 }, strategies: [good] });
  const combined = evaluateMultiStrategy({ snapshot: { x: 2 }, strategies: [good, invalid] });
  assert.equal(combined.finalScore, single.finalScore);
  assert.equal(combined.pass, single.pass);
});
