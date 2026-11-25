import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseSelectionCommand, evaluateSelectionCommand, selectionCommandDay, createCommandSelection} from '../public/nova/command-selection.mjs';
const require = createRequire(import.meta.url);
const {commandSelectionContext} = require('../src/core/command-selection-view.js');
const now = Date.parse('2026-11-25T14:00:00+08:00'), day = '2026-11-25';
const dates = ['2026-11-19','2026-11-20','2026-11-23','2026-11-24','2026-11-25'];
const isTradingDay = value => ![0, 6].includes(new Date(value + 'T12:00:00Z').getUTCDay());
const stock = (code, overrides = {}) => ({code, name: '隔离测试股票 ' + code, sector: '半导体', score: 80,
  quoteAt: now - 1000, quoteSource: 'eastmoney', tradeDate: day, price: 10, ...overrides});
const funds = (main = 100, overrides = {}) => dates.map(date => ({date, main, source: 'eastmoney',
  fundsMethod: 'vendor-order-size-estimate', unit: 'CNY', retrievedAt: now - 100, sourceTimestamp: null, ...overrides}));
function scenario(overrides = {}) {
  const rows = [stock('600001'), stock('600002', {score: 90}), stock('600003', {sector: '材料', score: 95})];
  const server = {candidatePool: rows, fundDays: new Map([['600001', funds(100)], ['600002', funds(300)], ['600003', funds(1000)]])};
  const state = {marketClock: {day, trading: true}, pool: rows, ...overrides};
  const flowContext = commandSelectionContext(server, {day, days: 5, now, isTradingDay});
  return {server, state, flowContext};
}

test('bounded grammar accepts the requested five-day chip query and normalizes fullwidth digits', () => {
  const query = parseSelectionCommand('近５日主力净流入前５的芯片股');
  assert.deepEqual({...query, raw: ''}, {ok: true, metric: 'flow', days: 5, limit: 5, theme: '芯片', explicitAllMarket: false, raw: ''});
  assert.equal(parseSelectionCommand('芯片股按精选评分前3').theme, '芯片');
  assert.equal(parseSelectionCommand('共振分前3').metric, 'resonance');
});

test('unsupported conditions and historical score windows fail visibly instead of dropping clauses', () => {
  for (const query of ['近5日评分前3', '评分前3且利润大于2', '明日保证涨停', '评分前0', '评分前99', '近11日主力净流入前5', '评分共振前3', ''])
    assert.equal(parseSelectionCommand(query).ok, false, query);
});

test('compound conditions preserve every comparison and normalize percentages and CNY amount units',()=>{
  const query=parseSelectionCommand('近５日主力净流入前５的芯片股，评分至少８０且涨幅小于５％且成交额大于１亿元且排除ST');
  assert.equal(query.ok,true);assert.equal(query.days,5);assert.equal(query.theme,'芯片');
  assert.deepEqual(query.filters.map(f=>[f.metric,f.op,f.value]),[['score','>=',80],['pct','<',5],['amount','>',1e8],['notST','exclude',undefined]]);
  assert.equal(parseSelectionCommand('评分前3且共振>=2').filters[0].value,2);
  for(const text of ['评分前3且换手率小于2亿元','评分前3或者共振前3','评分前3且未知条件','评分前3且精选评分大于101',
    '评分前3且共振大于2.5','评分前3且涨幅小于5%且保证明天盈利','评分前3且不含次新'])
    assert.equal(parseSelectionCommand(text).ok,false,text);
});

test('compound ranking excludes failed conditions, retains original evidence and never turns missing values into zero',()=>{
  const args=scenario();
  args.state.pool.forEach(row=>Object.assign(row,{receivedAt:now-500,quoteMode:'public-live-unverified',pct:3,amount:2e8,turnover:2,suspended:false}));
  args.state.pool[0].pct=6;
  const query='近5日主力净流入前5的芯片股且评分至少80且涨幅小于5%且成交额大于1亿元且排除停牌';
  const value=evaluateSelectionCommand(query,{...args,now});
  assert.deepEqual(value.items.map(row=>row.code),['600002']);assert.equal(value.coverage.filtered,1);
  assert.equal(value.items[0].commandConditions.length,4);assert.match(value.items[0].selectionWhy,/涨幅.*实际 3%.*原时点/);
  args.state.pool[1].amount=null;
  const missing=evaluateSelectionCommand(query,{...args,now});
  assert.equal(missing.status,'data-missing');assert.equal(missing.coverage.missing,1);assert.match(missing.message,/成交额.*原值、单位或时点/);
  args.state.pool[1].amount=0;
  const zero=evaluateSelectionCommand(query,{...args,now});assert.equal(zero.status,'no-match');assert.equal(zero.coverage.missing,0);
});

test('compound filters require their own original quote clocks and cannot silently assume normal trade status',()=>{
  const state={marketClock:{day},pool:[stock('600001',{pct:2,amount:1e8,quoteMode:'public-live-unverified'})]};
  assert.equal(evaluateSelectionCommand('评分前3且涨幅大于1%',{state,now}).status,'data-missing');
  state.pool[0].receivedAt=now-500;
  assert.equal(evaluateSelectionCommand('评分前3且涨幅大于1%',{state,now}).items.length,1);
  assert.equal(evaluateSelectionCommand('评分前3且排除停牌',{state,now}).status,'data-missing');
  state.pool[0].suspended=false;
  assert.equal(evaluateSelectionCommand('评分前3且排除停牌',{state,now}).items.length,1);
  state.pool[0].amountUnit='USD';
  assert.equal(evaluateSelectionCommand('评分前3且成交额大于1万元',{state,now}).items.length,0);
});

test('the read projection preserves original daily dates, unknown amounts and knownAt without altering state', () => {
  const {server} = scenario();
  server.fundDays.get('600001')[0].main = null;
  const before = JSON.stringify([...server.fundDays]);
  const result = commandSelectionContext(server, {day, days: 5, now, isTradingDay});
  assert.deepEqual(result.expectedDays, dates);
  assert.equal(result.flowHistory['600001'][0].main, null);
  assert.equal(result.flowHistory['600001'][0].knownAt, now - 100);
  assert.equal(result.flowHistory['600001'][0].sourceTimestamp, null);
  assert.equal(result.coverage.complete, 2);
  assert.equal(result.canTrade, false);
  assert.equal(JSON.stringify([...server.fundDays]), before);
});

test('a complete five-trading-day history ranks chip/semiconductor samples with original evidence', () => {
  const args = scenario();
  const result = evaluateSelectionCommand('近5日主力净流入前5的芯片股', {...args, now});
  assert.deepEqual(result.items.map(row => row.code), ['600002', '600001']);
  assert.deepEqual(result.items.map(row => row.commandValue), [1500, 500]);
  assert.match(result.items[0].selectionWhy, /半导体.*2026-11-19 至 2026-11-25.*eastmoney/);
  assert.match(result.scope, /非全市场/);
  assert.ok(result.items.every(row => row.canTrade === false && row.commandObservation));
});

test('today funds cannot impersonate five days and incomplete coverage stays explicit', () => {
  const args = scenario();
  args.flowContext.flowHistory['600002'].pop();
  args.state.pool[1].mainInflow = 1e12;
  args.state.pool[1].fundsSourceTimestamp = now - 2000;
  args.state.pool[1].fundsRetrievedAt = now - 1000;
  args.state.pool[1].fundsSource = 'eastmoney';
  args.state.pool[1].fundsMethod = 'vendor-order-size-estimate';
  args.state.pool[1].fundsUnit = 'CNY';
  const result = evaluateSelectionCommand('近5日主力净流入前5的芯片股', {...args, now});
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.missing, 1);
  assert.deepEqual(result.items.map(row => row.code), ['600001']);
  assert.match(result.message, /1 只缺少完整 5 个交易日/);
});

test('unknown/zero/negative funds remain distinct and never become a positive inflow candidate', () => {
  const args = scenario();
  args.flowContext.flowHistory['600001'].forEach(row => row.main = 0);
  args.flowContext.flowHistory['600002'].forEach(row => row.main = -1);
  let result = evaluateSelectionCommand('近5日主力净流入前5的芯片股', {...args, now});
  assert.equal(result.status, 'no-match');assert.equal(result.coverage.missing, 0);assert.equal(result.items.length, 0);
  args.flowContext.flowHistory['600001'][0].main = null;
  result = evaluateSelectionCommand('近5日主力净流入前5的芯片股', {...args, now});
  assert.equal(result.status, 'data-missing');assert.equal(result.coverage.missing, 1);
});

test('duplicate dates, mixed sources, future receipts and unverified units invalidate a funds window', () => {
  const mutations = [
    rows => rows.push({...rows[0], main: 999999}),
    rows => {rows[0].source = 'another-provider';},
    rows => {rows[0].knownAt = now + 1;rows[0].retrievedAt = now + 1;},
    rows => {rows[0].unit = '万元';},
    rows => {rows[0].fundsMethod = 'price-proxy';},
    rows => {rows[0].sourceTimestamp = now - 1000;}
  ];
  for (const mutate of mutations) {
    const args = scenario();
    args.state.pool = args.state.pool.slice(0, 1);
    mutate(args.flowContext.flowHistory['600001']);
    const result = evaluateSelectionCommand('近5日主力净流入前5', {...args, now});
    assert.equal(result.status, 'data-missing');assert.deepEqual(result.items, []);
  }
});

test('the projection rejects future, synthetic and missing acquisition times without inventing timestamps', () => {
  const {server} = scenario();
  server.fundDays.set('600001', funds(100, {retrievedAt: undefined}));
  server.fundDays.set('600002', funds(100, {retrievedAt: now + 1}));
  server.fundDays.set('600003', funds(100, {synthetic: true}));
  const result = commandSelectionContext(server, {day, days: 5, now, isTradingDay});
  assert.equal(result.coverage.complete, 0);assert.equal(result.coverage.rejectedRecords, 15);
  assert.ok(Object.values(result.flowHistory).every(rows => rows.length === 0));
});

test('missing trading calendar does not treat five observed records as five consecutive trading days', () => {
  const args = scenario();
  args.flowContext = commandSelectionContext(args.server, {day, days: 5, now});
  assert.equal(args.flowContext.status, 'missing-calendar');
  assert.deepEqual(args.flowContext.expectedDays, []);
  assert.equal(evaluateSelectionCommand('近5日主力净流入前5', {...args, now}).status, 'data-missing');
});

test('old dates, source-less quotes and blocked candidates cannot enter same-day score results', () => {
  const state = {marketClock: {day}, pool: [stock('600001'), stock('600002', {blocked: true}),
    stock('600003', {quoteAt: now - 86400000, tradeDate: '2026-11-24'}),
    stock('600004', {quoteSource: undefined}), stock('600005', {quoteAt: undefined, tradeDate: undefined}),
    stock('600006', {synthetic: true}), stock('600007', {score: null})]};
  const result = evaluateSelectionCommand('精选评分前5', {state, now});
  assert.deepEqual(result.items.map(row => row.code), ['600001']);
  assert.equal(result.coverage.missing, 1);
});

test('score and resonance rankings use independent strategy membership rather than repeated factors', () => {
  const {state} = scenario();
  state.pool[1].signals = ['趋势条件', '资金条件', '位置条件'];
  const resonanceByCode = {
    '600001': {day, count: 2, strategies: [{id: 'ranked', day}, {id: 'relay-first', day}, {id: 'relay-first', day}]},
    '600002': {day, count: 1, strategies: [{id: 'ranked', day}]},
    '600003': {day, count: 1, strategies: [{id: 'ranked', day}]}
  };
  const result = evaluateSelectionCommand('共振分前3', {state, now, resonanceByCode});
  assert.equal(result.items[0].code, '600001');assert.equal(result.items[0].commandValue, 2);
  assert.equal(result.items.find(row => row.code === '600002').commandValue, 1);
  const score = evaluateSelectionCommand('精选评分前2', {state, now});
  assert.deepEqual(score.items.map(row => row.code), ['600003', '600002']);
  assert.equal(evaluateSelectionCommand('共振分前3', {state, now}).status, 'data-missing', 'the frontend never invents missing authoritative resonance');
});

test('source date remains the closed-session day and limits are enforced by the projection', () => {
  assert.equal(selectionCommandDay({closeSession: {day: '2026-11-24'}, marketClock: {day}}), '2026-11-24');
  assert.equal(commandSelectionContext({}, {day: '2026-02-30', now}).ok, false);
  assert.equal(commandSelectionContext({}, {day: '2026-11-26', now}).ok, false);
  assert.equal(commandSelectionContext({}, {day, days: 0, now}).ok, false);
  assert.equal(commandSelectionContext({}, {day, days: 11, now}).ok, false);
  const rows = Array.from({length: 205}, (_, n) => stock(String(600001 + n)));
  const result = commandSelectionContext({candidatePool: rows}, {day, days: 5, now, isTradingDay});
  assert.equal(result.coverage.returned, 200);assert.equal(result.coverage.truncated, true);
});

class El {
  constructor(tag) {this.tag = tag;this.children = [];this.listeners = {};this.dataset = {};this.disabled = false;this.value = '';}
  append(...children) {this.children.push(...children);}
  prepend(...children) {this.children.unshift(...children);}
  replaceChildren(...children) {this.children = children;}
  addEventListener(name, callback) {this.listeners[name] = callback;}
  setAttribute(key, value) {this[key] = value;}
}
const text = node => [node?.textContent || '', ...(node?.children || []).map(text)].join(' ');
const find = (node, fn) => fn(node) ? node : (node.children || []).map(child => find(child, fn)).find(Boolean);
test('command UI loads only on submit, reuses same-day history and exposes no mutating API', async () => {
  global.Node = El;
  global.document = {createElement: tag => new El(tag), createTextNode: textContent => Object.assign(new El('text'), {textContent})};
  const actualNow = Date.now(), actualDay = new Date(actualNow + 28800000).toISOString().slice(0,10);
  const row = stock('600001', {tradeDate: actualDay, quoteAt: actualNow - 1000});
  const calls = [], updates = [], controller = new AbortController();
  const ctx = {state: {marketClock: {day: actualDay}, pool: [row]}, signal: controller.signal,
    api: async (...args) => {calls.push(args);return {ok: true, day: actualDay, days: 5, expectedDays: [], flowHistory: {}};},
    onState: fn => updates.push(fn), selectStock() {}};
  const view = createCommandSelection(ctx);
  assert.deepEqual(calls, []);
  const input = find(view, node => node.tag === 'input'), form = find(view, node => node.tag === 'form');
  input.value = '近5日主力净流入前5的芯片股';
  form.listeners.submit({preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);assert.equal(calls[0][0], '/api/selection-command/context?days=5');
  assert.equal(calls[0][1].method, undefined);
  assert.match(text(view), /暂不生成排名/);
  form.listeners.submit({preventDefault() {}});await new Promise(resolve => setImmediate(resolve));
  updates[0]();assert.equal(calls.length, 1);
  controller.abort();
});
