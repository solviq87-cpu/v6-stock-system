'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditKlineSourceContinuity } = require('../src/core/kline-source-continuity');
const dates = ['2026-10-28','2026-10-29','2026-10-30'];
const bar = (date, close = 10) => ({ date, open: close, high: close + 1, low: close - 1, close, volume: 100 });
const run = (primaryBars, fallbackBars, expectedDates = dates, extra = {}) => auditKlineSourceContinuity({ primaryBars, fallbackBars, expectedDates, ...extra });

test('uses primary bars and preserves source provenance', () => {
  const result = run(dates.map(d => bar(d)), []);
  assert.equal(result.status, 'continuous');
  assert.equal(result.bars[0].source, 'primary');
  assert.equal(result.bars[0].fallbackUsed, false);
});
test('fills missing primary date from fallback and records source switch', () => {
  const result = run([bar(dates[0]), bar(dates[2])], [bar(dates[1])]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.sourceSwitches, [
    { date: dates[1], from: 'primary', to: 'fallback' },
    { date: dates[2], from: 'fallback', to: 'primary' }
  ]);
  assert.equal(result.bars[1].fallbackUsed, true);
});
test('reports missing dates instead of silently fabricating bars', () => {
  const result = run([bar(dates[0])], []);
  assert.deepEqual(result.gaps, dates.slice(1));
  assert.equal(result.status, 'incomplete');
});
test('rejects duplicate primary dates', () => assert.throws(() => run([bar(dates[0]), bar(dates[0])], []), /重复交易日/));
test('rejects duplicate fallback dates', () => assert.throws(() => run([], [bar(dates[0]), bar(dates[0])]), /重复交易日/));
test('rejects malformed OHLC from fallback', () => assert.throws(() => run([], [{ ...bar(dates[0]), high: 1 }]), /价格关系无效/));
test('rejects fractional or negative volume', () => assert.throws(() => run([ { ...bar(dates[0]), volume: 1.5 } ], []), /成交量无效/));
test('rejects large cross-source close divergence', () => assert.throws(() => run([bar(dates[0], 10)], [bar(dates[0], 12)]), /差异超过阈值/));
test('rejects guessed or invalid expected dates', () => assert.throws(() => run([], [], ['2026-02-30']), /交易日期/));
test('rejects unordered expected dates', () => assert.throws(() => run([], [], [...dates].reverse()), /严格递增/));
test('reports unexpected provider dates outside exchange calendar', () => {
  const result = run([bar(dates[0]), bar('2026-11-02')], []);
  assert.deepEqual(result.unexpectedDates, ['2026-11-02']);
});
test('validates divergence threshold bounds', () => assert.throws(() => run([], [], dates, { maxCloseDivergencePct: 50 }), /阈值无效/));
