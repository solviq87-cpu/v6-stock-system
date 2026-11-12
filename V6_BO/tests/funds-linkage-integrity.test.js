'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const analysis = fs.readFileSync(require.resolve('../analysis.js'), 'utf8');
const ui = fs.readFileSync(require.resolve('../public/assets/app.js'), 'utf8');
function extract(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const helpers = extract(server, 'function fundsNumber(', "const { analyzeShortline }");
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(helpers, ctx);
  return ctx;
}

test('funds updates clear stale fields and preserve observed zero with separate provenance', () => {
  const ctx = context();
  const stock = {mainInflow: 50, mainPct: 2, superNet: 30, bigNet: 20, midNet: -20, smallNet: -30};
  ctx.applyObservedFunds(stock, {today: 0, pct: 0, superNet: null, bigNet: 0,
    upstream: 'eastmoney', fundsMethod: 'vendor-order-size-estimate', retrievedAt: 123});
  assert.equal(stock.mainInflow, 0);
  assert.equal(stock.mainPct, 0);
  assert.equal(stock.superNet, null);
  assert.equal(stock.bigNet, 0);
  assert.equal(stock.midNet, null);
  assert.equal(stock.smallNet, null);
  assert.equal(stock.fundsSource, 'eastmoney');
  assert.equal(stock.fundsRetrievedAt, 123);
  assert.equal(stock.fundsSourceTimestamp, null);
});

test('historical funds windows require every observation and retain zero and negative totals', () => {
  const ctx = context();
  assert.equal(ctx.fundsWindowSum([{main: 5}, {main: null}, {main: -1}], 3), null);
  assert.equal(ctx.fundsWindowSum([{main: 5}], 3), null);
  assert.equal(ctx.fundsWindowSum([{main: 5}, {main: 0}, {main: -5}], 3), 0);
  assert.equal(ctx.fundsWindowSum([{main: -5}, {main: 0}, {main: 1}], 3), -4);
  assert.equal(ctx.fundsWindowSum([{main: 1, big: 1, super: null}], 1, ['main', 'big', 'super']), null);
});

test('sector aggregation counts known zero but never mixes THS or unmarked funds into EM sum', () => {
  const stocks = [
    {code: '000001', name: 'A', pct: 1, mainInflow: 0, fundsSource: 'eastmoney', fundsMethod: 'vendor-order-size-estimate'},
    {code: '000002', name: 'B', pct: -1, mainInflow: 20, fundsSource: 'eastmoney', fundsMethod: 'vendor-order-size-estimate'},
    {code: '000003', name: 'C', pct: 0, mainInflow: null, thsNetAmt: 900},
    {code: '000004', name: 'D', pct: null, mainInflow: 700},
    {code: '000001', name: 'A', pct: 1, mainInflow: 500}
  ];
  const ctx = context({S: {stocks}, sectorOfStock: () => '行业'});
  vm.runInContext(extract(server, 'function aggregateSectorFlowFromStocks()', '// ---------------- 5. 定时任务'), ctx);
  const [row] = ctx.aggregateSectorFlowFromStocks();
  assert.equal(row.observedMainInflowSum, 20);
  assert.equal(row.knownFundsCount, 2);
  assert.equal(row.observedStockCount, 4);
  assert.equal(row.fundsCoverage, 0.5);
  assert.equal(row.mainInflow, null);
  assert.equal(row.totalCount, null);
  assert.equal(row.upCount, 1);
  assert.equal(row.downCount, 1);
  assert.equal(row.independentSource, false);
  stocks.splice(0, stocks.length, {code: '000003', name: 'C', thsNetAmt: 900});
  const [unknown] = ctx.aggregateSectorFlowFromStocks();
  assert.equal(unknown.observedMainInflowSum, null);
  assert.equal(unknown.knownFundsCount, 0);
  assert.equal(unknown.upCount, null);
});

test('K-line funds consumer keeps partial EM evidence unknown and handles THS zero without substitution', async () => {
  const ctx = context({Date, Map, KL_FLOW_TTL: 60000, _klFlowCache: new Map(),
    em: {fetchBatchFlowEM: async () => [{pct: null, today: 0, bigNet: 0,
      fundsMethod: 'vendor-order-size-estimate', retrievedAt: 123}],
      fetchThsActive: async () => ({netAmt: 0, activePct: 0})}});
  vm.runInContext(extract(server, 'async function klineFlowOf(code)', '// 洗盘 vs 出货'), ctx);
  const first = (await ctx.klineFlowOf('000001')).data;
  assert.equal(first.today, 0);
  assert.equal(first.mainPct, null);
  assert.equal(first.superNet, null);
  assert.equal(first.bigNet, 0);
  assert.equal(first.sourceTimestamp, null);
  ctx.em.fetchBatchFlowEM = async () => [];
  const fallback = (await ctx.klineFlowOf('000002')).data;
  assert.equal(fallback.source, 'ths');
  assert.equal(fallback.today, 0);
  assert.equal(fallback.mainPct, 0);
  assert.equal(fallback.superNet, null);
});

test('trend funds check distinguishes unknown history from three positive days', () => {
  const ctx = vm.createContext({ma: (values, count) => values.slice(-count).reduce((sum, value) => sum + value, 0) / count});
  vm.runInContext(extract(analysis, 'function trendCheck(', '// ---------- 趋势类榜单'), ctx);
  const rows = Array.from({length: 30}, () => ({close: 10, high: 11, volume: 100, pct: 0}));
  assert.equal(ctx.trendCheck({rows, price: 10, fundDays: [{main: 1}, {main: null}, {main: 1}]}).fund3d, null);
  assert.equal(ctx.trendCheck({rows, price: 10, fundDays: [{main: 1}, {main: 0}, {main: 1}]}).fund3d, false);
  assert.equal(ctx.trendCheck({rows, price: 10, fundDays: [{main: 1}, {main: 2}, {main: 1}]}).fund3d, true);
});

test('K-line funds UI renders unknown explicitly while displaying genuine zero', () => {
  const box = {innerHTML: ''};
  const ctx = vm.createContext({document: {getElementById: () => box},
    KL: {marks: {flow: {source: 'em', mainPct: null, superNet: null, bigNet: 0, midNet: -10, smallNet: 10}}},
    klMoney: value => String(value), esc: value => String(value)});
  vm.runInContext(extract(ui, 'function klRenderFlow()', 'function klRenderPaper()'), ctx);
  ctx.klRenderFlow();
  assert.match(box.innerHTML, /未知/);
  assert.doesNotMatch(box.innerHTML, /null|NaN/);
  assert.match(box.innerHTML, /大单 <b[^>]*>0<\/b>/);
});

test('known EM zero or outflow cannot fall through to positive THS or price-volume proxies', () => {
  const {trendPoolCheck} = require('../analysis');
  const rows = Array.from({length: 65}, (_, index) => ({
    date: `day-${index}`, open: 10, high: 11, low: 9.5, close: 10,
    pct: 0, volume: 10000, amount: 100000, turnover: 1
  }));
  const evaluate = extra => trendPoolCheck({rows, price: 10, fundDays: [],
    floatCap: 2e9, code: '000001', name: '样本', ...extra});
  for (const mainInflow of [0, -1, -1000000]) {
    for (const thsNetAmt of [null, 1000000]) {
      const result = evaluate({mainInflow, thsNetAmt});
      assert.equal(result.fundIn, false);
      assert.equal(result.source, 'em');
      assert.equal(result.proxy, false);
    }
  }
  assert.equal(evaluate({mainInflow: 100, thsNetAmt: -100}).fundIn, true);
  const fallback = evaluate({mainInflow: null, thsNetAmt: 100});
  assert.equal(fallback.fundIn, true);
  assert.equal(fallback.source, 'ths');
  const thsZero = evaluate({mainInflow: null, thsNetAmt: 0});
  assert.equal(thsZero.fundIn, false);
  assert.equal(thsZero.source, 'ths');
  const proxy = evaluate({mainInflow: null, thsNetAmt: null});
  assert.equal(proxy.fundIn, true);
  assert.equal(proxy.source, 'price');
  assert.equal(proxy.proxy, true);
  const history = evaluate({fundDays: [{main: -5}, {main: 0}, {main: 0}], mainInflow: 100, thsNetAmt: 100});
  assert.equal(history.fundIn, false);
  assert.equal(history.source, 'em');
});

test('accumulation path displays actual big-plus-super net without counting main again', () => {
  const paths = [];
  const days = Array.from({length: 3}, () => ({main: 1e6, big: 4e5, super: 6e5}));
  const ctx = context({S: {fundDays: new Map([['000001', days]])},
    s: {code: '000001'}, k: {rows: [{pct: 1}, {pct: 1}, {pct: 1}]},
    pushPath: (name, detail) => paths.push({name, detail})});
  const block = extract(server, '    const fd = S.fundDays.get(s.code) || [];', '    // 大单流入：当日主力净占比');
  vm.runInContext(block, ctx);
  assert.equal(paths.length, 1);
  assert.match(paths[0].detail, /净额300万/);
  assert.doesNotMatch(paths[0].detail, /480万/);
  days[1].super = null;
  paths.length = 0;
  vm.runInContext(`{${block}}`, ctx);
  assert.equal(paths.length, 0);
});

test('sector surge requires two observed amounts and treats real zero as comparable', () => {
  const ctx = context();
  vm.runInContext(extract(server, 'function pickNotableSectors(', 'async function sectorSurgeScan()'), ctx);
  const pick = (current, previous) => ctx.pickNotableSectors([{name: '行业', pct: 1, mainInflow: current}], new Map([['行业', previous]]), true, 2.5);
  for (const missing of [null, undefined, NaN, '-', '']) {
    assert.equal(pick(5e7, missing).length, 0);
    assert.equal(pick(missing, -5e7).length, 0);
  }
  assert.equal(pick(5e7, 0)[0].kind, 'surge');
  assert.equal(pick(5e7, 0)[0].delta, 5e7);
  const strong = ctx.pickNotableSectors([{name: '行业', pct: 3, mainInflow: 5e7}], null, false, 2.5)[0];
  assert.equal(strong.kind, 'strong');
  assert.equal(strong.delta, null);
});

test('sample histories never bridge missing funds, including a missing interior observation', () => {
  const ctx = context();
  vm.runInContext(extract(server, 'function countStreak(h)', 'function sectorZTCountFor('), ctx);
  const rows = Array.from({length: 12}, (_, i) => ({mainInflow: i * 1e7}));
  assert.equal(ctx.fundsWindowDelta(rows, 12), 11e7);
  assert.equal(ctx.countStreak(rows), 1);
  for (const index of [0, 5, 11]) {
    const gap = rows.map(row => ({...row}));
    gap[index].mainInflow = null;
    assert.equal(ctx.fundsWindowDelta(gap, 12), null);
  }
  const afterGap = rows.map(row => ({...row}));
  afterGap[8].mainInflow = null;
  assert.equal(ctx.countStreak(afterGap), 0);
  for (let i = 0; i < 12; i++) afterGap.push({mainInflow: i});
  assert.equal(ctx.fundsWindowDelta(afterGap, 12), 11);
});

test('actual history ingestion stores unknown and replaces prior sector baseline with unknown', () => {
  const h = [], ctx = context({h, now: 123, s: {mainInflow: null, pct: 1}});
  vm.runInContext(extract(server, '      h.push({ t: now, mainInflow:', '      while (h.length'), ctx);
  assert.equal(h[0].mainInflow, null);
  ctx.s.mainInflow = 0;
  vm.runInContext(extract(server, '      h.push({ t: now, mainInflow:', '      while (h.length'), ctx);
  assert.equal(h[1].mainInflow, 0);
  ctx.S = {sectors: [{name: '行业', mainInflow: null}]};
  vm.runInContext(extract(server, '  const cur = new Map(S.sectors.map(', '  // ⛔ 基线必须') + '\nthis.baseline = cur;', ctx);
  assert.equal(ctx.baseline.get('行业'), null);
});
