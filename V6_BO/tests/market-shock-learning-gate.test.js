'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {assessMarketShock} = require('../src/core/market-shock-learning-gate');
const {freezeHealthBaseline, evaluateFactorHealth} = require('../src/core/factor-health');
const observedAt = Date.parse('2026-11-06T15:10:00+08:00');
const asOf = observedAt + 10 * 60000;
const stamp = (changePct, source = 'market-source') => ({changePct, source, observedAt});
function market() {
  return {schemaVersion: 1, source: 'imported', provider: 'market-source', tradeDate: '2026-11-06',
    observedAt, coverage: 0.9, breadth: {upPct: 18, source: 'market-source', observedAt},
    indices: {shanghai: stamp(-3.5), shenzhen: stamp(-4.1), chinext: stamp(-4.8)}};
}
test('two steep index declines and weak breadth defer learning but retain risk and loss samples', () => {
  const input = market(), before = structuredClone(input);
  const result = assessMarketShock(input, {asOf});
  assert.equal(result.regime, 'systemic-selloff');
  assert.equal(result.deferLearningUpdate, true);
  assert.equal(result.weightsChanged, false);
  assert.equal(result.returnSamplesPreserved, true);
  assert.equal(result.riskMonitoringRequired, true);
  assert.equal(result.forceMajeureVerified, false);
  assert.equal(result.canTrade, false);
  assert.deepEqual(input, before);
});
test('one weak index, strong breadth or moderate falls do not prove systemic shock', () => {
  for (const change of [
    m => { m.indices.shenzhen.changePct = -1; m.indices.chinext.changePct = -1; },
    m => { m.breadth.upPct = 40; },
    m => { Object.values(m.indices).forEach(i => i.changePct = -2.9); }
  ]) {
    const m = market(); change(m);
    const r = assessMarketShock(m, {asOf});
    assert.equal(r.status, 'observed-unverified');
    assert.equal(r.deferLearningUpdate, false);
  }
});
test('inclusive thresholds and two-index evidence count', () => {
  const m = market(); delete m.indices.chinext;
  m.coverage = 0.8; m.breadth.upPct = 25;
  m.indices.shanghai.changePct = -3; m.indices.shenzhen.changePct = -3;
  assert.equal(assessMarketShock(m, {asOf}).deferLearningUpdate, true);
});
test('future and stale evidence, mismatched dates, simulation and invalid breadth fail closed', () => {
  const cases = [
    m => {m.observedAt = asOf + 1;},
    m => {m.breadth.observedAt = asOf + 1;},
    m => {m.indices.shanghai.observedAt = asOf + 1;},
    m => {m.indices.shanghai.source = 'wrong';},
    m => {m.tradeDate = '2026-11-05';},
    m => {m.source = 'fixture';},
    m => {m.simulated = true;},
    m => {m.breadth.upPct = null;},
    m => {m.coverage = 0.79;},
    m => {delete m.indices.shanghai; delete m.indices.shenzhen;}
  ];
  for (const mutate of cases) {
    const m = market(); mutate(m);
    const r = assessMarketShock(m, {asOf});
    assert.equal(r.status, 'unverified', r.reason);
    assert.equal(r.deferLearningUpdate, false);
    assert.equal(r.riskMonitoringRequired, true);
  }
  assert.equal(assessMarketShock(market(), {asOf: observedAt + 91 * 60000}).status, 'unverified');
});
test('invalid clocks reject and unknown market does not silently become evidence', () => {
  assert.throws(() => assessMarketShock(market(), {asOf: NaN}), /时钟/);
  assert.equal(assessMarketShock(undefined, {asOf}).status, 'unverified');
});
test('factor health retains mean-shift warning while reporting shock learning gate', () => {
  const baselineAt = observedAt - 30 * 60000;
  const feed = {source: 'imported', provider: 'factor-source', datasetId: 'historical-test-fixture'};
  const makeRows = (value, t) => ['600000', '000001'].map(symbol => ({symbol,
    sectorHeatScore: value, factorEvidence: {sectorHeatScore: {source: feed.provider, timestamp: t}}}));
  const frozen = freezeHealthBaseline({schemaVersion: 1, feed, factorIds: ['sector_heat'],
    policy: {maxAgeMs: 3600000, minValidSamples: 2, minValidFraction: 1, maxMeanShift: 10},
    baseline: {schemaVersion: 1, feed, asOf: baselineAt, rows: makeRows(40, baselineAt)}},
  {now: baselineAt + 1000});
  const current = {schemaVersion: 1, feed, asOf, rows: makeRows(75, asOf)};
  const noContext = evaluateFactorHealth(frozen, current, {now: asOf + 1000});
  assert.equal(Object.hasOwn(noContext, 'learningGate'), false);
  const withContext = evaluateFactorHealth(frozen, current, {now: asOf + 1000, marketContext: market()});
  assert.equal(withContext.factors[0].status, 'watch');
  assert.equal(withContext.factors[0].meanShift, 35);
  assert.deepEqual(withContext.factors[0].reasons, ['mean-shift']);
  assert.equal(withContext.learningGate.deferLearningUpdate, true);
  assert.equal(withContext.weightsChanged, false);
  assert.equal(withContext.canTrade, false);
});
