'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createFixture } = require('./helpers/v6-studio-fixture');
const at = (s) => Date.parse('2026-11-16T' + s + '+08:00');
test(
  'real desktop/mobile state and card APIs retain last preclose frame while review/relay remain current',
  { timeout: 45000 },
  async (t) => {
    const f =
      await require('./helpers/closing-market-fixture').createClosingFixture();
    t.after(() => f.close());
    // f.close must run before removing its external virtual-clock file.
    const first = await f.request('/api/state');
    assert.equal(first.body.pool[0].price, 1, JSON.stringify(first.body));
    assert.equal(first.body.trading, true);
    assert.equal(first.body.fastStockMoves.items[0].code, '600009');
    const viewer = await f.request('/api/state', 'GET', null, f.viewerToken);
    assert.equal(viewer.body.fastStockMoves.items[0].code, '600000');
    assert.equal(viewer.body.fastStockMoves.requested, 1);
    const mobile = await f.request('/api/mobile-digest');
    assert.equal(mobile.body.dashboard.rows[0].price, 1);
    // Preseal is a market card that can be observed before close; its auth is retained.
    const preseal = await f.request('/api/preseal');
    assert.equal(preseal.status, 200);
    assert.equal(preseal.body.day, '20261116');
    f.setTime('14:59:50');
    const last = await f.request('/api/state');
    assert.equal(last.body.pool[0].price, 2);
    await f.request('/api/mobile-digest');
    f.setTime('15:00:00');
    const closed = await f.request('/api/state'),
      other = await f.request('/api/state');
    for (const value of [closed.body, other.body]) {
      assert.equal(value.pool[0].price, 2);
      assert.equal(value.global[0].price, 2);
      assert.equal(value.dashboard.rows[0].price, 2);
      assert.equal(value.review.value, 99);
      assert.equal(value.yierList[0].price, 99);
      assert.equal(value.lianbanList[0].price, 99);
      assert.equal(value.trading, false);
      assert.equal(value.marketFrozen, true);
      assert.equal(value.canTrade, false);
      assert.equal(value.snapshotCapturedAt, at('14:59:50'));
    }
    const phone = await f.request('/api/mobile-digest');
    assert.equal(phone.body.dashboard.rows[0].price, 2);
    assert.equal(phone.body.snapshotDay, '20261116');
    assert.equal(closed.body.fastStockMoves.items[0].code, '600009');
    const closedViewer = await f.request('/api/state', 'GET', null, f.viewerToken);
    assert.equal(closedViewer.body.fastStockMoves.items[0].code, '600000');
    assert.equal(closedViewer.body.fastStockMoves.requested, 1);
    assert.equal(closedViewer.body.privateFastStockMoves, undefined);
    for (const route of [
      'quant-picks',
      'auction-resonance',
      'intraday-strong',
      'wash-trend',
      'shortline',
    ]) {
      const r = await f.request('/api/' + route + '?force=1');
      assert.equal(r.body.marketFrozen, true, route);
      assert.equal(r.body.canTrade, false);
      assert.equal(
        r.body.freezeUnavailable,
        true,
        'missing ' +
          route +
          ' is explicit; never trigger a new after-close scan',
      );
    }
    const frozenPreseal = await f.request('/api/preseal');
    assert.deepEqual(frozenPreseal.body.items, preseal.body.items);
    assert.equal(frozenPreseal.body.marketFrozen, true);
    const refresh = await f.request('/api/refresh', 'POST', { module: 'pool' });
    assert.equal(refresh.body.ok, true);
    assert.equal(refresh.body.marketFrozen, true);
    const privateRead = await f.request(
      '/api/preseal',
      'GET',
      null,
      f.viewerToken,
    );
    assert.equal(privateRead.body.locked, true);
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(f.tmp, 'data', 'closing-card-snapshots.json'),
        'utf8',
      ),
    );
    assert.equal(saved.entries['state:all'].value.pool[0].price, 2);
    assert.equal(saved.entries['state:all'].capturedAt, at('14:59:50'));
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(f.token));
    assert.doesNotMatch(JSON.stringify(saved), /仅模拟持仓夹具/);
  },
);
