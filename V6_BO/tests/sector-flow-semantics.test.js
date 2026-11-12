'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../em.js'), 'utf8');
const receivedAt = Date.parse('2026-11-12T08:00:00Z');
function section(start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `missing parser section: ${start}`);
  return source.slice(begin, finish);
}
function parsers(response) {
  const context = vm.createContext({
    EM: 'https://eastmoney.invalid', EMH: 'https://eastmoney.invalid',
    Date: { now: () => receivedAt },
    get: async () => response, doGet: async () => response,
    curlGet: async () => response, _srcWarn: () => {},
    pool: async (items, worker) => Promise.all(items.map(worker))
  });
  vm.runInContext([
    section('function observedFlowNumber(', '// 板块成分股（'),
    section('async function fetchFundFlowDays(', '// curl 子进程 GET：'),
    section('async function fetchBatchFlowEM(', '// ---------- 备用数据源：'),
    'this.api = {fetchSectorFlow, fetchFundFlowDays, fetchBatchFlowEM, flowBalance};'
  ].join('\n'), context);
  return context.api;
}
function provenance(row) {
  assert.equal(row.source, 'eastmoney');
  assert.equal(row.upstream, 'eastmoney');
  assert.equal(row.fundsMethod, 'vendor-order-size-estimate');
  assert.equal(row.retrievedAt, receivedAt);
  assert.equal(row.sourceTimestamp, null);
  assert.equal(row.rawquoteAt, undefined);
  assert.equal(row.quoteAt, undefined);
}

test('sector parser separates advances, declines and order-size classes without inventing total members', async () => {
  const rows = await parsers({data: {diff: [{
    f12: 'BK1034', f14: '板块', f3: '1.25', f62: '300', f66: '200', f72: '100',
    f104: '7', f105: '3', f136: '9.5'
  }]}}).fetchSectorFlow(2);
  const row = rows[0];
  assert.equal(row.upCount, 7);
  assert.equal(row.downCount, 3);
  assert.equal(row.observedDirectionalCount, 10);
  assert.equal(row.totalCount, null);
  assert.equal(row.mainInflow, 300);
  assert.equal(row.superInflow, 200);
  assert.equal(row.bigInflow, 100);
  assert.equal(row.pct, 1.25);
  assert.equal(row.leaderPct, 9.5);
  provenance(row);
});

test('sector missing amounts and invalid counts stay unknown; observed zeros survive', async () => {
  for (const missing of [null, undefined, '', ' ', '-', 'NaN', Infinity, false, [], {}, '0x10']) {
    const [row] = await parsers({data: {diff: [{
      f62: missing, f66: missing, f72: missing, f3: missing, f136: missing,
      f104: 0, f105: missing
    }]}}).fetchSectorFlow(3);
    for (const field of ['mainInflow', 'superInflow', 'bigInflow', 'pct', 'leaderPct', 'downCount', 'observedDirectionalCount'])
      assert.equal(row[field], null, field);
    assert.equal(row.upCount, 0);
  }
  for (const invalidCount of [-1, 1.5, '2.5']) {
    const [row] = await parsers({data: {diff: [{f104: invalidCount, f105: 0}]}}).fetchSectorFlow(2);
    assert.equal(row.upCount, null);
    assert.equal(row.downCount, 0);
    assert.equal(row.observedDirectionalCount, null);
  }
  const [zero] = await parsers({data: {diff: [{f62: '0', f66: 0, f72: '0.0', f104: 0, f105: '0'}]}}).fetchSectorFlow(2);
  for (const field of ['mainInflow', 'superInflow', 'bigInflow', 'upCount', 'downCount', 'observedDirectionalCount'])
    assert.equal(zero[field], 0);
  assert.equal(zero.totalCount, null);
});

test('daily fund-flow parser preserves missing slots instead of manufacturing zero', async () => {
  const rows = await parsers({data: {klines: [
    '2026-11-11,-,, ,NaN',
    '2026-11-12,0,0.0,-10,2.5,7.5'
  ]}}).fetchFundFlowDays('600000', 2);
  for (const field of ['main', 'small', 'mid', 'big', 'super']) assert.equal(rows[0][field], null, field);
  assert.equal(rows[0].date, '2026-11-11');
  assert.equal(rows[1].main, 0);
  assert.equal(rows[1].small, 0);
  assert.equal(rows[1].mid, -10);
  assert.equal(rows[1].big, 2.5);
  assert.equal(rows[1].super, 7.5);
  rows.forEach(provenance);
});

test('batch fund-flow parser distinguishes every missing field from genuine zero', async () => {
  const mapping = {f62: 'today', f164: 'd5', f174: 'd10', f184: 'pct',
    f66: 'superNet', f69: 'superPct', f72: 'bigNet', f75: 'bigPct',
    f78: 'midNet', f81: 'midPct', f84: 'smallNet', f87: 'smallPct'};
  for (const value of [null, undefined, '-', '', ' ', false, 0, '0', '-12.5']) {
    const record = Object.fromEntries(Object.keys(mapping).map(field => [field, value]));
    const [row] = await parsers({data: {diff: [{f12: '000001', ...record}]}}).fetchBatchFlowEM(['000001']);
    const expected = value === 0 || value === '0' ? 0 : value === '-12.5' ? -12.5 : null;
    for (const field of Object.values(mapping)) assert.equal(row[field], expected, field);
    provenance(row);
  }
});

test('missing balance evidence cannot become a directional or flat classification', () => {
  const {flowBalance} = parsers({});
  for (const field of ['superNet', 'bigNet', 'midNet', 'smallNet']) {
    for (const value of [undefined, null, '-', '', false]) {
      const result = flowBalance({superNet: -70, bigNet: -30, midNet: 60, smallNet: 40, [field]: value});
      assert.equal(result.dir, 'unknown');
      assert.equal(result.consistent, null);
      assert.equal(result[field], null);
    }
  }
  assert.equal(flowBalance().dir, 'unknown');
  assert.equal(flowBalance(null).dir, 'unknown');
});

test('complete balance evidence retains classifications and uses order-size descriptions', () => {
  const {flowBalance} = parsers({});
  const cases = [
    [[100, 50, -100, -50], 'in'], [[-100, -50, 100, 50], 'out'],
    [[-10, 100, -50, -40], 'mixed'], [[-100, 10, 50, 40], 'mixed'],
    [[10, -100, 50, 40], 'mixed'], [[0, 0, 0, 0], 'flat'],
    [[100, 100, 100, 100], 'unknown']
  ];
  for (const [values, direction] of cases) {
    const result = flowBalance(Object.fromEntries(['superNet', 'bigNet', 'midNet', 'smallNet'].map((field, index) => [field, values[index]])));
    assert.equal(result.dir, direction);
    assert.equal(result.consistent, direction !== 'unknown');
    assert.doesNotMatch(result.label, /机构|顶级|散户|出货|接盘|资金出逃/);
  }
});
