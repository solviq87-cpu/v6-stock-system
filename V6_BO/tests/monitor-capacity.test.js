'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const productionRequire = createRequire(require.resolve('../server.js'));
const now = Date.parse('2026-11-13T10:00:00+08:00');
const codes = n => Array.from({ length: n }, (_, i) => String(600000 + i));
const positions = n => Object.fromEntries(codes(n).map(code => [code, { shares: 100 }]));

// Execute the real tick prefix through collection/coverage, without signals,
// account writes, network or notifications. Preserve state between invocations.
function monitor(n, respond = requested => requested.map(code => ({ code, price: 10,
  quoteAt: now - 1000, receivedAt: now, quoteSource: 'tencent', canTrade: true }))) {
  const requests = [];
  const c = vm.createContext({ require: productionRequire, Date: { now: () => now },
    S: { loop: { running: false }, candidatePool: [{ code: '000001' }], sectors: [], inflowHistory: new Map() },
    PAPER: { pool: { positions: positions(n) }, pre: { positions: {} } }, monitorCodes: [],
    em: { async fetchBatchSnapshot(requested) { requests.push(Array.from(requested)); return respond(requested); } }
  });
  const a = source.indexOf('async function tick()');
  const b = source.indexOf('    ingestPx(snaps);', a);
  assert.ok(a >= 0 && b > a);
  vm.runInContext(source.slice(a, b) + '\n} finally { S.loop.running = false; } }', c);
  return { c, requests, run: () => c.tick() };
}

test('normal monitoring keeps pool-external holdings before candidates and deduplicates across accounts', async () => {
  const h = monitor(1);
  h.c.PAPER.pre.positions = positions(1);
  await h.run();
  assert.deepEqual(h.requests[0], ['600000', '000001']);
});

test('221 holdings rotate within the unchanged 220-symbol budget instead of starving the last stock', async () => {
  const h = monitor(221);
  await h.run(); await h.run();
  assert.ok(h.requests.every(request => request.length === 220));
  assert.equal(new Set(h.requests.flat()).size, 221);
  assert.ok(h.requests.every(request => !request.includes('000001')), 'holdings retain priority');
});

test('overflow records an explicit incomplete snapshot and retains original quote ages', async () => {
  const h = monitor(221);
  await h.run();
  const status = h.c.S.loop.monitor;
  assert.equal(status.heldTotal, 221);
  assert.equal(status.heldRequested, 220);
  assert.equal(status.heldDeferred, 1);
  assert.equal(status.heldFresh, 220);
  assert.equal(status.heldUncovered, 1);
  assert.equal(status.capacityExceeded, true);
  assert.equal(status.complete, false);
  assert.equal(status.maxHeldQuoteAgeMs, 1000);
  assert.equal(status.checkedAt, now);
  assert.ok(status.heldCoveragePct < 100);
});

test('missing, stale, future and observation-only rows cannot inflate held coverage', async () => {
  const h = monitor(5, requested => requested.filter(code => code !== '600004').map((code, i) => ({ code, price: 10,
    quoteSource: 'tencent', quoteAt: [now - 15000, now - 15001, now + 1, now][i] ?? now,
    receivedAt: now, canTrade: i !== 3 })));
  await h.run();
  assert.equal(h.c.S.loop.monitor.heldFresh, 1);
  assert.equal(h.c.S.loop.monitor.heldUncovered, 4);
  assert.equal(h.c.S.loop.monitor.heldCoveragePct, 20);
  assert.equal(h.c.S.loop.monitor.maxHeldQuoteAgeMs, 15000);
});

test('collection failure exposes zero fresh coverage and a failed snapshot', async () => {
  const h = monitor(221, () => { throw Error('fixture outage'); });
  await assert.rejects(h.run(), /fixture outage/);
  assert.equal(h.c.S.loop.monitor.status, 'fetch-failed');
  assert.equal(h.c.S.loop.monitor.heldFresh, 0);
  assert.equal(h.c.S.loop.monitor.heldUncovered, 221);
});

test('a deferred stock loses its old funds baseline, even when it returns in the next tick', async () => {
  const h = monitor(221);
  h.c.S.inflowHistory.set('600220', [{ mainInflow: 100, t: now - 5000 }]);
  await h.run();
  assert.equal(h.c.S.inflowHistory.has('600220'), false);
});

test('large holding sets get bounded, duplicate-free service across consecutive cycles', async () => {
  const h = monitor(661);
  for (let i = 0; i < 4; i++) await h.run();
  assert.ok(h.requests.every(request => request.length === 220 && new Set(request).size === 220));
  assert.equal(new Set(h.requests.flat()).size, 661);
  // A changed portfolio still uses current symbols, and does not retain removed holdings.
  delete h.c.PAPER.pool.positions['600000'];
  h.c.PAPER.pool.positions['601000'] = { shares: 100 };
  const seen = new Set();
  for (let i = 0; i < 4; i++) { await h.run(); h.requests.at(-1).forEach(code => seen.add(code)); }
  assert.equal(seen.has('600000'), false);
  assert.equal(seen.has('601000'), true);
});

test('a holding added during collection cannot produce a falsely complete coverage snapshot', async () => {
  const h = monitor(1, requested => {
    h.c.PAPER.pre.positions['600999'] = { shares: 100 };
    return requested.map(code => ({code, price: 10, quoteSource: 'tencent',
      quoteAt: now, receivedAt: now, canTrade: true}));
  });
  await h.run();
  assert.equal(h.c.S.loop.monitor.heldChanged, true);
  assert.equal(h.c.S.loop.monitor.heldTotal, 2);
  assert.equal(h.c.S.loop.monitor.heldFresh, 1);
  assert.equal(h.c.S.loop.monitor.heldUncovered, 1);
  assert.equal(h.c.S.loop.monitor.complete, false);
});

test('capacity reached during one automatic buy batch commits only the first allowed purchase', () => {
  const skipped = []; let saves = 0;
  const account = { enabled: true, cash: 100000, positions: {}, trades: [] };
  const c = vm.createContext({ require: productionRequire, Date, S: {ztCodes: new Set()},
    isReplica: () => false, isContinuousTrading: () => true, skipAdd: reason => skipped.push(reason),
    PAPER_CFG: {pool: {maxPos: 5, name: 'fixture'}}, PAPER: {pool: account, pre: {positions: positions(219)}},
    paperAuthorityQuotes: () => ({'000001': {price: 10}, '000002': {price: 10}}),
    paperEquity: () => 100000, paperFeeAmount: () => 5, paperLotOf: () => 100,
    A: {isLimitUp: () => false}, numNeutral: () => 0, dataCapOf: () => 100,
    savePaper: () => { saves++; return true; }, pushPaperDigest() {} });
  const a = source.indexOf('function paperBuy('), b = source.indexOf('\n}\n', a);
  vm.runInContext(source.slice(a, b + 2), c);
  c.paperBuy('pool', [{code: '000001'}, {code: '000002'}], new Map(), () => 'fixture');
  assert.deepEqual(Object.keys(account.positions), ['000001']);
  assert.equal(account.trades.length, 1);
  assert.equal(saves, 1);
  assert.deepEqual(skipped, ['buyMonitorCapacity']);
});

for (const n of [219, 220, 221]) {
  test(`real automatic buy checks monitor capacity for ${n} distinct existing holdings`, () => {
    const skipped = []; let quoteReads = 0;
    const c = vm.createContext({ require: productionRequire, isReplica: () => false,
      isContinuousTrading: () => true, skipAdd: reason => skipped.push(reason),
      PAPER_CFG: { pool: { maxPos: 5 } },
      PAPER: { pool: { enabled: true, positions: {} }, pre: { positions: positions(n) } },
      paperAuthorityQuotes() { quoteReads++; return {}; } });
    const a = source.indexOf('function paperBuy('), b = source.indexOf('\n}\n', a);
    vm.runInContext(source.slice(a, b + 2), c);
    c.paperBuy('pool', [{ code: '000001' }], new Map(), () => 'fixture');
    assert.equal(skipped.includes('buyMonitorCapacity'), n >= 220);
    assert.equal(quoteReads, n >= 220 ? 0 : 1);
  });
}
