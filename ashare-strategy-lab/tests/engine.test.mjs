import assert from 'node:assert/strict';
import test from 'node:test';
import { CASE_VERSION, evaluate, normalizeCase } from '../public/engine.mjs';
import { RULES } from '../public/rules.mjs';
import { GROUPS } from '../public/schema.mjs';

const rule = (result, id) => result.rules.find(item => item.id === id);
const criterion = (result, id) => result.rules.flatMap(item => item.clauses.flatMap(branch => branch.criteria)).find(item => item.id === id);

function completeCase() {
  return {
    stock: { day: '2026-11-20', code: '600001', name: '合成标的', themeStatus: 'main', turnoverPct: 14, amount: 10 },
    market: { allAStatus: 'bull', shStatus: 'bull', cybStatus: 'bull', allAPct: 0.8, shPct: 0.7, cybPct: 0.9,
      advances: 3100, declines: 1400, amount: 11000, referenceAmount: 10000 },
    portfolio: { positionPct: 2, themePositionPct: 8, totalPositionPct: 25, offThemePositionPct: 0, lossesToday: 0, lossDays: 0 },
    evidence: Object.fromEntries([
      ...RULES[0].clauses.flatMap(clause => clause.criteria.map(item => [item.id, 'yes'])),
      ...RULES[55].clauses.flatMap(clause => clause.criteria.map(item => [item.id, 'no'])),
    ]),
  };
}

test('all 95 rules and every criterion survive the result with explicit missing state', () => {
  const result = evaluate({});
  assert.equal(result.version, CASE_VERSION);
  assert.deepEqual(result.rules.map(entry => entry.id), Array.from({ length: 95 }, (_, index) => index + 1));
  const criteria = result.rules.flatMap(entry => entry.clauses.flatMap(branch => branch.criteria));
  assert.equal(new Set(criteria.map(item => item.id)).size, criteria.length);
  assert.equal(criteria.length, result.summary.totalCriteria);
  assert.ok(criteria.every(item => item.state === 'unknown' && item.source === 'missing'));
  assert.equal(result.summary.knownCriteria, 0);
  assert.equal(result.advice.status, 'review');
  assert.equal(result.advice.capPct, null);
});

test('sparse normalized records preserve zero and dates without retaining extra keys', () => {
  const input = {
    stock: { code: ' 000001 ', day: '2024-02-29', untouched: 'extra' },
    market: { allAPct: '0', advances: '', declines: null, amount: ' 2e3 ' },
    portfolio: { positionPct: 0 },
    evidence: { '1.1': 'yes', '1.2': 'unknown', '1.3': null, '100.1': 'yes' },
  };
  assert.deepEqual(normalizeCase(input), {
    stock: { code: '000001', day: '2024-02-29' }, market: { allAPct: 0, amount: 2000 },
    portfolio: { positionPct: 0 }, evidence: { '1.1': 'yes' },
  });
  for (const invalid of [null, [], { stock: [] }, { stock: { code: 1 } }, { stock: { code: '0001' } },
    { stock: { day: '2026-02-29' } }, { stock: { day: '2026-4-01' } },
    { market: { advances: '0x10' } }, { market: { advances: '1.7' } }, { market: { amount: Infinity } },
    { market: { referenceAmount: 0 } }, { market: { gap: 'unrecognized' } }, { evidence: { '1.1': true } }]) {
    assert.throws(() => normalizeCase(invalid), /必须|无效|填写/);
  }
});

test('all automatic fact keys resolve from complete inputs, with explicit provenance', () => {
  const source = Object.fromEntries(GROUPS.map(group => [group.key, Object.fromEntries(group.fields.map(field => [field.key,
    field.type === 'date' ? '2026-11-20' : field.type === 'select' ? (field.key === 'emotion' ? 'decline' : field.options[0][0])
      : field.type === 'text' ? field.key === 'code' ? '600001' : '合成值' : Math.max(1, field.min),
  ]))]));
  const all = evaluate(source).rules.flatMap(item => item.clauses.flatMap(branch => branch.criteria));
  const broken = all.filter(item => item.fact && item.source !== 'automatic');
  assert.deepEqual(broken.map(item => [item.id, item.fact]), []);
});

test('ordinary match yields the smallest modeled remaining position allowance', () => {
  const input = completeCase();
  input.portfolio.singleCapPct = 9;
  input.portfolio.themeCapPct = 13.5;
  const before = structuredClone(input);
  const result = evaluate(input);
  assert.deepEqual(input, before);
  assert.deepEqual(evaluate(input), result);
  assert.equal(rule(result, 1).status, 'matched');
  assert.equal(rule(result, 56).status, 'unmatched');
  assert.equal(result.advice.status, 'candidate');
  assert.equal(result.advice.capPct, 5.5);
  assert.equal(result.environment.tradeSharePct, 68.89);
  assert.equal(result.environment.amountChangePct, 10);
  input.portfolio.totalPositionPct = 35;
  assert.equal(evaluate(input).advice.status, 'watch');
  assert.equal(evaluate(input).advice.capPct, 0);
});

test('a numeric comparison takes priority over contradictory manual evidence', () => {
  const input = completeCase();
  input.stock.themeStatus = 'off';
  const result = evaluate(input);
  assert.equal(criterion(result, '1.1').state, 'no');
  assert.equal(criterion(result, '1.1').source, 'automatic');
  assert.match(criterion(result, '1.1').detail, /冲突/);
  assert.equal(rule(result, 1).status, 'unmatched');
  delete input.stock.themeStatus;
  assert.equal(criterion(evaluate(input), '1.1').source, 'manual');
});

test('stop controls take precedence and known independent hazards use OR logic', () => {
  const input = completeCase();
  delete input.evidence['56.6'];
  assert.equal(rule(evaluate(input), 56).status, 'unknown');
  assert.equal(evaluate(input).advice.status, 'review');
  input.evidence['56.2'] = 'yes';
  let result = evaluate(input);
  assert.equal(rule(result, 56).status, 'matched');
  assert.equal(rule(result, 1).status, 'matched');
  assert.equal(result.advice.capPct, 0);
  assert.equal(result.advice.status, 'block');
  result = evaluate({ portfolio: { lossesToday: 2 } });
  assert.equal(result.advice.status, 'block');
  assert.match(result.advice.reasons.join(' '), /连续亏损/);
});

test('sharp high-volume index selloff blocks even with incomplete qualitative evidence', () => {
  const result = evaluate({ market: { allAPct: -1.5, amount: 11500, referenceAmount: 10000 } });
  assert.equal(result.environment.level, 'block');
  assert.equal(result.environment.amountChangePct, 15);
  assert.equal(result.advice.status, 'block');
  assert.equal(result.advice.capPct, 0);
  assert.equal(rule(result, 72).status, 'unknown');
  assert.equal(evaluate({ market: { allAPct: -1.5, amount: 11499, referenceAmount: 10000 } }).advice.status, 'review');
});

test('index trends, cross-index divergence, turnover and threshold reports use original values', () => {
  const input = completeCase();
  Object.assign(input.market, { allAClose: 980, allAMa5: 990, allAMa10: 1000, allAMa20: 1010, cybPct: -0.8 });
  let result = evaluate(input);
  assert.equal(result.environment.indexStates.allA, 'bear');
  assert.equal(result.environment.level, 'warn');
  assert.match(result.environment.reasons.join(' '), /均线排列有分歧.*低于 MA20/);
  assert.equal(rule(result, 80).status, 'matched');
  assert.ok(result.summary.triggeredRisks >= 1);
  assert.equal(result.advice.status, 'watch');
  input.stock.turnoverPct = 0;
  result = evaluate(input);
  assert.equal(rule(result, 66).status, 'matched');
  assert.equal(result.advice.status, 'block');
});

test('illustrative stop loss rounds no boundary and a gap follows the recorded branch', () => {
  const result = evaluate({
    market: { gap: 'down-open', allAPct: 1, advances: 1000, declines: 3000, amount: 8500, referenceAmount: 10000 },
    portfolio: { gainPct: -5, stopLossPct: 5 },
  });
  assert.equal(rule(result, 52).clauses[0].status, 'matched');
  const gap = rule(result, 93).clauses;
  assert.equal(gap[0].status, 'matched');
  assert.equal(gap[1].status, 'unmatched');
  assert.equal(rule(result, 94).clauses[1].status, 'matched');
  assert.equal(rule(result, 95).status, 'matched');
  assert.equal(result.advice.status, 'block');
});
