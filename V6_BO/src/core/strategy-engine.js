'use strict';

/**
 * 可组合选股条件引擎。
 * 用于逐步替换 server.js 中散落的硬编码条件，不强行改变现有策略结果。
 */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function validNumber(v) {
  return v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '') && typeof v !== 'boolean' && Number.isFinite(Number(v));
}

function validMinScore(value) {
  return validNumber(value) && Number(value) >= 0;
}

function evaluateRule(snapshot, rule) {
  if (!snapshot || !rule || !rule.field || !validNumber(snapshot[rule.field])) return false;
  const value = Number(snapshot[rule.field]);
  if (rule.op === 'between') {
    return validNumber(rule.min) && validNumber(rule.max) && Number(rule.min) <= Number(rule.max)
      && value >= Number(rule.min) && value <= Number(rule.max);
  }
  if (!validNumber(rule.value)) return false;
  const target = Number(rule.value);
  switch (rule.op) {
    case '>': return value > target;
    case '>=': return value >= target;
    case '<': return value < target;
    case '<=': return value <= target;
    case '===': return value === target;
    case 'between': return false;
    default: return false;
  }
}

function evaluateStrategy(snapshot, strategy) {
  const rules = strategy && Array.isArray(strategy.rules) ? strategy.rules : [];
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
  // A missing/invalid threshold or zero-hit strategy must not silently select a stock.
  const configuredMinScore = strategy && strategy.minScore;
  const thresholdValid = validMinScore(configuredMinScore);
  const minScore = thresholdValid ? Number(configuredMinScore) : 0;
  return { pass: thresholdValid && rules.length > 0 && hits.length > 0 && score > 0 && score >= minScore, score, minScore, hits, hitRate: rules.length ? hits.length / rules.length : 0 };
}

module.exports = { evaluateRule, evaluateStrategy, validMinScore };
