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
  const newer = fixture(); newer.result.stock.symbol = '600001';
  const { get, calls } = setup(() => ++count === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : newer);
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

test('frozen raw candle event, strict forecasts and immutable evidence are labeled independently', async () => {
  const f = fixture(); f.result.priceEventResearch = { objective: 'next-session-reported-candle-direction-v1', status: 'research-observation-recorded', currentHypothesis: { prediction: 'up', state: 'bullish', targetDate: '2026-11-13', decisionAt: 1794480000000, recordedAt: 1794480001000, probabilities: null, evidenceBundleHash: 'hash-fixture' }, pendingTargets: [{ targetDate: '2026-11-13' }], forwardValidation: { evaluated: 1, independentTargetDays: 1, rawCandleMatchFrequency: null, brier: null, brierEvaluated: 0 } };
  f.result.evidenceBundle = { hash: 'hash-fixture', recordedAt: 1794480001000, decisionAt: 1794480000000, stockStatus: { dividendEvents: { records: [], status: 'unknown' }, suspensionEvents: { records: [], status: 'unknown' } }, marketContext: { indices: { source: 'fixture', tradeDate: '2026-11-12', sourceTimestamp: null, retrievedAt: '2026-11-13T01:00:00Z', records: [{ tradeDate: '2026-11-12', shanghaiClose: 3000, shenzhenClose: null }] } } };
  const { get } = setup(f); get('captureSymbol').value = '600000'; await get('captureRun').click();
  const text = get('captureEvidence').textContent;
  for (const term of ['原始日K研究状态 / 目标日', '2026-11-13', 'C>O', '等待冻结后独立目标日证据', 'hash-fixture', '无记录不表示正常交易', '3000 / 未知', '指数原始时间：未知']) assert.ok(text.includes(term), term);
  assert.match(get('captureAnalysis').textContent, /下一交易日上涨概率：等待状态 \/ 行动证据/);
  assert.doesNotMatch(text, /预测胜率|收益保证|100.0%/);
});

test('latest observation and hypothesis-sealed evidence never substitute for one another', async () => {
  const f = fixture(); f.result.priceEventResearch = { currentHypothesis: { evidenceBundleHash: 'old-hash', targetDate: '2026-11-13' } };
  f.result.evidenceBundle = { hash: 'new-hash', marketContext: { status: 'NEW-CONTEXT' }, sourceRefs: ['new-source'] };
  f.result.hypothesisEvidence = { hash: 'old-hash', marketContext: { status: 'FROZEN-CONTEXT' }, sourceRefs: ['old-source'] };
  f.result.linkage = { tradeDate: '2026-11-12', marketTradeDate: '2026-11-12', sameMarketTradeDate: true, indices: { shanghaiClose: 3000, shanghaiChangePct: 0, shenzhenClose: null }, stockMainNetInflow: 0, sentiment: { status: 'observed-unverified' }, memberBoards: [{ category: 'industry', code: 'BK1000', name: '<b>板块</b>', quoteDate: '2026-11-11', sameQuoteDate: false, changePct: 999, mainNetInflow: 999, membershipScope: 'current-observation-only' }] };
  const { get } = setup(f); get('captureSymbol').value = '600000'; await get('captureRun').click(); const text = get('captureEvidence').textContent;
  for (const term of ['本次观察与预测封存证据不同', '本次观察哈希：new-hash', '预测引用哈希：old-hash', '封存市场 / 板块状态：FROZEN-CONTEXT / 未知', '同日上证 / 深证：3000 / 未知', '个股同日主力净流入（元）：0', '<b>板块</b>', '日期不同或缺失，数值未知']) assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /999/);
});

test('missing sealed evidence stays unknown and mismatched market date hides same-day index and sentiment', async () => {
  const f = fixture(); f.result.priceEventResearch = { currentHypothesis: { evidenceBundleHash: 'missing-hash' } }; f.result.evidenceBundle = { hash: 'latest-hash', marketContext: { status: 'NEW' } };
  f.result.linkage = { sameMarketTradeDate: false, indices: { shanghaiClose: 999 }, sentiment: { status: 'SHOULD-NOT-SHOW' } };
  const { get } = setup(f); get('captureSymbol').value = '600000'; await get('captureRun').click(); const text = get('captureEvidence').textContent;
  assert.match(text, /预测封存原文哈希：未知/); assert.match(text, /封存原文缺失或引用不匹配；保持未知/); assert.match(text, /日期不同或缺失，禁止混作同日证据/);
  assert.doesNotMatch(text, /SHOULD-NOT-SHOW|999|封存市场 \/ 板块状态：NEW/);
});
