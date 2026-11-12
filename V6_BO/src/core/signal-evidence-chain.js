'use strict';
/** Immutable provenance envelope linking a strategy signal to a paper intent. */
const crypto = require('node:crypto');
const SYSTEMS = new Set(['fourteen-stock-pick','eight-character','gpt-five','python-three-round']);
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function snapshot(value) { const text = JSON.stringify(value); if (typeof text !== 'string' || Buffer.byteLength(text) > 512 * 1024) throw Error('信号证据超过512KiB或不是JSON'); return JSON.parse(text); }
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
  const payload = snapshot({ schemaVersion: 1, system, symbol, signalDate, observedThrough, generatedAt: new Date(generatedAt).toISOString(), evaluatorVersion, source, feedGate: { mode: feedGate.mode, status: feedGate.status, stale: false, simulated: false, qualityFingerprint: String(feedGate.qualityFingerprint || '') }, riskCheck: { status: riskCheck.status, ruleSetVersion: String(riskCheck.ruleSetVersion || ''), checkedAt: new Date(riskCheck.checkedAt || generatedAt).toISOString() }, signal });
  return deepFreeze({ ...payload, signalFingerprint: sha256(payload) });
}
function validateSignalEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || evidence.schemaVersion !== 1 || typeof evidence.signalFingerprint !== 'string') return { ok: false, reason: '证据结构无效' };
  const { signalFingerprint, ...payload } = evidence;
  try { const rebuilt=createSignalEvidence(payload);return rebuilt.signalFingerprint===signalFingerprint && sha256(payload)===signalFingerprint ? {ok:true,signalFingerprint} : {ok:false,reason:'信号证据指纹不匹配'}; }
  catch { return {ok:false,reason:'信号证据结构或门禁无效'}; }
}
function bindPaperIntent(evidence, intent) {
  const checked = validateSignalEvidence(evidence);
  if (!checked.ok) throw new Error(checked.reason);
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('模拟盘委托意图无效');
  if (intent.symbol !== evidence.symbol || intent.signalDate !== evidence.signalDate) throw new Error('委托标的或信号日期与证据不一致');
  if (!['buy', 'sell'].includes(intent.side) || !Number.isSafeInteger(intent.quantity) || intent.quantity <= 0) throw new Error('委托方向或数量无效');
  if (!Number.isFinite(intent.limitPrice) || intent.limitPrice <= 0) throw new Error('委托价格无效');
  return deepFreeze({ schemaVersion: 1, intent: { symbol: intent.symbol, signalDate: intent.signalDate, side: intent.side, quantity: intent.quantity, limitPrice: intent.limitPrice }, evidenceFingerprint: checked.signalFingerprint, canTrade: false, mode: 'paper-intent-evidence-only' });
}
// Production observations may have missing evidence. Recording the gap does not
// certify a trading feed or turn a model score into a probability.
function createProductionSignalEvidence(input) {
  if (!input || !/^\d{6}$/.test(input.code || '') || typeof input.type !== 'string' || !input.type.trim() || !Number.isSafeInteger(input.triggerAt) || input.triggerAt <= 0) throw Error('生产信号身份无效');
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
  const quote = input.quote || {}, missing = [];
  const quoteAt = finite(quote.quoteAt), receivedAt = finite(quote.receivedAt), source = text(quote.quoteSource);
  if (!source || quoteAt === null || quoteAt > input.triggerAt || receivedAt === null || quoteAt > receivedAt || receivedAt > input.triggerAt) missing.push('UNKNOWN_OR_INVALID_ORIGINAL_QUOTE');
  if (quoteAt !== null && input.triggerAt - quoteAt > 15000) missing.push('STALE_QUOTE');
  const conditions = (Array.isArray(input.conditions) ? input.conditions : []).map(c => ({id:text(c.id),label:text(c.label),value:finite(c.value),threshold:finite(c.threshold),operator:text(c.operator),source:text(c.source),updatedAt:finite(c.updatedAt)}));
  if (!conditions.length || conditions.some(c => c.value === null || c.threshold === null || !c.source || c.updatedAt === null || c.updatedAt > input.triggerAt)) missing.push('INCOMPLETE_TRIGGER_CONDITIONS');
  const version = text(input.strategyVersion); if (!version) missing.push('UNKNOWN_STRATEGY_VERSION');
  if (!Array.isArray(input.inputs?.bars) || !input.inputs.bars.length) missing.push('NO_FROZEN_KLINE');
  if (!input.inputs?.news?.originalEvidence) missing.push('NEWS_ORIGINAL_EVIDENCE_NOT_FROZEN');
  if (input.inputs?.qualityEvidence?.canNotify !== true) missing.push('QUOTE_USE_NOT_ELIGIBLE_OR_UNKNOWN');
  if (!input.risk?.invalidWhen) missing.push('NO_EXPLICIT_INVALIDATION_RULE');
  const payload = snapshot({schemaVersion:2,mode:'production-signal-provenance',code:input.code,type:text(input.type),triggerAt:input.triggerAt,
    strategyVersion:version,recordKind:input.recordKind === 'trigger' ? 'trigger' : 'observation',supersedes:typeof input.supersedes === 'string' ? input.supersedes : null,
    quote:{price:finite(quote.price),pct:finite(quote.pct),quoteAt,receivedAt,quoteSource:source,quoteFreshness:text(quote.quoteFreshness),canTrade:quote.canTrade === true},
    model:{value:finite(input.model?.value),kind:text(input.model?.kind)||'unknown',target:input.model?.target===null?null:text(input.model?.target)||'unknown',
      rankingValue:finite(input.model?.rankingValue),rankingKind:text(input.model?.rankingKind)||'unknown',calibrationCertified:false},
    riseModel:{value:finite(input.riseModel?.value),kind:text(input.riseModel?.kind)||'unknown',target:input.riseModel?.target===null?null:text(input.riseModel?.target)||'unknown',source:text(input.riseModel?.source),calibrationCertified:false},
    conditions,inputs:input.inputs || {},supportingReasons:(input.supportingReasons || []).map(text),opposingReasons:(input.opposingReasons || []).map(text),
    risk:{text:text(input.risk?.text),stopLoss:text(input.risk?.stopLoss),invalidWhen:text(input.risk?.invalidWhen)},
    message:text(input.message),status:missing.length ? 'partial' : 'recorded',missingReasons:missing,canTrade:false});
  const evidenceFingerprint = sha256(payload);
  return deepFreeze({...payload,signalId:evidenceFingerprint,evidenceFingerprint});
}
function validateProductionSignalEvidence(evidence) {
  if (!evidence || evidence.schemaVersion !== 2 || evidence.mode !== 'production-signal-provenance' || evidence.canTrade !== false || !/^[a-f0-9]{64}$/.test(evidence.signalId || '') || !/^\d{6}$/.test(evidence.code||'') || !Number.isSafeInteger(evidence.triggerAt) || evidence.triggerAt<=0 || !['trigger','observation'].includes(evidence.recordKind) || !Array.isArray(evidence.conditions) || !Array.isArray(evidence.missingReasons) || !['partial','recorded'].includes(evidence.status)) return {ok:false,reason:'生产信号证据结构无效'};
  const {signalId,evidenceFingerprint,...payload} = evidence;
  return signalId === evidenceFingerprint && sha256(payload) === evidenceFingerprint ? {ok:true,signalId} : {ok:false,reason:'生产信号证据指纹不匹配'};
}
module.exports = { createSignalEvidence, validateSignalEvidence, bindPaperIntent, createProductionSignalEvidence, validateProductionSignalEvidence, immutableSnapshot:value=>deepFreeze(snapshot(value)) };
