'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../src/core/intelligence-history');
const {auditCenterInputs} = require('../src/core/intelligence-research');
const {readEvents} = require('../src/core/research-workspace-store');
const {runWorkspaceJob} = require('../src/server/research-workspace-job');
const {spawnSync} = require('node:child_process');
const day = '2026-11-23', at = Date.parse(day + 'T16:10:00+08:00');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fayo-hfq-evidence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root;
}
function eastmoney(receivedAt = at, dateValue = day, price = '10.00') {
  const rawText = JSON.stringify({rc: 0, data: {code: '600000', name: '隔离适配器输入', klines: [dateValue + ',' + price + ',' + price + ',' + price + ',' + price + ',1000,1000000']}});
  return {schemaVersion: 1, mode: H.MODE, source: 'eastmoney-public-history', startedAt: receivedAt - 1000,
    receivedAt, rawText, rawHash: hash(rawText), timeMeaning: 'collector-received-at', canTrade: false,
    request: {symbols: ['600000'], start: dateValue, end: dateValue, endpoint: H.ENDPOINT, secid: '1.600000', klt: '101', fqt: '2'}};
}
function baostock(receivedAt = at, dateValue = day) {
  const rows = Array.from({length: 31}, (_, i) => ({calendar_date: new Date(Date.parse(dateValue) + i * 86400000).toISOString().slice(0, 10),
    // Explicit deterministic fixture calendar, never installed in production.
    is_trading_day: i < 5 ? '1' : '0'}));
  const raw = {schemaVersion: 1, mode: 'baostock-center-hfq-export-v1', completed: true, canTrade: false,
    startedAt: receivedAt - 900, completedAt: receivedAt - 100, start: dateValue, end: dateValue,
    calendar: {source: 'baostock:query_trade_dates', errorCode: '0', complete: true, receivedAt: receivedAt - 800,
      startDate: dateValue, endDate: rows.at(-1).calendar_date, rows},
    stocks: [{code: 'sh.600000', errorCode: '0', complete: true, frequency: 'd', adjustflag: '1', receivedAt: receivedAt - 500,
      rows: [{code: 'sh.600000', date: dateValue, open: '10.00', high: '10.00', low: '10.00', close: '10.00',
        volume: '100000', amount: '1000000', adjustflag: '1', tradestatus: '1'}]}]};
  const rawText = JSON.stringify(raw);
  return {schemaVersion: 1, mode: H.MODE, source: 'baostock', startedAt: receivedAt - 1000,
    receivedAt, rawText, rawHash: hash(rawText), timeMeaning: 'collector-received-at', canTrade: false,
    request: {symbols: ['600000'], start: dateValue, end: dateValue, frequency: 'd', adjustflag: '1'}};
}
function amend(receipt, fn) {
  const next = clone(receipt), raw = JSON.parse(next.rawText); fn(raw);
  next.rawText = JSON.stringify(raw); next.rawHash = hash(next.rawText); return next;
}

test('hfq adapters preserve original adjustment flags, units and unknown source clocks', () => {
  const em = eastmoney(), bs = baostock();
  em.observedAt = Date.parse(day + 'T15:00:00+08:00');
  const a = H.normalizeHistoryReceipt(em, {now: at}), b = H.normalizeHistoryReceipt(bs, {now: at});
  assert.equal(a.bars[0].volume, 100000); assert.equal(b.bars[0].volume, 100000);
  for (const row of [...a.bars, ...b.bars]) {
    assert.equal(row.adjustment, 'hfq'); assert.equal(row.observedAt, null);
    assert.equal(row.knownAt, at); assert.equal(row.amount, 1000000);
    assert.equal(row.amountBasis, 'actual-unadjusted-turnover'); assert.equal(row.sourceDatePrecision, 'day');
    assert.match(row.lineage.rawHash, /^[a-f0-9]{64}$/);
  }
  const gate = auditCenterInputs([...a.bars, ...b.bars], {now: at});
  assert.equal(gate.admittedGroups, 0);
  assert.ok(gate.rejected.every(row => row.reason === 'missing-original-time'));
  assert.equal(b.calendars[0].knownAt, at, 'today collection cannot backdate the calendar');
});

test('qfq/unadjusted, renamed source, missing fields, bad stream flags and fabricated clocks are rejected', () => {
  for (const modify of [r => {r.request.fqt = '1';}, r => {r.request.klt = '5';}, r => {r.request.secid = '0.600000';},
    r => {r.source = 'efinance';}, r => {r.receivedAt = at + 1;}, r => {r.rawHash = 'f'.repeat(64);}]) {
    const receipt = eastmoney(); modify(receipt); assert.throws(() => H.normalizeHistoryReceipt(receipt, {now: at}));
  }
  for (const mutate of [r => {r.stocks[0].rows[0].adjustflag = '3';}, r => {r.stocks[0].complete = false;},
    r => {r.stocks[0].rows[0].amount = '';}, r => {r.stocks[0].rows[0].tradestatus = '0';},
    r => {r.calendar.rows.splice(3, 1);}, r => {r.calendar.receivedAt = at + 1;}])
    assert.throws(() => H.normalizeHistoryReceipt(amend(baostock(), mutate), {now: at}));
  const raw = amend(eastmoney(), r => {r.data.klines[0] = day + ',10,10,10,10,1.25,1250';});
  assert.equal(H.normalizeHistoryReceipt(raw, {now: at}).bars[0].volume, 125, 'fractional hands are exact shares when integral');
});

test('private append-only receipts survive restart, preserve earliest known time and quarantine corrections', t => {
  const root = temporary(t), first = eastmoney();
  const saved = H.recordHistoryReceipt(root, first, {now: at});
  assert.equal(saved.reused, false); assert.equal(H.recordHistoryReceipt(root, first, {now: at}).reused, true);
  H.recordHistoryReceipt(root, eastmoney(at + 1000), {now: at + 1000});
  H.recordHistoryReceipt(root, baostock(at + 2000), {now: at + 2000});
  let history = H.readCenterHistory(root, {now: at + 2000, day});
  assert.equal(history.bars.length, 2); assert.equal(history.bars.find(row => row.source.startsWith('eastmoney')).knownAt, at);
  assert.equal(history.summary.receipts, 3); assert.equal(history.summary.sources.length, 2);
  assert.equal(H.readCenterHistory(root, {now: at - 1, day}).bars.length, 0);
  H.recordHistoryReceipt(root, eastmoney(at + 3000, day, '11.00'), {now: at + 3000});
  history = H.readCenterHistory(root, {now: at + 3000, day});
  assert.equal(history.bars.length, 1); assert.equal(history.summary.quarantinedKeys, 1);
  assert.equal(H.readCenterHistory(root, {now: at + 2000, day}).bars.length, 2, 'future correction cannot alter past replay');
  const file = path.join(root, 'receipts', '000001.json');
  const event = JSON.parse(fs.readFileSync(file)); event.data.receipt.request.fqt = '1';
  fs.writeFileSync(file, JSON.stringify(event));
  assert.throws(() => H.readCenterHistory(root, {now: at + 3000, day}), /完整性/);
  const unchangedArchive = {bars: [{date: day, code: '600001', adjustment: 'qfq'}], checks: []};
  const isolated = H.composeCenterHistory(unchangedArchive, root, {now: at + 3000, day});
  assert.equal(isolated.summary.status, 'invalid-history-store'); assert.deepEqual(isolated.bars, unchangedArchive.bars);
});

test('read-only supply never creates directories and rejects public, symlink or broad-permission stores', t => {
  const root = temporary(t), absent = path.join(root, 'absent');
  assert.equal(H.readCenterHistory(absent, {now: at, day}).summary.status, 'missing-receipts');
  assert.equal(fs.existsSync(absent), false);
  assert.equal(H.readCenterHistory(null, {now: at, day}).summary.status, 'not-configured');
  assert.throws(() => H.recordHistoryReceipt(path.join(root, 'public'), eastmoney(), {now: at}), /公开/);
  const linked = path.join(root, 'link'); fs.symlinkSync(root, linked);
  assert.throws(() => H.recordHistoryReceipt(linked, eastmoney(), {now: at}), /符号链接/);
  H.recordHistoryReceipt(root, eastmoney(), {now: at});
  fs.chmodSync(path.join(root, 'receipts', '000001.json'), 0o644);
  assert.throws(() => H.readCenterHistory(root, {now: at, day}), /权限/);
});

test('bounded collector uses actual fqt=2 and SDK flag1, persists only research evidence, dedupes across calls', async t => {
  const root = temporary(t); let clock = at, requests = 0, sdk = 0;
  const deps = {clock: () => clock, fetchImpl: async (url, options) => {
    requests++; assert.equal(new URL(url).origin + new URL(url).pathname, H.ENDPOINT);
    assert.equal(new URL(url).searchParams.get('fqt'), '2'); assert.equal(options.redirect, 'error');
    clock += 1000; return {ok: true, text: async () => eastmoney().rawText};
  }, runBaoStock: async scope => {
    sdk++; assert.deepEqual(scope.symbols, ['600000']); clock += 1000; return baostock(clock).rawText;
  }};
  let result = await H.collectCenterHistory({root, symbols: ['600000'], start: day, end: day, allowNetwork: true}, deps);
  assert.equal(result.status, 'collected'); assert.equal(requests, 1); assert.equal(sdk, 1);
  assert.equal(result.summary.rows, 2); assert.equal(result.summary.missingOriginalTime, 2);
  assert.ok(result.missing.includes('逐日源端原始时刻'));
  const history = H.readCenterHistory(root, {now: clock, day});
  assert.equal(auditCenterInputs(history.bars, {now: clock}).admittedGroups, 0);
  const before = fs.readFileSync(path.join(root, 'receipts', '000002.json'));
  clock += 900000;
  result = await H.collectCenterHistory({root, symbols: ['600000'], start: day, end: day, allowNetwork: true}, deps);
  assert.equal(result.status, 'already-collected-today'); assert.equal(requests, 1); assert.equal(sdk, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'receipts', '000002.json')), before);
  assert.deepEqual(fs.readdirSync(root).sort(), ['collector', 'receipts']);
});

test('network/replica preflight is side-effect free; role revocation during fetch stops all later writes and sources', async t => {
  const base = temporary(t); let calls = 0, writable = true, clock = at;
  const deps = {clock: () => clock, canWrite: () => writable, fetchImpl: async () => {calls++; writable = false; clock += 1000; return {ok: true, text: async () => eastmoney().rawText};},
    runBaoStock: async () => {throw Error('must not call second provider');}};
  for (const flags of [{}, {allowNetwork: true, replica: true}]) {
    const root = path.join(base, crypto.randomUUID());
    await H.collectCenterHistory({root, symbols: ['600000'], start: day, end: day, ...flags}, deps);
    assert.equal(calls, 0); assert.equal(fs.existsSync(root), false);
  }
  const root = path.join(base, 'revoked');
  const result = await H.collectCenterHistory({root, symbols: ['600000', '600001'], start: day, end: day, allowNetwork: true}, deps);
  assert.equal(result.status, 'read-only-instance'); assert.equal(calls, 1);
  const events = readEvents(path.join(root, 'receipts'), {asOf: clock});
  assert.equal(events.length, 1); assert.equal(events[0].data.mode, 'fayo-center-history-attempt-v1');
});

test('failed collection remains bounded across restart, and concurrent collector does not bypass the lock', async t => {
  const root = temporary(t); let clock = at, calls = 0;
  const deps = {clock: () => clock, fetchImpl: async () => {calls++; throw Error('fixture outage');},
    runBaoStock: async () => {throw Object.assign(Error('missing optional SDK'), {historyCode: 'adapter-unavailable'});}};
  for (let i = 0; i < 3; i++) {
    const result = await H.collectCenterHistory({root, symbols: ['600000'], start: day, end: day, allowNetwork: true}, deps);
    assert.equal(result.status, 'collection-blocked'); assert.equal(result.attempts.at(-1).status, 'adapter-unavailable');
    const again = await H.collectCenterHistory({root, symbols: ['600000'], start: day, end: day, allowNetwork: true}, deps);
    assert.equal(again.status, i === 2 ? 'daily-attempt-limit' : 'retry-cooldown'); clock += 121000;
  }
  assert.equal(calls, 3);
  const other = path.join(root, 'concurrent'); let release, entered;
  const ready = new Promise(resolve => {entered = resolve;});
  const pending = H.collectCenterHistory({root: other, symbols: ['600000'], start: day, end: day, allowNetwork: true},
    {...deps, fetchImpl: () => new Promise(resolve => {release = () => resolve({ok: false}); entered();})});
  await ready;
  const second = await H.collectCenterHistory({root: other, symbols: ['600000'], start: day, end: day, allowNetwork: true}, deps);
  assert.equal(second.status, 'collection-busy'); release(); await pending;
});

test('centre composition and actual worker consume hfq history without rewriting the shortline archive or weakening the time gate', async t => {
  const root = temporary(t), historyRoot = path.join(root, 'history'), archiveRoot = path.join(root, 'shortline');
  H.recordHistoryReceipt(historyRoot, eastmoney(), {now: at});
  H.recordHistoryReceipt(historyRoot, baostock(), {now: at});
  const archive = {scope: 'main', bars: [{date: day, code: '600001', source: 'eastmoney', adjustment: 'qfq'}], checks: []};
  const before = JSON.stringify(archive), input = H.composeCenterHistory(archive, historyRoot, {now: at, day});
  assert.equal(input.bars.length, 3); assert.equal(JSON.stringify(archive), before);
  assert.equal(input.calendar.nextEvidenceByDay[day].knownAt, at);
  const result = await runWorkspaceJob({action: 'intelligence-research', root: archiveRoot, historyRoot, day, now: at, quotes: []});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.historySupply.rows, 2); assert.equal(result.result.coverage.rawBars, 2);
  assert.equal(result.result.coverage.admittedHfqGroups, 0);
  assert.equal(result.result.quality.gates.backtest.reasons['missing-original-time'], 2);
  assert.equal(fs.existsSync(archiveRoot), false, 'a report read cannot create a private original archive');
});

test('actual Python collector preserves hfq SDK requests and detects late stream errors offline', () => {
  const result = spawnSync('python3', [path.join(__dirname, 'test_center_hfq_collector.py')],
    {encoding: 'utf8', timeout: 10000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 4 tests/); assert.match(result.stderr, /^OK$/m);
});
