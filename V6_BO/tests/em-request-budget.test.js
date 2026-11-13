'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {createMarketRequestGovernor, isMarketRestrictionError} = require('../src/core/market-request-governor');
const source = fs.readFileSync(require.resolve('../em'), 'utf8');
const epoch = Date.parse('2026-11-13T10:00:00+08:00');
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function clock() {
  let at = epoch, id = 0;
  const timers = new Map();
  return {
    now: () => at,
    stall(ms) { at += ms; },
    setTimeout(fn, ms) { const key = ++id; timers.set(key, {fn, at: at + ms}); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(ms) {
      const end = at + ms;
      for (;;) {
        await flush();
        const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        at = Math.max(at, next[1].at); timers.delete(next[0]); next[1].fn();
      }
      at = end; await flush();
    }
  };
}
function fixture({respond = () => ({body: '{}'}), curlResponse, cleanupFails = false, prepDelayMs = 0} = {}) {
  const time = clock(), starts = [], temporary = [];
  let prepared = 0;
  const governor = createMarketRequestGovernor({now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout});
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time.now()])); } static now() { return time.now(); } }
  const https = {Agent: class {}, get(url, options, callback) {
    starts.push({transport: 'node', url, at: time.now() - epoch});
    const req = new EventEmitter(); req.destroy = error => { if (error) queueMicrotask(() => req.emit('error', error)); };
    queueMicrotask(() => {
      const input = respond(url, starts.length);
      if (input.error) { req.emit('error', input.error); return; }
      const response = new EventEmitter(); response.statusCode = input.status || 200; response.headers = input.headers || {}; response.resume = () => {};
      callback(response); response.emit('data', Buffer.from(input.body || '{}')); response.emit('end');
    });
    return req;
  }};
  const context = vm.createContext({module: {exports: {}}, Buffer, TextDecoder, URL, Date: Clock,
    Math: Object.assign(Object.create(Math), {random: () => 0}),
    __dirname: '/nonexistent/v6-offline-fixture', console: {log() {}, warn() {}, error() {}},
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    require(name) {
      if (name === 'https') return https;
      if (name === './src/core/market-request-governor') return {marketRequests: governor, isMarketRestrictionError};
      if (name === 'child_process') return {execFile(command, args, options, callback) {
        assert.equal(command, 'curl'); assert.ok(curlResponse, 'unexpected subprocess in offline fixture');
        const url = args.at(-1), headers = args[args.indexOf('--dump-header') + 1], body = args[args.indexOf('--output') + 1];
        temporary.push(path.dirname(headers)); starts.push({transport: 'curl', url, at: time.now() - epoch});
        const response = curlResponse(url);
        fs.writeFileSync(headers, response.rawHeaders || `HTTP/1.1 ${response.status}\r\nRetry-After: ${response.retryAfter || '0'}\r\n\r\n`);
        fs.writeFileSync(body, response.body || '{}');
        queueMicrotask(() => callback(response.error || null, String(response.status), 'private upstream detail'));
      }};
      if (name === 'fs' && (cleanupFails || prepDelayMs)) return {...fs,
        mkdtempSync(...args) { if (!prepared++) time.stall(prepDelayMs); return fs.mkdtempSync(...args); },
        rmSync(...args) { fs.rmSync(...args); if (cleanupFails) throw Error('mock cleanup failed'); }};
      if (['fs', 'path', 'os'].includes(name)) return require(name);
      if (name === './src/core/public-market') return require('../src/core/public-market');
      throw Error('unexpected fixture require: ' + name);
    }});
  vm.runInContext(source + '\nmodule.exports.fixture = {getPaged, curlGet, txGet, thsGet};', context);
  return {api: context.module.exports, governor, starts, temporary, ...time};
}
const rejected = promise => promise.then(() => assert.fail('expected request failure'), error => error);

test('real EM transport reserves concurrent starts atomically across history and numbered aliases', async () => {
  const h = fixture();
  const tasks = Array.from({length: 6}, (_, n) => h.api.get(`https://${n % 2 ? '72.push2' : 'push2his'}.eastmoney.com/fixture/${n}`));
  await h.advance(6000); await Promise.all(tasks);
  assert.deepEqual(h.starts.map(row => row.at), [0, 1000, 2000, 3000, 4000, 5000]);
});

for (const status of [429, 403]) test(`HTTP ${status} stops retries, aliases, curl and later source fallback`, async () => {
  const h = fixture({respond: () => ({status, headers: {'retry-after': '120'}, body: '{}'})});
  const result = rejected(h.api.fetchBatchSnapshot(['000001']));
  await h.advance(10000); const error = await result;
  assert.equal(error.code, 'MARKET_RESTRICTED'); assert.equal(error.status, status);
  assert.equal(error.resumeAt, epoch + (status === 429 ? 120000 : 900000));
  assert.equal(h.starts.length, 1);
  const queued = await rejected(h.api.get('https://82.push2.eastmoney.com/fixture'));
  assert.equal(queued.code, 'MARKET_RESTRICTED'); assert.equal(h.starts.length, 1);
});

test('ordinary network retries each consume the same provider budget and stop after three attempts', async () => {
  const h = fixture({respond: () => ({error: Object.assign(Error('socket hang up'), {code: 'ECONNRESET'})})});
  const result = rejected(h.api.get('https://push2.eastmoney.com/fixture'));
  await h.advance(10000); await result;
  assert.deepEqual(h.starts.map(row => row.at), [0, 1000, 2000]);
  assert.ok(h.starts.every(row => new URL(row.url).hostname === 'push2.eastmoney.com'));
});

test('paged requests and Tencent/THS transports also use provider start budgets', async () => {
  const h = fixture();
  const tasks = [h.api.fixture.getPaged('https://push2.eastmoney.com/page'), h.api.get('https://push2his.eastmoney.com/history'),
    h.api.fixture.txGet('https://qt.gtimg.cn/q=sh600000'), h.api.fixture.txGet('https://web.ifzq.gtimg.cn/history'),
    h.api.fixture.thsGet('https://d.10jqka.com.cn/a'), h.api.fixture.thsGet('https://data.10jqka.com.cn/b')];
  await h.advance(2000); await Promise.all(tasks);
  for (const domain of ['eastmoney.com', 'gtimg.cn', '10jqka.com.cn']) {
    assert.deepEqual(h.starts.filter(row => new URL(row.url).hostname.endsWith(domain)).map(row => row.at), [0, 1000]);
  }
});

test('curl observes a restriction even when the transfer fails and always removes private temporary files', async () => {
  const h = fixture({curlResponse: () => ({status: 429, retryAfter: '180', error: Error('transfer failed')})});
  const result = rejected(h.api.fetchBatchSnapshot(['000001']));
  await h.advance(2000); const error = await result;
  assert.equal(error.code, 'MARKET_RESTRICTED'); assert.equal(error.resumeAt, epoch + 181000);
  assert.deepEqual(h.starts.map(row => row.transport), ['node', 'curl']);
  assert.ok(h.temporary.every(dir => !fs.existsSync(dir)));
});

test('curl rejects an incomplete HTTP 200 transfer even when a partial body happens to be valid JSON', async () => {
  const h = fixture({curlResponse: () => ({status: 200, body: '{}', error: Error('timeout')})});
  const result = rejected(h.api.fixture.curlGet('https://push2.eastmoney.com/fixture'));
  await h.advance(1); assert.match((await result).message, /transport failed/);
  assert.ok(h.temporary.every(dir => !fs.existsSync(dir)));
});

test('slow local curl preparation does not consume the interval between actual wire starts', async () => {
  const h = fixture({prepDelayMs: 2000, curlResponse: () => ({status: 200})});
  const first = h.api.fixture.curlGet('https://push2.eastmoney.com/first');
  const second = h.api.fixture.curlGet('https://push2his.eastmoney.com/second');
  await h.advance(2000); await Promise.all([first, second]);
  assert.deepEqual(h.starts.map(row => row.at), [2000, 3000]);
  assert.ok(h.temporary.every(dir => !fs.existsSync(dir)));
});

test('curl header and cleanup errors cannot hide a restriction or activate another transport', async () => {
  const h = fixture({cleanupFails: true, curlResponse: () => ({status: 403,
    rawHeaders: 'HTTP/1.1 403 Forbidden\r\nX-Large: ' + 'x'.repeat(65536) + '\r\n\r\n'})});
  const result = rejected(h.api.fetchBatchSnapshot(['000001']));
  await h.advance(2000); const error = await result;
  assert.equal(error.code, 'MARKET_RESTRICTED'); assert.equal(error.status, 403);
  assert.deepEqual(h.starts.map(row => row.transport), ['node', 'curl']);
  assert.ok(h.temporary.every(dir => !fs.existsSync(dir)));
});

test('healthy 60-page full-market retrieval remains possible under the shared one-second budget', async () => {
  const h = fixture({respond: url => {
    const page = Number(new URL(url).searchParams.get('pn'));
    return {body: JSON.stringify({data: {total: 6000, diff: Array.from({length: 100}, (_, i) => ({
      f12: String((page - 1) * 100 + i + 1).padStart(6, '0'), f14: 'fixture', f2: 10, f124: epoch / 1000
    }))}})};
  }});
  const result = h.api.fetchAllStocksEM();
  await h.advance(65000); const rows = await result;
  assert.equal(rows.length, 6000); assert.equal(h.starts.length, 60);
  assert.deepEqual(h.starts.map(row => row.at), Array.from({length: 60}, (_, i) => i * 1000));
});

test('bulk and individual Kline requests share the canonical in-flight entry', async () => {
  const rows = Array.from({length: 7}, (_, n) => `2026-11-${String(n + 1).padStart(2, '0')},10,10,11,9,100,100000,2,0,0,1`);
  const h = fixture({respond: () => ({body: JSON.stringify({data: {name: 'fixture', klines: rows}})})});
  const bulk = h.api.fetchKlineBulk(['000001'], 7), single = h.api.fetchKline('000001', 7);
  await h.advance(1); const [batch, item] = await Promise.all([bulk, single]);
  assert.equal(h.starts.length, 1); assert.equal(batch.map.get('000001'), item);
  assert.equal(item.src, 'em'); assert.equal(item.rows[0].close, 10);
});

test('waiting for the budget preserves source quote time and records the actual later reception', async () => {
  const h = fixture({respond: () => ({body: JSON.stringify({data: {diff: [{f12: '000001', f2: 10, f124: epoch / 1000}]}})})});
  await h.api.get('https://push2.eastmoney.com/first');
  const pending = h.api.fetchBatchSnapshot(['000001']);
  await h.advance(1000); const [row] = await pending;
  assert.equal(row.quoteAt, epoch); assert.equal(row.receivedAt, epoch + 1000);
  assert.equal(row.price, 10); assert.equal(row.quoteSource, 'eastmoney');
});
