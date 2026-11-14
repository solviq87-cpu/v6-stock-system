'use strict';
// The real static-page ledger handlers are executed in a no-network VM.
// This file is automatically picked up by npm test and the dedicated CI gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../V6_WEB/workbuddy/index.html'), 'utf8');
const begin = source.indexOf('async function readRemote(){');
const end = source.indexOf('async function commit(change,message){', begin);
assert.ok(begin > 0 && end > begin, 'actual cloud functions must remain available');
const handlers = source.slice(begin, end);

function fixture({ rows = [], allow = false, ignorePosts = false, failGet = false, corrupt = false, cached = null } = {}) {
  let records = rows.map(record => ({ ...record }));
  let writes = 0;
  const cache = new Map();
  if (cached !== null) cache.set('v6:last-confirmed-state', JSON.stringify(cached));
  const state = () => ({ revision: 0, updatedAt: '2026-11-14T00:00:00.000Z', initialCash: 1000000,
    cash: 1000000, realized: 0, positions: [], orders: [], picks: {}, signalHistory: [], risk: {} });
  const context = {
    KEY: 'v6.app.state', LOCAL_KEY: 'v6:last-confirmed-state',
    bootstrapPermission: false, ready: false, busy: false, cloud: false,
    cloudError: '', state: state(), lastConnection: null,
    C: { createDefaultState: state, normalizeState: value => {
      if (!value || value.invalid) throw new Error('invalid-state');
      return JSON.parse(JSON.stringify(value));
    }, strategies: [], selectStocks: () => [] },
    async api(route, method = 'GET', body) {
      assert.equal(route, 'records');
      if (method === 'GET') {
        if (failGet) throw new Error('数据接口返回 HTTP 404');
        return { ok: true, records, allowCreateInitialState: allow };
      }
      assert.equal(method, 'POST');
      writes++;
      const entry = { ...body, id: 'fixture-account' };
      if (!ignorePosts) {
        const index = records.findIndex(row => row.name === body.name);
        if (index >= 0) records[index] = entry; else records.push(entry);
      }
      return { ok: true, record: entry };
    },
    restoreSharedMarket: async () => {},
    localStorage: { getItem: key => cache.get(key) || null, setItem: (key,value) => cache.set(key,value) },
    $: () => ({ disabled: false }),
    connection(status,message) { context.lastConnection = { status, message }; },
    screeningFromMarket() {}, render() {},
  };
  vm.runInNewContext(handlers + '\nthis.cloudHandlers={initialize,readRemote,writeRemote};', context,
    { filename: 'V6_WEB/workbuddy/index.html:real-cloud-handlers', timeout: 1000 });
  return { context, records: () => records, get writes() { return writes; },
    initialize: () => context.cloudHandlers.initialize() };
}

test('empty records without explicit server bootstrap contract stays read-only and never writes', async () => {
  const f = fixture();
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.context.cloud, false);
  assert.equal(f.context.lastConnection.status, 'error');
  assert.match(f.context.cloudError, /禁止自动新建/);
});

test('other records must not be mistaken for an empty newly authorized V6 account', async () => {
  const f = fixture({ rows: [{ name: 'v6.news.pool', content: '{}' }], allow: true });
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.records().length, 1);
  assert.match(f.context.cloudError, /禁止自动新建/);
});

test('a valid existing ledger is read without a new initialization write', async () => {
  const value = { revision: 8, updatedAt: '2026-11-13T00:00:00.000Z',
    cash: 900000, positions: [], orders: [], picks: {}, signalHistory: [], risk: {} };
  const f = fixture({ rows: [{ name: 'v6.app.state', content: JSON.stringify(value) }] });
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.context.cloud, true);
  assert.equal(f.context.state.cash, 900000);
  assert.equal(f.context.state.revision, 8);
});

test('corrupted existing ledger is not reset or overwritten', async () => {
  const f = fixture({ rows: [{ name: 'v6.app.state', content: '{"unclosed":' }] });
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.context.cloud, false);
  assert.match(f.context.cloudError, /内容损坏/);
});

test('missing API keeps cached state read-only; it cannot fabricate cloud synchronization', async () => {
  const cache = { revision: 5, cash: 1200000, positions: [], orders: [],
    picks: {}, signalHistory: [], risk: {} };
  const f = fixture({ failGet: true, cached: cache });
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.context.cloud, false);
  assert.equal(f.context.state.revision, 5);
  assert.match(f.context.cloudError, /HTTP 404/);
});

test('only an explicitly authorized empty fixture can initialize; POST must be verified by GET', async () => {
  const f = fixture({ allow: true });
  await f.initialize();
  assert.equal(f.writes, 1);
  assert.equal(f.context.cloud, true);
  assert.equal(f.records()[0].name, 'v6.app.state');
  assert.equal(f.context.lastConnection.status, 'ok');
});

test('HTTP-success without persisted content fails closed after readback and never marks synced', async () => {
  const f = fixture({ allow: true, ignorePosts: true });
  await f.initialize();
  assert.equal(f.writes, 1);
  assert.equal(f.context.cloud, false);
  assert.match(f.context.cloudError, /一致性读回/);
});

test('a changed or missing persisted revision is not accepted as a successful write', async () => {
  const value = { revision: 5, updatedAt: '2026-11-14T00:00:00.000Z', cash: 100,
    positions: [], orders: [], picks: {}, signalHistory: [], risk: {} };
  const f = fixture({ rows: [{ name: 'v6.app.state', content: JSON.stringify(value) }], ignorePosts: true });
  await assert.rejects(() => f.context.cloudHandlers.writeRemote({ ...value, revision: 6 }),
    /一致性读回/);
  assert.equal(f.writes, 1);
});

test('duplicate V6 ledger records fail closed without choosing the last row or overwriting either', async () => {
  const first = { revision: 8, cash: 800000, positions: [], orders: [],
    picks: {}, signalHistory: [], risk: {} };
  const second = { ...first, revision: 9, cash: 600000 };
  const rows = [
    { id: 'historical-A', name: 'v6.app.state', content: JSON.stringify(first) },
    { id: 'historical-B', name: 'v6.app.state', content: JSON.stringify(second) }
  ];
  const f = fixture({ rows, allow: true });
  await f.initialize();
  assert.equal(f.writes, 0);
  assert.equal(f.context.cloud, false);
  assert.equal(f.context.lastConnection.status, 'error');
  assert.match(f.context.cloudError, /多条同名模拟账本/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.records())), rows);
});
