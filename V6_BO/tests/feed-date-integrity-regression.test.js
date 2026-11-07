'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateFeed} = require('../src/strategy/feed-quality');

const now = Date.parse('2026-11-07T06:30:00Z');
function fixture() {
  return {
    code: '000001',
    feed: {source: 'eastmoney', timestamp: now},
    bars: Array.from({length:45}, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0,10),
      open: 10 + i*.01, high: 11 + i*.01, low: 9 + i*.01,
      close: 10.1 + i*.01, volume: 1000000
    }))
  };
}

test('a complete valid historical calendar still passes feed validation', () => {
  assert.equal(validateFeed(fixture(),{now}).usable, true);
});

test('impossible date inside otherwise strictly ordered K-lines is rejected', () => {
  const stock = fixture();
  stock.bars[30].date='2026-09-31';
  const result=validateFeed(stock,{now});
  assert.equal(result.usable,false);
  assert.ok(result.errors.some(e=>e.includes('日期无效')));
});

test('partially missing historical dates are rejected instead of silently accepted', () => {
  const stock = fixture();
  delete stock.bars[30].date;
  const result=validateFeed(stock,{now});
  assert.equal(result.usable,false);
  assert.ok(result.errors.some(e=>e.includes('日期字段不一致')));
});

test('fully undated legacy bars retain their existing compatibility', () => {
  const stock = fixture();
  for (const bar of stock.bars) delete bar.date;
  assert.equal(validateFeed(stock,{now}).usable, true);
});
