'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path'),os=require('node:os');
const {createRequire}=require('node:module');
const productionRequire=createRequire(require.resolve('../server.js'));
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const start = Date.parse('2026-11-13T10:00:00+08:00');
const minute = {minSpanMs: 45000, maxSpanMs: 75000};
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(section('function fundsNumber(', 'const { analyzeShortline }'), ctx);
  vm.runInContext(section('function countStreak(h)', 'function sectorZTCountFor('), ctx);
  return ctx;
}
function stock(at, mainInflow = 0, extra = {}) {
  return {code: '000001', name:'正常股票', price: 10, pct: 0, mainPct: 0, floatCap: 1e10, mainInflow,volume:1e6,amount:1e8,
    quoteAt:at,receivedAt:at,quoteSource:'eastmoney',quoteMode:'public-live-unverified',canTrade:true,canNotify:true,
    fundsSource: 'eastmoney', fundsMethod: 'vendor-order-size-estimate',
    fundsRetrievedAt: at, fundsSourceTimestamp: null, ...extra};
}
function history(ctx, count = 12, interval = 5000, at = start) {
  return Array.from({length: count}, (_, i) => ctx.fundsHistoryObservation(stock(at + i * interval, i * 1e7), at + i * interval));
}

test('normal funds windows keep observed zero, signed deltas and independently unknown vendor time', () => {
  const c = context(), rows = history(c);
  assert.equal(rows[0].mainInflow, 0);
  assert.equal(rows[0].fundsSourceTimestamp, null);
  assert.equal(c.fundsWindowDelta(rows, 12, minute), 11e7);
  assert.equal(c.countStreak(rows), 1);
  for (const row of rows) row.mainInflow = 0;
  assert.equal(c.fundsWindowDelta(rows, 12, minute), 0);
  rows.at(-1).mainInflow = -100;
  assert.equal(c.fundsWindowDelta(rows, 12, minute), -100);
});

test('funds source and method changes invalidate a window independently of price source', () => {
  const c = context();
  for (const field of ['fundsSource', 'fundsMethod']) {
    const rows = history(c);
    rows[6][field] = 'other';
    assert.equal(c.fundsWindowDelta(rows, 12), null, field);
    assert.equal(c.countStreak(rows), 0, field);
  }
  const rows = history(c);
  rows.forEach((row, i) => { row.quoteSource = i % 2 ? 'tencent' : 'eastmoney'; });
  assert.equal(c.fundsWindowDelta(rows, 12, minute), 11e7);
});

test('missing funds, legacy histories and unknown provenance never authorize a pulse', () => {
  const c = context();
  for (const value of [null, undefined, NaN, Infinity, '0']) {
    const rows = history(c); rows[6].mainInflow = value;
    assert.equal(c.fundsWindowDelta(rows, 12), null);
  }
  for (const patch of [{fundsSource: null}, {fundsMethod: ''}, {fundsRetrievedAt: null}]) {
    const rows = history(c); Object.assign(rows[6], patch);
    assert.equal(c.fundsWindowDelta(rows, 12), null);
  }
  const old = Array.from({length: 12}, (_, i) => ({t: start + i * 5000, mainInflow: i * 1e7}));
  assert.equal(c.fundsWindowDelta(old, 12), null);
  assert.equal(c.countStreak(old), 0);
});

test('cross-day, time reversal, repeated observations and sampling gaps break continuity', () => {
  const c = context();
  for (const jump of [86400000, 120000, -5000, -10000]) {
    const rows = history(c);
    for (let i = 6; i < rows.length; i++) { rows[i].t += jump; rows[i].fundsRetrievedAt += jump; }
    assert.equal(c.fundsWindowDelta(rows, 12), null, String(jump));
    assert.equal(c.countStreak(rows), 0, String(jump));
  }
  const midnight = history(c, 12, 5000, Date.parse('2026-11-12T23:59:30+08:00'));
  assert.equal(c.fundsWindowDelta(midnight, 12), null);
  const rows = history(c); rows[6].fundsRetrievedAt = rows[5].fundsRetrievedAt;
  assert.equal(c.fundsWindowDelta(rows, 12), null);
});

test('known vendor timestamps cannot be future, stale, replayed or replaced with reception time', () => {
  const c = context();
  for (const offset of [1, -15001]) {
    const rows = history(c);
    rows.forEach(row => { row.fundsSourceTimestamp = row.fundsRetrievedAt + offset; });
    assert.equal(c.fundsWindowDelta(rows, 12), null);
  }
  const rows = history(c);
  rows.forEach(row => { row.fundsSourceTimestamp = row.fundsRetrievedAt - 1000; });
  assert.equal(c.fundsWindowDelta(rows, 12, minute), 11e7);
  rows[6].fundsSourceTimestamp = rows[5].fundsSourceTimestamp;
  assert.equal(c.fundsWindowDelta(rows, 12), null);
  rows[6].fundsSourceTimestamp = null;
  assert.equal(c.fundsWindowDelta(rows, 12), null);
  assert.equal(c.fundsWindowDelta(history(c), 12, minute), 11e7);
});

test('minute pulses enforce elapsed time while ten-minute retention keeps its own window', () => {
  const c = context();
  for (const interval of [1000, 10000]) assert.equal(c.fundsWindowDelta(history(c, 12, interval), 12, minute), null);
  const rows = history(c, 120);
  assert.equal(c.fundsWindowDelta(rows, rows.length), 119e7);
  assert.equal(c.fundsWindowDelta(rows, 12, minute), 11e7);
});

function monitor() {
  let now = start, response = [];
  class Clock extends Date { static now() { return now; } }
  const c = context({Date: Clock, console: {log() {}, error() {}}, monitorCodes: [],
    fs,path,__dirname:path.resolve(__dirname,'..'),process:{env:{V6_NEWS_EVIDENCE_DIR:path.join(os.tmpdir(),'v6-news-empty-'+process.pid+'-'+Math.random().toString(16).slice(2))}},
    require:productionRequire,Buffer,
    SignalEvidence:productionRequire('./src/core/signal-evidence-chain'),
    SIGNAL_RULE_SOURCE_MANIFEST:productionRequire('./src/core/signal-rule-manifest').buildSignalRuleSourceManifest(path.resolve(__dirname,'..')),
    S: {loop: {running: false, tickCount: 0}, candidatePool: [{code: '000001'}, {code: '000002'}],
      sectors: [], stocks: [], inflowHistory: new Map(), klines: new Map(),
      news: {goodCodes: new Set(), badCodes: new Set(),evidenceIntake:{status:'unknown'}}},
    PAPER: {pool: {positions: {}}, pre: {positions: {}}},
    em: {fetchBatchSnapshot: async () => { if (response instanceof Error) throw response; return response; }},
    ingestPx() {}, A: {isNearLimitUp: () => false, limitUpProbability: () => 0},
    numNeutral: (_, value) => value, sectorZTCountFor: () => 0, numGapRaw: () => 1,
    calibratedProb: value => value, probThreshold: () => 1, auctionPhase: () => 0,
    pushAll: () => assert.fail('no external notification allowed'),
    enqueueIntraday: () => assert.fail('fixture must not enqueue notifications')});
  vm.runInContext(section('const NEWS_EVIDENCE_ROOT=','const HOLIDAY_BUF_CAP'),c);
  for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','freezeRecommendationRows',
    'recommendationSendOptions','prepareRecommendationDelivery','signalCondition','annotateSignalConditions']){
    const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}\n',a);
    assert.ok(a>=0&&b>a,name);vm.runInContext(source.slice(a,b+2),c);
  }
  vm.runInContext(section('async function tick()', '\nfunction countStreak(h)'), c);
  return {c, async run(at, rows) { now = at; response = rows; await c.tick(); }};
}

for (const gap of ['omitted', 'fetch-failure', 'unknown', 'changed-source']) {
  test(`real tick clears the baseline after ${gap} and rearms only after a new valid window`, async () => {
    const {c, run} = monitor();
    for (let i = 0; i < 12; i++) {
      const at = start + i * 5000;
      await run(at, [stock(at, i), stock(at, i, {code: '000002'})]);
      assert.equal(c.S.loop.lastError, null);
    }
    const at = start + 60000;
    const one = gap === 'unknown' ? [stock(at, null)] : gap === 'changed-source' ? [stock(at, 5e7, {fundsSource: 'other'})] : [];
    await run(at, gap === 'fetch-failure' ? new Error('fixture outage') : [...one, stock(at, 12, {code: '000002'})]);
    assert.equal(c.S.loop.lastError, gap === 'fetch-failure' ? 'fixture outage' : null);
    if (gap === 'omitted' || gap === 'fetch-failure') assert.equal(c.S.inflowHistory.has('000001'), false);
    if (gap !== 'fetch-failure') assert.equal(c.S.inflowHistory.get('000002').length, 13);
    for (let i = 0; i < 12; i++) {
      const t = at + (i + 1) * 5000;
      await run(t, [stock(t, 5e7 + i), stock(t, 13 + i, {code: '000002'})]);
      assert.equal(c.S.loop.lastError, null);
      const rows = c.S.inflowHistory.get('000001');
      assert.equal(rows.length, i + 1);
      assert.equal(c.fundsWindowDelta(rows, 12, minute), i === 11 ? 11 : null);
    }
  });
}
