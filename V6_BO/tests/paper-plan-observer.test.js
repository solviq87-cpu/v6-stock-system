'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {observePaperPlans, sessions, planVersion} = require('../src/core/paper-plan-observer');
const {createPaperPlanObservationStore} = require('../src/core/paper-plan-observation-store');
const {decisionPlanPayload, bindAuthoritativePlan, paperExecutionScore} = require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance} = require('../src/core/paper-input-provenance');
const {createFillEvidence} = require('../src/core/paper-fill-evidence');

const entryDay = '2026-11-06', exitDay = '2026-11-09';
const stamp = (day, time) => Date.parse(day + 'T' + time + '+08:00');
const planId = 'plan-00000000-0000-4000-8000-000000000001';
const calendar = {isOpen: day => [entryDay, exitDay].includes(day)};
const clone = value => JSON.parse(JSON.stringify(value));

function frozen() {
  const card = {authority: 'fayo-decision-center', decisionId: 'a'.repeat(64), code: '600000', day: entryDay,
    name: '隔离测试', calculatedAt: stamp(entryDay, '09:29:40'), strategyAt: stamp(entryDay, '09:29:00'),
    quoteBasis: {source: 'tencent', quoteAt: stamp(entryDay, '09:29:39')},
    plan: {buyLow: 9.8, buyHigh: 10.1, stop: 9.4, target: 10.8, positionPct: 19.6}};
  return bindAuthoritativePlan({id: planId, sampleSet: 'real', frozenAt: new Date(stamp(entryDay, '09:29:50')).toISOString(),
    ...decisionPlanPayload(card)}, card);
}
function quote(day, now, price = 10, patch = {}) {
  const row = {code: '600000', name: '隔离测试', price, preClose: 10, volume: 100000,
    quoteSource: 'tencent', quoteMode: 'public-live-unverified', quoteAt: now, receivedAt: now, canTrade: true,
    suspended: false, tradable: true};
  const result = {symbol: row.code, price, quoteSource: row.quoteSource, provider: row.quoteSource, quoteAt: now,
    timestamp: now, receivedAt: now, tradeDate: day, mode: row.quoteMode, volumeUnit: 'shares', volume: row.volume * 100,
    upperLimit: 11, lowerLimit: 9, suspended: false, tradable: true,
    inputProvenance: createAutomaticInputProvenance({stock: row, observation: row,
      stockOrigin: 'S.lastPx.wireQuote', priceOrigin: 'S.lastPx.wireQuote', limitPct: .1})};
  return {...result, ...patch};
}
function book(entered = true) {
  const event = {eventId: 'buy-plan', orderId: 'buy-order', side: 'buy', symbol: '600000', quantity: 200,
    tradeDate: entryDay, timestamp: stamp(entryDay, '10:00:00'), price: 10,
    reason: '作战台计划[' + planId + '] 原账户风控'};
  return {revision: 1, legacy: {enabled: true}, feePolicy: {version: 'legacy-A-B', feeBps: 2.5, minFee: 5, sellTaxBps: 5},
    account: {cash: 10000, events: entered ? [event] : [], positions: entered ? {'600000': {quantity: 200,
    lots: [{quantity: 200, buyDate: entryDay, sellableDate: null, sourceEventId: event.eventId}]}} : {}}, orders: {}};
}
function sell(state, at, shares, price = 9.3) {
  const q = quote(exitDay, at, price), event = {eventId: 'sell-' + at, orderId: 'sell-order-' + at, side: 'sell',
    symbol: '600000', quantity: shares, tradeDate: exitDay, timestamp: at, price};
  event.fillEvidence = createFillEvidence(q, {executionAt: at, executionKind: 'automatic-paper', symbol: '600000', tradeDate: exitDay, price});
  state.account.events.push(event);
  const position = state.account.positions['600000']; position.quantity -= shares; position.lots[0].quantity -= shares;
  if (position.quantity === 0) delete state.account.positions['600000'];
  return event;
}
function observed({state = book(), day = exitDay, now = stamp(day, '10:00:00'), price = 10, plan = frozen(),
  allowed = true, patch = {}, extra = {}} = {}) {
  const q = quote(day, now, price, patch);
  return observePaperPlans({plans: [plan], book: state, quotes: {'600000': q}, day, now, calendar, continuous: true,
    entryEligibilityByPlan: {[plan.id]: {allowed, reason: allowed === null ? '缺少原预检' : allowed ? '原买入预检通过' : '原买入门禁拦截', checkedAt: now, quoteAt: q.quoteAt}},
    exitEligibilityByPlan: {[plan.id]: {allowed: true, reason: '原账户已启用且原封跌停巡检未拦截', checkedAt: now, quoteAt: q.quoteAt}}, ...extra});
}
function fullSamples({state = book(), day = exitDay, until = Infinity, price = () => 10, allowed = true, stateAt} = {}) {
  const records = [];
  for (const [start, end] of sessions(day)) for (let now = start; now < Math.min(end, until); now += 15000) {
    const result = observed({state: stateAt ? stateAt(now) : state, day, now, price: price(now), allowed});
    assert.deepEqual(result.rejected, []); assert.equal(result.records.length, 1);
    records.push(result.records[0]);
  }
  return records;
}
const score = (state, observations, day = exitDay) => paperExecutionScore({book: state, plans: [frozen()], observations,
  day, now: stamp(day, '15:01:00')});

test('observer retains original provenance and frozen version without mutating account; alert availability is bounded to paper constraints', () => {
  const state = book(), before = JSON.stringify(state), at = stamp(exitDay, '10:00:00');
  const result = observed({state, now: at, price: 9.3}), row = result.records[0];
  assert.deepEqual(result.rejected, []); assert.equal(row.quoteAt, at); assert.equal(row.receivedAt, at);
  assert.equal(row.source, 'tencent'); assert.equal(row.planVersion, planVersion(frozen()));
  assert.equal(row.entryEventId, 'buy-plan'); assert.equal(row.remainingQuantity, 200);
  assert.equal(row.exit.allowed, true); assert.equal(row.canTrade, false); assert.equal(row.accountMutated, false);
  assert.equal(result.alerts[0].kind, 'stop'); assert.equal(result.alerts[0].private, true);
  assert.equal(result.alerts[0].availability, 'allowed'); assert.equal(result.alerts[0].observationId, row.fingerprint);
  assert.match(row.exit.reason, /不代表真实盘口/); assert.equal(JSON.stringify(state), before);
});

test('stale, missing, future, wrong-day, fabricated and conflicting-source quotes produce no usable observation or alert', () => {
  const now = stamp(exitDay, '10:00:00');
  for (const patch of [{quoteAt: now - 15001, timestamp: now - 15001}, {receivedAt: null}, {receivedAt: now + 1},
    {quoteAt: now + 1, timestamp: now + 1}, {tradeDate: entryDay}, {provider: 'another'}, {volume: 0},
    {mode: 'simulated'}, {inputProvenance: undefined}, {suspended: true}, {tradable: false}, {canTrade: false}]) {
    const result = observed({now, price: 9.3, patch}); assert.equal(result.records.length, 0); assert.equal(result.alerts.length, 0);
    assert.ok(result.rejected.length);
  }
  for (const time of ['09:25:00', '12:00:00', '14:57:00', '15:00:00']) assert.equal(observed({now: stamp(exitDay, time)}).records.length, 0);
  assert.equal(observed({extra: {continuous: false}}).records.length, 0);
  assert.equal(observed({extra: {calendar: {isOpen: () => false}}}).records.length, 0);
});

test('T+1, frozen sells, participation and limit prices prevent a sell window; an unknown lot remains unknown', () => {
  const sameDay = observed({day: entryDay, now: stamp(entryDay, '10:01:00'), price: 9.3});
  assert.equal(sameDay.records[0].exit.allowed, false); assert.match(sameDay.records[0].exit.reason, /T\+1/);
  const reserved = book(); reserved.orders.pending = {order: {side: 'sell', symbol: '600000'}, state: {terminal: false, remainingQuantity: 100}};
  assert.equal(observed({state: reserved, price: 9.3}).records[0].exit.allowed, false);
  const used = book(); used.account.events.push({eventId: 'other-volume', side: 'buy', symbol: '600000', quantity: 99900,
    tradeDate: exitDay, timestamp: stamp(exitDay, '09:31:00'), price: 10});
  assert.equal(observed({state: used, price: 9.3}).records.length, 0); // overlapping lot attribution fails closed
  const limited = observed({price: 9}); assert.equal(limited.records[0].exit.allowed, false); assert.match(limited.records[0].exit.reason, /涨跌停/);
  const unknown = book(); delete unknown.account.positions['600000'].lots;
  assert.equal(observed({state: unknown, price: 9.3}).records[0].exit.allowed, null);
  assert.equal(observed({price: 9.3, extra: {exitEligibilityByPlan: {}}}).records[0].exit.allowed, null);
  const disabled = book(); disabled.legacy.enabled = false;
  assert.equal(observed({state: disabled, price: 9.3}).records[0].exit.allowed, false);
  const missingFee = book(); delete missingFee.feePolicy;
  assert.equal(observed({state: missingFee, price: 9.3}).records[0].exit.allowed, null);
  const insolvent = book(); insolvent.account.cash = 0; insolvent.feePolicy.minFee = 10000;
  assert.equal(observed({state: insolvent, price: 9.3}).records[0].exit.allowed, false);
  const q = quote(exitDay, stamp(exitDay, '10:00:00'), 9.3);
  q.volume = 10000; q.inputProvenance.volume.value = 10000; q.inputProvenance.volume.rawValue = 100;
  const participation = observed({price: 9.3, patch: q});
  assert.equal(participation.records[0].exit.allowed, false); assert.match(participation.records[0].exit.reason, /参与率/);
});

test('unfilled entry scoring separates observed no-trigger, missing data, actual gates and an observed missed window', () => {
  const empty = book(false);
  assert.equal(score(empty, [], entryDay).score, null);
  const noTrigger = fullSamples({state: empty, day: entryDay, price: () => 10.5});
  assert.equal(score(empty, noTrigger, entryDay).score, 100);
  const missed = fullSamples({state: empty, day: entryDay, price: () => 10});
  assert.equal(score(empty, missed, entryDay).rows[0].facts[0].status, '触发');
  assert.equal(score(empty, missed, entryDay).score, 0);
  const gap = missed.filter((_, index) => index !== 20);
  assert.equal(score(empty, gap, entryDay).rows[0].facts[0].status, '资料不足');
  const blocked = fullSamples({state: empty, day: entryDay, price: () => 10, allowed: false});
  assert.equal(score(empty, blocked, entryDay).rows[0].facts[0].status, '不适用');
  const unknown = fullSamples({state: empty, day: entryDay, price: () => 10, allowed: null});
  assert.equal(score(empty, unknown, entryDay).rows[0].facts[0].status, '资料不足');
});

test('a cross-day stop is assessed only with complete sampled evidence; a genuine prompt full exit is linked by its buy event', () => {
  const state = book(), trigger = stamp(exitDay, '10:00:00'), exit = trigger + 5000;
  const samples = fullSamples({state, until: exit, price: at => at >= trigger ? 9.3 : 10});
  const before = clone(state); sell(state, exit, 200);
  const result = score(state, samples);
  assert.equal(result.score, 100); assert.equal(result.rows[0].facts[1].status, '符合');
  assert.equal(result.rows[0].remainingQuantity, 0); assert.equal(result.rows[0].coverage.complete, true);
  assert.match(result.rows[0].facts[1].evidence, /全部卖出/);
  assert.equal(score(state, samples.filter((_, i) => i !== 10)).score, null);
  const noHit = fullSamples({state: before}); assert.equal(score(before, noHit).score, 100);
});

test('late or partial stop exits cannot be excused by a later fresh quote, and later same-code round trips are excluded', () => {
  const initial = book(), trigger = stamp(exitDay, '10:00:00'), late = trigger + 60000;
  const lateSamples = fullSamples({state: initial, until: late, price: at => at >= trigger ? 9.3 : 10});
  const delayed = clone(initial); sell(delayed, late, 200);
  assert.equal(score(delayed, lateSamples).rows[0].facts[1].status, '触发');
  const partial = clone(initial), partialAt = trigger + 5000; sell(partial, partialAt, 100);
  const samples = fullSamples({stateAt: at => at < partialAt ? initial : partial, price: at => at >= trigger ? 9.3 : 10});
  const partialScore = score(partial, samples);
  assert.equal(partialScore.rows[0].remainingQuantity, 100); assert.equal(partialScore.rows[0].facts[1].status, '触发');
  const firstPartial = clone(initial); sell(firstPartial, trigger, 100);
  const finalPartial = clone(firstPartial); sell(finalPartial, trigger + 5000, 100);
  const promptPartialSamples = fullSamples({until: trigger + 5000, stateAt: at => at < trigger ? initial : firstPartial,
    price: at => at >= trigger ? 9.3 : 10});
  assert.equal(score(finalPartial, promptPartialSamples).rows[0].facts[1].status, '符合');
  const prompt = clone(initial), exit = trigger + 5000, promptSamples = fullSamples({state: initial, until: exit, price: at => at >= trigger ? 9.3 : 10});
  sell(prompt, exit, 200);
  prompt.account.events.push({eventId: 'unrelated-buy', side: 'buy', symbol: '600000', quantity: 100,
    tradeDate: exitDay, timestamp: stamp(exitDay, '11:00:00'), price: 10, reason: '另一个策略'});
  prompt.account.events.push({eventId: 'unrelated-sell', side: 'sell', symbol: '600000', quantity: 100,
    tradeDate: exitDay, timestamp: stamp(exitDay, '14:00:00'), price: 9.2});
  const result = score(prompt, promptSamples);
  assert.equal(result.score, 100); assert.deepEqual(result.rows[0].facts[1].eventIds, ['sell-' + exit]);
});

test('sampling cannot bridge lunch using one quote or repair gaps with duplicate/replayed observations', () => {
  const state = book(), samples = fullSamples({state});
  const result = score(state, [...samples, samples[1]]); assert.equal(result.score, 100);
  const missing = samples.filter(r => r.observedAt < stamp(exitDay, '13:00:00'));
  assert.equal(score(state, [...missing, ...missing]).score, null);
  assert.ok(score(state, missing).rows[0].coverage.gapCount > 0);
  const changed = {...frozen(), decisionId: 'b'.repeat(64)};
  changed.decisionEvidence = {...changed.decisionEvidence, decisionId: changed.decisionId};
  assert.throws(() => paperExecutionScore({book: state, plans: [changed], observations: samples, day: exitDay,
    now: stamp(exitDay, '15:01:00')}), /版本/);
  const forged = clone(samples); forged[0].exit.allowed = true; forged[0].price = 9.1;
  assert.throws(() => score(state, forged), /校验/);
});

test('private store lazily persists hash-linked observations, deduplicates alerts across restart, and never opens a ledger', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-observe-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const root = path.join(dir, 'research-observations'); let now = stamp(exitDay, '10:00:00');
  const ledger = path.join(dir, 'ledger.json'); fs.writeFileSync(ledger, JSON.stringify(book())); const bytes = fs.readFileSync(ledger);
  const make = () => createPaperPlanObservationStore({root, clock: () => now, canWrite: () => true});
  let store = make(); assert.equal((await store.read({day: exitDay})).status, 'missing'); assert.equal(fs.existsSync(root), false);
  await store.append({records: [], alerts: [], now}); assert.equal(fs.existsSync(root), false);
  const batch = observed({now, price: 9.3}); const first = await store.append({...batch, now});
  assert.equal(first.added, 1); assert.equal(first.alerts.length, 1);
  assert.deepEqual(await store.append({...batch, now}), {added: 0, duplicate: 1, alerts: []});
  now += 5000; store = make(); const second = await store.append({...observed({now, price: 9.3}), now});
  assert.equal(second.added, 1); assert.equal(second.alerts.length, 0);
  const restored = await store.read({day: exitDay}); assert.equal(restored.records.length, 2); assert.equal(restored.alerts.length, 1);
  assert.equal(fs.statSync(root).mode & 0o077, 0); assert.equal(fs.statSync(path.join(root, exitDay, 'manifest.json')).mode & 0o077, 0);
  assert.deepEqual(fs.readFileSync(ledger), bytes);
  const oldest = fs.readdirSync(path.join(root, exitDay)).find(file => file.startsWith('00000001-'));
  fs.unlinkSync(path.join(root, exitDay, oldest)); await assert.rejects(store.read({day: exitDay}), /缺失或损坏/);
});

test('store refuses replicas, stale backfill, public/symlink paths and forged alerts without committing a manifest', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-observe-gates-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const now = stamp(exitDay, '10:00:00'), batch = observed({now, price: 9.3}), root = path.join(dir, 'private');
  const replica = createPaperPlanObservationStore({root, clock: () => now});
  await assert.rejects(replica.append({...batch, now}), /主实例/); assert.equal(fs.existsSync(root), false);
  const store = createPaperPlanObservationStore({root, clock: () => now + 20000, canWrite: () => true});
  await assert.rejects(store.append({...batch, now}), /时钟/);
  const writable = createPaperPlanObservationStore({root, clock: () => now, canWrite: () => true});
  await assert.rejects(writable.append({...batch, alerts: [{...batch.alerts[0], private: false}], now}), /不一致/);
  const publicStore = createPaperPlanObservationStore({root: path.join(dir, 'public', 'observations'), clock: () => now, canWrite: () => true});
  await assert.rejects(publicStore.append({...batch, now}), /公开/);
  const target = path.join(dir, 'elsewhere'); fs.mkdirSync(target, {mode: 0o700}); fs.symlinkSync(target, root);
  await assert.rejects(writable.append({...batch, now}), /符号链接/);
});

test('a role change before commit leaves no visible evidence and an identical immutable batch can be recovered once', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-observe-role-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const root = path.join(dir, 'research'), now = stamp(exitDay, '10:00:00'), batch = observed({now, price: 9.3});
  let checks = 0;
  const interrupted = createPaperPlanObservationStore({root, clock: () => now, canWrite: () => ++checks < 5});
  await assert.rejects(interrupted.append({...batch, now}), /主实例/);
  assert.equal((await interrupted.read({day: exitDay})).records.length, 0);
  assert.equal(fs.existsSync(path.join(root, exitDay, 'manifest.json')), false);
  const resumed = createPaperPlanObservationStore({root, clock: () => now, canWrite: () => true});
  assert.equal((await resumed.append({...batch, now})).alerts.length, 1);
  assert.equal((await resumed.append({...batch, now})).alerts.length, 0);
  assert.equal((await resumed.read({day: exitDay})).records.length, 1);
});
