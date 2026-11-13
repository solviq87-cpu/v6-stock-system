'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../V6_WEB/workbuddy/index.html'), 'utf8'
);

// Extract the deployed functions rather than recreating the execution gate.
function extractFunction(name) {
  const match = new RegExp('\\b(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(source);
  assert.ok(match, 'Missing live function: ' + name);
  const start = source.indexOf('{', match.index + match[0].length);
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2);
      if (end === -1) break;
      i = end;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      assert.notEqual(end, -1, 'Unclosed comment in ' + name);
      i = end + 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}' && --depth === 0) {
      return source.slice(match.index, i + 1);
    }
  }
  assert.fail('Unclosed live function: ' + name);
}

const liveFunctions = extractFunction('marketScanAllowed') + '\n' + extractFunction('paperQuoteStatus') + '\n' +
  extractFunction('battleTrade');
const NOW = Date.UTC(2026, 10, 13, 5, 45, 0);
const SYMBOL = 'offline-symbol';

function harness({ ageMs = 0, stock = {}, enabled = true, hidden = false,
  missingStock = false, riskResult = { ok: true } } = {}) {
  const at = new Date(NOW - ageMs).toISOString();
  const row = { symbol: SYMBOL, price: 10, isStale: false,
    providerDateKnown: true, quoteAt: at, providerTime: at, receivedAt: at,
    ...stock };
  const trace = [];
  const coreCalls = [];
  const riskCalls = [];
  const accepted = { ok: true, marker: 'core-result' };
  const context = {
    Date: class FixedDate extends Date {
      constructor(...args) { super(...(args.length ? args : [NOW])); }
      static now() { return NOW; }
    },
    Number,
    validNumber: value => typeof value === 'number' && Number.isFinite(value),
    document: { hidden },
    window: {
      V6Market: { status: { collectionEnabled: enabled }, sessionAt: () => ({open:true}) },
      V6Battle: { checkOrder(...args) {
        trace.push('risk'); riskCalls.push(args); return riskResult;
      } }
    },
    C: { stocks: missingStock ? [] : [row], trade(...args) {
      trace.push('core'); coreCalls.push(args); return accepted;
    } },
    battleSnapshot: () => ({ source: 'offline-snapshot' }),
    fetch() { assert.fail('Network transport must not run in this test'); }
  };
  vm.createContext(context);
  vm.runInContext(liveFunctions +
    '\nglobalThis.liveReview = { paperQuoteStatus, battleTrade };',
  context, { timeout: 1000 });
  return { ...context.liveReview, context, trace, coreCalls, riskCalls, accepted };
}

function order(side = 'buy') {
  return { symbol: SYMBOL, side, quantity: 100 };
}

function assertBlocked(options) {
  for (const side of ['buy', 'sell']) {
    const h = harness(options);
    assert.equal(h.battleTrade({ cash: 10000 }, order(side)).ok, false, side);
    assert.equal(h.coreCalls.length, 0, side + ' must not call core trade');
    assert.equal(h.riskCalls.length, 0, side + ' must stop before risk/core');
  }
}

test('fresh buy preserves the original risk check and core trade arguments', () => {
  const h = harness();
  const state = { cash: 10000 };
  const request = order();
  assert.equal(h.battleTrade(state, request), h.accepted);
  assert.deepEqual(h.trace, ['risk', 'core']);
  assert.equal(h.coreCalls.length, 1);
  assert.equal(h.coreCalls[0][0], state);
  assert.equal(h.coreCalls[0][1], request);
  assert.ok(h.riskCalls[0].includes(request));
});

test('the exact 15-second quote boundary passes and one millisecond older stops', () => {
  assert.equal(harness({ ageMs: 15000 }).battleTrade({}, order()).ok, true);
  assertBlocked({ ageMs: 15001 });
});

test('paused collection rejects buy and sell before core trade', () => {
  assertBlocked({ enabled: false });
});

test('a hidden page rejects buy and sell before core trade', () => {
  assertBlocked({ hidden: true });
});

test('stale or unknown-date quotes cannot reach risk or core trade', () => {
  assertBlocked({ stock: { isStale: true } });
  assertBlocked({ stock: { providerDateKnown: false } });
});

test('missing, invalid, or future quote evidence cannot reach core trade', () => {
  assertBlocked({ missingStock: true });
  assertBlocked({ stock: { price: 0 } });
  assertBlocked({ stock: { price: NaN } });
  assertBlocked({ stock: { quoteAt: null, providerTime: null, receivedAt: null } });
  assertBlocked({ ageMs: -5000 });
});

test('a fresh buy rejected by the existing risk check does not call core trade', () => {
  const h = harness({ riskResult: { ok: false, error: 'offline-risk-refusal' } });
  const result = h.battleTrade({}, order());
  assert.equal(result.ok, false);
  assert.equal(result.error, 'offline-risk-refusal');
  assert.deepEqual(h.trace, ['risk']);
  assert.equal(h.coreCalls.length, 0);
});

test('fresh sell preserves the existing core trade route', () => {
  const h = harness();
  const state = { positions: [{ symbol: SYMBOL, quantity: 100 }] };
  const request = order('sell');
  assert.equal(h.battleTrade(state, request), h.accepted);
  assert.equal(h.coreCalls.length, 1);
  assert.equal(h.coreCalls[0][0], state);
  assert.equal(h.coreCalls[0][1], request);
});

function shareHarness(options = {}) {
  const h = harness(options);
  const codecCalls = [];
  const apiCalls = [];
  const c = h.context;
  Object.assign(c, {
    BATTLE_KEY: 'offline-battle-key', battleSharing: false,
    battleSharedAt: 0, sharedBattleResult: null,
    state: { battleSettings: {}, selectionPolicy: {} },
    api(...args) { apiCalls.push(args); return Promise.resolve({}); }
  });
  c.window.V6Battle.normalizeSettings = value => value || {};
  c.window.V6Market.universe = { count: 5578 };
  c.window.V6StorageCodec = { async encode(...args) {
    codecCalls.push(args);
    return { encoding: 'offline-test', data: 'offline-payload' };
  } };
  vm.runInContext(extractFunction('shareBattleResult') +
    '\nglobalThis.actualShareBattleResult = shareBattleResult;',
  c, { timeout: 1000 });
  return { ...h, codecCalls, apiCalls, share: c.actualShareBattleResult };
}

function battleResult() {
  return { computedAt: new Date(NOW).toISOString(), status: 'ready',
    signals: [], coverage: {}, filterStats: {}, settings: {} };
}

test('actual snapshot sharing does not encode or write while paused or hidden', async () => {
  for (const options of [{ enabled: false }, { hidden: true }]) {
    const h = shareHarness(options);
    await h.share(battleResult());
    assert.equal(h.codecCalls.length, 0);
    assert.equal(h.apiCalls.length, 0);
  }
});

test('actual snapshot sharing rechecks pause after asynchronous encoding', async () => {
  const h = shareHarness();
  let finishEncoding;
  h.context.window.V6StorageCodec.encode = (...args) => {
    h.codecCalls.push(args);
    return new Promise(resolve => { finishEncoding = resolve; });
  };
  const pending = h.share(battleResult());
  assert.equal(h.codecCalls.length, 1, 'The enabled path must reach the real await');
  assert.equal(h.apiCalls.length, 0);
  h.context.window.V6Market.status.collectionEnabled = false;
  finishEncoding({ encoding: 'offline-test', data: 'offline-payload' });
  await pending;
  assert.equal(h.apiCalls.length, 0, 'Pausing during encode must prevent POST');
});

const tradeSubmitLine = source.split(/\r?\n/).find(line =>
  line.includes("if(event.target.id==='trade-form')"));
assert.ok(tradeSubmitLine, 'Missing actual trade submit handler');

for (const invalidation of ['paused', 'stale', 'session-ended']) {
  test('actual trade submit rechecks ' + invalidation + ' inside the commit mutation', async () => {
    const h = harness();
    const c = h.context;
    let mutations = 0;
    let writes = 0;
    let refusal = null;
    const fields = new Map();
    Object.assign(c, {
      state: { cash: 10000 }, busy: false,
      orderDraft: { symbol: SYMBOL, side: 'buy' }, portfolioTab: '',
      $(id) {
        if (!fields.has(id)) fields.set(id, { value: '100', innerHTML: '', close() {} });
        return fields.get(id);
      },
      refreshEstimate() {},
      navigate() { assert.fail('A rejected commit must not navigate'); },
      api() { writes += 1; return Promise.resolve({}); },
      async commit(mutator) {
        assert.equal(h.coreCalls.length, 1, 'Fresh preview must reach the original core');
        if (invalidation === 'paused') {
          c.window.V6Market.status.collectionEnabled = false;
        } else if (invalidation === 'session-ended') {
          c.window.V6Market.sessionAt = () => ({open:false,kind:'after-close'});
        } else {
          const staleAt = new Date(NOW - 16000).toISOString();
          Object.assign(c.C.stocks[0], {
            quoteAt: staleAt, providerTime: staleAt, receivedAt: staleAt
          });
        }
        mutations += 1;
        try {
          mutator(c.state);
          writes += 1;
          return true;
        } catch (error) {
          refusal = error;
          return false;
        }
      }
    });
    vm.runInContext('async function actualTradeSubmit(event) {\n' +
      tradeSubmitLine + '\n}\nglobalThis.actualTradeSubmit = actualTradeSubmit;',
    c, { timeout: 1000 });
    await c.actualTradeSubmit({ target: { id: 'trade-form' }, preventDefault() {} });
    assert.equal(mutations, 1);
    assert.ok(refusal, 'The actual commit mutation must reject changed evidence');
    assert.equal(h.coreCalls.length, 1, 'Only the fresh preview may reach core trade');
    assert.equal(h.riskCalls.length, 1, 'The second attempt must stop before risk/core');
    assert.equal(writes, 0, 'Rejected commit evidence must prevent persistence');
  });
}


test('session closure refuses a fresh paper quote before delayed effective-state timers fire', () => {
  const h = harness();
  assert.equal(h.context.window.V6Market.status.collectionEnabled, true);
  h.context.window.V6Market.sessionAt = () => ({open:false,kind:'after-close'});
  const result = h.battleTrade({}, order());
  assert.equal(result.ok, false);
  assert.equal(h.coreCalls.length, 0);
  assert.equal(h.riskCalls.length, 0);
});
