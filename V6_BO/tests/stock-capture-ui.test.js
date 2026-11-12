'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../public/assets/stock-capture-workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/research.html'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.value = ''; this.handlers = {}; this.attrs = {}; this.content = ''; }
  set textContent(v) { this.content = String(v); this.children = []; }
  get textContent() { return this.content + this.children.map(x => x.textContent).join(' '); }
  set innerHTML(_) { throw Error('unsafe HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.content = ''; this.children = nodes; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  click() { return this.handlers.click?.(); }
}
function setup(reply) {
  const elements = new Map(), calls = [], get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('captureProvider').value = 'auto';
  vm.runInNewContext(script, { document: { getElementById: get, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    AbortController, setTimeout, clearTimeout, fetch: async (url, options) => { calls.push({ url, options }); const body = await (typeof reply === 'function' ? reply(url, options) : reply); return { ok: body?.ok !== false, json: async () => body }; } });
  return { get, calls };
}
function fixture() { return { ok: true, result: { status: 'partial', history: { source: 'fixture', provider: 'tencent', priceBasis: 'unadjusted', tradeDate: '2026-11-12', retrievedAt: '2026-11-13T01:00:00Z', sourceTimestamp: null, units: { volume: 'share' } },
  stock: { name: '<img onerror=bad>', symbol: '600000', observedAt: '2026-11-13T00:00:00Z', bars: [{ date: '2026-11-12', open: 10, high: 12, low: 9, close: 11, volume: 100 }] },
  observation: { changed: true, revision: 1 }, currentFormation: { status: 'price-only-unverified', date: '2026-11-12', patterns: { matched: [{ label: '当前形态' }], checks: [] } },
  analysis: { direction: { probability: null }, limitUp: { probability: null } }, readiness: { blockers: ['等待未来收盘'] }, canTrade: false } }; }
test('compact capture section precedes linked research and retains all existing entry points', () => {
  assert.ok(html.indexOf('id="stockCapture"') < html.indexOf('id="linkedIntelligence"'));
  for (const id of ['captureSymbol', 'captureProvider', 'captureRun', 'captureRead', 'captureChart', 'linkedIntelligenceFile']) assert.ok(html.includes('id="' + id + '"'));
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
test('capture is click-only, authenticated, needs no JSON and shows separate date/time and real OHLC', async () => {
  const { get, calls } = setup(fixture()); assert.equal(calls.length, 0);
  get('captureSymbol').value = '600000'; get('token').value = 'fixture-token';
  await get('captureRun').click();
  assert.equal(calls[0].url, '/api/research/observe-stock');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { symbol: '600000', provider: 'auto', historyDays: 120, includeContext: true });
  const summary = get('captureSummary').textContent;
  for (const term of ['<img onerror=bad>', '数据截止交易日：2026-11-12', '本轮获取时间：2026-11-13T01:00:00Z', '该内容版本观测时间：2026-11-13T00:00:00Z', '来源原始时间：未知', '新增或变化']) assert.ok(summary.includes(term), term);
  assert.match(get('captureChart').textContent, /开 10.*高 12.*低 9.*收 11/);
  assert.match(get('captureAnalysis').textContent, /当前形态/); assert.match(get('captureAnalysis').textContent, /等待状态 \/ 行动证据/);
  assert.doesNotMatch(get('captureAnalysis').textContent, /0\.0%|100\.0%/);
  await get('captureRead').click(); assert.equal(calls[1].url, '/api/research/stock-observations?symbol=600000&provider=tencent');
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined);
});
test('read requires explicit provider until successful auto capture; invalid codes never fetch', async () => {
  const { get, calls } = setup(fixture());
  for (const symbol of ['', '1', '60000x', '<script>']) { get('captureSymbol').value = symbol; await get('captureRun').click(); }
  get('captureSymbol').value = '600000'; await get('captureRead').click(); assert.equal(calls.length, 0); assert.match(get('captureStatus').textContent, /明确选择来源/);
  get('captureProvider').value = 'eastmoney'; await get('captureRead').click(); assert.match(calls[0].url, /provider=eastmoney/);
});
test('changed token or selection cannot render old response even without dispatched events', async () => {
  for (const field of ['token', 'captureSymbol', 'captureProvider']) {
    let release; const pending = new Promise(resolve => { release = resolve; });
    const { get } = setup(() => pending); get('captureSymbol').value = '600000';
    const run = get('captureRun').click(); get(field).value = 'changed'; release(fixture()); await run;
    assert.equal(get('captureSummary').textContent, ''); assert.equal(get('captureOutput').textContent, ''); assert.equal(get('captureRun').disabled, false);
  }
});
test('selection event aborts request and late errors cannot clear newer evidence', async () => {
  let rejectFirst; let count = 0;
  const { get, calls } = setup(() => ++count === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : fixture());
  get('captureSymbol').value = '600000'; const old = get('captureRun').click();
  get('captureSymbol').value = '600001'; get('captureSymbol').handlers.input();
  assert.equal(calls[0].options.signal.aborted, true);
  await get('captureRun').click(); rejectFirst(Error('stale error')); await old;
  assert.match(get('captureSummary').textContent, /fixture|600000/); assert.doesNotMatch(get('captureStatus').textContent, /stale/);
});
test('empty or invalid bars produce no invented candles; errors clear prior output', async () => {
  let bad = false; const f = fixture(); f.result.stock.bars = [{ date: '2026-11-12', open: null, high: 12, low: 9, close: 11, volume: 0 }];
  const { get } = setup(() => bad ? { ok: false, error: '<b>来源失败</b>' } : f); get('captureSymbol').value = '600000';
  await get('captureRun').click(); assert.match(get('captureChart').textContent, /暂无有效日K/);
  bad = true; await get('captureRun').click(); assert.equal(get('captureChart').textContent, ''); assert.equal(get('captureStatus').textContent, '<b>来源失败</b>');
});
test('chart caps actual supplied candles at 120 and date selector exposes individual observations', async () => {
  const f = fixture(); f.result.stock.bars = Array.from({ length: 125 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: i + 10, high: i + 12, low: i + 9, close: i + 11, volume: i }));
  const { get } = setup(f); get('captureSymbol').value = '600000'; await get('captureRun').click();
  const p = get('captureChart'), svg = p.children.find(n => n.tagName === 'svg'); assert.equal(svg.children.filter(n => n.tagName === 'rect').length, 120);
  const control = p.children.find(n => n.tagName === 'input'); control.value = '0'; control.handlers.input(); assert.match(p.textContent, /2026-01-06 · 开 15/);
});
