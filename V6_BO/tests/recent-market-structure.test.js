'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { researchLiveMarket } = require('../src/core/live-market-research');

const now = Date.parse('2026-11-05T10:00:00+08:00');
const snapshot = {
  source: 'isolated-clist-fixture', date: '2026-11-05', universeSize: 4,
  retrievedAt: new Date(now).toISOString(),
  stocks: [-2, -1, 0, 8].map((pctChange, i) => ({
    code: String(i + 1).padStart(6, '0'), pctChange, amount: [0, 10, 20, 70][i],
    vendorQuoteAt: now - i * 1000
  }))
};
const run = patch => researchLiveMarket({ now, fetchSnapshot: async () => ({ ...snapshot, ...patch }) });

test('same snapshot distinguishes median stock from equal-weight mean and turnover concentration', async () => {
  const { recentStructure: s } = await run({});
  assert.equal(s.medianReturnPct, -0.5);
  assert.equal(s.equalWeightReturnPct, 1.25);
  assert.equal(s.upShare, 0.25);
  assert.ok(Math.abs(s.turnoverHHI - 0.54) < 1e-12);
  assert.equal(s.oldestQuoteAt, now - 3000);
  assert.equal(s.asOf, now);
  assert.equal(s.observed, 4);
  assert.equal(s.universeSize, 4);
  assert.equal(s.canTrade, false);
});

test('late, future, duplicated and suspended quotes cannot supply current breadth', async () => {
  const stocks = [...snapshot.stocks, snapshot.stocks[0]].map((s,i) => {
    if (i === 1) return { ...s, vendorQuoteAt: now - 86400000 };
    if (i === 2) return { ...s, vendorQuoteAt: now + 1000 };
    if (i === 3) return { ...s, suspended: true };
    return s;
  });
  const { recentStructure: s } = await run({ stocks });
  assert.equal(s.observed, 0);
  assert.equal(s.medianReturnPct, null);
  assert.equal(s.turnoverHHI, null);
  assert.equal(s.status, 'insufficient-coverage');
});

test('missing amounts, a zero denominator and incomplete universe keep full-universe HHI unknown', async () => {
  for (const patch of [
    { stocks: snapshot.stocks.map((s,i) => i ? s : { ...s, amount: null }) },
    { stocks: snapshot.stocks.map(s => ({ ...s, amount: 0 })) }, { universeSize: 5 }
  ]) {
    const { recentStructure: s } = await run(patch);
    assert.equal(s.medianReturnPct, -0.5);
    assert.equal(s.turnoverHHI, null);
  }
});
