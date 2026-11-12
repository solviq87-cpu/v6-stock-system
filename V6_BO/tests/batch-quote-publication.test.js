'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
// The same cases can be run against an immutable baseline without replacing product files.
const source = process.env.V6_A2_BASELINE_REF
  ? execFileSync('git', ['show', process.env.V6_A2_BASELINE_REF + ':V6_BO/em.js'], {cwd: path.dirname(root), encoding: 'utf8'})
  : fs.readFileSync(path.join(root, 'em.js'), 'utf8');
const start = Date.parse('2026-11-13T10:00:00+08:00');
const codes = count => Array.from({length: count}, (_, i) => String(i + 1).padStart(6, '0'));
const plain = value => JSON.parse(JSON.stringify(value));
function quote(code, at = start, extra = {}) {
  return {code, price: 10, pct: 0, quoteSource: 'eastmoney', quoteAt: at,
    receivedAt: at, quoteFreshness: 'recent-unverified', canTrade: true, ...extra};
}
function timestamp(ms) {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
}
function wire(code, at, extra = {}) {
  const fields = Array(60).fill('0');
  Object.assign(fields, {1: 'fixture', 3: '10', 4: '9', 6: '100', 30: timestamp(at),
    32: '1', 33: '11', 34: '9', 37: '100', 38: '1', 44: '1', 45: '1'}, extra);
  return `v_sz${code}="${fields.join('~')}";`;
}
function harness({now = start, primary = async () => [], secondary, backup = () => [], rawTx} = {}) {
  let time = now;
  const primaryCalls = [], secondaryCalls = [], wireCalls = [], backupCalls = [], warnings = [];
  class Clock extends Date { static now() { return time; } }
  const denied = () => assert.fail('fixture must never use network, subprocesses or timers');
  const c = vm.createContext({Date: Clock, Buffer, TextDecoder, URL, __dirname: root,
    process: {env: {}}, module: {exports: {}}, console: {log() {}, error() {}, warn: (...args) => warnings.push(args)},
    setTimeout: denied,
    require: name => {
      if (name === 'https') return {Agent: class {}, get: denied};
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      if (name === 'child_process') return {execFile: denied};
      if (name === './src/core/public-market') return require('../src/core/public-market');
      if (name === './src/core/six-photo-backups') return {photoQuoteFallback: requested => {
        backupCalls.push(Array.from(requested)); return backup(requested, control);
      }};
      throw Error('unexpected fixture require: ' + name);
    }});
  const control = {now: () => time, set: value => { time = value; }, advance: value => { time += value; }};
  vm.runInContext(source, c);
  c.fixturePrimary = async requested => {
    primaryCalls.push(Array.from(requested)); return primary(requested, control);
  };
  c.fixtureSecondary = secondary && (async requested => {
    secondaryCalls.push(Array.from(requested)); return secondary(requested, control);
  });
  c.fixtureTx = async url => {
    const requested = new URL(url).pathname.slice('/q='.length).split(',').map(code => code.slice(2));
    wireCalls.push(requested);
    return rawTx ? rawTx(requested, control, wireCalls.length - 1) : Buffer.from(requested.map(code => wire(code, time)).join('\n'));
  };
  c.fixtureWarn = (...args) => warnings.push(args);
  vm.runInContext('fetchBatchSnapshotEM = fixturePrimary; txGet = fixtureTx; _srcWarn = fixtureWarn;' +
    (secondary ? 'fetchBatchSnapshotTx = fixtureSecondary;' : ''), c);
  return {api: c.module.exports, primaryCalls, secondaryCalls, wireCalls, backupCalls, warnings, ...control};
}

test('final batch publication uses original 15-second boundary rather than freshness labels', async () => {
  const input = [quote('000001', start - 15000), quote('000002', start - 15001),
    quote('000003', start + 1), quote('000004', null), quote('000005', NaN)];
  for (const row of input) row.receivedAt = start;
  const h = harness({primary: async () => input, secondary: async () => []});
  const rows = await h.api.fetchBatchSnapshot(input.map(row => row.code));
  assert.deepEqual(Array.from(rows, row => row.code), ['000001']);
  assert.equal(rows[0].quoteAt, start - 15000);
  assert.equal(rows[0].receivedAt, start);
});

test('a recent label cannot authorize missing source, invalid price or invalid reception evidence', async () => {
  for (const patch of [{quoteSource: ''}, {quoteSource: null}, {price: null}, {price: 0}, {price: Infinity},
    {receivedAt: null}, {receivedAt: start + 1}]) {
    const h = harness({primary: async () => [quote('000001', start, patch)], secondary: async () => []});
    assert.equal((await h.api.fetchBatchSnapshot(['000001'])).length, 0, JSON.stringify(patch));
  }
});

test('final publication preserves each source row and reception time without mutating its input', async () => {
  const row = Object.freeze(quote('000001', start - 1000, {receivedAt: start - 100, mainInflow: 0, mainPct: 0}));
  const before = plain(row);
  const h = harness({primary: async () => [row]});
  const result = await h.api.fetchBatchSnapshot(['000001']);
  assert.equal(result.length, 1);
  assert.deepEqual(plain(row), before);
  for (const field of ['quoteAt', 'receivedAt', 'quoteSource', 'price', 'mainInflow', 'mainPct']) assert.equal(result[0][field], before[field]);
  assert.ok(Array.isArray(result));
  assert.ok(Reflect.ownKeys(result).every(key => typeof key === 'string' && (key === 'length' || /^\d+$/.test(key))),
    'results remain ordinary arrays without hidden failure metadata');
});

test('a quote that was future at reception cannot become usable just because publication waited', async () => {
  const h = harness({primary: async () => [quote('000001', start - 100, {receivedAt: start - 1000})], secondary: async () => []});
  assert.equal((await h.api.fetchBatchSnapshot(['000001'])).length, 0);
});

test('live batch publication does not cross the Beijing trading date even inside 15 seconds', async () => {
  const now = Date.parse('2026-11-13T00:00:01+08:00');
  const h = harness({now, primary: async () => [quote('000001', now - 2000, {receivedAt: now})], secondary: async () => []});
  assert.equal((await h.api.fetchBatchSnapshot(['000001'])).length, 0);
});

test('duplicate and unexpected provider rows keep one latest complete row per requested stock', async () => {
  const h = harness({primary: async () => [quote('000001', start - 1000, {price: 11, receivedAt: start}),
    quote('999999'), quote('000001', start - 500, {price: 12, receivedAt: start})]});
  const rows = await h.api.fetchBatchSnapshot(['000001', '000001']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 12);
  assert.equal(rows[0].quoteAt, start - 500);
  assert.deepEqual(h.primaryCalls, [['000001']]);
});

test('a stale successful primary cannot occupy the symbol and block a fresh secondary', async () => {
  const h = harness({primary: async () => [quote('000001', start - 16000, {receivedAt: start}), quote('000002')],
    secondary: async requested => requested.map(code => quote(code, start, {quoteSource: 'tencent', price: 12}))});
  const rows = await h.api.fetchBatchSnapshot(['000001', '000002']);
  assert.deepEqual(h.secondaryCalls, [['000001']]);
  assert.deepEqual(Array.from(rows, row => [row.code, row.price]), [['000001', 12], ['000002', 10]]);
});

test('an EM quote expiring while Tencent serves other stocks gets one bounded recovery attempt', async () => {
  const h = harness({primary: async () => [quote('000001')], secondary: async (requested, clock) => {
    if (requested.includes('000002')) clock.advance(16000);
    return requested.map(code => quote(code, clock.now(), {quoteSource: 'tencent', price: 12}));
  }});
  const rows = await h.api.fetchBatchSnapshot(['000001', '000002']);
  assert.deepEqual(h.secondaryCalls, [['000002'], ['000001']]);
  assert.deepEqual(Array.from(rows, row => row.code), ['000001', '000002']);
  assert.ok(rows.every(row => h.now() - row.quoteAt <= 15000));
});

test('recovery cannot loop or request a Tencent stock twice when waiting expires another result', async () => {
  const h = harness({primary: async () => [quote('000001')], secondary: async (requested, clock) => {
    clock.advance(16000);
    return requested.map(code => quote(code, clock.now(), {quoteSource: 'tencent'}));
  }});
  const rows = await h.api.fetchBatchSnapshot(['000001', '000002']);
  assert.deepEqual(h.secondaryCalls, [['000002'], ['000001']]);
  assert.deepEqual(Array.from(rows, row => row.code), ['000001']);
  const called = h.secondaryCalls.flat();
  assert.equal(new Set(called).size, called.length);
});

for (const size of [61, 121, 220]) {
  test(`Tencent ${size}-stock serial batches reclassify early rows at the final clock`, async () => {
    const h = harness({rawTx: async (requested, clock, index) => {
      if (index > 0) clock.advance(16000);
      return Buffer.from(requested.map(code => wire(code, clock.now())).join('\n'));
    }});
    const rows = await h.api.fetchBatchSnapshotTx(codes(size));
    assert.equal(rows.length, size, 'direct Tencent history/display callers retain old rows');
    assert.equal(h.wireCalls.length, Math.ceil(size / 60));
    assert.equal(rows[0].quoteAt, start);
    assert.equal(rows[0].receivedAt, start);
    assert.equal(rows[0].quoteFreshness, 'stale');
    assert.equal(rows[0].canTrade, false);
    assert.equal(rows.at(-1).quoteFreshness, 'recent-unverified');
  });
}

test('a later Tencent batch failure preserves previous valid rows and continues after the failed batch', async () => {
  const h = harness({rawTx: async (requested, clock, index) => {
    if (index === 1) throw Error('fixture timeout');
    return Buffer.from(requested.map(code => wire(code, clock.now())).join('\n'));
  }});
  const rows = await h.api.fetchBatchSnapshotTx(codes(121));
  assert.equal(h.wireCalls.length, 3);
  assert.equal(rows.length, 61);
  assert.equal(rows[0].code, '000001');
  assert.equal(rows.at(-1).code, '000121');
  assert.ok(rows.every(row => row.quoteFreshness === 'recent-unverified'));
  assert.ok(h.warnings.length > 0, 'partial failures remain diagnosable');
});

test('a first Tencent batch failure does not prevent later stocks from succeeding', async () => {
  const h = harness({rawTx: async (requested, clock, index) => {
    if (index === 0) throw Error('fixture first failure');
    return Buffer.from(requested.map(code => wire(code, clock.now())).join('\n'));
  }});
  const rows = await h.api.fetchBatchSnapshotTx(codes(61));
  assert.equal(h.wireCalls.length, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '000061');
});

test('Tencent all-batch failure remains an error after all bounded batches have been attempted', async () => {
  const h = harness({rawTx: async () => { throw Error('fixture outage'); }});
  await assert.rejects(h.api.fetchBatchSnapshotTx(codes(220)), /fixture outage/);
  assert.equal(h.wireCalls.length, 4);
});

test('Tencent direct history rows preserve unknown and original future times without execution permission', async () => {
  const h = harness({rawTx: async requested => Buffer.from(requested.map((code, index) =>
    wire(code, start, {30: index === 0 ? 'invalid' : timestamp(start + 1000)})).join('\n'))});
  const rows = await h.api.fetchBatchSnapshotTx(['000001', '000002']);
  assert.equal(rows[0].quoteAt, null);
  assert.equal(rows[0].quoteFreshness, 'unknown');
  assert.equal(rows[0].receivedAt, start);
  assert.equal(rows[1].quoteAt, start + 1000);
  assert.equal(rows[1].quoteFreshness, 'future');
  assert.ok(rows.every(row => row.canTrade === false));
});

test('Tencent direct input duplicates do not consume another batch or repeat an already requested stock', async () => {
  const h = harness();
  const requested = [...codes(60), '000001', '000061', '000061'];
  const rows = await h.api.fetchBatchSnapshotTx(requested);
  assert.equal(h.wireCalls.length, 2);
  assert.deepEqual(h.wireCalls[1], ['000061']);
  const all = h.wireCalls.flat();
  assert.equal(all.length, 61);
  assert.equal(new Set(all).size, all.length);
  assert.equal(rows.length, 61);
  assert.deepEqual(Array.from(rows, row => row.code), codes(61));
});

test('Tencent direct duplicate responses choose the latest valid complete row without mixing fields', async () => {
  const h = harness({rawTx: async () => Buffer.from([
    wire('000001', start - 2000, {3: '11', 4: '10'}),
    wire('000001', start - 1000, {3: '12', 4: '11'}),
    wire('999999', start, {3: '99'}),
    wire('000001', start + 1000, {3: '30', 4: '29'}),
    wire('000001', start, {3: '40', 4: '39', 30: 'invalid'})
  ].join('\n'))});
  const rows = await h.api.fetchBatchSnapshotTx(['000001']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '000001');
  assert.equal(rows[0].price, 12);
  assert.equal(rows[0].preClose, 11);
  assert.equal(rows[0].quoteAt, start - 1000);
  assert.equal(rows[0].quoteFreshness, 'recent-unverified');
  assert.equal(rows[0].canTrade, true);
});

test('Tencent dated history beats unknown or future duplicates and preserves requested output order', async () => {
  const h = harness({rawTx: async () => Buffer.from([
    wire('000001', start, {3: '40', 30: 'invalid'}),
    wire('000001', start + 1000, {3: '30'}),
    wire('000001', start - 60000, {3: '15', 4: '14'}),
    wire('000002', start, {3: '20', 4: '19'}),
    wire('000001', start - 61000, {3: '10', 4: '9'})
  ].join('\n'))});
  const rows = await h.api.fetchBatchSnapshotTx(['000002', '000001']);
  assert.deepEqual(Array.from(rows, row => row.code), ['000002', '000001']);
  assert.equal(rows[0].price, 20);
  assert.equal(rows[1].price, 15);
  assert.equal(rows[1].preClose, 14);
  assert.equal(rows[1].quoteAt, start - 60000);
  assert.equal(rows[1].quoteFreshness, 'stale');
  assert.equal(rows[1].canTrade, false);
});

test('the real Tencent-to-primary wrapper filters serially expired rows instead of publishing stale labels', async () => {
  const h = harness({rawTx: async (requested, clock, index) => {
    if (index > 0) clock.advance(16000);
    return Buffer.from(requested.map(code => wire(code, clock.now())).join('\n'));
  }});
  const rows = await h.api.fetchBatchSnapshot(codes(121));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '000121');
  assert.equal(rows[0].receivedAt, start + 32000);
  assert.ok(rows.every(row => h.now() - row.quoteAt <= 15000));
});

test('fresh research fallback keeps canTrade false and is rechecked after preceding sources fail', async () => {
  const row = Object.freeze(quote('000001', start - 1000, {quoteSource: 'photo-fixture', receivedAt: start - 500, canTrade: false}));
  const h = harness({primary: async () => { throw Error('fixture primary'); },
    secondary: async () => { throw Error('fixture secondary'); }, backup: () => [row]});
  const rows = await h.api.fetchBatchSnapshot(['000001']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].canTrade, false);
  assert.equal(rows[0].quoteAt, start - 1000);
  assert.equal(rows[0].receivedAt, start - 500);
  assert.equal(row.canTrade, false);
});

test('stale research fallback cannot bypass the final publication gate', async () => {
  const h = harness({secondary: async () => [], backup: () => [quote('000001', start - 15001,
    {quoteSource: 'photo-fixture', receivedAt: start, canTrade: false})]});
  assert.equal((await h.api.fetchBatchSnapshot(['000001'])).length, 0);
});
