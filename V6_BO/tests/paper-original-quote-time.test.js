'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

function functions() {
  const a = source.indexOf('function ingestPx(rows)');
  const b = source.indexOf('function paperEquity(key, pm)', a);
  assert.ok(a >= 0 && b > a);
  let now = 1_800_000_000_000;
  const c = { S: { lastPx: new Map(), stocks: [], stocksAt: 0, candidatePool: [], trendPool: [] }, Date: { now: () => now }, Map };
  vm.createContext(c);
  vm.runInContext(source.slice(a, b), c);
  return { c, clock: value => { now = value; } };
}

test('recently received full-A rows without original stock time cannot execute paper orders', () => {
  const { c } = functions();
  const now = 1_800_000_000_000;
  c.S.stocksAt = now;
  c.S.stocks = [{ code: '600519', price: 99 }];
  c.ingestPx(c.S.stocks);
  assert.equal(c.S.lastPx.size, 0);
  assert.equal(c.paperPxFresh('600519'), 0);
});

test('a verified held-stock observation expires by provider time, even with a new receive time', () => {
  const { c, clock } = functions();
  const t = 1_800_000_000_000;
  clock(t);
  c.S.stocksAt = t;
  c.S.stocks = [{ code: '600519', price: 99, quoteSource: 'tencent', quoteAt: t - 16_000 }];
  c.ingestPx(c.S.stocks);
  assert.equal(c.paperPxFresh('600519'), 0);
  c.ingestPx([{ code: '600519', price: 10, quoteSource: 'tencent', quoteAt: t - 1000 }]);
  assert.equal(c.paperPxFresh('600519'), 10);
  clock(t + 15_001);
  assert.equal(c.paperPxFresh('600519'), 0);
});

test('full-A fallback accepts only its own fresh provider timestamp', () => {
  const { c, clock } = functions();
  const t = 1_800_000_000_000;
  clock(t);
  c.S.stocksAt = t;
  c.S.stocks = [{ code: '000001', price: 8, quoteSource: 'tencent', quoteAt: t - 500 }];
  assert.equal(c.paperPxFresh('000001'), 8);
  c.S.stocks[0].canTrade = false;
  assert.equal(c.paperPxFresh('000001'), 0);
  c.S.stocks[0].canTrade = true;
  c.S.stocks[0].quoteAt = t + 1;
  assert.equal(c.paperPxFresh('000001'), 0);
});

test('late responses cannot replace a newer cached observation or extend its lifetime', () => {
  const { c, clock } = functions();
  const t = 1_800_000_000_000;
  const row = { code: '600519', price: 10, quoteSource: 'tencent', quoteAt: t - 1000 };
  c.ingestPx([row]);
  const original = c.S.lastPx.get(row.code);
  clock(t + 1000);
  c.ingestPx([{ ...row, price: 9, quoteSource: 'eastmoney', quoteAt: t - 2000 }]);
  assert.equal(c.S.lastPx.get(row.code), original);
  assert.equal(c.paperPxFresh(row.code), 10);
  c.ingestPx([{ ...row, price: 11, quoteAt: t + 500 }]);
  assert.equal(c.paperPxFresh(row.code), 11);
  clock(t + 15501);
  assert.equal(c.paperPxFresh(row.code), 0);
});

test('monitoring includes a held stock after it leaves the candidate pool', async () => {
  const start = source.indexOf('const _mon = new Set();', source.indexOf('async function tick()'));
  const end = source.indexOf('monitorCodes = codes;', start);
  assert.ok(start >= 0 && end > start);
  const c = {
    S: { candidatePool: Array.from({ length: 100 }, (_, i) => ({ code: String(i).padStart(6, '0') })), sectors: [] },
    PAPER: { a: { positions: { '600519': { shares: 100 } } } }, Set
  };
  vm.createContext(c);
  const codes = vm.runInContext(`(() => { ${source.slice(start, end)}; return codes; })()`, c);
  assert.equal(codes[0], '600519');
  assert.equal(codes.length, 101);
});
