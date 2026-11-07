'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { probePublicQuotes: probe, projectProbe: project, readPublicQuoteProbe: read } = require('../src/core/public-quote-probe');
const { address, parse, createPublicMarket } = require('../src/core/public-market');
const now = Date.parse('2026-11-06T02:00:00Z');
function raw(id, at = now) {
  if (id === 'eastmoney') return JSON.stringify({ rc: 0, data: { f57: '600519', f43: 10, f60: 9, f47: 123, f86: at / 1000 } });
  const a = Array(33).fill('0'); a[2] = '600519'; a[3] = '10'; a[4] = '9'; a[6] = '123';
  a[30] = new Date(at + 8 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return 'v_sh600519="' + a.join('~') + '";';
}
const fetchGood = at => async url => new Response(raw(url.includes('gtimg') ? 'tencent' : 'eastmoney', at));
const base = { code: '600519', clock: () => now };
test('one or two selected public sources run without constructing any paid API or requiring a third peer', async () => {
  const calls = []; const r = await probe({ ...base, fetchImpl: async (url, opts) => { calls.push(url); assert.equal(opts.headers?.Authorization, undefined); return fetchGood(now)(url); } });
  assert.equal(calls.length, 2); assert.ok(calls.every(x => /gtimg|eastmoney/.test(x)));
  assert.equal(r.paidServicesUsed, false); assert.equal(r.probeOnly, true); assert.equal(r.canTrade, false);
  assert.equal(project(r, now).sources[0].status, 'fresh-unverified');
  assert.equal((await probe({ ...base, providers: ['tencent'], fetchImpl: fetchGood(now) })).sources.length, 1);
});
test('stale close data retains its original date and is never promoted by recent reception or persisted status', async () => {
  const old = now - 86400000, r = await probe({ ...base, fetchImpl: fetchGood(old) });
  const view = project(r, now); assert.equal(view.status, 'snapshot-only');
  assert.ok(view.sources.every(s => s.status === 'dated-snapshot' && s.quote.quoteAt === old));
  assert.ok(view.sources.every(s => s.quote.freshness === 'not-realtime' && s.quote.status === 'market-state-unverified'));
  r.verifiedLive = true; assert.throws(() => project(r, now));
});
test('one transport retry is bounded and an unavailable peer never replaces the healthy source', async () => {
  let calls = 0;
  const r = await probe({ ...base, fetchImpl: async url => {
    if (url.includes('gtimg')) return fetchGood(now)(url);
    calls++; if (calls === 1) throw Error('SECRET_SENTINEL'); return fetchGood(now)(url);
  } });
  assert.equal(calls, 2); assert.equal(r.sources[0].status, 'ok'); assert.equal(r.sources[1].status, 'ok');
  assert.equal(r.attempts[1].retried, true); assert.ok(!JSON.stringify(r).includes('SECRET_SENTINEL'));
});
test('HTTP403 and rate limits never trigger retries or fallback to paid/login endpoints', async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const r = await probe({ ...base, providers: ['tencent'], fetchImpl: async () => { calls++; return new Response('', { status }); } });
    assert.equal(calls, 1); assert.equal(r.sources[0].error, 'HTTP ' + status); assert.equal(project(r, now).sources[0].quote, null);
  }
});
test('unknown, duplicate, injection and paid sources reject before the first request', async () => {
  let calls = 0;
  for (const providers of [['ifind'], ['choice'], ['tencent', 'tencent'], [], ['tencent;evil']]) {
    await assert.rejects(() => probe({ ...base, providers, fetchImpl: async () => { calls++; } }));
  }
  assert.equal(calls, 0); assert.throws(() => address('ifind', '600519')); assert.throws(() => parse('other', '', '600519'));
  assert.throws(() => createPublicMarket({ code: '600519', providers: ['bad'] }));
});
test('quote freshness is recomputed at read time and a failed new check does not show a cached successful price', async () => {
  const r = await probe({ ...base, fetchImpl: fetchGood(now) });
  const old = project(r, now + 16000); assert.equal(old.status, 'check-expired'); assert.equal(old.sources[0].status, 'dated-snapshot');
  const failed = await probe({ ...base, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(project(failed, now).status, 'unavailable'); assert.ok(project(failed, now).sources.every(s => s.quote === null));
});
test('corrupt provider identity, quote dates, duplicated symbols and future clocks fail closed', async () => {
  const r = await probe({ ...base, fetchImpl: fetchGood(now) });
  for (const mutate of [
    x => x.generatedAt = now + 1,
    x => x.sources[0].snapshot.provider = 'other',
    x => x.sources[0].snapshot.quotes[0].timestamp = now + 1,
    x => x.sources[0].snapshot.quotes[0].timestamp = -1,
    x => x.sources[0].snapshot.quotes[0].code = '000001',
    x => x.sources[0].snapshot.quotes.push(x.sources[0].snapshot.quotes[0]),
    x => x.sources[0].snapshot.quotes[0].volumeUnit = 'lot'
  ]) { const copy = structuredClone(r); mutate(copy); assert.throws(() => project(copy, now)); }
  assert.throws(() => project(r, NaN));
});
test('fixed-file dashboard reader projects only display fields and rejects links, corruption and oversized files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-quote-view-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'probe.json'), r = await probe({ ...base, fetchImpl: fetchGood(now) });
  r.secrets = 'DO_NOT_EXPORT_SENTINEL'; r.pageLinks = [{ url: 'javascript:evil' }]; r.sources[0].snapshot.quotes[0].account = 77777;
  fs.writeFileSync(file, JSON.stringify(r));
  const view = read(file, now); assert.equal(view.sources.length, 2); assert.ok(!JSON.stringify(view).includes('DO_NOT_EXPORT_SENTINEL'));
  assert.ok(!JSON.stringify(view).includes('javascript')); assert.ok(!JSON.stringify(view).includes('77777'));
  const link = path.join(dir, 'linked.json'); fs.symlinkSync(file, link); assert.equal(read(link, now).status, 'invalid');
  fs.writeFileSync(file, '{}'); assert.equal(read(file, now).status, 'invalid');
  fs.writeFileSync(file, ' '.repeat(1024 * 1024 + 1)); assert.equal(read(file, now).status, 'invalid');
});
test('actual CLI publishes a complete new file and refuses overwrite before making further requests', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-quote-cli-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mock = path.join(dir, 'fetch.cjs'), out = path.join(dir, 'probe.json');
  fs.writeFileSync(mock, `global.fetch=async()=>{throw Error('explicit fixture offline')};`);
  const cli = path.resolve(__dirname, '../scripts/public-quote-probe.js');
  const run = args => spawnSync(process.execPath, ['--require', mock, cli, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run(['600519', out, 'tencent']).status, 0);
  const saved = fs.readFileSync(out); assert.equal(JSON.parse(saved).sources[0].status, 'unavailable');
  assert.equal(run(['600519', out, 'tencent']).status, 1); assert.deepEqual(fs.readFileSync(out), saved);
  const no = path.join(dir, 'no.json'); assert.equal(run(['600519', no, 'ifind']).status, 1); assert.equal(fs.existsSync(no), false);
  const link = path.join(dir, 'linked.json'); fs.symlinkSync(out, link); assert.equal(run(['600519', link]).status, 1);
});
test('a future or malformed quote fails only that peer while another source remains observable', async () => {
  const r = await probe({ ...base, fetchImpl: async url => new Response(raw(url.includes('gtimg') ? 'tencent' : 'eastmoney', url.includes('gtimg') ? now + 1000 : now)) });
  const view = project(r, now); assert.equal(view.sources[0].status, 'unavailable'); assert.equal(view.sources[0].quote, null);
  assert.equal(view.sources[1].status, 'fresh-unverified');
});
