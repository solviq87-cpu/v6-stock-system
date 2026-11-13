'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.V6_SELECTION_TEST_SOURCE || path.resolve(__dirname, '../../V6_WEB/workbuddy/index.html'), 'utf8');
const ending = "})(typeof window!=='undefined'?window:globalThis);";
function moduleFor(name) {
  const marker = html.indexOf('root.' + name + '=Object.freeze(');
  const starts = [...html.slice(0, marker).matchAll(/\(function\s*\(root\)\s*\{/g)];
  assert.ok(marker >= 0 && starts.length, 'Missing actual module ' + name);
  const end = name === 'TianjiViews' ? html.indexOf('})(window);', marker) + 11 : html.indexOf(ending, marker) + ending.length;
  return html.slice(starts.at(-1).index, end);
}
const at = value => Date.parse(value + '+08:00');
function harness() {
  let now = at('2026-11-13T09:45:00');
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const c = { Date: ClockDate, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    document: { hidden: false }, navigator: {}, localStorage: { getItem: () => null },
    fetch() { assert.fail('Freshness checks must not fetch or publish'); } };
  c.window = c; vm.createContext(c);
  for (const name of ['V6Core', 'V6Market', 'V6SelectionClock', 'V6Policy', 'V6Battle']) vm.runInContext(moduleFor(name), c);
  const rows = [1, 2, 3].map((n) => ({ symbol: '30000' + n, name: '离线测试' + n,
    price: 12 + n, previousClose: 12, change: n, volume: 10000, amount: 1e8,
    floatMarketCap: 8e9, marketCap: 1e10, turnover: 3, pe: 10 + n, pb: 1,
    ma5: 12, ma20: 11, momentum: 8, dayVolumeRatio: 1.5, volatility: 1,
    providerTime: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(),
    providerDateKnown: true, standardVolumeRatio: true, volumeRatio: 4,
    volumeRatioSource: 'offline fixture', source: 'offline fixture' }));
  const snapshot = { stocks: rows, indices: [], universe: { complete: true, count: 3 },
    marketDataVersion: 1, providerTime: rows[0].providerTime, fetchedAt: rows[0].receivedAt };
  const state = c.V6Core.createDefaultState();
  Object.assign(state.selectionPolicy, { excludeBanks: false, excludeWeightProxy: false, excludeDefensive: false, allowUnknownIndustry: true });
  c.V6Core.setMarketData(snapshot);
  return { c, rows, snapshot, state, jump(value) { now = typeof value === 'number' ? value : at(value); }, get now() { return now; } };
}
test('actual session calendar and row clock enforce the exact two-minute research boundary', () => {
  const h = harness();
  assert.equal(h.c.V6SelectionClock.check(h.rows[0]).ok, true);
  h.jump(h.now + 120000); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).ok, true);
  h.jump(h.now + 1); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).code, 'staleQuote');
});
for (const [label, changes, expected] of [
  ['last-month archive received now', { providerTime: '2026-10-13T09:45:00+08:00' }, 'staleQuote'],
  ['previous trading day', { providerTime: '2026-11-12T15:00:00+08:00' }, 'staleQuote'],
  ['unknown date', { providerDateKnown: false }, 'quoteClockUnknown'],
  ['missing source clock', { providerTime: null }, 'quoteClockUnknown'],
  ['missing row receipt', { receivedAt: null }, 'quoteClockUnknown'],
  ['explicit source stale flag', { isStale: true }, 'staleQuote'],
  ['future receipt', { receivedAt: '2026-11-13T09:45:01+08:00' }, 'quoteClockInvalid'],
  ['source after receipt', { providerTime: '2026-11-13T09:45:01+08:00' }, 'quoteClockInvalid']
]) test('common candidate gate rejects ' + label, () => {
  const h = harness(); Object.assign(h.rows[0], changes);
  const result = h.c.V6Battle.checkStock(h.rows[0], h.state, h.snapshot, { skipPushPreferences: true });
  assert.equal(result.status, 'pending'); assert.ok(result.pending.some(r => r.code === expected));
});
test('latest completed session remains dated research and cannot be called current or tradable', () => {
  const h = harness(); h.jump('2026-11-13T20:00:00');
  assert.equal(h.c.V6SelectionClock.check(h.rows[0]).code, 'staleClose');
  Object.assign(h.rows[0], { providerTime: '2026-11-13T15:00:00+08:00', receivedAt: '2026-11-13T15:00:02+08:00' });
  for (const date of ['2026-11-13T20:00:00', '2026-11-14T10:00:00', '2026-11-16T09:00:00']) {
    h.jump(date); const result = h.c.V6SelectionClock.check(h.rows[0]);
    assert.equal(result.ok, true); assert.equal(result.current, false); assert.equal(result.canTrade, false);
    assert.equal(result.dataDate, '2026-11-13');
  }
  h.jump('2026-11-16T09:30:00'); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).ok, false);
  h.jump('2027-01-04T10:00:00'); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).code, 'calendarUnknown');
});
test('lunch does not extend the lifetime of morning observations', () => {
  const h = harness(); Object.assign(h.rows[0], { providerTime: '2026-11-13T11:29:59+08:00', receivedAt: '2026-11-13T11:30:00+08:00' });
  h.jump('2026-11-13T11:30:00'); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).code, 'break-observation');
  h.jump('2026-11-13T12:00:00'); assert.equal(h.c.V6SelectionClock.check(h.rows[0]).ok, false);
});
test('all four strategies invalidate cached candidates without requiring a new source version', () => {
  const h = harness(), before = {};
  for (const strategy of h.c.V6Core.strategies) {
    before[strategy.id] = h.c.V6Policy.screen(h.state, h.snapshot, strategy.id);
    assert.ok(before[strategy.id].items.length > 0, strategy.id + ' has fresh candidates');
  }
  h.jump(h.now + 120001);
  for (const strategy of h.c.V6Core.strategies) {
    const after = h.c.V6Policy.screen(h.state, h.snapshot, strategy.id);
    assert.notEqual(after, before[strategy.id]); assert.equal(after.items.length, 0);
    assert.ok(after.pending.some(r => r.pendingReasons.some(p => p.includes('超过2分钟'))));
  }
  for (const row of h.rows) row.providerTime = row.receivedAt = new Date(h.now).toISOString();
  h.snapshot.marketDataVersion++; h.c.V6Core.setMarketData(h.snapshot);
  assert.ok(h.c.V6Policy.screen(h.state, h.snapshot, 'value').items.length > 0);
});
test('normalization cannot borrow a batch source timestamp to qualify a row', () => {
  const h = harness(); delete h.rows[0].providerTime; delete h.rows[0].receivedAt;
  h.c.V6Core.setMarketData(h.snapshot);
  const result = h.c.V6Policy.screen(h.state, h.snapshot, 'value');
  assert.ok(!result.items.some(r => r.symbol === h.rows[0].symbol));
  assert.ok(result.pending.some(r => r.symbol === h.rows[0].symbol && r.pendingReasons.some(p => p.includes('逐股'))));
});
test('clock expiry also invalidates cached breadth and index-derived market regime', () => {
  const h = harness(); h.snapshot.indices = ['sh000001', 'sz399001', 'sz399006'].map(symbol => ({ ...h.rows[0], symbol, change: 1 }));
  const before = h.c.V6Policy.analyzeMarket(h.snapshot);
  assert.equal(before.regime.id, 'strong'); h.jump(h.now + 120001);
  const after = h.c.V6Policy.analyzeMarket(h.snapshot);
  assert.equal(after.regime.id, 'insufficient'); assert.equal(after.breadth.alignedCount, 0);
});
test('43-playbook cache and held-stock exception cannot resurrect expired signals', () => {
  const h = harness();
  const before = h.c.V6Battle.scan(h.state, h.snapshot, { strategyIds: ['b41'] });
  assert.ok(before.signals.length > 0); h.state.positions = [{ symbol: h.rows[0].symbol, quantity: 100, averageCost: 10 }];
  h.jump(h.now + 120001);
  const cached = h.c.V6Battle.scan(h.state, h.snapshot, { strategyIds: ['b41'], cacheOnly: true });
  assert.equal(cached.status, 'pending'); assert.equal(cached.signals.length, 0);
  const after = h.c.V6Battle.scan(h.state, h.snapshot, { strategyIds: ['b41'] });
  assert.equal(after.signals.length, 0); assert.equal(after.perStrategy.b41.checkedCount, 0);
});
test('expiry during an async batch rejects the entire completed result', async () => {
  const h = harness(); let advanced = false;
  const result = await h.c.V6Battle.scanAsync(h.state, h.snapshot, { strategyIds: ['b41'], batchSize: 1,
    onProgress() { if (!advanced) { advanced = true; h.jump(h.now + 120001); } } });
  assert.equal(result.status, 'superseded'); assert.equal(result.signals.length, 0);
  assert.equal(h.c.V6Battle.lastScan, null);
});
test('render-only clock clears frozen screen state without network or scan calls', () => {
  const h = harness(); let rendered = 0;
  Object.assign(h.c, { ready: true, busy: false, displayedSelectionClock: '', renderMarketSafely() { rendered++; } });
  // Preserve the actual session calendar and provide a frozen source snapshot.
  h.c.V6Market = { snapshot: h.snapshot, sessionAt: h.c.V6Market.sessionAt };
  const start = html.indexOf('function refreshSelectionClock(){'), end = html.indexOf('setInterval(refreshSelectionClock', start);
  vm.runInContext(html.slice(start, end), h.c);
  h.c.refreshSelectionClock(); h.c.refreshSelectionClock(); assert.equal(rendered, 1);
  h.jump(h.now + 120001); h.c.refreshSelectionClock(); assert.equal(rendered, 2);
  h.c.document.hidden = true; h.jump('2026-11-14T10:00:00'); h.c.refreshSelectionClock(); assert.equal(rendered, 2);
});
test('homepage memo re-enters policy filtering when frozen data ages', () => {
  const h = harness(), policy = h.c.V6Policy; let screens = 0;
  h.c.V6Policy = { ...policy, screen(...args) { screens++; return policy.screen(...args); } };
  h.c.V6Market = { snapshot: h.snapshot, status: {}, sessionAt: h.c.V6Market.sessionAt };
  vm.runInContext(moduleFor('TianjiViews'), h.c);
  h.c.TianjiViews.home(h.state); h.c.TianjiViews.home(h.state); assert.equal(screens, 1);
  h.jump(h.now + 120001); h.c.TianjiViews.home(h.state); assert.equal(screens, 2);
  assert.equal(policy.screen(h.state, h.snapshot, h.state.selectedStrategy).items.length, 0);
});
