'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../public/research.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/assets/linked-intelligence-workbench.js'), 'utf8');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.value = ''; this.files = []; this.checked = false; this.disabled = false; this.handlers = {}; this.content = ''; }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return this.content + this.children.map(x => x.textContent).join(' '); }
  set innerHTML(_) { throw Error('Untrusted HTML assignment'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.content = ''; this.children = nodes; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  async click() { return this.handlers.click?.(); }
}
function setup(reply) {
  const elements = new Map(), calls = [], downloads = [], get = id => {
    if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);
  };
  const sandbox = { document: { getElementById: get, createElement: tag => new Element(tag) },
    AbortController, setTimeout, clearTimeout, Blob,
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:fixture'; }, revokeObjectURL: () => {} },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const body = typeof reply === 'function' ? reply(url, options) : reply;
      return { ok: body?.ok !== false, json: async () => body };
    } };
  vm.runInNewContext(script, sandbox);
  return { get, calls, downloads };
}
const result = { asOf: 1794480000000, marketContext: { status: 'unknown' },
  stocks: [{ symbol: '000001', name: '<img src=x onerror=alert(1)>',
    forecast: { direction: { probability: .6, samples: 40, confidenceInterval: [.45, .72], outOfSample: { brier: .22, evaluated: 20 } },
      limitUp: { probability: null, samples: 3 }, patterns: { checks: [{ label: '<script>evil</script>', status: 'matched', detail: '原始数据' }] } },
    conditions: [{ label: '市场证据', status: 'unknown', detail: '<b>缺少</b>' }], memory: { status: 'saved', revision: 2 } }],
  sectorRelations: { sources: ['fixture'], coverage: { acceptedDays: 24, expectedDays: 24 },
    nodes: [{ id: 'A', name: '甲', code: 'S1', mainNetInflow: null }, { id: 'B', name: '乙', code: 'S2', mainNetInflow: 0 }],
    edges: [{ from: 'A', to: 'B', sameDayCorrelation: { coefficient: .8, knownMatchedCount: 24 },
      marketResidualCorrelation: { coefficient: null, knownMatchedCount: 19, reason: 'insufficient-matched-sessions' }, membershipOverlap: { jaccard: .25 } }] },
  limitations: ['仅供研究'], canTrade: false };

test('section follows factor agent, keeps existing modules and provides licensed source links', () => {
  const section = html.slice(html.indexOf('id="linkedIntelligence"'), html.indexOf('id="adaptiveHeading"'));
  assert.ok(html.indexOf('id="factorAgentHeading"') < html.indexOf('id="linkedIntelligence"'));
  for (const id of ['linkedPublicRun', 'linkedIntelligenceFile', 'linkedIntelligenceRun', 'linkedMemoryRead', 'linkedTemplate']) assert.ok(section.includes('id="' + id + '"'));
  assert.ok(html.includes('/assets/linked-intelligence-workbench.js?v=20261112linked1'));
  for (const label of ['AKShare · MIT', 'efinance · MIT', 'CZSC · Apache-2.0', 'Qlib · MIT']) assert.ok(section.includes(label));
  assert.ok(html.includes('.linked-controls{grid-template-columns:minmax(0,1fr)}'));
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});

test('script is isolated, performs zero startup requests and only click posts authenticated context', async () => {
  const { get, calls } = setup({ ok: true, result: { marketFlow: { mainNetInflow: null }, sectorFlow: null, stockFlow: null, limitPools: null, errors: [] } });
  assert.equal(calls.length, 0);
  get('token').value = 'test-developer-token'; get('linkedPublicSymbol').value = '000001'; get('linkedSectorCode').value = 'BK1234'; get('linkedPublicDate').value = '2026-11-12';
  await get('linkedPublicRun').click();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/research/public-context');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers.Authorization, 'Bearer test-developer-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { symbol: '000001', sectorCode: 'BK1234', date: '2026-11-12' });
  assert.match(get('linkedPublicSummary').textContent, /未知/); assert.match(get('linkedPublicSummary').textContent, /原始时间缺失/);
  assert.equal(get('linkedPublicRun').disabled, false);
  get('linkedPublicSymbol').value = '1'; await get('linkedPublicRun').click();
  assert.equal(calls.length, 1); assert.match(get('linkedPublicStatus').textContent, /六位数字/);
});

test('uploaded analysis displays probability evidence and unknown correlations using text nodes', async () => {
  const { get, calls } = setup({ ok: true, result });
  const payload = { schemaVersion: 1, asOf: 1794480000000, tradeDates: [], stocks: [] };
  get('linkedIntelligenceFile').files = [{ size: 100, text: async () => JSON.stringify(payload) }];
  get('linkedPersist').checked = true;
  await get('linkedIntelligenceRun').click();
  assert.equal(calls[0].url, '/api/research/linked-intelligence');
  assert.equal(JSON.parse(calls[0].options.body).persist, true);
  const text = get('linkedStockSummary').textContent;
  for (const term of ['60.0%', '40', '45.0% ～ 72.0%', '0.220', '20', '数据不足', '<img src=x onerror=alert(1)>', '<b>缺少</b>', '<script>evil</script>']) assert.ok(text.includes(term), term);
  const sector = get('linkedSectorSummary').textContent;
  for (const term of ['同日相关', '0.800', '去市场相关', '未知', '成员重叠', '25.0%', '原始时间缺失']) assert.ok(sector.includes(term), term);
  assert.equal(get('linkedIntelligenceRun').disabled, false);
});

test('normalized CNY records retain missing source timestamp and separate retrieval time', async () => {
  const retrievedAt = '2026-11-12T08:00:00.000Z';
  const { get } = setup({ ok: true, result: {
    marketFlow: { source: 'fixture', fundsMethod: 'provider-main-net', unit: 'CNY',
      sourceTimestamp: null, retrievedAt, records: [{ tradeDate: '2026-11-12', mainNetInflow: 0 }] }, errors: [] } });
  await get('linkedPublicRun').click();
  const text = get('linkedPublicSummary').textContent;
  assert.match(text, /主力净流入：0 元/);
  assert.match(text, /原始观测时间：原始时间缺失/);
  assert.match(text, /本次获取时间：2026-11-12T08:00:00.000Z/);
  assert.match(text, /资金口径：provider-main-net/);
});

test('fund history shows only the latest eight supplied sessions with newest first', async () => {
  const records = Array.from({ length: 12 }, (_, i) => ({ tradeDate: '2026-11-' + String(i + 1).padStart(2, '0'), mainNetInflow: i + 1 }));
  const before = JSON.stringify(records);
  const { get } = setup({ ok: true, result: { marketFlow: { source: 'fixture', records }, errors: [] } });
  await get('linkedPublicRun').click();
  const text = get('linkedPublicSummary').textContent;
  assert.ok(text.indexOf('2026-11-12') < text.indexOf('2026-11-11'));
  assert.ok(text.includes('2026-11-05'));
  for (const date of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) assert.ok(!text.includes(date), date);
  assert.equal(JSON.stringify(records), before);
});

test('final limit pool schema displays named pools, coverage, dates and descriptive ratios', async () => {
  const pools = { complete: true, tradeDate: '2026-11-12',
    sealed: { records: [{ code: '600001' }], fetchedCount: 30, totalCount: 30, partial: false, complete: true, sourceTimestamp: null },
    broken: { records: [{ code: '600002' }], fetchedCount: 10, totalCount: 10, partial: false, complete: true, sourceTimestamp: '2026-11-12T07:00:00Z' },
    sealRate: .75, breakRate: .25, limitUpToBrokenRatio: 3, overlapDetected: false };
  const { get } = setup({ ok: true, result: { limitPools: pools, errors: [] } });
  await get('linkedPublicRun').click();
  const text = get('linkedPublicSummary').textContent;
  for (const term of ['封板数量：已获取 30 / 来源总数 30', '炸板未封数量：已获取 10 / 来源总数 10', '池覆盖：完整',
    '涨停池交易日期：2026-11-12', '封板原始观测时间：原始时间缺失', '炸板未封原始观测时间：2026-11-12T07:00:00.000Z',
    '封板占比：75.0%', '炸板未封占比：25.0%', '封板 / 炸板未封数量比：3.000', '不是交易成功率或收益']) assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /fetchedCount|sealRate|complete：/);
});

test('partial or nonfinite pool ratios remain unknown even when raw rates exist', async () => {
  const pools = { complete: false, tradeDate: '2026-11-12', sealed: { fetchedCount: 20, totalCount: 30, partial: true, complete: false },
    broken: { fetchedCount: 10, totalCount: 10, complete: true }, sealRate: .75, breakRate: .25, limitUpToBrokenRatio: 3, overlapDetected: true };
  const { get } = setup({ ok: true, result: { limitPools: pools } });
  await get('linkedPublicRun').click();
  const text = get('linkedPublicSummary').textContent;
  assert.match(text, /封板覆盖：部分数据/); assert.match(text, /池覆盖：不完整/); assert.match(text, /已检测到重叠/);
  assert.doesNotMatch(text, /75.0%|25.0%|3.000/);
  assert.match(text, /封板占比：未知/);
  pools.complete = true; pools.sealRate = Infinity; pools.breakRate = null; pools.limitUpToBrokenRatio = NaN;
  await get('linkedPublicRun').click();
  assert.match(get('linkedPublicSummary').textContent, /封板占比：未知/);
});

test('stock linkage uses independent market and sector statuses plus conflict and evidence', async () => {
  const r = structuredClone(result);
  r.stocks[0].linkage = { marketStatus: 'observed-unverified', sectorStatus: 'stale-or-invalid', riskConflict: true,
    support: ['同日市场上涨家数比例≥60%'], risks: ['存在看跌K线形态'] };
  const { get } = setup({ ok: true, result: r });
  get('linkedIntelligenceFile').files = [{ size: 100, text: async () => JSON.stringify({ schemaVersion: 1, asOf: r.asOf, tradeDates: [], stocks: [] }) }];
  await get('linkedIntelligenceRun').click();
  const text = get('linkedStockSummary').textContent;
  for (const term of ['市场联动证据：已观测，未独立核验', '板块联动证据：证据过时或无效', '存在形态与上下文风险冲突',
    '支持依据：同日市场上涨家数比例≥60%', '风险依据：存在看跌K线形态']) assert.ok(text.includes(term), term);
});

test('pattern study shows only eight current matches with historical frequency, count and interval', async () => {
  const r = structuredClone(result);
  r.stocks[0].patternStudy = { patterns: [
    { id: 'not-current', label: '未匹配形态', currentlyMatched: false, direction: { probability: .99 } },
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'pattern-' + i, label: '匹配形态-' + i, side: 'bullish', currentlyMatched: true,
      direction: { probability: .6, samples: 40, wins: 24, confidenceInterval: [.45, .72] },
      limitUp: { probability: null, samples: 3, wins: 0, confidenceInterval: null } })) ] };
  const { get } = setup({ ok: true, result: r });
  get('linkedIntelligenceFile').files = [{ size: 100, text: async () => JSON.stringify({ schemaVersion: 1, asOf: r.asOf, tradeDates: [], stocks: [] }) }];
  await get('linkedIntelligenceRun').click();
  const card = get('linkedStockSummary').children[0];
  const study = card.children.find(n => n.tagName === 'details' && n.children[0]?.textContent === '历史形态与后续表现');
  assert.ok(study);
  const text = study.textContent;
  for (const term of ['匹配形态-0', '匹配形态-7', '后续上涨历史频率：60.0%', '匹配历史样本量：40', '45.0% ～ 72.0%',
    '后续涨停历史频率：数据不足', '非前瞻验证', '频率不等于可成交收益']) assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /未匹配形态|匹配形态-8|匹配形态-9|Brier/);
});

test('missing, oversized, malformed and invalid-schema files never send requests', async () => {
  const { get, calls } = setup({ ok: true, result });
  await get('linkedIntelligenceRun').click(); assert.match(get('linkedIntelligenceStatus').textContent, /请选择/);
  get('linkedIntelligenceFile').files = [{ size: 2 * 1024 * 1024 + 1, text: async () => { throw Error('must not read'); } }];
  await get('linkedIntelligenceRun').click(); assert.match(get('linkedIntelligenceStatus').textContent, /2MiB/);
  for (const body of ['{', 'null', '[]', '{"schemaVersion":2}']) {
    get('linkedIntelligenceFile').files = [{ size: body.length, text: async () => body }];
    await get('linkedIntelligenceRun').click(); assert.equal(get('linkedIntelligenceRun').disabled, false);
  }
  assert.equal(calls.length, 0);
});

test('code query presents revision history and prospective Brier without treating frequencies as return', async () => {
  const memory = { symbol: '000001', totalRevisions: 2, revisions: [{ revision: 2, decisionAt: 1794480000000, recordedAt: 1794480001000, stock: { name: '<svg/onload=alert(1)>' } }],
    forwardValidation: { direction: { evaluated: 4, brier: .21 }, limitUp: { evaluated: 0, brier: null } }, canTrade: false };
  const { get, calls } = setup({ ok: true, result: memory });
  get('linkedMemorySymbol').value = 'invalid'; await get('linkedMemoryRead').click(); assert.equal(calls.length, 0);
  get('linkedMemorySymbol').value = '000001'; await get('linkedMemoryRead').click();
  assert.equal(calls[0].url, '/api/research/stock-memory?symbol=000001');
  const content = get('linkedMemorySummary').textContent;
  assert.match(content, /版本 2/); assert.match(content, /0.210/); assert.match(content, /尚无可用验证/); assert.match(content, /<svg\/onload=alert\(1\)>/);
  assert.doesNotMatch(content, /收益率|获利|命中率/);
});

test('failed responses clear old output and restore buttons', async () => {
  let fail = false;
  const { get } = setup(() => fail ? { ok: false, error: '<b>授权失败</b>' } : { ok: true, result: { symbol: '000001', totalRevisions: 0 } });
  get('linkedMemorySymbol').value = '000001'; await get('linkedMemoryRead').click();
  assert.match(get('linkedMemorySummary').textContent, /000001/);
  fail = true; await get('linkedMemoryRead').click();
  assert.equal(get('linkedMemorySummary').textContent, ''); assert.equal(get('linkedMemoryOutput').textContent, '');
  assert.equal(get('linkedMemoryStatus').textContent, '<b>授权失败</b>'); assert.equal(get('linkedMemoryRead').disabled, false);
});

test('in-flight response with a changed developer token cannot render prior-session results', async () => {
  const { get } = setup(() => {
    get('token').value = 'changed-token';
    return { ok: true, result: { symbol: '000001', totalRevisions: 2 } };
  });
  get('token').value = 'initial-token'; get('linkedMemorySymbol').value = '000001';
  await get('linkedMemoryRead').click();
  assert.equal(get('linkedMemorySummary').textContent, '');
  assert.match(get('linkedMemoryStatus').textContent, /令牌已更改/);
});

test('empty template contains no invented dates, prices or trading history', async () => {
  const { get, calls, downloads } = setup();
  await get('linkedTemplate').click();
  assert.equal(calls.length, 0); assert.equal(downloads.length, 1);
  assert.deepEqual(JSON.parse(await downloads[0].text()), { schemaVersion: 1, asOf: null, tradeDates: [], stocks: [], persist: false });
});

test('current price-only formation remains visible independently from unknown historical probability', async () => {
  const r = structuredClone(result);
  r.stocks[0].forecast.direction.probability = null;
  r.stocks[0].patternStudy = { currentFormation: { status: 'price-only-unverified', date: '2026-11-12', availableAt: 1794480000000,
    patterns: { checks: [{ label: '当前独立形态', status: 'matched', detail: '仅价格' }] } }, patterns: [] };
  const { get } = setup({ ok: true, result: r });
  get('linkedIntelligenceFile').files = [{ size: 100, text: async () => JSON.stringify({ schemaVersion: 1, asOf: r.asOf, tradeDates: [], stocks: [] }) }];
  await get('linkedIntelligenceRun').click();
  assert.match(get('linkedStockSummary').textContent, /当前形态 · 仅价格证据（price-only，未核验）/);
  assert.match(get('linkedStockSummary').textContent, /当前独立形态/);
  assert.match(get('linkedStockSummary').textContent, /下一明确交易日上涨概率：数据不足/);
});

test('v2 validation uses the new protocol summary and labels legacy evaluations separately', async () => {
  const { get } = setup({ ok: true, result: { symbol: '600000', totalRevisions: 4,
    forwardValidation: { direction: { evaluated: 99, brier: .01 } },
    newProtocolForwardValidation: { direction: { evaluated: 2, brier: .25 } },
    legacyForwardValidation: { direction: { evaluated: 97, brier: .005 } } } });
  get('linkedMemorySymbol').value = '600000'; await get('linkedMemoryRead').click();
  const text = get('linkedMemorySummary').textContent;
  assert.match(text, /方向v2冻结预测后续验证：样本 2 · Brier 0.250/);
  assert.match(text, /旧协议 97 · v2新协议 2/);
  assert.doesNotMatch(text, /样本 99|Brier 0.010/);
});
