import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDraft, saveDraft, loadRecords, saveRecords, makeRecord, recordsToJSON, recordsToCSV} from '../public/records.mjs';

function fakeStorage(t) {
  const initial = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: storage});
  t.after(() => initial ? Object.defineProperty(globalThis, 'localStorage', initial) : delete globalThis.localStorage);
  return {storage, data};
}

function resultFixture() {
  return {
    version: 1,
    case: {stock: {day: '2026-05-28', code: '000001', name: '研究样本', sector: '样本题材'}, market: {}, portfolio: {}, evidence: {'1.1': 'yes'}},
    environment: {label: '全A偏弱', level: 'block', description: '模拟盘面', reasons: ['全A放量下跌']},
    advice: {label: '模拟暂停开仓', status: 'block', capPct: 0, message: '检查已有仓位', reasons: ['模拟风控命中']},
    summary: {matchedStrategies: 1, triggeredRisks: 2, matchedIndexes: 1, unknownRules: 88, knownCriteria: 12, totalCriteria: 400},
    rules: [
      {id: 1, name: '龙头战法', kind: 'strategy', status: 'matched', clauses: [{status: 'matched', level: 'match'}]},
      {id: 11, name: '强转弱规避因子', kind: 'risk', status: 'matched', clauses: [{status: 'matched', level: 'warn'}]},
      {id: 72, name: '指数放量杀跌风控因子', kind: 'index', status: 'matched', clauses: [{status: 'matched', level: 'block'}]},
      {id: 94, name: '两市成交额匹配指数', kind: 'index', status: 'matched', clauses: [{status: 'matched', level: 'info'}, {status: 'unmatched', level: 'warn'}]}
    ]
  };
}

test('a draft retains the exact evidence and resets safely on corrupt storage', t => {
  const {data} = fakeStorage(t);
  assert.equal(loadDraft(), null);
  const draft = {case: resultFixture().case, demo: false};
  assert.equal(saveDraft(draft), true);
  assert.deepEqual(loadDraft(), draft);
  const key = [...data.keys()][0];
  data.set(key, '{broken');
  assert.equal(loadDraft(), null);
  assert.equal(saveDraft({case: null}), false);
  data.set(key, JSON.stringify({case: {...draft.case, market: {allAStatus: 'invalid'}}}));
  assert.equal(loadDraft(), null);
  assert.equal(saveDraft({case: {stock: {}}}), false);
  assert.equal(saveDraft({...draft, demo: true}), true);
  assert.equal(loadDraft().demo, true);
});

test('records retain historical inputs and the matched risk branches at save time', t => {
  fakeStorage(t);
  assert.deepEqual(loadRecords(), []);
  const result = resultFixture();
  const record = makeRecord(result, {demo: true});
  assert.equal(record.demo, true);
  assert.equal(record.outcomePct, null);
  assert.equal(record.advice.capPct, 0);
  assert.deepEqual(record.strategies, ['龙头战法']);
  assert.deepEqual(record.risks, ['强转弱规避因子', '指数放量杀跌风控因子']);
  result.case.evidence['1.1'] = 'no';
  result.summary.matchedStrategies = 3;
  result.environment.reasons.push('更新后的环境说明');
  result.advice.reasons.push('更新后的模拟风控');
  assert.equal(record.case.evidence['1.1'], 'yes');
  assert.equal(record.summary.matchedStrategies, 1);
  assert.deepEqual(record.environment.reasons, ['全A放量下跌']);
  assert.deepEqual(record.advice.reasons, ['模拟风控命中']);
  assert.equal(saveRecords([record]), true);
  assert.deepEqual(loadRecords(), [record]);
});

test('corrupt nested case data never reaches the history views or replaces data on disk', t => {
  const {data} = fakeStorage(t);
  loadRecords();
  const record = makeRecord(resultFixture());
  assert.equal(saveRecords([record]), true);
  const key = [...data.keys()][0];
  const invalid = [
    {...record, case: {...record.case, stock: null}},
    {...record, case: {}},
    {...record, case: {...record.case, evidence: []}},
    {...record, case: {...record.case, market: {advances: -1}}},
    {...record, advice: {...record.advice, reasons: {}}}
  ];
  for (const item of invalid) {
    const raw = JSON.stringify([item]);
    data.set(key, raw);
    assert.deepEqual(loadRecords(), []);
    assert.equal(saveRecords([record]), false);
    assert.equal(data.get(key), raw);
  }
});

test('no silent history replacement after a storage error or an update from another tab', t => {
  const {storage, data} = fakeStorage(t);
  loadRecords();
  const oldRecord = makeRecord(resultFixture());
  const item = makeRecord(resultFixture());
  assert.equal(saveRecords([oldRecord]), true);
  const key = [...data.keys()][0];
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(saveRecords([item, oldRecord]), false);
  assert.deepEqual(loadRecords(), [oldRecord]);
  storage.setItem = (name, value) => data.set(name, value);
  data.set(key, JSON.stringify([item, oldRecord]));
  assert.equal(saveRecords([]), false);
  assert.deepEqual(loadRecords(), [item, oldRecord]);
  data.set(key, '[{broken');
  assert.deepEqual(loadRecords(), []);
  assert.equal(saveRecords([item]), false);
  assert.equal(data.get(key), '[{broken');
});

test('history length and personal review outcomes are retained in JSON', t => {
  fakeStorage(t);
  loadRecords();
  const entries = Array.from({length: 125}, (_, index) => ({...makeRecord(resultFixture()), id: String(index), outcomePct: index-100}));
  assert.equal(saveRecords(entries), true);
  const history = loadRecords();
  assert.equal(history.length, entries.length);
  const exported = JSON.parse(recordsToJSON(history));
  assert.equal(exported.schema, 'ashare-strategy-lab-reviews');
  assert.deepEqual(exported.records, entries);
  assert.equal(exported.records[0].case.stock.code, '000001');
});

test('CSV handles spreadsheet formulas, quotes, Unicode and negative numeric outcomes', () => {
  const item = makeRecord(resultFixture());
  item.case.stock.name = '  =HYPERLINK("sample")';
  item.case.stock.sector = '＠危险';
  item.note = '\t+SUM(1,2)\n第二行 "备注"';
  item.outcomePct = -4.5;
  const csv = recordsToCSV([item]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"\'  =HYPERLINK(""sample"")"'));
  assert.ok(csv.includes('"\'＠危险"'));
  assert.ok(csv.includes('"\'\t+SUM(1,2)\n第二行 ""备注"""'));
  assert.ok(csv.includes('"-4.5"'));
  assert.ok(csv.includes('"000001"'));
  assert.ok(!csv.includes('"\'-4.5"'));
});
