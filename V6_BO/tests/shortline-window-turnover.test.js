'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {gzipSync, gunzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const {readResearchCalendar} = require('../src/core/research-calendar-source');
const {saveMinuteBars, readMinuteBars} = require('../src/research/shortline-minute-archive');
const {compareWindowTurnover} = require('../src/research/shortline-window-turnover');

const code = '600001', day = '2026-11-27';
const time = (date, hhmm = '16:00') => Date.parse(date + 'T' + hhmm + ':00+08:00');
const selection = {code, day, observedAtMs: time(day)};
const calendar = readResearchCalendar({asOf: time(day), symbol: code});
const dates = calendar.tradeDates.filter(d => d <= day).slice(-22);
function archive(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fayo-turnover-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
// Synthetic native receipts. The afternoon has ten times the usual morning size.
function bars(date, period = '5m', multiplier = 1) {
  const step = period === '1m' ? 1 : 5;
  const source = step === 1 ? 'V6/eastmoney' : 'V6/sina';
  const rawHash = createHash('sha256').update(['synthetic', date, period, multiplier].join('/')).digest('hex');
  const records = [];
  for (const start of [570, 780]) {
    for (let m = start + step; m <= start + 120; m += step) {
      const stamp = [Math.floor(m / 60), m % 60].map(n => String(n).padStart(2, '0')).join(':');
      const volume = multiplier * (start === 780 ? 100 : 10) * step;
      records.push({code, role: 'stock', period, secid: '1.' + code, source, rawHash,
        date: date + ' ' + stamp, knownAt: time(date, '15:30'), availableAt: date + ' 15:30',
        priceBasis: 'unadjusted', volumeUnit: 'shares', open: 10, close: 10, low: 10, high: 10,
        amount: volume * 10, volume});
    }
  }
  return records;
}
const save = (root, date, rows, observedAtMs = time(date)) => saveMinuteBars(root, {day: date, code, observedAtMs}, rows);
for (const period of ['1m', '5m']) {
  test(period + ' compares the three separate five-minute slots on the preceding 20 exchange sessions', async t => {
    const root = archive(t);
    const history = dates.slice(1, -1);
    history.forEach((d, i) => save(root, d, bars(d, period, i < 10 ? 1 : 3)));
    const current = bars(day, period, 2);
    const {shortlineJob} = await import('../src/research/shortline/store.mjs');
    const {state} = await shortlineJob({root,
      input: {revision: 0, action: 'v6:sync', payload: {code, day}},
      snapshot: {...selection, stock: {code, name: '合成测试'}, minuteBars: current, bars: [], market: [],
        missing: [], evidence: [], observedAt: day + ' 16:00', latestClosedDay: day, latestClosed: true}});
    const report = state.v6Observation.windowTurnover;
    assert.equal(report.status, 'available');
    assert.equal(report.period, period);
    assert.deepEqual(report.windows.map(w => w.multiple), [1, 1, 1]);
    assert.deepEqual(report.windows.map(w => w.median), [1000, 10000, 10000]);
    assert.deepEqual(report.history.map(x => x.day), history);
    assert.equal(report.current.rawHash, current[0].rawHash);
    assert.equal(report.calendarSha256, calendar.metadata.sha256);
    assert.deepEqual((await shortlineJob({root})).state.v6Observation.windowTurnover, report);
    const {windowTurnoverHTML} = await import('../public/nova/shortline/market.mjs');
    assert.match(windowTurnoverHTML(report, code, day), /20\/20/);
    assert.match(windowTurnoverHTML(report, code, day), /13:00–13:05/);
    assert.equal(windowTurnoverHTML(report, '000001', day), '');
    assert.equal(windowTurnoverHTML(report, code, dates.at(-2)), '');
    assert.equal(windowTurnoverHTML(undefined, code, day), '');
  });
}
test('one missing day stays missing even if an older usable day is present; zero is not missing', t => {
  const root = archive(t), omitted = dates[5];
  for (const d of dates.filter(d => d !== omitted)) {
    const tape = bars(d);
    for (const row of tape) if (row.date.endsWith('09:35') && d !== day || row.date.endsWith('15:00') && d === day) {
      row.volume = 0; row.amount = 0;
    }
    save(root, d, tape);
  }
  const missing = compareWindowTurnover(root, selection);
  assert.equal(missing.observedDays, 19);
  assert.ok(missing.windows.every(w => w.multiple === null));
  assert.equal(missing.history.find(r => r.day === omitted).status, 'missing-session');
  save(root, omitted, bars(omitted).map(r => r.date.endsWith('09:35') ? {...r, volume: 0, amount: 0} : r));
  const complete = compareWindowTurnover(root, selection);
  assert.equal(complete.status, 'partial');
  assert.deepEqual(complete.windows.map(w => w.multiple), [null, 1, 0]);
  assert.equal(complete.windows[0].reason, 'zero-median');
});
test('late conflicting receipt quarantines the session durably and preserves the earlier research cut', t => {
  const root = archive(t);
  for (const d of dates.slice(1)) save(root, d, bars(d));
  const target = dates.at(-2), first = bars(target)[0], later = time(day, '17:00');
  save(root, target, [{...first, volume: first.volume * 2, amount: first.amount * 2}], later);
  assert.equal(compareWindowTurnover(root, selection).status, 'available');
  const after = compareWindowTurnover(root, {...selection, observedAtMs: later});
  assert.equal(after.history.at(-1).status, 'disputed-session');
  assert.equal(after.observedDays, 19);
  assert.equal(readMinuteBars(root, {code, day: target, observedAtMs: later})[0].amount, first.amount);
});
test('calendar, partial pages, archived currency, mixed receipts, provider and cutoff cannot fill the denominator', t => {
  const root = archive(t), changes = dates.slice(-8, -1);
  for (const d of dates.slice(1)) {
    let rows = bars(d);
    if (d === changes[0]) rows.pop();
    if (d === changes[1]) rows[2].amountUnit = 'USD';
    if (d === changes[2]) rows[15].rawHash = 'c'.repeat(64);
    if (d === changes[3]) rows.forEach(r => {r.source = 'V6/tencent'; delete r.amount;});
    if (d === changes[4]) rows = bars(d, '1m');
    save(root, d, rows, d === changes[5] ? time(day, '16:01') : time(d));
    if (d === changes[6]) {
      const file = path.join(root,'minutes-v1',d,'stock-'+code+'-5m.json.gz');
      const envelope = JSON.parse(gunzipSync(fs.readFileSync(file)));
      delete envelope.data.turnoverAudit;
      envelope.sha256 = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
      fs.writeFileSync(file, gzipSync(JSON.stringify(envelope)));
    }
  }
  const report = compareWindowTurnover(root, selection);
  assert.equal(report.observedDays, 13);
  assert.deepEqual(report.history.slice(-7).map(r => r.status), ['incomplete-session', 'incompatible-receipt-or-amount',
    'incompatible-receipt-or-amount', 'incompatible-receipt-or-amount', 'missing-session', 'missing-session', 'legacy-without-dispute-history']);
  assert.equal(compareWindowTurnover(root, {...selection, day: '2026-11-22'}).reason, 'calendar-unavailable-or-session-closed');
  assert.equal(compareWindowTurnover(root, {...selection, observedAtMs: time(day,'14:00')}).reason, 'current-session-unavailable');
  assert.equal(compareWindowTurnover(root, {...selection, code:'920001'}).reason, 'calendar-unavailable-or-session-closed');
});
