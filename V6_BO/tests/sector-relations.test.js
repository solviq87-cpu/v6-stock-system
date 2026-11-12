'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSectorRelations: analyze } = require('../src/strategy/sector-relations');

const dates = [];
for (let t = Date.parse('2026-09-01T00:00:00Z'); dates.length < 24; t += 86400000) {
  const d = new Date(t);
  if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
}
const asOf = Date.parse(dates.at(-1) + 'T18:00:00+08:00');
function fixture() {
  return dates.map((tradeDate, i) => {
    const market = Math.cos(i * .7), noise = Math.sin(i * 1.7);
    return { tradeDate, source: 'provider-A', classificationVersion: 'class-v1',
      observedAt: Date.parse(tradeDate + 'T15:01:00+08:00'), marketChangePct: market,
      sectors: [
        { code: 'S1', name: '甲', category: 'industry', changePct: 2 * market + noise,
          mainNetInflow: 100 + i, amountCny: 1000, members: ['600001', '600002'] },
        { code: 'S2', name: '乙', category: 'concept', changePct: 3 * market + noise,
          mainNetInflow: -50 - i, amountCny: 2000, members: ['600002', '600003'] },
        { code: 'S3', name: '丙', category: 'concept', changePct: 4 * market - noise,
          mainNetInflow: i % 2 ? 0 : null, members: ['600004'] }
      ] };
  });
}
const run = (history = fixture(), extras = {}) => analyze({ asOf, tradeDates: dates, history, ...extras });
const pair = (r, a = 'S1', b = 'S2') => r.edges.find(e => r.nodes.find(n => n.id === e.from).code === a && r.nodes.find(n => n.id === e.to).code === b ||
  r.nodes.find(n => n.id === e.from).code === b && r.nodes.find(n => n.id === e.to).code === a);

test('same-day and beta-residual correlation describe separate evidence from member overlap', () => {
  const input = fixture(), before = JSON.stringify(input), r = run(input);
  assert.equal(r.status, 'descriptive-unverified');
  const edge = pair(r);
  assert.equal(edge.sameDayCorrelation.status, 'descriptive-unverified');
  assert.equal(edge.sameDayCorrelation.knownMatchedCount, 24);
  assert.ok(edge.sameDayCorrelation.coefficient > .9);
  assert.ok(Math.abs(edge.marketResidualCorrelation.coefficient - 1) < 1e-10);
  assert.ok(Math.abs(pair(r, 'S1', 'S3').marketResidualCorrelation.coefficient + 1) < 1e-10);
  assert.equal(edge.membershipOverlap.jaccard, 1 / 3);
  assert.deepEqual(edge.membershipOverlap.sharedMembers, ['600002']);
  assert.equal(pair(r, 'S1', 'S3').membershipOverlap.jaccard, 0);
  assert.equal(JSON.stringify(input), before);
  for (const flag of ['canTrade', 'canNotify', 'verifiedLive', 'weightsChanged', 'rankingModified', 'autoPromotion']) assert.equal(r[flag], false);
});

test('common market alone cannot produce a residual or a leading/causal claim', () => {
  const history = fixture();
  for (const r of history) { r.sectors[0].changePct = 2 * r.marketChangePct; r.sectors[1].changePct = 5 * r.marketChangePct; }
  const edge = pair(run(history));
  assert.ok(Math.abs(edge.sameDayCorrelation.coefficient - 1) < 1e-10);
  assert.equal(edge.marketResidualCorrelation.coefficient, null);
  assert.equal(edge.marketResidualCorrelation.reason, 'constant-market-residual');
  for (const r of history) r.sectors[0].changePct = 1;
  assert.equal(pair(run(history)).sameDayCorrelation.coefficient, null);
});

test('20 distinct sessions and complete explicit contiguous dates are mandatory', () => {
  const history = fixture().slice(-19), r = run(history, { tradeDates: dates.slice(-19) });
  assert.equal(pair(r).sameDayCorrelation.reason, 'insufficient-matched-sessions');
  assert.equal(pair(r).sameDayCorrelation.knownMatchedCount, 19);
  const gap = run(fixture().filter((_, i) => i !== 10));
  assert.equal(pair(gap).sameDayCorrelation.reason, 'missing-contiguous-session');
  assert.equal(pair(gap).sameDayCorrelation.knownMatchedCount, 23);
  assert.equal(analyze({ asOf, history: fixture() }).reason, 'invalid-explicit-trading-calendar');
  assert.equal(run(fixture(), { tradeDates: [...dates].reverse() }).status, 'unknown');
});

test('flow continuity uses actual last 3/5 sessions and never sums overlapping sectors', () => {
  const r = run(), node = r.nodes.find(n => n.code === 'S1');
  assert.equal(node.flowIntensity, .123);
  assert.equal(node.flowContinuity.threeSession.direction, 'continuous-inflow');
  assert.equal(node.flowContinuity.fiveSession.netInflowCny, 605);
  assert.equal(node.flowContinuity.fiveSession.observations.length, 5);
  assert.deepEqual(node.flowContinuity.threeSession.tradeDates, dates.slice(-3));
  assert.equal(r.nodes.find(n => n.code === 'S3').flowContinuity.threeSession.status, 'unknown');
  assert.equal(r.rotation.length, 2);
  assert.ok(r.rotation.every(e => e.capitalTransferEstablished === false));
  assert.equal(Object.hasOwn(r, 'marketNetInflow'), false);
  const missing = fixture(); missing.at(-2).sectors[0].mainNetInflow = null;
  assert.equal(run(missing).nodes.find(n => n.code === 'S1').flowContinuity.threeSession.knownMatchedCount, 2);
  const gap = run(fixture().filter((_, i) => i !== 22));
  assert.equal(gap.nodes.find(n => n.code === 'S1').flowContinuity.threeSession.status, 'unknown');
});

test('no amount proxy, missing/zero amount or missing flow is invented as intensity', () => {
  for (const amount of [null, undefined, 0, -2, '1000']) {
    const history = fixture(); history.at(-1).sectors[0].amountCny = amount;
    history.at(-1).sectors[0].amount = 99999;
    assert.equal(run(history).nodes.find(n => n.code === 'S1').flowIntensity, null);
  }
  const zero = fixture(); zero.at(-1).sectors[0].mainNetInflow = 0;
  assert.equal(run(zero).nodes.find(n => n.code === 'S1').flowIntensity, 0);
});

test('provider, classification and constituent changes cannot be pooled by code/name', () => {
  const cases = [
    [r => { r.source = 'provider-B'; }, 'mixed-source'],
    [r => { r.classificationVersion = 'class-v2'; }, 'classification-version-changed'],
    [r => { r.sectors[0].members = ['600001', '600099']; }, 'membership-changed'],
    [r => { delete r.sectors[0].members; }, 'membership-unknown']
  ];
  for (const [mutate, reason] of cases) {
    const history = fixture(); mutate(history[10]);
    assert.equal(pair(run(history)).sameDayCorrelation.reason, reason);
    assert.equal(pair(run(history)).sameDayCorrelation.coefficient, null);
  }
  const history = fixture(); history.at(-2).source = 'different';
  const r = run(history), n = r.nodes.find(n => n.code === 'S1');
  assert.equal(n.flowContinuity.threeSession.reason, 'mixed-source');
  assert.equal(r.rotation.length, 0);
  const duplicateNames = fixture();
  for (const row of duplicateNames) row.sectors.forEach(s => { s.name = '同名'; });
  assert.equal(run(duplicateNames).nodes.length, 3);
});

test('future knowledge and duplicate/corrected daily archives never add matched sessions', () => {
  const future = fixture(); future[8].observedAt = asOf + 1;
  const f = run(future);
  assert.equal(pair(f).sameDayCorrelation.knownMatchedCount, 23);
  assert.ok(f.coverage.rejectedRows.some(e => e.reason === 'future-observation'));
  const history = fixture(), correction = structuredClone(history[8]);
  correction.observedAt += 60000; correction.sectors[0].changePct = 10;
  const duplicate = run([...history, correction]);
  assert.equal(pair(duplicate).sameDayCorrelation.reason, 'duplicate-daily-evidence');
  assert.equal(pair(duplicate).sameDayCorrelation.knownMatchedCount, 23);
  correction.observedAt = asOf + 1;
  assert.equal(pair(run([...history, correction])).sameDayCorrelation.knownMatchedCount, 24);
  const lateKnown = fixture(); lateKnown[8].observedAt = asOf - 1;
  assert.equal(pair(run(lateKnown)).sameDayCorrelation.knownMatchedCount, 24);
});

test('current snapshot repetition is idempotent and a current correction is ambiguous', () => {
  const history = fixture(), baseline = run(history);
  assert.deepEqual(run(history, { current: structuredClone(history.at(-1)) }), baseline);
  const current = structuredClone(history.at(-1)); current.sectors[0].changePct += 1;
  assert.equal(run(history, { current }).reason, 'latest-session-evidence-missing');
  assert.equal(pair(run(history.slice(0, -1), { current: structuredClone(history.at(-1)) })).sameDayCorrelation.knownMatchedCount, 24);
});

test('missing returns and market data remain null, with separate matched counts', () => {
  const history = fixture(); history[2].sectors[0].changePct = null;
  const r = run(history);
  assert.equal(pair(r).sameDayCorrelation.reason, 'missing-contiguous-return-session');
  assert.equal(pair(r).sameDayCorrelation.knownMatchedCount, 23);
  const market = fixture(); delete market[3].marketChangePct;
  const edge = pair(run(market));
  assert.equal(edge.sameDayCorrelation.status, 'descriptive-unverified');
  assert.equal(edge.marketResidualCorrelation.coefficient, null);
  assert.equal(edge.marketResidualCorrelation.knownMatchedCount, 23);
  assert.equal(edge.marketResidualCorrelation.tradeDates.length, 23);
  for (const row of market) row.marketChangePct = 0;
  assert.equal(pair(run(market)).marketResidualCorrelation.reason, 'constant-market-series');
});

test('stable deterministic ordering survives input row, sector and member ordering', () => {
  const history = fixture(), r = run(history), reordered = structuredClone(history).reverse();
  for (const row of reordered) { row.sectors.reverse(); row.sectors.forEach(s => s.members.reverse()); }
  assert.deepEqual(run(reordered), r);
  assert.equal(run(history, { asOf: new Date(asOf).toISOString() }).asOf, asOf);
});

test('bounded malformed input fails closed without network or implicit clocks', () => {
  assert.equal(analyze().reason, 'invalid-as-of');
  assert.equal(run(Array(121).fill(fixture()[0])).reason, 'history-bound-exceeded-or-invalid');
  const missing = fixture(); delete missing.at(-1).source;
  assert.equal(run(missing).status, 'unknown');
  const duplicate = fixture(); duplicate.at(-1).sectors.push(structuredClone(duplicate.at(-1).sectors[0]));
  assert.equal(run(duplicate).status, 'unknown');
  const malformed = fixture(); malformed.at(-1).sectors[0].members = ['600001', '600001'];
  assert.equal(pair(run(malformed)).membershipOverlap.status, 'unknown');
  assert.equal(run(fixture(), { tradeDates: [...dates, '2026-11-31'] }).status, 'unknown');
  const history = fixture();
  for (const row of history) row.sectors = Array.from({ length: 30 }, (_, i) => ({ ...row.sectors[0], code: String(i) }));
  const bounded = run(history);
  assert.equal(bounded.nodes.length, 30); assert.equal(bounded.edges.length, 120);
  assert.equal(bounded.coverage.omittedEdges, 315);
});
