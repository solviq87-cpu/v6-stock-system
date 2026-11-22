'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const {
  createClosingCardSnapshot,
  beforeClose,
} = require('../src/core/closing-card-snapshot');
const at = (s) => Date.parse('2026-11-16T' + s + '+08:00'),
  day = '20261116';
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closing-card-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = at('14:59:40');
  const file = path.join(root, 'cards.json'),
    errors = [];
  return {
    file,
    errors,
    set: (v) => (now = v),
    context: () => ({
      sourceDay: day,
      session: { day, trading: beforeClose(now) },
    }),
    open: () =>
      createClosingCardSnapshot({
        file,
        clock: () => now,
        onError: (e) => errors.push(e),
      }),
  };
}
const frame = (n) => ({
  pool: [{ code: '600001', price: n, quoteAt: at('14:59:30') }],
  global: [{ code: 'test', price: n }],
  dashboard: {
    rows: [{ code: '600001', price: n }],
    indices: [{ price: n }],
    counts: { candidates: n },
    pushes: { items: [{ title: 'private-push' }] },
  },
  paper: { cash: n },
  news: { items: [{ title: 'news-' + n }] },
  review: { date: day, value: n },
  yierList: [{ code: '600002', price: n }],
  lianbanList: [{ code: '600003', price: n }],
});
test('15:00 is a strict close boundary, including UTC-hosted market clocks', () => {
  for (const [s, want] of [
    ['09:14:59', false],
    ['09:15:00', true],
    ['11:31:00', false],
    ['13:00:00', true],
    ['14:59:59', true],
    ['15:00:00', false],
    ['15:40:00', false],
  ])
    assert.equal(beforeClose(at(s)), want, s);
});
test('same-day populated post-close changes cannot replace any saved market card; exceptions stay current', (t) => {
  const x = setup(t),
    s = x.open();
  s.project('state', frame(1), x.context());
  x.set(at('14:59:50'));
  s.project('state', frame(2), x.context());
  x.set(at('15:00:00'));
  const r = s.project('state', frame(99), x.context());
  assert.equal(r.pool[0].price, 2);
  assert.equal(r.dashboard.rows[0].price, 2);
  assert.equal(r.global[0].price, 2);
  assert.equal(r.review.value, 99);
  assert.equal(r.yierList[0].price, 99);
  assert.equal(r.lianbanList[0].price, 99);
  assert.equal(r.paper.cash, 99);
  assert.equal(r.news.items[0].title, 'news-99');
  assert.equal(r.dashboard.pushes.items[0].title, 'private-push');
  assert.equal(r.pool[0].quoteAt, at('14:59:30'));
  assert.equal(r.snapshotCapturedAt, at('14:59:50'));
  assert.equal(r.canTrade, false);
  assert.equal(r.canNotify, false);
});
test('post-close index uses later original observation while candidate evidence remains frozen', (t) => {
  const x=setup(t),s=x.open();
  const index=(price,time,extra={})=>({code:'1.000001',price,pct:-.5,quoteSource:'tencent-index',quoteAt:at(time),receivedAt:at(time),...extra});
  s.project('state',{...frame(1),dashboard:{indices:[index(3578.46,'14:59:30')]}},x.context());
  x.set(at('18:00:00'));
  const current={...frame(99),dashboard:{indices:[index(3584.58,'15:00:00')]}};
  const out=s.project('state',current,x.context());
  assert.equal(out.dashboard.indices[0].price,3584.58);
  assert.equal(out.dashboard.indices[0].quoteAt,at('15:00:00'));
  assert.equal(out.pool[0].price,1);
  assert.equal(out.dashboard.indices[0].canTrade,false);
  assert.equal(out.dashboard.indices[0].quoteStatus,'stale');
  assert.equal(out.dashboard.indices[0].quoteAgeMs,3*60*60*1000);
  assert.equal(current.dashboard.indices[0].canTrade,undefined,'input is not mutated');
  for(const bad of [[],[index(999,'14:00:00')],[index(999,'18:01:00')],
    [index(999,'15:00:00',{quoteSource:''})],[index(999,'15:00:00',{receivedAt:at('14:00:00')})],
    [index(999,'15:00:00',{quoteAt:null})],[index(999,'15:00:00',{price:NaN})]]) {
    const result=s.project('state',{dashboard:{indices:bad}},x.context());
    assert.equal(result.dashboard.indices[0].price,3578.46,'invalid/older current data preserves explicitly dated old observation');
  }
});
test('throttled last frame is fsynced at close and survives a new process/store', (t) => {
  const x = setup(t),
    s = x.open();
  s.project('state', frame(1), x.context());
  x.set(at('14:59:50'));
  s.project('state', frame(2), x.context());
  x.set(at('15:00:00'));
  s.flush(true);
  const r = x.open().project('state', frame(100), x.context());
  assert.equal(r.pool[0].price, 2);
  assert.equal(r.snapshotDay, day);
  const raw = fs.readFileSync(x.file, 'utf8');
  assert.doesNotMatch(
    raw,
    /private-push|paper|cash|news-1|news-2|yierList|lianbanList/,
  );
  assert.equal(fs.statSync(x.file).mode & 0o777, 0o600);
});
test('restoring an older mixed-scope fast-move cache discards its stock list', (t) => {
  const x = setup(t);
  fs.writeFileSync(x.file, JSON.stringify({schemaVersion:1,entries:{'state:all':{
    day,capturedAt:at('14:59:40'),value:{...frame(1),fastStockMoves:{items:[{code:'600009'}]}}
  }}}), {mode:0o600});
  x.set(at('15:00:00'));
  const result = x.open().project('state', frame(99), x.context());
  assert.equal(result.pool[0].price, 1);
  assert.equal(result.fastStockMoves, undefined);
  assert.equal(result.marketFastStockMoves, undefined);
});
test('pending computation crossing close cannot be remembered; force and nonempty recalculation do not bypass freeze', (t) => {
  const x = setup(t),
    s = x.open();
  s.remember(
    'intraday:all',
    { items: [{ code: '600001', price: 1 }], asOf: at('14:59:40') },
    x.context(),
  );
  x.set(at('15:00:00'));
  assert.equal(
    s.remember(
      'intraday:all',
      { items: [{ code: '600002', price: 99 }] },
      x.context(),
    ),
    false,
  );
  assert.equal(s.read('intraday:all').value.items[0].price, 1);
  assert.equal(s.read('intraday:gem'), null);
});
test('restored card rows recover their own dating metadata instead of borrowing a newer frame', (t) => {
  const x=setup(t),store=x.open(),friday=Date.parse('2026-11-13T14:58:00+08:00');
  const saved={...frame(1),pool:[{code:'600001',price:1,quoteAt:friday}],
    sectors:[{name:'合成板块'}],sectorsDay:'20261113'};
  store.project('state',saved,x.context());
  x.set(at('15:00:00'));
  const current={...frame(99),snapshotFieldDays:{pool:day,dashboard:day,sectors:day,ztReviewPool:day}};
  const restored=x.open().project('state',current,x.context());
  assert.equal(restored.snapshotDay,day);
  assert.equal(restored.snapshotFieldDays.pool,'20261113');
  assert.equal(restored.snapshotFieldDays.candidatePool,'20261113');
  assert.equal(restored.snapshotFieldDays.sectors,'20261113');
  assert.equal(restored.snapshotFieldDays.dashboard,null);
  assert.equal(restored.snapshotFieldDays.ztReviewPool,day,'unrestored review evidence keeps its own date');
});
test('unknown and prior-session quote days cannot seed a purported current-session snapshot', (t) => {
  const x = setup(t),
    s = x.open();
  for (const sourceDay of ['', '20261113', '20261117'])
    assert.equal(
      s.remember(
        'quant:all',
        { items: [{ code: '600001' }] },
        { ...x.context(), sourceDay },
      ),
      false,
    );
  assert.equal(
    s.remember(
      'quant:main',
      { board: 'gem', items: [{ code: '300001' }] },
      x.context(),
    ),
    false,
  );
  assert.equal(fs.existsSync(x.file), false);
});
test('empty transient card result retains the previous nonempty card, failed result never commits', (t) => {
  const x = setup(t),
    s = x.open();
  assert.equal(
    s.remember('quant:all', { items: [{ code: '600001' }] }, x.context()),
    true,
  );
  for (const v of [
    { items: [] },
    { locked: true, items: [] },
    { error: 'private', items: [] },
    { ok: false },
  ])
    assert.equal(s.remember('quant:all', v, x.context()), false);
  assert.equal(s.read('quant:all').value.items.length, 1);
});
test('missing close snapshot is explicit and is not written from after-close output', (t) => {
  const x = setup(t);
  x.set(at('16:00:00'));
  const s = x.open(),
    r = s.project('state', frame(1), x.context());
  assert.equal(r.freezeUnavailable, true);
  assert.equal(fs.existsSync(x.file), false);
  assert.equal(s.read('quant:all'), null);
});
test('weekend and pre-open reads hold the old day; new real session can replace it', (t) => {
  const x = setup(t),
    s = x.open();
  s.project('state', frame(1), x.context());
  x.set(Date.parse('2026-11-22T12:00:00+08:00'));
  const r = s.project('state', frame(3), {
    session: { day: '20261122', trading: false },
    sourceDay: day,
  });
  assert.equal(r.pool[0].price, 1);
  assert.equal(r.snapshotDay, day);
  x.set(Date.parse('2026-11-23T10:00:00+08:00'));
  const live = {
    session: { day: '20261123', trading: true },
    sourceDay: '20261123',
  };
  assert.equal(s.project('state', frame(4), live).pool[0].price, 4);
});
test('corrupt private snapshot reports a bounded code and keeps current data untouched', (t) => {
  const x = setup(t);
  fs.writeFileSync(x.file, '{"token":"private",BROKEN', { mode: 0o600 });
  const s = x.open();
  assert.equal(s.read('state:all'), null);
  assert.deepEqual(x.errors, ['closing-card-snapshot-read']);
});
