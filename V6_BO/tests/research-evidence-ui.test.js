'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../public/assets/research-evidence-workbench.js'), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.value = ''; this.content = ''; this.handlers = {}; }
  set textContent(v) { this.content = String(v); this.children = []; }
  get textContent() { return this.content + this.children.map(n => n.textContent).join(' '); }
  set innerHTML(_) { throw Error('unsafe HTML'); }
  append(...n) { this.children.push(...n); } replaceChildren(...n) { this.content = ''; this.children = n; }
  addEventListener(name, fn) { this.handlers[name] = fn; } click() { return this.handlers.click?.(); }
}
function setup(reply) {
  const elements = new Map(), calls = [], get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  vm.runInNewContext(script, { document: { getElementById: get, createElement: tag => new Element(tag) }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({ url, options }); const body = await (typeof reply === 'function' ? reply(url, options) : reply); return { ok: body?.ok !== false, json: async () => body }; } }); return { get, calls };
}
const boards = Array.from({ length: 8 }, (_, i) => ({ category: i % 2 ? 'concept' : 'industry', code: 'BK' + (1000 + i), name: i ? '板块' + i : '<img onerror=bad>' }));
function fixture(selection = []) { return { ok: true, result: { status: 'catalogue-only', catalogue: { records: boards }, selection,
  relations: { edges: [{ from: 'A', to: 'B', membershipOverlap: { intersectionCount: 3, jaccard: .2 }, sameDayCorrelation: { coefficient: null, knownMatchedCount: 1 } }] }, historyCoverage: { acceptedDays: 1, expectedDays: 20 }, errors: [] } }; }
test('zero startup requests; catalogue refresh does not silently select boards', async () => {
  const { get, calls } = setup(fixture()); assert.equal(calls.length, 0); get('token').value = 'fixture-token';
  await get('sectorCatalogueRun').click(); assert.equal(calls[0].url, '/api/research/public-sectors'); assert.equal(calls[0].options.body, '{}');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.match(get('sectorSelection').textContent, /已选 0/);
  await get('sectorCaptureRun').click(); assert.equal(calls.length, 1); assert.match(get('sectorEvidenceStatus').textContent, /明确选择1至6/);
});
test('user selection is explicit, bounded and persists only category/code; GET restores cloud selection', async () => {
  const { get, calls } = setup(fixture()); await get('sectorSavedRead').click();
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
  for (const b of boards) { get('sectorBoardChoice').value = b.category + ':' + b.code; await get('sectorBoardAdd').click(); }
  assert.match(get('sectorSelection').textContent, /已选 6/); assert.match(get('sectorEvidenceStatus').textContent, /最多选择6/);
  await get('sectorCaptureRun').click(); const payload = JSON.parse(calls[1].options.body); assert.equal(payload.boards.length, 6);
  assert.deepEqual(payload.boards[0], { category: 'industry', code: 'BK1000' });
  const second = setup(fixture([boards[0]])); await second.get('sectorSavedRead').click(); assert.match(second.get('sectorSelection').textContent, /<img onerror=bad>/);
  await second.get('sectorSelection').children[1].click(); assert.match(second.get('sectorSelection').textContent, /已选 0/);
});
test('current intersection, historical coverage and unknown correlation remain distinct', async () => {
  const { get } = setup(fixture()); await get('sectorSavedRead').click(); const text = get('sectorEvidenceSummary').textContent;
  assert.match(text, /当前成员交集 3 · Jaccard 20.0% · 同日相关 未知 \/ 匹配日 1/); assert.match(text, /历史覆盖/);
  assert.match(text, /当前成员不会回填过去/); assert.doesNotMatch(text, /胜率|收益保证/);
});
test('research status distinguishes evidence collection from raw candle event evaluation', async () => {
  const { get, calls } = setup({ ok: true, result: { researchFollowups: { counts: { pending: 2, completed: 1, unknown: 1, due: 1 }, lastFailure: { symbol: '600000', reason: '<b>TARGET_MISSING</b>' } },
    priceEventResearch: { objective: 'next-session-reported-candle-direction-v1', independentTargetDays: 2, streams: [{ symbol: '600000', provider: 'tencent', forwardValidation: { evaluated: 2, independentTargetDays: 2, rawCandleMatchFrequency: null, brier: null, brierEvaluated: 0 } }] } } });
  await get('researchStatusRead').click(); assert.equal(calls[0].url, '/api/research/stock-observation-status');
  const text = get('researchStatusSummary').textContent; assert.match(text, /复访待处理 \/ 已完成 \/ 未知：2 \/ 1 \/ 1/); assert.match(text, /等待独立目标日证据/); assert.match(text, /<b>TARGET_MISSING<\/b>/); assert.match(text, /不等于收益或涨停概率/);
});
test('selection edits and token changes invalidate late sector responses', async () => {
  let release; let count = 0; const { get } = setup(() => ++count === 1 ? fixture() : new Promise(resolve => { release = resolve; }));
  await get('sectorSavedRead').click(); const pending = get('sectorCatalogueRun').click();
  get('sectorBoardChoice').value = 'industry:BK1000'; get('sectorBoardAdd').click(); release(fixture()); await pending;
  assert.match(get('sectorSelection').textContent, /已选 1/);
  const old = get('sectorSavedRead').click(); get('token').value = 'changed'; get('token').handlers.input(); release(fixture([boards[1]])); await old;
  assert.equal(get('sectorEvidenceSummary').textContent, ''); assert.match(get('sectorSelection').textContent, /已选 0/);
});
test('older backends with missing fields remain unknown and errors are text only', async () => {
  let fail = false; const { get } = setup(() => fail ? { ok: false, error: '<b>denied</b>' } : { ok: true, result: {} });
  await get('researchStatusRead').click(); assert.match(get('researchStatusSummary').textContent, /未知 \/ 未知 \/ 未知/);
  fail = true; await get('researchStatusRead').click(); assert.equal(get('researchStatusSummary').textContent, ''); assert.equal(get('researchStatusMessage').textContent, '<b>denied</b>');
});

test('public-sector persisted shape renders top-level current overlap independently of historical edges', async () => {
  const f = fixture([boards[0]]); f.result.current = { tradeDate: '2026-11-13', retrievedAt: 1794567000000, boards: [{ ...boards[0], members: ['600000'], membershipComplete: true, membersObservedAt: 1794566000000, changePct: 1 }], errors: [{ message: '<b>partial-source</b>' }] };
  f.result.overlap = [{ from: 'industry:BK1000', to: 'concept:BK1001', sharedMembers: ['600000'], jaccard: .25, membersObservedAt: { from: 1794566000000, to: 1794566000000 } }];
  f.result.relations.edges = []; f.result.historyCoverage = { frozenDailyCount: 1, acceptedSessions: 1, expectedSessions: 2, missingTradeDates: ['2026-11-12'] }; delete f.result.errors;
  const { get } = setup(f); await get('sectorSavedRead').click(); const text = get('sectorEvidenceSummary').textContent;
  for (const term of ['当前成员交集：1 · Jaccard 25.0%', '历史关系：等待完整成员及对齐历史证据', '已冻结日 / 匹配日 / 应有日：1 / 1 / 2', '缺失交易日：2026-11-12', '<b>partial-source</b>']) assert.ok(text.includes(term), term);
});
