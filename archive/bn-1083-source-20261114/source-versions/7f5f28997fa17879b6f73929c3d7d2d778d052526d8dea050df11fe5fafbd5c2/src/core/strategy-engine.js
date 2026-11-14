'use strict';

/**
 * 可组合选股条件引擎。
 * 用于逐步替换 server.js 中散落的硬编码条件，不强行改变现有策略结果。
 */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateRule(snapshot, rule) {
  const value = toNumber(snapshot[rule.field]);
  const target = toNumber(rule.value);
  switch (rule.op) {
    case '>': return value > target;
    case '>=': return value >= target;
    case '<': return value < target;
    case '<=': return value <= target;
    case '===': return value === target;
    case 'between': return value >= toNumber(rule.min) && value <= toNumber(rule.max);
    default: return false;
  }
}

function evaluateStrategy(snapshot, strategy) {
  const rules = Array.isArray(strategy.rules) ? strategy.rules : [];
  const hits = [];
  let score = 0;
  for (const rule of rules) {
    const passed = evaluateRule(snapshot, rule);
    if (passed) {
      const weight = toNumber(rule.weight, 0);
      score += weight;
      hits.push({ id: rule.id || rule.field, weight, label: rule.label || rule.field });
    }
  }
  const minScore = toNumber(strategy.minScore, 0);
  return { pass: score >= minScore, score, minScore, hits, hitRate: rules.length ? hits.length / rules.length : 0 };
}

module.exports = { evaluateRule, evaluateStrategy };
