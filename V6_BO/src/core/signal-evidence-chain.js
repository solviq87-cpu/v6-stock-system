'use strict';
/** Immutable provenance envelope linking a strategy signal to a paper intent. */
const crypto = require('node:crypto');
const SYSTEMS = new Set(['fourteen-stock-pick','eight-character','gpt-five','python-three-round']);
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
function createSignalEvidence(input) {
  if (!input || typeof input !== 'object') throw new Error('信号证据必须是对象');
  const { system, symbol, signalDate, observedThrough, generatedAt, evaluatorVersion, source, feedGate, riskCheck, signal } = input;
  if (!SYSTEMS.has(system)) throw new Error('未知策略系统');
  if (typeof symbol !== 'string' || !/^(\d{6}\.(SH|SZ|BJ)|[A-Z]{2,8})$/.test(symbol)) throw new Error('股票代码格式无效');
  if (!isDate(signalDate) || !isDate(observedThrough) || observedThrough > signalDate) throw new Error('信号日期或观察截止日期无效');
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) throw new Error('生成时间无效');
  if (typeof evaluatorVersion !== 'string' || !evaluatorVersion.trim()) throw new Error('缺少策略评估器版本');
  if (typeof source !== 'string' || !source.trim()) throw new Error('缺少行情来源');
  if (!feedGate || feedGate.mode !== 'strict' || feedGate.status !== 'pass' || feedGate.stale === true || feedGate.simulated === true) throw new Error('行情质量门禁未通过');
  if (!riskCheck || riskCheck.status !== 'pass') throw new Error('风控检查未通过');
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) throw new Error('缺少原始策略信号');
  const payload = { schemaVersion: 1, system, symbol, signalDate, observedThrough, generatedAt: new Date(generatedAt).toISOString(), evaluatorVersion, source, feedGate: { mode: feedGate.mode, status: feedGate.status, stale: false, simulated: false, qualityFingerprint: String(feedGate.qualityFingerprint || '') }, riskCheck: { status: riskCheck.status, ruleSetVersion: String(riskCheck.ruleSetVersion || ''), checkedAt: new Date(riskCheck.checkedAt || generatedAt).toISOString() }, signal };
  return Object.freeze({ ...payload, signalFingerprint: sha256(payload) });
}
function validateSignalEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || evidence.schemaVersion !== 1 || typeof evidence.signalFingerprint !== 'string') return { ok: false, reason: '证据结构无效' };
  const { signalFingerprint, ...payload } = evidence;
  return sha256(payload) === signalFingerprint ? { ok: true, signalFingerprint } : { ok: false, reason: '信号证据指纹不匹配' };
}
function bindPaperIntent(evidence, intent) {
  const checked = validateSignalEvidence(evidence);
  if (!checked.ok) throw new Error(checked.reason);
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('模拟盘委托意图无效');
  if (intent.symbol !== evidence.symbol || intent.signalDate !== evidence.signalDate) throw new Error('委托标的或信号日期与证据不一致');
  if (!['buy', 'sell'].includes(intent.side) || !Number.isSafeInteger(intent.quantity) || intent.quantity <= 0) throw new Error('委托方向或数量无效');
  if (!Number.isFinite(intent.limitPrice) || intent.limitPrice <= 0) throw new Error('委托价格无效');
  return Object.freeze({ schemaVersion: 1, intent: { symbol: intent.symbol, signalDate: intent.signalDate, side: intent.side, quantity: intent.quantity, limitPrice: intent.limitPrice }, evidenceFingerprint: checked.signalFingerprint, canTrade: false, mode: 'paper-intent-evidence-only' });
}
module.exports = { createSignalEvidence, validateSignalEvidence, bindPaperIntent };
