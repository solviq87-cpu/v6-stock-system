'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const contract = require('../src/core/probability-contract');
function grab(start, end = '\n}\n') {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b >= a, start);
  return source.slice(a, b + end.length);
}
const historicalHarness = fs.readFileSync(require.resolve('../_test_empcalib.js'), 'utf8');
const prefix = historicalHarness.slice(0, historicalHarness.indexOf('// 造信号：')) + '\nthis.parts = parts;';
const ctx = {require: name => name === 'fs' ? {readFileSync: () => source} : require(name)};
vm.runInNewContext(prefix, ctx);
const actual = ctx.parts.join('\n') + '\n' + grab('function empInfo(prob, type, target) {') +
  '\n' + grab('const LA_DELTA_CAP =', '\n') + '\n' + grab('function fusedProb(') +
  '\n' + grab('function fuseLine(x) {') + '\n' + grab('function calibratedProb(p) {');
function api(signals = [], shape = null) {
  const calls = [];
  const state = {learn: {signals, buckets: {'55-64': {corr: .2}, '<70': {corr: .2}, '80-84': {corr: .1}}}};
  const functions = new Function('S', 'probabilityContract', 'laProbCached', 'laWhy', actual +
    '\nreturn {empTable,empInfo,fusedProb,fuseLine,calibratedProb,probKindOf};')(
    state, contract, (...args) => {calls.push(args[3]); return shape;}, () => 'fixture pattern');
  return {...functions, calls};
}
function signals(type, prob, patch = {}) {
  return Array.from({length: 20}, (_, i) => ({type, prob,
    date: '202611' + String(i % 5 + 2).padStart(2, '0'),
    nd: {hit: true, limitUp: i < 4, quality: 'fake'}, ...patch}));
}

test('empInfo transports real zero and all quality rates without converting quality into another event', () => {
  const x = api(signals('bigmoney', 60));
  const info = x.empInfo(60, 'bigmoney');
  assert.equal(info.realRate, 0);
  assert.equal(info.fakeRate, 100);
  assert.equal(info.strongRate, 0);
  assert.equal(info.okRate, 0);
  assert.equal(info.qualityN, 20);
  assert.equal(info.target, 'up3Next');
  const result = x.fusedProb('600000', 'fixture', [], 'bigmoney', 60);
  assert.equal(result.prob, 60, 'next-day hit rate cannot correct a same-day sealing model');
  assert.equal(result.emp, null);
  assert.equal(result.empReal, 0);
  assert.equal(result.empFake, 100);
  assert.equal(result.target, 'ztToday');
  assert.equal(result.calibrationCertified, false);
});

test('same-day auction cannot borrow next-day shape and the final result keeps the 45 ceiling', () => {
  const x = api([], {p: .5, base: .1});
  const result = x.fusedProb('600000', 'fixture', [], 'auczt', 45);
  assert.equal(result.prob, 45);
  assert.deepEqual(x.calls, []);
  assert.equal(result.target, 'ztToday');
  assert.equal(result.valueKind, 'model-estimate');
  assert.equal(x.fusedProb('600000', 'fixture', [], 'auczt', 99).prob, 45);
});

test('conflicting explicit event targets fail closed rather than overriding the model event', () => {
  const x = api([], {p: .9, base: .1});
  for (const target of ['up3', 'zt', 'unknown']) {
    const result = x.fusedProb('600000', 'fixture', [], 'auczt', 45, target);
    assert.equal(result.target, null);
    assert.equal(result.prob, 45);
  }
  assert.deepEqual(x.calls, []);
});

test('next-day sealing uses only next-day sealing frequencies and the matching shape target', () => {
  const x = api(signals('yier', 60), {p: .5, base: .1});
  const info = x.empInfo(60, 'yier', 'ztNext');
  assert.equal(info.rate, 100, 'separate up3 diagnostic stays available');
  assert.equal(info.targetRate, 20);
  const result = x.fusedProb('600000', 'fixture', [], 'yier', 60);
  assert.deepEqual(x.calls, ['zt']);
  assert.equal(result.emp, 20);
  assert.equal(result.prob, 45, 'same-event sealing frequency keeps the existing fusion weights and penalties');
  assert.equal(result.target, 'ztNext');
  assert.equal(result.valueKind, 'ranking-score');
  assert.equal(result.calibrationCertified, false);
  assert.match(x.fuseLine({_fz: result}), /研究排序分/);
  assert.doesNotMatch(x.fuseLine({_fz: result}), /学后胜率|已校准/);
});

test('score producers never borrow frequency buckets or shape probabilities', () => {
  const x = api(signals('pre', 80), {p: .9, base: .1});
  for (const type of ['pool', 'trend', 'pre']) {
    const result = x.fusedProb('600000', 'fixture', [], type, 80);
    assert.equal(x.probKindOf(type), 'score');
    assert.equal(result.prob, 80);
    assert.equal(result.valueKind, 'score');
    assert.equal(result.target, null);
    assert.equal(result.emp, null);
  }
  assert.deepEqual(x.calls, []);
});

test('unknown production types keep target unknown and are not silently assigned next-day up3', () => {
  const x = api([], {p: .9, base: .1});
  const result = x.fusedProb('600000', 'fixture', [], 'future-new-type', 60);
  assert.equal(result.prob, 60);
  assert.equal(result.target, null);
  assert.deepEqual(x.calls, []);
});

test('next-day data cannot become a missing auction same-day failure', () => {
  const x = api(signals('auczt', 20));
  const table = x.empTable();
  assert.equal(table['auczt|<45'], undefined);
  assert.equal(table['auczt-nd|<45'].n, 20);
  assert.equal(x.empInfo(20, 'auczt', 'ztToday'), null);
});

test('missing limit-up outcomes have their own denominator and do not become observed zero', () => {
  const rows = signals('yier', 60);
  rows.forEach(row => { delete row.nd.limitUp; });
  const x = api(rows), bucket = x.empTable()['未启动类|55-64'];
  assert.equal(bucket.rate, 100);
  assert.equal(bucket.luRate, null);
  assert.equal(bucket.luN, 0);
  assert.equal(x.empInfo(60, 'yier', 'ztNext'), null);
  assert.equal(x.fusedProb('600000', 'fixture', [], 'yier', 60).emp, null);
});

test('missing quality remains unknown and observed zero is retained', () => {
  const rows = signals('trendsig', 60);
  rows.forEach(row => { delete row.nd.quality; row.nd.hit = false; row.nd.limitUp = false; });
  const x = api(rows), info = x.empInfo(60, 'trendsig');
  assert.equal(info.realRate, null);
  assert.equal(info.fakeRate, null);
  assert.equal(info.qualityN, 0);
  assert.equal(info.targetRate, 0);
  const result = x.fusedProb('600000', 'fixture', [], 'trendsig', 60);
  assert.equal(result.emp, 0);
  assert.doesNotMatch(result.src, /undefined|NaN/);
});

test('quality diagnostics remain independent when an event outcome is unavailable', () => {
  const rows = signals('bigmoney', 60);
  rows.forEach(row => { delete row.nd.hit; delete row.nd.limitUp; });
  const x = api(rows), result = x.fusedProb('600000', 'fixture', [], 'bigmoney', 60);
  assert.equal(result.emp, null);
  assert.equal(result.empReal, 0);
  assert.equal(result.empFake, 100);
  assert.equal(result.empQualityN, 20);
  assert.equal(result.empQualityTarget, 'qualityNext');
  assert.equal(result.prob, 60);
});

test('invalid calendar dates cannot satisfy cross-day empirical evidence', () => {
  const rows = signals('trendsig', 60);
  rows.forEach((row, i) => { row.date = '202613' + String(i % 5 + 1).padStart(2, '0'); });
  const x = api(rows);
  assert.equal(x.empInfo(60, 'trendsig'), null);
  assert.equal(x.fusedProb('600000', 'fixture', [], 'trendsig', 60).emp, null);
});

test('actual relay scanners and push builders carry the sealing target and display research values', () => {
  const x = api([], {p: .9, base: .1});
  const ztPool = [1, 2, 3, 7].map((level, i) => ({code: '60000' + i, name: 'fixture' + i, sector: '技术',
    limitUpCount: level, price: 10, pct: 10, amount: 1e9, sealAmount: 2e8,
    floatCap: 1e10, turnover: 5, breakCount: 0}));
  const state = {ztPool, ztBySector: {'技术': ztPool}, klines: new Map(), stocks: [], news: {}};
  const dependencies = {S: state, A: require('../analysis'), todayBeta: () => 0,
    classifySectorRoles: () => ({map: new Map(ztPool.map(z => [z.code, 'leader']))}),
    themeStrengthOf: () => ({theme: '技术', score: 50, grade: '中', inflowSum: 0, sectorZT: 4, maxLb: 7, roleScore: 20}),
    isMainlineStock: () => ({ok: true, reason: 'fixture'}), krowsOf: () => [], fusedProb: x.fusedProb,
    ZT_INFER_PUSH_PROB: 18, todayStr: () => '20261113', empTable: x.empTable, HIT_THR: 3,
    fuseLine: x.fuseLine};
  const production = new Function(...Object.keys(dependencies), grab('function scanYiEr() {') +
    grab('function scanLianbanRelay() {') + grab('function buildYiErMessage(items) {') +
    grab('function buildLianbanRelayMessage(items) {') +
    '\nreturn {scanYiEr,scanLianbanRelay,buildYiErMessage,buildLianbanRelayMessage};')(...Object.values(dependencies));
  const first = production.scanYiEr(), relay = production.scanLianbanRelay();
  assert.equal(first.length, 1);
  assert.equal(relay.length, 2);
  assert.deepEqual(x.calls, ['zt', 'zt', 'zt']);
  for (const row of first.concat(relay)) {
    assert.equal(row.eventTarget, 'ztNext');
    assert.equal(row.probKind, 'model-estimate');
    assert.equal(row.fusedKind, 'ranking-score');
    assert.equal(row.calibrationCertified, false);
    assert.equal(row._fz.model, row.prob);
    assert.equal(row._fz.prob, row.fused);
    assert.ok(Math.abs(row.fused - row.prob) <= 12, 'the original shape cap stays in force');
  }
  for (const message of [production.buildYiErMessage(first), production.buildLianbanRelayMessage(relay)]) {
    assert.match(message, /次日封板研究排序值/);
    assert.match(message, /未独立校准|未经独立样本外校准/);
    assert.doesNotMatch(message, /次日涨停概率|学后胜率|概率经历史回验校准/);
  }
});

test('the actual intraday report does not relabel a copied same-day model as next-day up3', () => {
  const x = api([], {p: .9, base: .1});
  const report = new Function('probDef', 'fuseLine', 'stopRefNote', grab('function buildAlertsReport(list, opt) {') +
    '\nreturn buildAlertsReport;')(contract.label, x.fuseLine, () => '');
  const fz = x.fusedProb('600000', 'fixture', [], 'ztprob', 60);
  const message = report([{type: '后排涨停概率', name: 'fixture', code: '600000', price: 10, pct: 3,
    prob: 60, riseProb: 60, _fz: fz}], {});
  assert.match(message, /当日封板模型估值 60%/);
  assert.doesNotMatch(message, /次日最高涨≥3%|学后胜率/);
});

test('the real governance gate keeps its up3 accuracy floor within that event', () => {
  const seal = signals('yier', 60), up3 = signals('trendsig', 80);
  up3.forEach(row => { row.nd.hit = false; });
  const x = api(seal.concat(up3), {p: .5, base: .1});
  const state = {klines: new Map()}, governance = {codes: new Map(), lowProb: 0, total: 0};
  const dependencies = {S: state, PUSH_GOV: governance, govResetIfNewDay: () => {},
    reviewRecommendation: row => require('../src/core/recommendation-evidence-review').reviewRecommendationEvidence(row, {purpose:'intraday-recommendation'}),
    _govCfg: () => 0, pushMinProb: () => 0, pushMinProbPre: () => 0,
    fusedProb: x.fusedProb, krowsOf: () => [], pushQuota: () => 100,
    PUSH_GOV_RESERVE: .2, savePushGov: () => {}};
  const gate = new Function(...Object.keys(dependencies), grab('function govTake(code, type, strong, prob, row) {') +
    '\nreturn govTake;')(...Object.values(dependencies));
  const row = code => ({code,name:'正常股票',price:10,quoteAt:Date.now()-100,receivedAt:Date.now(),quoteSource:'vendor-original',mode:'public-live-unverified',canNotify:true,amount:1e8});
  const sealing = gate('600000', 'yier', false, 60, row('600000')), gains = gate('600001', 'trendsig', false, 80, row('600001'));
  assert.equal(sealing.ok, true, '35 percent up3 evidence is not a sealing-event floor');
  assert.equal(sealing.fused.target, 'ztNext');
  assert.equal(gains.ok, false);
  assert.equal(gains.fused.target, 'up3Next');
  assert.match(gains.why, /准确率门槛 35%/);
});

test('the historical comparison report separates sealing and gain events and preserves unknown outcomes', () => {
  const rows = signals('trendsig', 60).concat(signals('yier', 60), signals('pre', 60),
    signals('auczt', 20, {resolved: {limitUp: false, hit: true}}));
  rows.forEach(row => { row.fused = row.prob; });
  const dependencies = {S: {learn: {signals: rows}}, probabilityContract: contract,
    isLiveSample: () => true, empBucketOf: n => n < 45 ? '<45' : '55-64', EMP_BUCKETS: ['<45', '55-64']};
  const report = new Function(...Object.keys(dependencies), grab("function learnFusedReport(target = 'up3Next') {") +
    '\nreturn learnFusedReport;')(...Object.values(dependencies));
  const gain = report(), seal = report('ztNext'), today = report('ztToday');
  assert.equal(gain.fusedN, 20);
  assert.equal(gain.target, 'up3Next');
  assert.equal(gain.rows[1].fusedRate, 100);
  assert.equal(seal.rows[1].fusedRate, 20);
  assert.equal(today.rows[0].fusedRate, 0);
  assert.equal(gain.calibrationCertified, false);
  assert.equal(gain.independentHoldout, false);
  rows.filter(row => row.type === 'yier').forEach(row => { delete row.nd.limitUp; });
  assert.equal(report('ztNext').fusedN, 0);
});

test('the legacy calibration entry preserves the bounded model instead of consuming mixed-target corr', () => {
  const x = api();
  assert.equal(x.calibratedProb(80), 80);
  assert.equal(x.calibratedProb(60), 60);
  assert.equal(x.calibratedProb(null), null);
  assert.equal(x.calibratedProb(NaN), null);
});
