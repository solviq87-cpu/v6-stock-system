'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReferenceStrategyStats } = require('../src/ui/reference-strategy-stats');

test('four strategy counts use explicit attribution only and deduplicate stock codes', () => {
  const result = buildReferenceStrategyStats([
    { code:'600000', strategy:'十四条选股' },
    { code:'600000', strategy:'rule14' },
    { code:'000001', strategy:'八字口诀' },
    { code:'300001', strategy:'GPT五策略' },
    { code:'300002', strategy:'Python三轮筛选' },
    { code:'600003' }
  ], 123);
  assert.equal(result.items.rule14.count, 1);
  assert.equal(result.items.rule14.attributedRows, 2);
  assert.equal(result.items.bazi.count, 1);
  assert.equal(result.items.gpt.count, 1);
  assert.equal(result.items.python.count, 1);
  assert.equal(result.items.rule14.status, 'attributed');
});

test('missing strategy attribution remains unavailable rather than inferred from aggregate pool', () => {
  const result = buildReferenceStrategyStats([{ code:'600000' }, { code:'000001', score:95 }]);
  for (const key of ['rule14','bazi','gpt','python']) {
    assert.equal(result.items[key].count, null);
    assert.equal(result.items[key].status, 'unavailable');
  }
});

test('invalid input is safe and response explains count semantics', () => {
  const result = buildReferenceStrategyStats(null, 'bad');
  assert.equal(result.candidatePoolSize, 0);
  assert.ok(Number.isFinite(result.asOf));
  assert.match(result.note, /不是策略绩效或收益统计/);
});
