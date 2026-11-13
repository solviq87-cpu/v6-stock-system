'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistoryBackfillBudget, backfillSession, POLICY } = require('../src/strategy/history-backfill-budget');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const functionSource = server.slice(server.indexOf('async function klineBackfill(limitN, days) {'), server.indexOf('// 复盘类样本：登记时行情已经走完'));
const ANCHOR = Date.parse('2026-11-13T16:00:00+08:00');
const weekday = d => ![0, 6].includes(d.getDay());
const code = n => String(n).padStart(6, '0');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-backfill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, '.kline_cache'), ledger = path.join(root, 'private', 'budget.json');
  fs.mkdirSync(cache);
  const clock = { at: ANCHOR };
  const budget = createHistoryBackfillBudget({ file: ledger, now: () => clock.at, ...options });
  const warm = () => { budget.reserve([], { targetDate: '2026-11-13' }); clock.at += POLICY.bootstrapDelayMs; };
  return { root, cache, ledger, clock, budget, warm };
}
function bars(day = '2026-11-13', count = 40) {
  return { name: 'Fixture', src: 'fixture-original-provider', receivedAt: ANCHOR - 10000,
    rows: Array.from({ length: count }, (_, i) => ({ date: new Date(Date.parse(day) - (count - 1 - i) * 86400000).toISOString().slice(0, 10), close: 10 })) };
}
function wireFunction(x, { universe = ['000001'], snapshots = {}, transport = async () => bars(), role = 'primary', stocks = [] } = {}) {
  fs.writeFileSync(path.join(x.root, '.universe_cache.json'), JSON.stringify(universe));
  for (const [symbol, snapshot] of Object.entries(snapshots)) {
    const file = path.join(x.cache, symbol + '.json');
    fs.writeFileSync(file, JSON.stringify(snapshot));
    fs.utimesSync(file, x.clock.at / 1000, x.clock.at / 1000);
  }
  const calls = [], state = { config: { pushRole: role }, stocks }, prog = { ok: false, day: '', scanned: 0, added: 0, fail: 0 };
  let learns = 0;
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [x.clock.at])); } static now() { return x.clock.at; } }
  const simulatedFs = { ...fs, writeFileSync(file, ...args) { fs.writeFileSync(file, ...args);
    if (String(file).startsWith(x.cache + path.sep)) fs.utimesSync(file, x.clock.at / 1000, x.clock.at / 1000); } };
  const fn = new Function('fs', 'path', '__dirname', 'KLINE_CACHE', 'em', 'isTradeDay', 'nameOfCode', 'taskSet', 'outN', 'emptyWhyOf', 'runLearnallIngest', '_kbfProg', '_kbfBusy', 'Date', 'S', '_kbfBudget', 'backfillSession', 'HISTORY_BACKFILL_POLICY', '_klineWriteErr', functionSource + '\nreturn klineBackfill;')(
    simulatedFs, path, x.root, x.cache, { fetchKline: async (symbol, n) => { calls.push({ symbol, n, at: x.clock.at }); return transport(symbol, n); } }, weekday,
    () => 'Fixture', () => {}, (_, n) => n, () => '', async () => { learns++; return { added: 1 }; }, prog, false, FakeDate, state,
    x.budget, backfillSession, POLICY, () => {});
  return { fn, calls, state, prog, learns: () => learns };
}

test('all admission is bounded, 0 disables, and first use declares unknown prior usage', t => {
  const x = fixture(t), list = Array.from({ length: 100 }, (_, i) => code(i));
  const first = x.budget.reserve(list, { targetDate: '2026-11-13' });
  assert.deepEqual(first.codes, []);
  assert.equal(first.reason, 'cold-start-or-batch-cooldown');
  assert.equal(JSON.parse(fs.readFileSync(x.ledger)).bootstrap, 'prior-usage-unknown');
  x.clock.at += POLICY.bootstrapDelayMs;
  assert.equal(x.budget.reserve(list, { limit: 2000, targetDate: '2026-11-13' }).codes.length, 60);
  assert.deepEqual(x.budget.reserve(list, { targetDate: '2026-11-13' }).codes, []);
  const disabled = fixture(t, { dailyLimit: 0 }); disabled.warm();
  assert.equal(disabled.budget.reserve(list, { targetDate: '2026-11-13' }).reason, 'daily-budget');
  assert.throws(() => createHistoryBackfillBudget({ file: x.ledger, dailyLimit: 6001 }));
});

test('daily cap applies after close and survives restart; midnight uses China date and retains cooldown', t => {
  const x = fixture(t, { dailyLimit: 2 }); x.warm();
  assert.equal(x.budget.reserve(['000001', '000002', '000003'], { limit: 2000, targetDate: '2026-11-13' }).codes.length, 2);
  x.clock.at += 60000;
  const restarted = createHistoryBackfillBudget({ file: x.ledger, now: () => x.clock.at, dailyLimit: 2 });
  assert.equal(restarted.reserve(['000003'], { targetDate: '2026-11-13' }).reason, 'daily-budget');
  x.clock.at = Date.parse('2026-11-14T00:00:01+08:00');
  const next = restarted.reserve(['000003'], { targetDate: '2026-11-13' });
  assert.equal(next.budgetDay, '2026-11-14'); assert.equal(next.attemptedToday, 1);
  // Moving the clock backwards cannot reset the day and refund its budget.
  x.clock.at = Date.parse('2026-11-13T23:59:00+08:00');
  assert.equal(restarted.reserve(['000004'], { targetDate: '2026-11-13' }).reason, 'clock-went-backward');
});

test('no-progress codes rotate behind untouched codes and durable exponential cooldown permits recovery', t => {
  const x = fixture(t); x.warm();
  const list = ['000001', '000002', '000003'];
  assert.deepEqual(x.budget.reserve(list, { limit: 1, targetDate: '2026-11-13' }).codes, ['000001']);
  x.budget.finish('000001', { reason: 'source-lagging' });
  x.clock.at += 60000;
  const restarted = createHistoryBackfillBudget({ file: x.ledger, now: () => x.clock.at });
  assert.deepEqual(restarted.reserve(list, { limit: 1, targetDate: '2026-11-13' }).codes, ['000002']);
  restarted.finish('000002', { reason: 'source-failed' });
  x.clock.at += 60000;
  assert.deepEqual(restarted.reserve(list, { limit: 1, targetDate: '2026-11-13' }).codes, ['000003']);
  restarted.finish('000003', { reason: 'source-failed' });
  x.clock.at += 60000;
  assert.equal(restarted.reserve(list, { targetDate: '2026-11-13' }).codes.length, 0);
  x.clock.at += POLICY.failureDelayMs;
  assert.deepEqual(restarted.reserve(['000001'], { targetDate: '2026-11-13' }).codes, ['000001']);
  restarted.finish('000001', { reason: 'source-failed' });
  const failed = JSON.parse(fs.readFileSync(x.ledger)).items['000001'];
  assert.equal(failed.nextAttemptAt - x.clock.at, POLICY.failureDelayMs * 2);
  x.clock.at = failed.nextAttemptAt;
  assert.equal(restarted.reserve(['000001'], { targetDate: '2026-11-13' }).codes.length, 1);
  restarted.finish('000001', { success: true });
  assert.equal(restarted.summary().deferredCodes, 2);
});

test('corrupt state, unsafe files and failed persistence fail closed before any reservation', t => {
  const x = fixture(t); x.warm();
  fs.writeFileSync(x.ledger, '{broken');
  const restarted = createHistoryBackfillBudget({ file: x.ledger, now: () => x.clock.at });
  assert.throws(() => restarted.reserve(['000001'], { targetDate: '2026-11-13' }), /无可信状态/);
  // A full/unwritable data directory is represented by a non-directory parent.
  const badRoot = path.join(x.root, 'not-a-directory'); fs.writeFileSync(badRoot, 'fixture');
  const blocked = createHistoryBackfillBudget({ file: path.join(badRoot, 'budget.json'), now: () => x.clock.at });
  assert.throws(() => blocked.reserve(['000001'], { targetDate: '2026-11-13' }));
  const symlink = path.join(x.root, 'linked.json'); fs.symlinkSync(x.ledger, symlink);
  assert.throws(() => createHistoryBackfillBudget({ file: symlink, now: () => x.clock.at }).reserve(['000001'], { targetDate: '2026-11-13' }), /无可信状态/);
});

test('calendar targets last closed trading session across weekends, Monday midnight and holidays', () => {
  assert.equal(backfillSession(Date.parse('2026-11-16T00:01:00+08:00'), weekday).targetDate, '2026-11-13');
  assert.equal(backfillSession(Date.parse('2026-11-16T15:29:59+08:00'), weekday).targetDate, '2026-11-13');
  assert.equal(backfillSession(Date.parse('2026-11-16T15:30:00+08:00'), weekday).targetDate, '2026-11-16');
  const holiday = d => weekday(d) && d.getDate() !== 16;
  assert.equal(backfillSession(Date.parse('2026-11-16T16:00:00+08:00'), holiday).targetDate, '2026-11-13');
  assert.throws(() => backfillSession(ANCHOR, () => false), /未知/);
});

test('real klineBackfill function admits one batch, caps huge caller limits, and preserves source metadata', async t => {
  const x = fixture(t); x.warm();
  const original = bars(), list = Array.from({ length: 75 }, (_, i) => code(i + 1));
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const y = wireFunction(x, { universe: list, transport: async symbol => { if (symbol === list[0]) await waiting; return original; } });
  const first = y.fn(2000, 60);
  assert.equal(y.calls.length, 1);
  assert.equal((await y.fn(2000, 60)).running, true);
  assert.equal(JSON.parse(fs.readFileSync(x.ledger)).attempted, 60, 'reservation is durable before the first request finishes');
  release();
  const result = await first;
  assert.equal(result.scanned, 60); assert.equal(y.calls.length, 60); assert.equal(y.learns(), 1);
  const saved = JSON.parse(fs.readFileSync(path.join(x.cache, list[0] + '.json')));
  assert.deepEqual(saved, original);
  assert.equal((await y.fn(2000, 60)).addedThis, 0);
  assert.equal(y.calls.length, 60, 'manual and startup calls share the minimum interval');
});

test('real function refreshes stale and missing histories, skips fresh cache, and never stamps old bars current', async t => {
  const x = fixture(t); x.warm();
  const y = wireFunction(x, { universe: ['000001', '000002', '000003'],
    snapshots: { '000001': bars('2026-11-12'), '000002': bars() },
    transport: async symbol => symbol === '000001' ? bars('2026-11-12') : bars() });
  const result = await y.fn(60, 60);
  assert.equal(result.stale, 1); assert.equal(result.missing, 1);
  assert.deepEqual(y.calls.map(c => c.symbol), ['000001', '000003']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(x.cache, '000001.json'))).rows.at(-1).date, '2026-11-12');
  assert.equal(result.addedThis, 1);
  x.clock.at += 60000;
  const again = await y.fn(60, 60);
  assert.equal(again.addedThis, 0); assert.equal(y.calls.length, 2);
  assert.equal(y.learns(), 1, 'no progress does not run expensive ingestion');
});

test('real function defers disconnected and short-listing histories, then recovers; replica never collects', async t => {
  const x = fixture(t); x.warm();
  let healthy = false;
  const y = wireFunction(x, { universe: ['000001', '000002'], stocks: [{ code: '000002', listedDate: '2026-11-12' }],
    transport: async symbol => { if (symbol === '000002') return bars('2026-11-13', 2); if (!healthy) throw Error('fixture disconnected'); return bars(); } });
  await y.fn(60, 60);
  const persisted = JSON.parse(fs.readFileSync(x.ledger));
  assert.equal(persisted.items['000002'].reason, 'listed-short-history');
  assert.equal(persisted.items['000002'].nextAttemptAt, Date.parse('2026-11-16T15:30:00+08:00'));
  healthy = true; x.clock.at += POLICY.failureDelayMs;
  assert.equal((await y.fn(60, 60)).addedThis, 1);
  assert.equal(y.calls.filter(c => c.symbol === '000002').length, 1);
  const other = fixture(t), replica = wireFunction(other, { role: 'replica' });
  assert.equal((await replica.fn(2000, 60)).skipped, 'not-primary');
  assert.equal(replica.calls.length, 0); assert.equal(fs.existsSync(other.ledger), false);
});

test('actual f26 numeric and string listing dates defer new listings; malformed dates are not evidence', async t => {
  for (const listedDate of [20261112, '20261112', '2026-11-12', Date.parse('2026-11-12T00:00:00+08:00')]) {
    const x = fixture(t); x.warm();
    const y = wireFunction(x, { stocks: [{ code: '000001', listedDate }], transport: async () => bars('2026-11-13', 2) });
    await y.fn(60, 60);
    assert.equal(JSON.parse(fs.readFileSync(x.ledger)).items['000001'].reason, 'listed-short-history', String(listedDate));
  }
  const x = fixture(t); x.warm();
  const y = wireFunction(x, { stocks: [{ code: '000001', listedDate: 20261399 }], transport: async () => bars('2026-11-13', 2) });
  await y.fn(60, 60);
  assert.equal(JSON.parse(fs.readFileSync(x.ledger)).items['000001'].reason, 'insufficient-history');
});

test('a batch crossing China midnight stops unstarted reservations instead of spending yesterday allowance', async t => {
  const x = fixture(t);
  x.clock.at = Date.parse('2026-11-13T23:40:00+08:00'); x.warm();
  const y = wireFunction(x, { universe: ['000001', '000002'], transport: async () => {
    x.clock.at = Date.parse('2026-11-14T00:00:01+08:00'); return bars();
  } });
  const result = await y.fn(60, 60);
  assert.equal(result.reserved, 2); assert.equal(result.scanned, 1); assert.equal(y.calls.length, 1);
  const saved = JSON.parse(fs.readFileSync(x.ledger));
  assert.equal(saved.day, '2026-11-13'); assert.equal(saved.attempted, 2);
  assert.equal(saved.items['000002'].reason, 'reserved-before-fetch');
});

test('explicit complete short history pauses for a week while unknown short data stays retryable', async t => {
  const x = fixture(t); x.warm();
  const y = wireFunction(x, { universe: ['000001', '000002'], transport: async symbol =>
    ({ ...bars('2026-11-13', 2), ...(symbol === '000001' ? { historyComplete: true } : {}) }) });
  await y.fn(60, 60);
  const saved = JSON.parse(fs.readFileSync(x.ledger));
  assert.equal(saved.items['000001'].nextAttemptAt - x.clock.at, 7 * 86400000);
  assert.equal(saved.items['000002'].nextAttemptAt - x.clock.at, POLICY.failureDelayMs);
  x.clock.at += 86400000;
  await y.fn(60, 60);
  assert.equal(y.calls.filter(c => c.symbol === '000001').length, 1);
  assert.equal(y.calls.filter(c => c.symbol === '000002').length, 2);
});

test('persisting a reservation must succeed before real backfill function starts even the first supplier call', async t => {
  const x = fixture(t); x.warm();
  fs.symlinkSync(path.join(x.root, 'do-not-overwrite'), x.ledger + '.tmp');
  const y = wireFunction(x);
  const result = await y.fn(60, 60);
  assert.equal(result.ok, false); assert.match(result.error, /无法持久化/); assert.equal(y.calls.length, 0);
  const again = await y.fn(60, 60);
  assert.equal(again.ok, false); assert.equal(y.calls.length, 0);
});

test('server schedule, startup and manual refresh share bounded admission without a fast-mode bypass', () => {
  assert.doesNotMatch(server, /_kbfFastTimer|klineBackfill\(2000|!afterClose && _kbfProg\.scanned/);
  assert.match(server, /setInterval\(_kbfTick, HISTORY_BACKFILL_POLICY\.minIntervalMs\)/);
  assert.match(server, /_clampInt\(b\.n, 0, HISTORY_BACKFILL_POLICY\.batchLimit/);
  assert.match(server, /await klineBackfill\(HISTORY_BACKFILL_POLICY\.batchLimit, 60\)/);
  assert.doesNotMatch(functionSource, /fetchKlineBulk|receivedAt\s*[:=]\s*(?:Date\.now|t0)/);
});
