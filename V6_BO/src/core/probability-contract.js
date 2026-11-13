'use strict';

// These targets describe the model's event, not the outcome used by an unrelated
// historical report. Unknown types keep an unknown target instead of borrowing one.
const TARGETS = Object.freeze({ztToday: '当日封板', ztNext: '次日封板', up3Next: '次日最高涨≥3%'});
const TYPES = Object.freeze({
  auczt: 'ztToday', ztprob: 'ztToday', fastin: 'ztToday', bigmoney: 'ztToday',
  'bigmoney-B': 'ztToday', bigmoney_repeat: 'ztToday', buzhang: 'ztToday', similar: 'ztToday',
  '后排涨停概率': 'ztToday', '大单快速流入': 'ztToday',
  yier: 'ztNext', lianban: 'ztNext', aucres: 'ztNext', sector: 'ztNext',
  trendsig: 'up3Next', '趋势票': 'up3Next'
});
const SCORES = new Set(['pool', 'trend', 'pre']);
function targetFor(type, requested) {
  if (SCORES.has(type)) return null;
  const explicit = requested === 'zt' ? 'ztNext' : requested === 'up3' ? 'up3Next' : requested;
  const actual = TYPES[type] || null;
  if (explicit != null && !Object.hasOwn(TARGETS, explicit)) return null;
  if (actual && explicit && actual !== explicit) return null;
  return actual || explicit || null;
}
function shapeTarget(target) { return target === 'ztNext' ? 'zt' : target === 'up3Next' ? 'up3' : null; }
function label(target) { return TARGETS[target] || '事件目标未知'; }
function bounded(value, type) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(type === 'auczt' ? 45 : 100, value));
}
function kind(type) { return SCORES.has(type) ? 'score' : 'model-estimate'; }
module.exports = {targetFor, shapeTarget, label, bounded, kind};
