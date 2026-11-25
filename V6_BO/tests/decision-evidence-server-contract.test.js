'use strict';

// Execute the production composition boundary. In particular, do not replace
// marketDisplaySession with an ISO-date stub: its real contract is YYYYMMDD.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), os = require('node:os');
const {createRequire} = require('node:module');
const {decisionPlanPayload, bindAuthoritativePlan} = require('../src/core/paper-decision-plan');
const {createPaperApplicationService} = require('../src/core/paper-application-service');
const {createPaperPlanObservationStore} = require('../src/core/paper-plan-observation-store');

const serverFile = path.resolve(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverFile, 'utf8'), serverRequire = createRequire(serverFile);
const day = '2026-11-25', at = (date, time) => Date.parse(date + 'T' + time + '+08:00');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production boundary must exist: ' + start);
  return source.slice(a, b);
}

async function setup(t) {
  const rules = await import('../public/nova/system-picks.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-production-risk-contract-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let now = at(day, '10:00:00'), replica = false, enabled = true, configured = false, factoryCalls = 0, options;
  const initialNow = now, calls = {archive: [], history: [], push: [], rules: 0, decisions: 0};
  // The server runs with China local wall time. Keep the test process timezone
  // untouched while executing its actual Date-using functions in this VM.
  class ChinaClock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
    getHours() { return new Date(super.getTime() + 28800000).getUTCHours(); }
    getMinutes() { return new Date(super.getTime() + 28800000).getUTCMinutes(); }
    getFullYear() { return new Date(super.getTime() + 28800000).getUTCFullYear(); }
    getMonth() { return new Date(super.getTime() + 28800000).getUTCMonth(); }
    getDate() { return new Date(super.getTime() + 28800000).getUTCDate(); }
    getDay() { return new Date(super.getTime() + 28800000).getUTCDay(); }
  }
  const card = {authority: 'fayo-decision-center', decisionId: 'a'.repeat(64), code: '600000', name: '隔离测试', day,
    calculatedAt: now - 7000, strategyAt: now - 10000, quoteBasis: {source: 'tencent', quoteAt: now - 8000},
    plan: {buyLow: 9.8, buyHigh: 10.1, stop: 9.4, target: 10.8, positionPct: 19.6}};
  const plan = bindAuthoritativePlan({id: 'plan-00000000-0000-4000-8000-000000000001', sampleSet: 'real',
    frozenAt: new Date(now - 6000).toISOString(), ...decisionPlanPayload(card)}, card);
  const wire = {code: plan.code, name: '隔离测试', price: 10, preClose: 10, volume: 100000,
    quoteAt: now - 1000, receivedAt: now - 500, quoteSource: 'tencent', quoteMode: 'public-live-unverified', canTrade: true,
    score: 88, paths: ['温和连阳'], tradeDate: '20261125'};
  const authorityFile = path.join(root, 'authority.json');
  const authority = createPaperApplicationService({file: authorityFile, clock: () => now, calendar: {isOpen: () => true}});
  authority.adoptLegacy({initial: 10000, enabled: true, cash: 10000, positions: {}, trades: []});
  const book = authority.read();
  const store = createPaperPlanObservationStore({root: path.join(root, 'observations'), clock: () => now,
    canWrite: () => !replica && enabled});
  const runtime = {label: 'captured-runtime'};
  const context = {
    Date: ChinaClock, Map, Set, console, path, __dirname: path.dirname(serverFile),
    process: {env: {V6_RISK_EVIDENCE_DIR: path.join(root, 'risk')}},
    require(id) {
      if (id === './src/server/decision-evidence-runtime') return {...serverRequire(id), createDecisionEvidenceRuntime(value) {
        options = value; factoryCalls++; return runtime;
      }};
      // Exercise the real unified risk runtime and the production factory;
      // only replace its wall clock so every original quote has one timeline.
      if (id === './src/server/risk-workbench-runtime') return {...serverRequire(id), createRiskWorkbenchRuntime(value) {
        return serverRequire(id).createRiskWorkbenchRuntime({...value, clock: () => now});
      }};
      if (id === './src/core/research-risk-center') return {readResearchRiskCenter: () => ({})};
      if (id === './src/server/research-workspace-job') return {async runWorkspaceJob(value) {
        calls.archive.push(value); return {ok: true, state: {plans: [plan]}};
      }};
      if (id === './src/core/intelligence-history') return {async collectCenterHistory(input, dependencies) {
        calls.history.push({input, canWrite: dependencies.canWrite()}); return {status: 'blocked', missing: ['测试不连接真实来源']};
      }};
      return serverRequire(id);
    },
    decisionEvidenceRuntime: undefined,
    isReplica: () => replica, centerEvidenceEnabled: () => enabled,
    isTradeDay: value => ![0, 6].includes(value.getDay()), configuredTradingCalendar: null, HOLIDAY_MAX_YEAR: 2027,
    shortlineResearchDir: () => '/private-fixture/shortline-research', centerHistoryDir: () => '/private-fixture/shortline-research/center-history',
    planObservationStore: () => store, privReady: () => configured,
    pushAll(...args) { calls.push.push(args); return true; },
    previousResearchDay: value => ({'2026-11-25': '2026-11-24', '2026-11-28': '2026-11-27'})[value],
    async loadSystemPickRules() { calls.rules++; now += 3; return rules; },
    async decisionCenterFor(includePrivate) { assert.equal(includePrivate, true); calls.decisions++; now += 5; return {cards: [card]}; },
    _paperAuthority: {pool: {read: () => book}},
    PAPER_CFG: {pool: {maxPos: 5, initial: 10000}}, PAPER: {pool: book.legacy, pre: {positions: {}}},
    newsWarnsCode: () => false, A: {isLimitUp: () => false},
    decisionCrossChecks: new Map(), dabankeReview: {summary: () => null}, newsEvidenceVisibleState: () => ({}),
    aShareCalendarDate: serverRequire('./src/core/a-share-calendar').aShareCalendarDate,
    S: {lastPx: new Map([[plan.code, {wireQuote: wire, p: wire.price, t: now, quoteAt: wire.quoteAt}]]),
      stocks: [wire], candidatePool: [wire], trendPool: [], ztCodes: new Set(), klines: new Map()}
  };
  vm.createContext(context);
  vm.runInContext([
    section('const isContinuousTrading = (at = new Date()) => {', '// 收盘后（交易日15:00之后）'),
    section('function marketDisplaySession(now=Date.now()) {', 'function sessionAuctionDisplay('),
    section('const paperAuthorityCalendar={isOpen(date){', 'const _paperAuthority='),
    section('function paperAuthorityQuotes(){', 'refreshPaperAuthority();'),
    section('function paperPrices() {', '// ⛔ 2026-10-28 补（用户「买卖都按正常 A 股逻辑」收口 · 买卖对称）'),
    section('function paperLotOf(code) {', 'function paperBuy('),
    section('function limitPctOfCode(code, name) {', '// 卖出巡检：止盈/收益联动止损'),
    section('function latestResearchClose(){', 'const shortlineCalendarLoadedAt='),
    section('let _riskWorkbenchRuntime=null;', 'let _decisionFeedbackRuntime='),
    section('function centerEvidenceRuntime(){', 'function manualResearchLedgerDir()')
  ].join('\n'), context, {filename: 'production-decision-evidence-contract.js'});
  assert.equal(context.centerEvidenceRuntime(), runtime);
  async function commitObservation() {
    const input = await options.readContext([plan]), current = options.session(input.now);
    const observed = options.observe({...input, plans: [plan], day: current.day, continuous: current.continuous});
    assert.deepEqual(observed.rejected, []);
    const committed = await store.append({records: observed.records, alerts: observed.alerts, now: input.now});
    assert.equal(committed.alerts.length, 1, 'the original observer must commit a fresh trigger before dispatch');
    return committed.alerts[0];
  }
  function refreshQuote(price = wire.price) {
    Object.assign(wire, {price, quoteAt: now, receivedAt: now});
    Object.assign(context.S.lastPx.get(plan.code), {p: price, t: now, quoteAt: now});
  }
  function purchase() {
    const quote = context.paperAuthorityQuotes()[plan.code], legacy = structuredClone(authority.legacy());
    const trade = {t: now, side: '买入', code: plan.code, name: plan.name, price: 10, shares: 100, amount: 1000,
      fee: 5, reason: '作战台计划[' + plan.id + '] 原账户风控'};
    legacy.cash -= 1005;
    legacy.positions[plan.code] = {code: plan.code, name: plan.name, shares: 100, buyPrice: 10,
      buyTs: now, basis: 1005};
    legacy.trades.unshift(trade);
    authority.saveLegacy(legacy, authority.read().revision, {action: 'buy', quotes: {[plan.code]: quote}});
    Object.assign(book, authority.read()); context.PAPER.pool = book.legacy;
    now++; refreshQuote();
    return book.account.events.at(-1);
  }
  return {context, options, plan, card, wire, book, calls, store, initialNow, authorityFile,
    commitObservation, refreshQuote, purchase, riskRuntime: () => context.riskWorkbenchRuntime(),
    now: () => now, factoryCalls: () => factoryCalls,
    set(value) { if (value.now !== undefined) now = value.now; if (value.replica !== undefined) replica = value.replica;
      if (value.enabled !== undefined) enabled = value.enabled; if (value.configured !== undefined) configured = value.configured; }};
}

test('production YYYYMMDD market session is normalized before reaching the core, preserving original continuous and primary gates', async t => {
  const x = await setup(t), {options, context} = x;
  assert.equal(context.marketDisplaySession(x.now()).day, '20261125');
  assert.equal(options.session(x.now()).day, day); assert.equal(options.session(x.now()).continuous, true);
  assert.equal(options.isPrimary(), true); x.set({replica: true}); assert.equal(options.isPrimary(), false);
  x.set({replica: false, enabled: false}); assert.equal(options.isPrimary(), false);
  x.set({enabled: true}); assert.equal(options.isPrimary(), true);
  for (const [time, continuous] of [['00:30:00', false], ['09:25:00', false], ['09:30:00', true], ['11:30:00', false],
    ['12:00:00', false], ['13:00:00', true], ['14:56:59', true], ['14:57:00', false]]) {
    x.set({now: at(day, time)});
    assert.equal(context.marketDisplaySession(x.now()).day, '20261125');
    assert.equal(options.session(x.now()).day, day); assert.equal(options.session(x.now()).continuous, continuous, time);
  }
  assert.equal(context.centerEvidenceRuntime(), context.centerEvidenceRuntime()); assert.equal(x.factoryCalls(), 1);
});

test('production observer delegates history to the single bounded background collector', async t => {
  const x = await setup(t);
  assert.equal(x.options.historyDay,undefined);assert.equal(x.options.historySymbols,undefined);assert.equal(x.options.collectHistory,undefined);
  assert.equal((source.match(/decisionBackground\(\)\.tick\(\)/g)||[]).length,1);
  assert.doesNotMatch(source,/centerEvidenceRuntime\(\)\.tickHistory\(/);
  const background=section('function decisionBackground(){','let _paperConditionalStore');
  assert.equal((background.match(/action:'intelligence-history-collect'/g)||[]).length,1);
  assert.match(background,/historyCandidates:/);assert.match(background,/collectFinancials:/);
  assert.equal(x.calls.history.length,0);
});

test('real server readContext shares its post-await clock with original quote evidence, entry/exit checks and the real observer', async t => {
  const x = await setup(t), before = JSON.stringify({book: x.book, plan: x.plan, wire: x.wire});
  const context = await x.options.readContext([x.plan]);
  assert.equal(context.now, x.initialNow + 8); assert.equal(context.now, x.now());
  assert.equal(x.calls.rules, 1); assert.equal(x.calls.decisions, 1);
  assert.equal(context.book, x.book); assert.equal(context.calendar.isOpen(day), true);
  const q = context.quotes[x.plan.code], entry = context.entryEligibilityByPlan[x.plan.id], exit = context.exitEligibilityByPlan[x.plan.id];
  assert.equal(q.symbol, x.plan.code); assert.equal(q.tradeDate, day); assert.equal(q.quoteAt, x.wire.quoteAt);
  assert.equal(q.timestamp, x.wire.quoteAt); assert.equal(q.receivedAt, x.wire.receivedAt);
  assert.equal(q.quoteSource, x.wire.quoteSource); assert.equal(q.provider, x.wire.quoteSource);
  assert.equal(q.volume, x.wire.volume * 100); assert.equal(q.inputProvenance.price.quoteAt, x.wire.quoteAt);
  assert.equal(entry.allowed, true); assert.equal(entry.quantity, 100); assert.equal(entry.checkedAt, context.now);
  assert.equal(exit.allowed, true); assert.equal(exit.checkedAt, context.now);
  assert.equal(entry.quoteAt, q.quoteAt); assert.equal(exit.quoteAt, q.quoteAt);
  const current = x.options.session(context.now);
  const result = x.options.observe({...context, plans: [x.plan], day: current.day, continuous: current.continuous});
  assert.deepEqual(result.rejected, []); assert.equal(result.records.length, 1);
  assert.equal(result.records[0].day, day); assert.equal(result.records[0].observedAt, context.now);
  assert.equal(result.records[0].quoteAt, x.initialNow - 1000);
  assert.equal(result.alerts[0].kind, 'entry'); assert.equal(result.alerts[0].availability, 'allowed');
  assert.equal(JSON.stringify({book: x.book, plan: x.plan, wire: x.wire}), before);
});

test('production exit receipts retain paused-account and original limit-down exclusions instead of certifying a window', async t => {
  const x = await setup(t); x.book.legacy.enabled = false;
  let context = await x.options.readContext([x.plan]);
  assert.equal(context.exitEligibilityByPlan[x.plan.id].allowed, false); assert.match(context.exitEligibilityByPlan[x.plan.id].reason, /暂停/);
  x.book.legacy.enabled = true; x.wire.price = 9;
  context = await x.options.readContext([x.plan]);
  assert.equal(context.quotes[x.plan.code].price, 9);
  assert.equal(context.exitEligibilityByPlan[x.plan.id].allowed, false); assert.match(context.exitEligibilityByPlan[x.plan.id].reason, /跌停/);
  assert.equal(context.exitEligibilityByPlan[x.plan.id].quoteAt, x.wire.quoteAt);
  assert.equal(context.entryEligibilityByPlan[x.plan.id].allowed, false);
});

test('production readContext prechecks only today or the historical plan bound to a currently held original purchase lot', async t => {
  const x = await setup(t);
  const oldDay = '2026-11-24';
  const oldPlan = (number, code = '600001') => {
    const card = {...x.card, code, day: oldDay, calculatedAt: at(oldDay, '09:29:30'), strategyAt: at(oldDay, '09:29:00')};
    return bindAuthoritativePlan({id: 'plan-00000000-0000-4000-8000-' + String(number).padStart(12, '0'), sampleSet: 'real',
      frozenAt: new Date(at(oldDay, '09:29:50')).toISOString(), ...decisionPlanPayload(card)}, card);
  };
  const held = oldPlan(2), otherPlanSameCode = oldPlan(3), unheld = oldPlan(4, '600002');
  const event = {eventId: 'held-original-buy', side: 'buy', symbol: held.code, quantity: 100, price: 10,
    tradeDate: oldDay, timestamp: at(oldDay, '10:00:00'), reason: '作战台计划[' + held.id + '] 原账户风控'};
  x.book.account.events.push(event);
  x.book.account.positions[held.code] = {quantity: 100, lots: [{quantity: 100, buyDate: oldDay,
    price: 10, cost: 1000, sourceEventId: event.eventId}]};
  const inputPlans = [x.plan, held, otherPlanSameCode, unheld], before = JSON.stringify({inputPlans, book: x.book});
  let context = await x.options.readContext(inputPlans);
  assert.deepEqual(Object.keys(context.entryEligibilityByPlan).sort(), [x.plan.id, held.id].sort());
  assert.deepEqual(Object.keys(context.exitEligibilityByPlan).sort(), [x.plan.id, held.id].sort());
  assert.equal(context.entryEligibilityByPlan[held.id].allowed, false);
  assert.match(context.entryEligibilityByPlan[held.id].reason, /持久成交/);
  assert.equal(JSON.stringify({inputPlans, book: x.book}), before);
  // Keeping the buy in the ledger alone must not keep a closed position active.
  delete x.book.account.positions[held.code];
  context = await x.options.readContext(inputPlans);
  assert.deepEqual(Object.keys(context.entryEligibilityByPlan), [x.plan.id]);
  assert.deepEqual(Object.keys(context.exitEligibilityByPlan), [x.plan.id]);
});

test('queued production alerts recheck enablement, original quote age, session, date and primary status before delivery', async t => {
  const x = await setup(t); x.set({configured: true});
  const alert = await x.commitObservation();
  assert.equal(await x.options.sendPrivate(alert), true);
  const queued = x.calls.push.at(-1)[2];
  assert.equal(typeof queued.beforeSend, 'function'); assert.equal(queued.beforeSend().ok, true);
  const dispatchAt = x.now();
  for (const patch of [{enabled: false}, {replica: true}, {configured: false}, {now: alert.quoteAt + 15001},
    {now: at('2026-11-26', '10:00:00')}]) {
    x.set({now: dispatchAt, enabled: true, replica: false, configured: true}); x.set(patch);
    assert.equal(queued.beforeSend().ok, false); const count = x.calls.push.length;
    assert.equal(await x.options.sendPrivate(alert), false); assert.equal(x.calls.push.length, count);
  }
  x.set({now: dispatchAt, enabled: true, replica: false, configured: true});
  // Frozen queued evidence does not trust a caller-mutated alert object.
  assert.equal(await x.options.sendPrivate({...alert, day: '2026-11-24'}), false);
  assert.equal(await x.options.sendPrivate({...alert, quoteAt: dispatchAt + 1}), false);
  assert.equal(x.calls.push.length, 1);
  const lunch = await setup(t); lunch.set({configured: true, now: at(day, '11:29:59')}); lunch.refreshQuote();
  const lunchAlert = await lunch.commitObservation();
  assert.equal(await lunch.options.sendPrivate(lunchAlert), true);
  const beforeLunch = lunch.calls.push.at(-1)[2].beforeSend;
  assert.equal(beforeLunch().ok, true); lunch.set({now: at(day, '11:30:00')});
  assert.equal(lunch.now() - lunchAlert.quoteAt, 1000); assert.equal(beforeLunch().ok, false);
});

test('production holding-risk classification requires a committed stop or target tied to the actual authoritative entry', async t => {
  for (const kind of ['entry', 'stop', 'target']) {
    const x = await setup(t); x.set({configured: true});
    const entry = kind === 'entry' ? null : x.purchase();
    x.refreshQuote(kind === 'stop' ? 9.3 : kind === 'target' ? 10.9 : 10);
    const alert = await x.commitObservation(), holdingRisk = kind !== 'entry';
    assert.equal(alert.kind, kind); assert.equal(alert.entryEventId, entry?.eventId || null);
    // A caller cannot manufacture the old holding-risk quota exemption.
    assert.equal(await x.options.sendPrivate({...alert, entryEventId: holdingRisk ? null : 'forged-buy-event'}), false);
    assert.equal(x.calls.push.length, 0);
    const before = fs.readFileSync(x.authorityFile, 'utf8');
    assert.equal(await x.options.sendPrivate(alert), true);
    const [message, force, delivery] = x.calls.push.at(-1);
    assert.equal(message.split('\n')[0], holdingRisk ? '═══ 持仓风控·计划条件观察 ═══' : '═══ 计划条件观察 ═══');
    assert.equal(force, false); assert.equal(delivery.private, true); assert.equal(delivery.sseEdit, true);
    assert.equal(delivery.signalRefs[0].type, 'plan-' + kind);
    assert.equal(delivery.signalRefs[0].signalId, alert.id);
    assert.equal(fs.readFileSync(x.authorityFile, 'utf8'), before);
    const gate = {todayStr: () => '20261125', envCold: () => false, _govCfg: () => 0};
    vm.createContext(gate);
    vm.runInContext(section('const MSG_CAP = ', '// ⛔⛔ 返回值语义'), gate, {filename: 'production-message-quota-contract.js'});
    gate.msgGate('═══ 普通信息 ═══', false); // Consume the unchanged one-message bucket.
    assert.equal(gate.msgGate(message, false).kind, holdingRisk ? '日报' : '其它');
    assert.equal(gate.msgGate(message, false).ok, holdingRisk); // Only actual holding alerts bypass the existing one-message bucket.
  }
});

test('actual factory binds private research, delegates history and keeps notifications on original primary private channel', async t => {
  const x = await setup(t); assert.equal(x.options.store, x.store);
  await x.options.readArchive();
  assert.equal(x.calls.archive[0].action, 'shortline'); assert.equal(x.calls.archive[0].book, 'main');
  assert.equal(x.calls.archive[0].root, '/private-fixture/shortline-research'); assert.equal(x.calls.archive[0].replica, false);
  assert.equal(x.options.collectHistory,undefined);assert.equal(x.calls.history.length,0);
  const alert = await x.commitObservation();
  x.set({replica: true, configured: true}); assert.equal(await x.options.sendPrivate(alert), false); assert.equal(x.calls.push.length, 0);
  x.set({replica: false, configured: false}); assert.equal(await x.options.sendPrivate(alert), false);
  x.set({configured: true}); assert.equal(await x.options.sendPrivate(alert), true);
  const [message, force, delivery] = x.calls.push[0];
  assert.equal(force, false); assert.equal(delivery.private, true); assert.equal(delivery.sseEdit, true);
  assert.equal(delivery.signalRefs[0].ts, x.wire.quoteAt); assert.equal(delivery.signalRefs[0].signalId, alert.id);
  assert.match(message, new RegExp(new Date(x.wire.quoteAt).toISOString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(message,/成交以原账本为准/);assert.doesNotMatch(message,/尚未下单/);
});

test('production conditional queue delegates every notification to the common plan observer',()=>{
  const run=section('async function runPaperConditionalOrders(){','function buildMobileDigest(');
  assert.match(run,/notificationOwner:'plan-observer'/);
  assert.doesNotMatch(run,/\bnotify\s*:/);
  assert.doesNotMatch(source,/function notifyPaperConditional\(/);
});

function privatePushHarness({requiresNewsReview = false} = {}) {
  const queued = [], checks = [], logs = []; let newsAllowed = true, releases = 0;
  const context = {
    process: {env: {}}, S: {config: {}}, Date, console: {log() {}, error() {}},
    prepareRecommendationDelivery: text => ({ok: true, text, kind: 'current-recommendation', requiresNewsReview,
      ...(requiresNewsReview ? {newsRows: [{code: '600000'}]} : {})}),
    redactSecrets: text => text, extractStockCodes: () => ['600000'], inManualPush: () => false, isReplica: () => false,
    msgGate: () => ({ok: true, release() { releases++; }}), MSG_STAT: {blocked: 0}, inQuietHours: () => false,
    sseSendEdit() {}, privReady: () => true, pushLog: (...args) => logs.push(args), _pushLast: {},
    govReleaseAll() {}, modDayRelease() {}, feishuSecMask: () => 'masked', sendResultUnknown: () => false,
    recommendationNewsReview() {
      checks.push('news');
      return {canRecommend: newsAllowed, status: newsAllowed ? 'clear' : 'blocked', reason: newsAllowed ? '已核对' : '原新闻闸拒绝',
        reviews: [{code: '600000', status: newsAllowed ? 'clear' : 'blocked', reason: '核验回执', matches: []}]};
    },
    feishuSecId: () => 'isolated-private-queue',
    _fsPrivateQueue: {send(job, callback, options) { queued.push({text: job.text, options, job, callback}); }},
    feishuSend() { assert.fail('private hook must never reach the public bot'); },
    sendQQMail() { assert.fail('private hook must never reach email'); }
  };
  const start = source.indexOf('function pushAll('), end = source.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  const extract = name => {
    const a = source.indexOf('function ' + name + '('), b = source.indexOf('\n}\n', a) + 2;
    assert.ok(a >= 0 && b > a); return source.slice(a, b);
  };
  vm.createContext(context);
  vm.runInContext([extract('freezeNewsRecommendationRows'), extract('feishuSendPrivate'), source.slice(start, end)].join('\n'),
    context, {filename: 'production-pushAll-contract.js'});
  return {context, queued, checks, logs, releases: () => releases, setNews: value => { newsAllowed = value; }};
}

test('real factory hook survives actual pushAll composition and reaches the private queue with live validity and truthful receipt evidence', async t => {
  const x = await setup(t), push = privatePushHarness();
  x.context.pushAll = push.context.pushAll; x.set({configured: true});
  x.purchase(); x.refreshQuote(9.3); const alert = await x.commitObservation();
  const before = fs.readFileSync(x.authorityFile, 'utf8');
  assert.equal(await x.options.sendPrivate(alert), true); assert.equal(push.queued.length, 1);
  const passed = push.queued[0].options;
  assert.equal(passed.private, true); assert.equal(passed.sseEdit, true); assert.equal(passed.beforeSend().ok, true);
  assert.equal(passed.signalRefs[0].signalId, alert.id); assert.equal(passed.signalRefs[0].ts, alert.quoteAt);
  push.queued[0].callback(true, 'ok'); await Promise.resolve();
  const report = await x.riskRuntime().read({accountId: 'pool'});
  const group = report.alerts.groups.find(row => row.rootCauseId.endsWith('/stop'));
  assert.equal(group.notification.status, 'gateway-accepted'); assert.equal(group.notification.receiverConfirmed, false);
  assert.equal(await x.options.sendPrivate(alert), false); assert.equal(push.queued.length, 1);
  assert.equal(fs.readFileSync(x.authorityFile, 'utf8'), before);
  const denied = await setup(t), stopped = privatePushHarness();
  denied.context.pushAll = stopped.context.pushAll; denied.set({configured: true});
  const blockedAlert = await denied.commitObservation();
  assert.equal(await denied.options.sendPrivate(blockedAlert), true);
  denied.set({enabled: false}); assert.equal(stopped.queued[0].options.beforeSend().ok, false);
  stopped.queued[0].callback(false, '私密消息出队条件已失效'); await Promise.resolve();
  const blocked = await denied.riskRuntime().read({accountId: 'pool'});
  assert.equal(blocked.alerts.groups.find(row => row.rootCauseId.endsWith('/entry')).notification.status, 'gateway-rejected');
  assert.equal(stopped.releases(), 1);
});

test('actual pushAll preserves original news rejection before the caller hook, both at enqueue and queue retry', async () => {
  const push = privatePushHarness({requiresNewsReview: true}); let callerAllowed = true;
  const caller = () => { push.checks.push('caller'); return {ok: callerAllowed, why: callerAllowed ? '' : '原计划已过期'}; };
  assert.equal(push.context.pushAll('600000 计划条件观察', false, {private: true, beforeSend: caller}), true);
  assert.equal(push.queued.length, 1); const queued = push.queued[0].options;
  push.checks.length = 0; assert.equal(queued.beforeSend().ok, true); assert.deepEqual(push.checks, ['news', 'caller']);
  push.setNews(false); push.checks.length = 0;
  const denied = queued.beforeSend();
  assert.equal(denied.ok, false); assert.match(denied.why, /新闻避险/); assert.deepEqual(push.checks, ['news']);
  assert.equal(callerAllowed, true); // A caller's true result cannot override the news gate.
  push.setNews(true); callerAllowed = false; push.checks.length = 0;
  assert.equal(queued.beforeSend().ok, false); assert.deepEqual(push.checks, ['news', 'caller']);
  const initiallyBlocked = privatePushHarness({requiresNewsReview: true}); initiallyBlocked.setNews(false);
  assert.equal(initiallyBlocked.context.pushAll('600000 计划条件观察', false, {private: true,
    beforeSend: () => assert.fail('caller must not run before an initial news rejection')}), false);
  assert.equal(initiallyBlocked.queued.length, 0); assert.equal(initiallyBlocked.releases(), 1);
  await Promise.resolve();
});
