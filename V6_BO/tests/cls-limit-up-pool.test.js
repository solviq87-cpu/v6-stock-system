'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { CLS_LIMIT_POOL_URL, normalizeClsLimitPool, fetchClsLimitPool, fetchClsLimitUpPool } = require('../src/core/cls-limit-up-pool');
const { createMarketRequestGovernor } = require('../src/core/market-request-governor');
const NOW = Date.parse('2026-11-15T08:00:00+08:00'), DAY = '2026-11-13';
// Synthetic provider-shaped records, not an archived or authenticated live pool.
const pool = (n = 38) => ({ code: 200, data: Array.from({ length: n }, (_, i) => ({
  secu_code: (i === n - 1 ? 'bj' : i % 2 ? 'sz' : 'sh') + String(600001 + i), secu_name: '样本' + i,
  last_px: 12.34, change: 0.1, limit_up_days: i % 4 + 1, is_st: i === n - 1 ? 1 : 0,
  time: DAY + ' 09:30:00', num_stocks: n, up_reason: '公开原因' + i,
  plate: [{ secu_code: '1001', secu_name: '第一题材' }, { secu_code: '1002', secu_name: '第二题材' }]
})) });
const normalize = (json, extra = {}) => normalizeClsLimitPool(json, { requestedDate: DAY, receivedAt: NOW, ...extra });
const wrap = json => ({ status: 200, raw: JSON.stringify(json) });
function unavailable(result, code) {
  assert.equal(result.complete, false); assert.deepEqual(result.items, []); assert.equal(result.tradeDate, null);
  assert.equal(result.errors[0].code, code);
}
test('all 38 provider rows including ST and every plate/reason survive without a shortlist', () => {
  const j = pool(), before = JSON.stringify(j), r = normalize(j);
  assert.equal(r.status, 'available'); assert.equal(r.complete, true);
  assert.equal(r.totalCount, 38); assert.equal(r.fetchedCount, 38); assert.equal(r.uniqueCount, 38);
  assert.equal(r.items.length, 38); assert.equal(r.reasonCount, 38); assert.equal(r.sectorCount, 38);
  assert.equal(r.tradeDate, DAY); assert.equal(r.source, 'cls'); assert.equal(r.scope, 'provider-up-pool-including-st');
  assert.equal(r.items.filter(item => item.isST).length, 1); assert.equal(r.items.at(-1).exchange, 'bj');
  for (let i = 0; i < r.items.length; i++) {
    const item = r.items[i]; assert.equal(item.code, j.data[i].secu_code.slice(2));
    assert.equal(item.reason, j.data[i].up_reason); assert.equal(item.reasonSource, 'cls');
    assert.equal(item.reasonDateStatus, 'matched'); assert.equal(item.reasonTradeDate, DAY);
    assert.equal(item.sector, '第一题材'); assert.deepEqual(item.plates, [{ code: '1001', name: '第一题材' }, { code: '1002', name: '第二题材' }]);
    assert.equal(item.sectorTags.length, 2); assert.equal(item.sectorTags[1].code, '1002');
    assert.equal(item.price, 12.34); assert.equal(item.pct, null); assert.equal(item.nativeChange, 0.1);
    assert.equal(item.changeUnit, 'unverified'); assert.equal(item.limitUpCount, i % 4 + 1);
    assert.equal(item.canTrade, false); assert.equal(item.canNotify, false); assert.equal(item.verifiedLive, false);
  }
  assert.equal(JSON.stringify(j), before); assert.equal(r.historicalDateSelectionSupported, false);
  assert.equal(r.coverage, 'provider-up-pool-only-not-all-a-shares');
});
test('provider event timestamps retain China timezone and never become quote timestamps or receive times', () => {
  const r = normalize(pool()), row = r.items[0];
  assert.equal(row.sourceEventAt, Date.parse(DAY + 'T09:30:00+08:00'));
  assert.notEqual(row.sourceEventAt, NOW); assert.equal(row.receivedAt, NOW); assert.equal(row.rawEventTime, DAY + ' 09:30:00');
  assert.equal(row.quoteAt, null); assert.equal(row.quoteMode, 'dated-limit-up-pool');
  assert.equal(row.metadata.priceTimestampProvided, false); assert.equal(row.metadata.eventTimeField, 'time');
  assert.equal(row.metadata.eventTimeZone, 'Asia/Shanghai'); assert.equal(r.quoteAt, null);
  assert.equal(r.canTrain, false); assert.equal(r.canTrade, false); assert.equal(r.canNotify, false); assert.equal(r.verifiedLive, false);
});
test('YYYYMMDD target and ISO reception are normalized without changing provider dates', () => {
  const r = normalize(pool(), { requestedDate: '20261113', receivedAt: new Date(NOW).toISOString() });
  assert.equal(r.requestedDate, DAY); assert.equal(r.tradeDate, DAY); assert.equal(r.receivedAt, NOW); assert.equal(r.complete, true);
});
test('a complete latest pool cannot be advertised as a requested historical date', () => {
  for (const requestedDate of ['2026-11-12', '2026-11-15']) {
    const r = normalize(pool(), { requestedDate });
    assert.equal(r.status, 'date-mismatch'); assert.equal(r.complete, true); assert.equal(r.tradeDate, DAY);
    assert.equal(r.requestedDate, requestedDate); assert.equal(r.sourceTradeDate, DAY);
    assert.ok(r.items.every(item => item.reasonDateStatus === 'date-mismatch' && item.reasonTradeDate === DAY && item.tradeDate === DAY));
  }
});
test('missing metrics and associations remain explicit unknown values', () => {
  const j = pool(1); Object.assign(j.data[0], { last_px: '', change: null, limit_up_days: '3', is_st: null, up_reason: null, plate: null });
  const r = normalize(j), row = r.items[0];
  assert.equal(r.complete, true); assert.equal(row.price, null); assert.equal(row.pct, null); assert.equal(row.nativeChange, null);
  assert.equal(row.limitUpCount, null); assert.equal(row.isST, null); assert.equal(row.sector, ''); assert.deepEqual(row.sectorTags, []);
  assert.equal(row.reason, ''); assert.equal(row.reasonStatus, 'unknown'); assert.equal(row.sectorStatus, 'unknown');
  assert.equal(r.reasonCount, 0); assert.equal(r.sectorCount, 0);
});
test('nonpositive/nonfinite prices and unverified board-count strings never fabricate metrics', () => {
  for (const value of [0, -1, null, '', 'bad', Infinity, NaN, true]) {
    const j = pool(1); Object.assign(j.data[0], { last_px: value, limit_up_days: value, change: value });
    const row = normalize(j).items[0]; assert.equal(row.price, null); assert.equal(row.limitUpCount, null); assert.equal(row.pct, null);
  }
  const j = pool(1); Object.assign(j.data[0], { limit_up_days: '2', last_px: '12.50', change: 1000001 });
  const row = normalize(j).items[0]; assert.equal(row.price, 12.5); assert.equal(row.limitUpCount, null); assert.equal(row.nativeChange, null);
});
for (const [label, edit, code] of [
  ['duplicate symbol', j => { j.data[1].secu_code = j.data[0].secu_code; }, 'cls-duplicate-code'],
  ['mixed dates', j => { j.data[1].time = '2026-11-12 09:30:00'; }, 'cls-mixed-trade-dates'],
  ['missing total', j => { delete j.data[1].num_stocks; }, 'cls-total-invalid'],
  ['changed total', j => { j.data[1].num_stocks = 37; }, 'cls-total-invalid'],
  ['string total', j => { j.data[1].num_stocks = '38'; }, 'cls-total-invalid'],
  ['incomplete total', j => { j.data.pop(); }, 'cls-incomplete-pool'],
  ['invalid code', j => { j.data[1].secu_code = 'hk600001'; }, 'cls-item-identity-invalid'],
  ['short code', j => { j.data[1].secu_code = 'sh12345'; }, 'cls-item-identity-invalid'],
  ['missing name', j => { j.data[1].secu_name = ' '; }, 'cls-item-identity-invalid'],
  ['missing source time', j => { delete j.data[1].time; }, 'cls-event-time-invalid'],
  ['invalid source date', j => { j.data[1].time = '2026-02-30 09:30:00'; }, 'cls-event-time-invalid'],
  ['future source time', j => { j.data[1].time = '2026-11-16 09:30:00'; }, 'cls-event-time-future'],
  ['impossible clock', j => { j.data[1].time = '2026-11-13 25:30:00'; }, 'cls-event-time-invalid'],
  ['malformed plate list', j => { j.data[1].plate = {}; }, 'cls-plate-invalid'],
  ['malformed plate identity', j => { j.data[1].plate[1].secu_code = ''; }, 'cls-plate-invalid']
]) test(label + ' rejects the entire pool instead of presenting a valid prefix as complete', () => {
  const j = pool(); edit(j); const r = normalize(j); unavailable(r, code); assert.equal(r.status, 'invalid');
});
test('empty, over-bound, malformed and rejected provider payloads cannot authenticate an empty trading day', () => {
  for (const j of [null, {}, { code: 200, data: {} }, { code: 500, data: pool().data }]) unavailable(normalize(j), 'cls-provider-response-invalid');
  unavailable(normalize(pool(0)), 'cls-empty-pool-date-unverified');
  unavailable(normalize(pool(10001)), 'cls-pool-too-large');
});
test('bad requested dates and unavailable reception clocks fail without inferring source date from a clock', () => {
  for (const requestedDate of [undefined, '', '20260230', '2026-11-13T00:00:00Z']) unavailable(normalize(pool(), { requestedDate }), 'cls-requested-date-invalid');
  for (const receivedAt of [undefined, null, '', NaN, -1]) unavailable(normalize(pool(), { receivedAt }), 'cls-received-time-invalid');
});
test('fetch uses one fixed endpoint, bounded authoritative bytes and dependency clock', async () => {
  const calls = [], times = [NOW - 100, NOW];
  const r = await fetchClsLimitPool({ date: '20261113' }, { now: () => times.shift(), requestJson: async (target, options) => {
    calls.push({ target, options }); return { ...wrap(pool()), json: { code: 500 } };
  } });
  assert.equal(fetchClsLimitUpPool, fetchClsLimitPool); assert.equal(r.complete, true); assert.equal(r.requestCount, 1);
  assert.equal(r.receivedAt, NOW); assert.equal(calls.length, 1); assert.equal(calls[0].target, CLS_LIMIT_POOL_URL);
  assert.equal(new URL(calls[0].target).searchParams.has('date'), false);
  assert.equal(calls[0].options.maxBytes, 2 * 1024 * 1024); assert.equal(calls[0].options.timeoutMs, 12000);
});
test('default requested day uses China date while latest source retains its actual previous trading day', async () => {
  const r = await fetchClsLimitPool({}, { now: NOW, requestJson: async () => wrap(pool()) });
  assert.equal(r.requestedDate, '2026-11-15'); assert.equal(r.tradeDate, DAY); assert.equal(r.status, 'date-mismatch');
});
test('invalid requested day prevents transport invocation', async () => {
  let calls = 0;
  const r = await fetchClsLimitPool({ date: '20260230' }, { now: NOW, requestJson: async () => { calls++; } });
  unavailable(r, 'cls-requested-date-invalid'); assert.equal(calls, 0);
});
test('bad JSON, missing/oversize bytes, HTTP errors and redirect fail without retry', async () => {
  for (const [response, code] of [
    [{ status: 200, raw: '{invalid' }, 'cls-json-invalid'],
    [{ status: 200, json: pool() }, 'cls-response-bytes-required'],
    [{ status: 200, raw: ' '.repeat(2 * 1024 * 1024 + 1) }, 'response-too-large'],
    [{ status: 503, raw: JSON.stringify(pool()) }, 'http-error'],
    [{ status: 302, headers: { location: 'https://other.invalid/' }, raw: JSON.stringify(pool()) }, 'http-error']
  ]) {
    let calls = 0;
    const r = await fetchClsLimitPool({ date: DAY }, { now: NOW, requestJson: async () => { calls++; return response; } });
    unavailable(r, code); assert.equal(r.status, 'unavailable'); assert.equal(calls, 1);
  }
});
for (const status of [403, 429]) test('HTTP ' + status + ' preserves the shared transport cooldown and never retries/bypasses', async () => {
  const requestGovernor = createMarketRequestGovernor({ now: () => NOW, minIntervalMs: 0 }); let calls = 0;
  const deps = { now: NOW, requestGovernor, requestJson: async () => { calls++; return { status, raw: JSON.stringify(pool()) }; } };
  const first = await fetchClsLimitPool({ date: DAY }, deps), second = await fetchClsLimitPool({ date: DAY }, deps);
  for (const r of [first, second]) {
    unavailable(r, 'MARKET_RESTRICTED'); assert.equal(r.status, 'restricted'); assert.equal(r.httpStatus, status);
    assert.ok(r.resumeAt > NOW); assert.equal(r.errors[0].status, status);
  }
  assert.equal(calls, 1);
});
test('aborted requests and backwards reception clocks cannot produce a pool', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const r = await fetchClsLimitPool({ date: DAY, signal: controller.signal }, { now: NOW, requestJson: async () => { calls++; return wrap(pool()); } });
  unavailable(r, 'request-aborted'); assert.equal(calls, 0);
  const times = [NOW, NOW - 1];
  const backwards = await fetchClsLimitPool({ date: DAY }, { now: () => times.shift(), requestJson: async () => wrap(pool()) });
  unavailable(backwards, 'cls-received-time-invalid');
});
