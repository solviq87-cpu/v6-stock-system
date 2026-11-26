'use strict';

/**
 * 可组合选股条件引擎。
 * 用于逐步替换 server.js 中散落的硬编码条件，不强行改变现有策略结果。
 */
function validNumber(v) {
  return (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
}
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function ruleSignature(rule) {
  if(!rule || typeof rule.field!=='string' || !rule.field.trim() || rule.field!==rule.field.trim())return null;
  if(rule.op==='between'){
    if(!validNumber(rule.min)||!validNumber(rule.max)||Number(rule.min)>Number(rule.max))return null;
    return JSON.stringify([rule.field,rule.op,Number(rule.min),Number(rule.max)]);
  }
  if(!['>','>=','<','<=','==='].includes(rule.op)||!validNumber(rule.value))return null;
  return JSON.stringify([rule.field,rule.op,Number(rule.value)]);
}

function validMinScore(value) {
  return validNumber(value) && Number(value) >= 0;
}

function evaluateRule(snapshot, rule) {
  if (!snapshot || !ruleSignature(rule) || !own(snapshot,rule.field) || !validNumber(snapshot[rule.field])) return false;
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
  const ids=new Set(),signatures=new Set(),configurationErrors=[];
  for (const rule of rules) {
    const signature=ruleSignature(rule);
    if(!signature||!validNumber(rule?.weight)){
      configurationErrors.push('INVALID_RULE');continue;
    }
    const hasId=rule.id!=null;
    if(hasId&&(typeof rule.id!=='string'||!rule.id.trim()||rule.id!==rule.id.trim())){
      configurationErrors.push('INVALID_RULE_ID');continue;
    }
    if(signatures.has(signature)||(hasId&&ids.has(rule.id))){
      configurationErrors.push('DUPLICATE_RULE');continue;
    }
    signatures.add(signature);if(hasId)ids.add(rule.id);
    if(evaluateRule(snapshot,rule)){
      const weight=Number(rule.weight);
      score+=weight;
      hits.push({id:rule.id||rule.field,weight,label:rule.label||rule.field});
    }
  }
  if(!Number.isFinite(score))configurationErrors.push('NONFINITE_RULE_SCORE');
  // A corrupt rule set must not contribute a partial score to the ensemble.
  if(configurationErrors.length)return {pass:false,score:0,minScore:validMinScore(strategy?.minScore)?Number(strategy.minScore):0,
    hits:[],hitRate:0,configurationValid:false,configurationErrors:[...new Set(configurationErrors)]};
  // A missing/invalid threshold or zero-hit strategy must not silently select a stock.
  const configuredMinScore = strategy && strategy.minScore;
  const thresholdValid = validMinScore(configuredMinScore);
  const minScore = thresholdValid ? Number(configuredMinScore) : 0;
  return { pass: thresholdValid && rules.length > 0 && hits.length > 0 && score > 0 && score >= minScore, score, minScore, hits, hitRate: rules.length ? hits.length / rules.length : 0 };
}

module.exports = { evaluateRule, evaluateStrategy, validMinScore };
