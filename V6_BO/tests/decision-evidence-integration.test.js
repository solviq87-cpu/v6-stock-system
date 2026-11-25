'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createDecisionEvidenceRuntime} = require('../src/server/decision-evidence-runtime');
const {observePaperPlans} = require('../src/core/paper-plan-observer');
const {createPaperPlanObservationStore} = require('../src/core/paper-plan-observation-store');
const {decisionPlanPayload, bindAuthoritativePlan, paperExecutionScore} = require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance} = require('../src/core/paper-input-provenance');

const day = '2026-11-09', entryDay = '2026-11-06', at = (d, time) => Date.parse(d + 'T' + time + '+08:00');
function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}
function fixture() {
  const card = {authority: 'fayo-decision-center', decisionId: 'a'.repeat(64), code: '600000', name: '隔离测试', day: entryDay,
    strategyAt: at(entryDay, '09:29:00'), calculatedAt: at(entryDay, '09:29:40'), quoteBasis: {source: 'tencent', quoteAt: at(entryDay, '09:29:39')},
    plan: {buyLow: 9.8, buyHigh: 10.1, stop: 9.4, target: 10.8, positionPct: 19.6}};
  const plan = bindAuthoritativePlan({id: 'plan-00000000-0000-4000-8000-000000000001', sampleSet: 'real',
    frozenAt: new Date(at(entryDay, '09:29:50')).toISOString(), ...decisionPlanPayload(card)}, card);
  const book = {revision: 1, legacy: {enabled: true}, feePolicy: {version: 'legacy-A-B', feeBps: 2.5, minFee: 5, sellTaxBps: 5}, orders: {},
    account: {cash: 10000, events: [{eventId: 'buy-plan', orderId: 'buy-order', side: 'buy', symbol: plan.code, quantity: 200,
      tradeDate: entryDay, timestamp: at(entryDay, '10:00:00'), price: 10, reason: '作战台计划[' + plan.id + '] 原账户风控'}],
      positions: {[plan.code]: {quantity: 200, lots: [{quantity: 200, buyDate: entryDay, sellableDate: null, sourceEventId: 'buy-plan'}]}}}};
  return frozen({plan, book});
}
function rawQuote(timestamp, source = 'tencent') {
  const row = {code: '600000', name: '隔离测试', price: 9.3, preClose: 10, volume: 100000, quoteSource: source,
    quoteMode: 'public-live-unverified', quoteAt: timestamp, receivedAt: timestamp, canTrade: true, suspended: false, tradable: true};
  return frozen({symbol: row.code, price: row.price, quoteSource: source, provider: source, quoteAt: timestamp, timestamp,
    receivedAt: timestamp, mode: row.quoteMode, tradeDate: day, volume: row.volume * 100, volumeUnit: 'shares', upperLimit: 11,
    lowerLimit: 9, suspended: false, tradable: true, inputProvenance: createAutomaticInputProvenance({stock: row, observation: row,
      stockOrigin: 'S.lastPx.wireQuote', priceOrigin: 'S.lastPx.wireQuote', limitPct: .1})});
}

test('real runtime → observer → private store → score retains exact source clocks, dedupes across restart and preserves ledger bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-evidence-integration-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const root = path.join(dir, 'research', 'plan-observations'), {plan, book} = fixture();
  const ledger = path.join(dir, 'original-ledger.json'); fs.writeFileSync(ledger, JSON.stringify(book));
  const ledgerBefore = fs.readFileSync(ledger), inputBefore = JSON.stringify({plan, book});
  const originalTime = at(day, '10:00:00'); let now = originalTime + 1000, quote = rawQuote(originalTime), primary = true;
  const sent = [], clock = () => now, calendar = {isOpen: d => d === day}, isPrimary = () => primary;
  const store = createPaperPlanObservationStore({root, clock, canWrite: isPrimary});
  const makeRuntime = () => createDecisionEvidenceRuntime({clock, isPrimary, session: () => ({day, continuous: true}),
    readArchive: async () => ({ok: true, state: {plans: [plan]}}),
    readContext: async () => ({now, book, quotes: {[plan.code]: quote}, calendar,
      exitEligibilityByPlan: {[plan.id]: {allowed: true, reason: '原账户及封跌停门禁已核对', checkedAt: now, quoteAt: quote.quoteAt}}}),
    observe: observePaperPlans, store, privateReady: () => true, sendPrivate: async alert => { sent.push(alert); }});
  let runtime = makeRuntime(); assert.equal((await runtime.tick()).status, 'observing');
  now += 5000; assert.equal((await runtime.tick()).status, 'observing');
  let saved = await store.read({day});
  assert.equal(saved.records.length, 2); assert.equal(sent.length, 1);
  assert.ok(saved.records.every(r => r.quoteAt === originalTime && r.receivedAt === originalTime && r.source === 'tencent'));
  assert.deepEqual(saved.records.map(r => r.observedAt), [originalTime + 1000, originalTime + 6000]);
  assert.equal(sent[0].private, true); assert.equal(sent[0].canTrade, false);
  now += 5000; quote = rawQuote(now, 'sina'); runtime = makeRuntime();
  assert.equal((await runtime.tick()).status, 'observing');
  saved = await store.read({day});
  assert.equal(saved.records.length, 3); assert.equal(sent.length, 1);
  assert.equal(saved.records[0].source, 'tencent'); assert.equal(saved.records[2].source, 'sina');
  assert.equal(saved.records[2].quoteAt, now);
  now += 20000; assert.equal((await runtime.tick()).status, 'missing-current-evidence');
  assert.equal((await store.read({day})).records.length, 3);
  const result = paperExecutionScore({book, plans: [plan], observations: saved.records, day, now: at(day, '15:01:00')});
  assert.equal(result.score, null); assert.equal(result.rows[0].facts[1].status, '资料不足');
  assert.ok(result.rows[0].coverage.gapCount > 0);
  primary = false; const before = JSON.stringify(await store.read({day})); await runtime.tick();
  assert.equal(JSON.stringify(await store.read({day})), before);
  assert.equal(JSON.stringify({plan, book}), inputBefore); assert.deepEqual(fs.readFileSync(ledger), ledgerBefore);
});

test('an unconfigured private channel records a condition but does not replay it when configured later', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-evidence-unconfigured-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {plan, book} = fixture(); let now = at(day, '10:00:00'), configured = false;
  const sent = [], store = createPaperPlanObservationStore({root: path.join(dir, 'observations'), clock: () => now, canWrite: () => true});
  const runtime = createDecisionEvidenceRuntime({clock: () => now, isPrimary: () => true, session: () => ({day, continuous: true}),
    readArchive: async () => ({ok: true, state: {plans: [plan]}}), readContext: async () => ({now, book,
      quotes: {[plan.code]: rawQuote(now)}, calendar: {isOpen: d => d === day},
      exitEligibilityByPlan: {[plan.id]: {allowed: true, reason: '原退出门禁已核对', checkedAt: now, quoteAt: now}}}),
    observe: observePaperPlans, store, privateReady: () => configured, sendPrivate: async value => { sent.push(value); }});
  assert.equal((await runtime.tick()).privateChannel, 'unconfigured'); assert.equal(sent.length, 0);
  configured = true; now += 5000; assert.equal((await runtime.tick()).privateChannel, 'configured');
  assert.equal(sent.length, 0); assert.equal((await store.read({day})).alerts.length, 1);
});
