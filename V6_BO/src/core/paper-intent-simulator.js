'use strict';
/** Offline paper-intent simulator. Never connects to a broker or mutates inputs. */
const crypto = require('node:crypto');
const { preflightPaperExecution } = require('./paper-execution-preflight');
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

function simulatePaperIntents(plan, snapshot, account, options = {}) {
  const gate = preflightPaperExecution(plan, snapshot, account);
  const cfg = { slippageBps: 10, feeBps: 8, minCommission: 5, maxParticipationPct: 10, ...options };
  for (const [k, v] of Object.entries(cfg)) {
    const max = k === 'maxParticipationPct' ? 100 : 1000;
    if (!Number.isFinite(v) || v < 0 || v > max) throw new Error(`模拟撮合参数无效：${k}`);
  }
  const initialCash = Number(account.cash);
  if (!Number.isFinite(initialCash) || initialCash < 0) throw new Error('模拟盘现金无效');
  const positions = JSON.parse(JSON.stringify(account.positions || {}));
  const ledger = Array.isArray(account.ledger) ? JSON.parse(JSON.stringify(account.ledger)) : [];
  const seen = new Set(ledger.map(x => x.intentId).filter(Boolean));
  const marketBySymbol = new Map(snapshot.symbols.map(x => [x.symbol, x]));
  let cash = initialCash;
  const fills = [], blocked = [];

  for (const decision of gate.decisions) {
    const intent = plan.intents.find(x => x.system === decision.system && x.symbol === decision.symbol &&
      x.executionDate === decision.executionDate && x.quantity === decision.quantity);
    if (!intent) { blocked.push({ ...decision, reason: '无法定位原始委托意图' }); continue; }
    const intentId = hash({ fingerprint: plan.datasetFingerprint, intent });
    if (seen.has(intentId)) { blocked.push({ ...decision, reason: '重复意图，幂等保护拒绝重复撮合' }); continue; }
    if (decision.status !== 'preflight-pass') { blocked.push({ ...decision, reason: decision.reason || '预检未通过' }); continue; }
    const row = marketBySymbol.get(intent.symbol);
    const open = Number(row.open ?? row.price), volume = Number(row.volume);
    if (!Number.isFinite(open) || open <= 0) { blocked.push({ ...decision, reason: '缺少有效开盘价' }); continue; }
    if (!Number.isFinite(volume) || volume <= 0) { blocked.push({ ...decision, reason: '缺少有效成交量' }); continue; }
    const maxQty = Math.floor(volume * cfg.maxParticipationPct / 100 / 100) * 100;
    if (intent.quantity > maxQty) { blocked.push({ ...decision, reason: '委托量超过成交量参与率限制' }); continue; }
    if (row.suspended === true || row.tradable === false || row.atUpperLimit === true) {
      blocked.push({ ...decision, reason: '撮合时行情状态不可交易' }); continue;
    }
    const price = round(open * (1 + cfg.slippageBps / 10000));
    const gross = round(price * intent.quantity);
    const fee = round(Math.max(cfg.minCommission, gross * cfg.feeBps / 10000));
    const total = round(gross + fee);
    if (total > cash + 1e-8) { blocked.push({ ...decision, reason: '计入滑点和费用后现金不足' }); continue; }
    cash = round(cash - total);
    const old = positions[intent.symbol] || { quantity: 0, sellable: 0, averageCost: 0, lots: [] };
    const oldQty = Number(old.quantity || 0), newQty = oldQty + intent.quantity;
    const averageCost = round((Number(old.averageCost || 0) * oldQty + total) / newQty);
    const lot = { date: snapshot.asOf, quantity: intent.quantity, sellableDate: null, price, gross, fee, totalCost: total, intentId };
    positions[intent.symbol] = { quantity: newQty, sellable: Number(old.sellable || 0), averageCost,
      lots: [...(Array.isArray(old.lots) ? old.lots : []), lot] };
    const fill = { intentId, system: intent.system, symbol: intent.symbol, side: 'buy', date: snapshot.asOf,
      quantity: intent.quantity, price, gross, fee, cashAfter: cash, status: 'simulated-filled',
      sellableDate: '下一交易日及以后（T+1）' };
    fills.push(fill); ledger.push(fill); seen.add(intentId);
  }
  const result = { schemaVersion: 1, mode: 'offline-paper-intent-simulation', canTrade: false,
    executed: false, brokerConnected: false, accountMutated: false, datasetFingerprint: plan.datasetFingerprint,
    asOf: snapshot.asOf, preflightId: gate.preflightId, initialCash, cash, positions, fills, blocked, ledger,
    metrics: { filledCount: fills.length, blockedCount: blocked.length, cashUsed: round(initialCash - cash), remainingCash: cash },
    warnings: ['仅为离线纸面模拟，不连接券商、不发送真实委托', '买入股份遵循T+1，当前交易日不可卖出',
      '成交量参与率、滑点和费用为模拟假设，不代表真实盘口成交'] };
  result.resultFingerprint = hash(result);
  return result;
}
module.exports = { simulatePaperIntents };
