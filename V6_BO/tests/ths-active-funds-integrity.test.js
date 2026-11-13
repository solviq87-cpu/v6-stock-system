'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../em.js'), 'utf8');
const retrievedAt = Date.parse('2026-11-13T02:00:00Z');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function api(records) {
  const calls = [];
  const ctx = vm.createContext({THS_HEAD: 'https://ths.invalid/', Date: {now: () => retrievedAt},
    thsGet: async url => {
      const code = url.match(/\/(\d{6})\/last\.js$/)[1];
      calls.push(code);
      return `quotebridge_v6_realhead_hs_${code}_last(${JSON.stringify({items: records[code]})})`;
    },
    pool: async (items, worker) => Promise.all(items.map(worker))});
  vm.runInContext(section('function observedFlowNumber(', 'function flowProvenance(') +
    section('async function fetchThsActive(code)', '// mj：全 A 官方行业拉取') +
    '\nthis.api = {fetchThsActive, fetchThsActiveBatch};', ctx);
  return {...ctx.api, calls};
}
const valid = () => ({'14': 70, '15': 30, '13': 100, '19': 1000, '10': 10});

test('THS active-flow missing inputs stay unknown instead of inventing a net direction', async () => {
  for (const field of ['14', '15', '13', '19']) {
    for (const value of [null, undefined, '', ' ', '-', 'NaN', Infinity, false, [], {}, '0x10', -1]) {
      const row = await api({'000001': {...valid(), [field]: value}}).fetchThsActive('000001');
      assert.equal(row.netAmt, null, `${field}=${String(value)}`);
      assert.equal(row.activePct, null, `${field}=${String(value)}`);
    }
  }
});

test('THS observed equal active sides preserve genuine zero in single and deduplicated batch reads', async () => {
  const input = api({'000001': {...valid(), '14': '50', '15': '50'}});
  const row = await input.fetchThsActive('000001');
  assert.equal(row.netAmt, 0);
  assert.equal(row.activePct, 0);
  const result = await input.fetchThsActiveBatch(['000001', '000001']);
  assert.equal(result.size, 1);
  assert.equal(result.get('000001').netAmt, 0);
  assert.equal(input.calls.length, 2, 'one direct call and one unique batch call');
});

test('THS explicit zero activity is known zero but a zero-denominator percentage stays unknown', async () => {
  const input = api({'000001': {'14': 0, '15': '0', '13': 0, '19': '0', '10': 0}});
  const row = await input.fetchThsActive('000001');
  assert.equal(row.netAmt, 0);
  assert.equal(row.activePct, null);
  assert.equal(row.price, 0);
  assert.equal((await input.fetchThsActiveBatch(['000001'])).size, 1);
  const missing = await api({'000001': {'14': 0, '15': 0, '19': 0}}).fetchThsActive('000001');
  assert.equal(missing.netAmt, null);
});

test('THS uses observed amount and volume rather than last price to manufacture a missing average', async () => {
  for (const price of [0, null, undefined, 999]) {
    const row = await api({'000001': {...valid(), '10': price}}).fetchThsActive('000001');
    assert.equal(row.netAmt, 400);
    assert.equal(row.activePct, 40);
  }
  for (const patch of [{'13': 0}, {'19': 0}, {'13': 0, '19': 0}]) {
    const row = await api({'000001': {...valid(), ...patch}}).fetchThsActive('000001');
    assert.equal(row.netAmt, null);
    assert.equal(row.activePct, null);
  }
  const overflow = await api({'000001': {...valid(), '14': 1000, '15': 0, '13': 1, '19': 1e308}}).fetchThsActive('000001');
  assert.equal(overflow.netAmt, null);
  assert.equal(overflow.activePct, null);
});

test('THS batch retains observed zero and signed estimates while excluding unknown calculations', async () => {
  const input = api({'000001': {...valid(), '14': 50, '15': 50},
    '000002': {...valid(), '14': 30, '15': 70},
    '000003': {...valid(), '14': null}});
  const result = await input.fetchThsActiveBatch(['000001', '000002', '000003']);
  assert.equal(result.size, 2);
  assert.equal(result.get('000001').netAmt, 0);
  assert.equal(result.get('000002').netAmt, -400);
  assert.equal(result.has('000003'), false);
});

test('THS estimate provenance never treats receipt time or price as a supplier funds timestamp', async () => {
  const row = await api({'000001': valid()}).fetchThsActive('000001');
  assert.equal(row.source, 'ths');
  assert.equal(row.upstream, 'ths');
  assert.equal(row.fundsMethod, 'vendor-active-order-estimate');
  assert.equal(row.retrievedAt, retrievedAt);
  assert.equal(row.sourceTimestamp, null);
  assert.equal(row.quoteAt, undefined);
});
