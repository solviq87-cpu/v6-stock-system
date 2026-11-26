'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createPaperApplicationService} = require('../src/core/paper-application-service');
const {evaluateEntryRisk} = require('../src/core/common-entry-risk');
const {planLedgerContext, sellEligibility} = require('../src/core/paper-plan-observer');
const {tradingFees} = require('../src/core/trading-fees');
const {aShareCalendarDate} = require('../src/core/a-share-calendar');

const ENTRY_DAY = '2026-11-23', EXIT_DAY = '2026-11-24';
const START = Date.parse(ENTRY_DAY + 'T10:00:00+08:00');
const PLAN_ID = 'plan-00000000-0000-4000-8000-000000000001';
const money = value => Math.round(value * 100) / 100;

function setup(t, legacy = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-symbol-boundaries-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const file = path.join(root, 'authority.json'); let now = START, serial = 0;
  const make = () => createPaperApplicationService({file, clock: () => now,
    calendar: {isOpen: day => [ENTRY_DAY, EXIT_DAY].includes(day)}});
  const app = make();
  if (legacy) app.adoptLegacy({initial: 100000, cash: 100000, realized: 0, enabled: true, positions: {}, trades: []});
  else app.initialize(100000);
  const day = () => aShareCalendarDate(now);
  const order = (orderId, symbol, side, quantity) => ({orderId, symbol, side, quantity, limitPrice: 10, tradeDate: day()});
  const quote = (symbol = '600000', volume = 10000000) => ({symbol, tradeDate: day(), timestamp: now,
    source: 'simulated', provider: 'isolated-symbol-boundary-test', suspended: false, tradable: true,
    volumeUnit: 'shares', volume, price: 10, lowerLimit: 9, upperLimit: 11});
  const buy = (symbol = '600000', quantity = 300) => {
    const id = 'buy-' + (++serial); app.submit(order(id, symbol, 'buy', quantity));
    return app.fill(id, id + '-fill', quote(symbol));
  };
  function reject(run, pattern) {
    const before = fs.readFileSync(file);
    assert.throws(run, pattern);
    assert.deepEqual(fs.readFileSync(file), before, 'rejection must leave the authority snapshot byte-identical');
    make().read();
  }
  function automatic(side, quantity, symbol = '600000', reason = 'isolated automatic fixture') {
    const old = app.legacy(), book = app.read(), key = String(symbol), prior = old.positions[key];
    const fee = tradingFees({side, quantity, price: 10, tradeDate: day(), policy: book.feePolicy,
      schedules: book.feeSchedules || null}).total;
    const positions = {...old.positions}, shares = (prior?.shares || 0) + (side === 'buy' ? quantity : -quantity);
    if (shares) positions[key] = {...prior, code: key, shares, buyTs: prior?.buyTs || now,
      buyPrice: 10, basis: side === 'buy' ? money((prior?.basis || 0) + quantity * 10 + fee) : prior.basis};
    else delete positions[key];
    const trade = {t: now, side: side === 'buy' ? '买入' : '卖出', code: symbol,
      price: 10, shares: quantity, amount: quantity * 10, fee, reason};
    const input = {...old, positions, cash: money(old.cash + (side === 'buy' ? -quantity * 10 - fee : quantity * 10 - fee)),
      trades: [trade, ...old.trades]};
    return {input, save: (q = quote(symbol)) => app.saveLegacy(input, app.read().revision, {quotes: {[key]: q}})};
  }
  return {app, file, make, order, quote, buy, reject, automatic, get now() { return now; },
    advance: (ms = 86400000) => { now += ms; }};
}

test('mixed numeric and string pending buys share one original single-stock limit in both directions', t => {
  for (const [first, second] of [[600000, '600000'], ['600000', 600000]]) {
    const f = setup(t);
    f.app.configure({expectedRevision: f.app.read().revision, riskPolicy: {version: 'single-v1', maxPositionPct: 15}});
    f.app.submit(f.order('pending', first, 'buy', 1000));
    f.reject(() => f.make().submit(f.order('second', second, 'buy', 600)), /SINGLE_POSITION_LIMIT/);
    assert.equal(typeof f.app.read().orders.pending.order.symbol, typeof first, 'do not rewrite stored order identity');
    f.app.submit(f.order('other-stock', '600001', 'buy', 600));
    const input = {policy: {version: 'pure-v1', maxPositionPct: 15}, symbol: second, side: 'buy',
      quantity: 600, price: 10, cash: 100000, pending: [{symbol: first, quantity: 1000, price: 10}]};
    const serialized = JSON.stringify(input), result = evaluateEntryRisk(input);
    assert.equal(result.allowed, false); assert.equal(result.exposure.single, 16000);
    assert.equal(JSON.stringify(input), serialized);
  }
});

test('held positions and queued fills recheck mixed-type single-stock exposure inside original authority', t => {
  const held = setup(t); held.buy('600000', 1000);
  held.app.configure({expectedRevision: held.app.read().revision, riskPolicy: {version: 'held-v1', maxPositionPct: 15}});
  held.reject(() => held.app.submit(held.order('numeric-extra', 600000, 'buy', 600),
    {riskContext: {observedAt: held.now, marks: {'600000': 10}}}), /SINGLE_POSITION_LIMIT/);
  const queued = setup(t);
  queued.app.submit(queued.order('numeric-pending', 600000, 'buy', 1000));
  queued.app.submit(queued.order('string-pending', '600000', 'buy', 600));
  queued.app.configure({expectedRevision: queued.app.read().revision, riskPolicy: {version: 'queued-v1', maxPositionPct: 15}});
  queued.reject(() => queued.make().fill('string-pending', 'excess-fill', queued.quote()), /SINGLE_POSITION_LIMIT/);
  assert.equal(queued.app.read().account.events.length, 0);
});

test('mixed sell reservations survive partial fill, restart and cancellation without duplicate events', t => {
  const f = setup(t); f.buy(); f.advance();
  f.app.submit(f.order('numeric-sell', 600000, 'sell', 200));
  f.reject(() => f.make().submit(f.order('too-large', '600000', 'sell', 200)), /可卖数量不足/);
  f.app.submit(f.order('string-sell', '600000', 'sell', 100));
  const q = f.quote(600000, 10000), partial = f.app.fill('numeric-sell', 'partial-numeric', q);
  assert.equal(partial.orders['numeric-sell'].state.remainingQuantity, 100);
  assert.equal(partial.account.positions['600000'].quantity, 200);
  const beforeRetry = fs.readFileSync(f.file);
  assert.deepEqual(f.make().fill('numeric-sell', 'partial-numeric', q), partial);
  assert.deepEqual(fs.readFileSync(f.file), beforeRetry);
  assert.equal(typeof partial.orders['numeric-sell'].order.symbol, 'number');
  assert.equal(typeof partial.account.events.at(-1).symbol, 'number');
  assert.equal(typeof partial.account.events.at(-1).fillEvidence.symbol, 'number');
  f.reject(() => f.make().submit(f.order('over-frozen', '600000', 'sell', 100)), /可卖数量不足/);
  f.make().cancel('numeric-sell', 'cancel-numeric');
  f.app.submit(f.order('replacement', '600000', 'sell', 100));
  f.reject(() => f.make().submit(f.order('oversell-after-cancel', 600000, 'sell', 100)), /可卖数量不足/);
  assert.equal(f.app.read().account.events.length, 2);
});

test('mixed-type fills share the original daily participation budget and retain quote identity checks', t => {
  const f = setup(t); f.buy(); f.advance();
  f.app.submit(f.order('numeric-sell', 600000, 'sell', 100));
  f.app.submit(f.order('string-sell', '600000', 'sell', 100));
  f.reject(() => f.app.fill('numeric-sell', 'wrong-quote-type', f.quote('600000', 10000)), /行情/);
  f.app.fill('numeric-sell', 'numeric-fill', f.quote(600000, 10000));
  f.reject(() => f.make().fill('string-sell', 'over-volume', f.quote('600000', 10000)), /参与率/);
  f.reject(() => f.app.fill('string-sell', 'stale', {...f.quote(), timestamp: f.now - 180001}), /行情/);
  const result = f.app.fill('string-sell', 'string-fill', f.quote('600000', 20000));
  assert.equal(result.account.positions['600000'].quantity, 100);
  assert.equal(result.account.events.length, 3);
  const sameDay = setup(t); sameDay.buy(600000, 100);
  sameDay.reject(() => sameDay.app.submit(sameDay.order('same-day-sell', '600000', 'sell', 100)), /T\+1/);
});

test('automatic legacy exit respects a numeric sell reservation and only resumes after cancellation', t => {
  const f = setup(t, true); f.buy(); f.advance();
  f.app.submit(f.order('numeric-reservation', 600000, 'sell', 200));
  const proposed = f.automatic('sell', 200);
  f.reject(() => proposed.save(), /冻结持仓/);
  f.make().cancel('numeric-reservation', 'release-reservation');
  const accepted = proposed.save();
  assert.equal(accepted.account.positions['600000'].quantity, 100);
  assert.equal(accepted.account.events.length, 2);
  const original = JSON.stringify(accepted.account.events);
  const retry = f.make().saveLegacy(proposed.input, accepted.revision, {quotes: {}});
  assert.equal(JSON.stringify(retry.account.events), original, 'automatic replay preserves original fills and evidence');
});

test('automatic legacy fills include numeric prior executions in the original participation budget', t => {
  const f = setup(t, true); f.buy(600000, 100);
  const proposed = f.automatic('buy', 100);
  f.reject(() => proposed.save(f.quote('600000', 10000)), /参与率/);
  const accepted = proposed.save(f.quote('600000', 20000));
  assert.equal(accepted.account.positions['600000'].quantity, 200);
  assert.equal(accepted.account.events.length, 2);
});

test('corporate settlement requires cancellation of same-stock numeric orders and remains idempotent', t => {
  for (const side of ['buy', 'sell']) {
    const f = setup(t); f.buy(); f.advance();
    f.app.submit(f.order('numeric-pending', 600000, side, 100));
    const book = f.app.read(), event = {eventId: 'cash-dividend', actionId: 'isolated-action', symbol: '600000',
      kind: 'cash-dividend', source: 'imported', provider: 'isolated-test-not-official', sourceRecordId: 'isolated-record',
      effectiveDate: EXIT_DAY, publishedAt: EXIT_DAY + 'T09:00:00+08:00', expectedQuantity: 300,
      expectedCostBasis: book.account.positions['600000'].lots.reduce((sum, lot) => sum + lot.cost, 0),
      cashDelta: 30, shareDelta: 0, basisDelta: 0};
    f.reject(() => f.make().settle(event, book.revision), /未完成委托/);
    f.app.cancel('numeric-pending', 'cancel-before-settlement');
    const settled = f.app.settle(event, f.app.read().revision), raw = fs.readFileSync(f.file);
    assert.equal(settled.corporateEvents.length, 1);
    assert.equal(settled.account.cash, money(book.account.cash + 30));
    assert.deepEqual(f.make().settle(event, settled.revision), settled);
    assert.deepEqual(fs.readFileSync(f.file), raw);
  }
});

test('original plan observer binds mixed-type authoritative fills and blocks frozen or over-volume exits', t => {
  const f = setup(t, true);
  f.automatic('buy', 300, 600000, '作战台计划[' + PLAN_ID + '] 原账户风控').save();
  const plan = {id: PLAN_ID, code: '600000', intendedDate: ENTRY_DAY, frozenAt: new Date(START - 5000).toISOString()};
  f.advance(); f.app.submit(f.order('numeric-reservation', 600000, 'sell', 100));
  let book = f.make().read(), context = planLedgerContext(book, plan, f.now);
  assert.equal(context.entry.symbol, 600000); assert.equal(context.remaining, 300);
  const checked = () => ({allowed: true, reason: 'isolated original exit check', checkedAt: f.now, quoteAt: f.now});
  const q = () => ({...f.quote('600000', 30000), quoteAt: f.now});
  let result = sellEligibility(book, context, q(), EXIT_DAY, f.now, checked());
  assert.equal(result.allowed, false); assert.equal(result.reservedQuantity, 100);
  const partial = f.app.fill('numeric-reservation', 'numeric-exit-fill', f.quote(600000, 10000));
  book = f.make().read(); context = planLedgerContext(book, plan, f.now);
  assert.equal(context.remaining, 200); assert.equal(context.sells[0].eventId, 'numeric-exit-fill');
  assert.equal(context.sells[0].fillEvidence.fingerprint, partial.account.events.at(-1).fillEvidence.fingerprint);
  const before = fs.readFileSync(f.file);
  result = sellEligibility(book, context, {...q(), volume: 20000}, EXIT_DAY, f.now, checked());
  assert.equal(result.allowed, false); assert.equal(result.usedVolume, 100); assert.match(result.reason, /参与率/);
  assert.equal(sellEligibility(book, context, q(), EXIT_DAY, f.now, checked()).allowed, true);
  assert.deepEqual(fs.readFileSync(f.file), before, 'observer cannot rewrite original numeric execution evidence');
  f.buy('600000', 100);
  assert.match(planLedgerContext(f.app.read(), plan, f.now).ambiguous, /追加买入/);
});
