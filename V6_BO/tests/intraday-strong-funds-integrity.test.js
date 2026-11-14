'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
function scanner(stocks) {
  const modelInputs = [], neutralInputs = [];
  const ctx = vm.createContext({
    S: {stocks, candidatePool: []},
    A: {isJunkName: () => false, limitUpProbability: input => { modelInputs.push(input); return 0.5; }},
    sectorOfStock: () => '', sectorHeat: () => null, numGapRaw: () => 5,
    scoreSmoothOf: (_code, score) => ({score, rawScore: score, trend: 'flat', trendText: ''}),
    calibratedProb: probability => probability,
    numNeutral: (field, raw) => {
      neutralInputs.push({field, raw});
      return raw == null ? ({score: 50, profitRatio: 50, gap: 8}[field] ?? 0) : raw;
    },
    klineRows: async () => [], console
  });
  vm.runInContext(section('function fundsNumber(', 'function fundsWindowSum(') +
    section('const INTRADAY_STRONG_CACHE_MS', '// ── 洗盘趋势扫描') +
    '\nthis.scan = intradayStrongScan;', ctx);
  return {scan: ctx.scan, modelInputs, neutralInputs};
}
function stock(code = '000001', extra = {}) {
  return {code, name: '正常股票', price: 10, pct: 4, speed: 0.5, turnover: 5,
    amount: 3e8, floatCap: 1e10, ...extra};
}

test('intraday strong rows keep missing and invalid funds unknown at the API boundary', async () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, '', '3', false, [], {}]) {
    const api = scanner([stock('000001', {mainPct: value, mainInflow: value})]);
    const result = await api.scan();
    assert.equal(result.count, 1, 'missing funds do not remove an otherwise valid observation');
    assert.equal(result.items[0].mainPct, null, `mainPct ${String(value)}`);
    assert.equal(result.items[0].mainInflow, null, `mainInflow ${String(value)}`);
    assert.equal(result.items[0].reasons.some(reason => reason.startsWith('主力')), false);
  }
});

test('intraday strong keeps missing funds distinct before the existing model neutral-value boundary', async () => {
  const api = scanner([stock()]);
  await api.scan();
  assert.equal(api.neutralInputs.find(input => input.field === 'mainPct').raw, null);
  assert.equal(api.modelInputs[0].mainPct, 0, 'existing model neutral value and thresholds remain unchanged');
});

test('intraday strong preserves real zero and signed observed funds without changing valid scores', async () => {
  const api = scanner([
    stock('000001', {mainPct: 0, mainInflow: 0}),
    stock('000002', {mainPct: -2.45, mainInflow: -12345678}),
    stock('000003', {mainPct: 2.45, mainInflow: 12345678})
  ]);
  const result = await api.scan();
  const rows = new Map(result.items.map(row => [row.code, row]));
  assert.equal(rows.get('000001').mainPct, 0);
  assert.equal(rows.get('000001').mainInflow, 0);
  assert.equal(rows.get('000002').mainPct, -2.5);
  assert.equal(rows.get('000002').mainInflow, -12345678);
  assert.equal(rows.get('000003').mainPct, 2.5);
  assert.equal(rows.get('000003').mainInflow, 12345678);
  assert.equal(rows.get('000001').rawScore, 32);
  assert.equal(rows.get('000002').rawScore, 32);
  assert.equal(rows.get('000003').rawScore, 35);
  assert.ok(rows.get('000003').reasons.includes('主力净占比 2.5%'));
  assert.equal(api.modelInputs.find(input => input.mainPct === -2.45).mainPct, -2.45);
});

test('intraday strong validates each funds field independently and cache retains unknown values', async () => {
  const api = scanner([
    stock('000001', {mainPct: null, mainInflow: 12345678}),
    stock('000002', {mainPct: 2.45, mainInflow: null})
  ]);
  const initial = await api.scan();
  const rows = new Map(initial.items.map(row => [row.code, row]));
  assert.equal(rows.get('000001').mainPct, null);
  assert.equal(rows.get('000001').mainInflow, 12345678);
  assert.equal(rows.get('000002').mainPct, 2.5);
  assert.equal(rows.get('000002').mainInflow, null);
  assert.equal(await api.scan(), initial, 'normal 30-second cache retains the same truthful rows');
});
