'use strict';

/**
 * Read-only three-way reconciliation for an offline paper account.
 * Rebuilds cash, realized P&L and FIFO position lots from immutable trade rows,
 * then compares them with the account snapshot. It never mutates either input.
 */
const DEFAULT_TOLERANCE = 0.02;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = n => n !== null && n !== undefined && !(typeof n === 'string' && n.trim() === '') && typeof n !== 'boolean' && Number.isFinite(Number(n));
const sideOf = side => {
  const s = String(side ?? '').trim().toUpperCase();
  if (['BUY', 'B', '买', '买入'].includes(s)) return 'BUY';
  if (['SELL', 'S', '卖', '卖出'].includes(s)) return 'SELL';
  return null;
};

function reconcilePaperAccount(input = {}) {
  const errors = [];
  const initialCash = Number(input.initialCash);
  const account = input.account || {};
  const trades = Array.isArray(input.trades) ? input.trades : null;
  const tolerance = finite(input.tolerance) ? Math.max(0, Number(input.tolerance)) : DEFAULT_TOLERANCE;
  if (!finite(initialCash) || initialCash < 0) errors.push('initialCash 必须是非负有限数值');
  if (!trades) errors.push('trades 必须是数组');
  if (!account || typeof account !== 'object' || Array.isArray(account)) errors.push('account 必须是对象');
  if (!account || !account.positions || typeof account.positions !== 'object' || Array.isArray(account.positions)) errors.push('account.positions 必须是持仓快照对象');
  if (errors.length) return { ok: false, complete: false, errors, tolerance };

  let cash = round2(initialCash), realized = 0, missingFee = 0, invalidTrades = 0;
  const lots = new Map();
  const seenTradeIds = new Set();
  const ordered = trades.map((t, i) => ({ t, i })).sort((a, b) => {
    const at = Number(a.t && a.t.t), bt = Number(b.t && b.t.t);
    return (Number.isFinite(at) ? at : Infinity) - (Number.isFinite(bt) ? bt : Infinity) || a.i - b.i;
  });
  for (const { t, i } of ordered) {
    if (!t || typeof t !== 'object') { invalidTrades++; errors.push(`第${i + 1}笔流水无效`); continue; }
    const side = sideOf(t.side), code = String(t.code || '').trim();
    const shares = Number(t.shares), amount = Number(t.amount);
    // Do not coerce null, booleans, or blank strings into epoch-zero timestamps.
    const rawTimestamp = t.t;
    const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp :
      (typeof rawTimestamp === 'string' && rawTimestamp.trim() !== '' ? Number(rawTimestamp) : NaN);
    const tradeId = t.tradeId ?? t.trade_id ?? t.id;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) { invalidTrades++; errors.push(`第${i + 1}笔流水缺少有效非负时间戳`); continue; }
    if (tradeId !== undefined && tradeId !== null && String(tradeId).trim()) {
      const normalizedId = String(tradeId).trim();
      if (seenTradeIds.has(normalizedId)) { invalidTrades++; errors.push(`重复成交流水ID：${normalizedId}`); continue; }
      seenTradeIds.add(normalizedId);
    }
    if (!side) { invalidTrades++; errors.push(`第${i + 1}笔流水方向无法识别`); continue; }
    if (!code || !Number.isSafeInteger(shares) || shares <= 0 || !finite(amount) || amount <= 0) {
      invalidTrades++; errors.push(`第${i + 1}笔流水股票代码、股数或金额无效`); continue;
    }
    if (t.fee === null || t.fee === undefined || !finite(t.fee) || Number(t.fee) < 0) { missingFee++; errors.push(`第${i + 1}笔流水缺少有效费用`); }
    const fee = t.fee !== null && t.fee !== undefined && finite(t.fee) && Number(t.fee) >= 0 ? Number(t.fee) : null;
    if (fee === null) continue; // incomplete evidence must not produce a guessed reconciliation
    if (side === 'BUY') {
      cash = round2(cash - amount - fee);
      if (cash < -tolerance) errors.push(`第${i + 1}笔买入导致重算现金为负数`);
      const queue = lots.get(code) || [];
      queue.push({ shares, basis: round2(amount + fee) });
      lots.set(code, queue);
    } else {
      cash = round2(cash + amount - fee);
      let remaining = shares, basis = 0;
      const queue = lots.get(code) || [];
      while (remaining > 0 && queue.length) {
        const lot = queue[0], take = Math.min(remaining, lot.shares);
        basis += lot.basis * take / lot.shares;
        lot.shares -= take;
        lot.basis = round2(lot.basis * (lot.shares / (lot.shares + take)));
        remaining -= take;
        if (lot.shares === 0) queue.shift();
      }
      if (remaining > 0) { invalidTrades++; errors.push(`第${i + 1}笔卖出超过可追溯买入数量 ${remaining} 股`); }
      else realized = round2(realized + amount - fee - basis);
      lots.set(code, queue);
    }
  }

  const actualCash = Number(account.cash), actualRealized = Number(account.realized);
  if (!finite(actualCash) || !finite(actualRealized)) errors.push('账户现金或已实现盈亏不是有限数值');
  const cashDiff = finite(actualCash) ? round2(cash - actualCash) : null;
  const realizedDiff = finite(actualRealized) ? round2(realized - actualRealized) : null;
  const actualPositions = account.positions && typeof account.positions === 'object' && !Array.isArray(account.positions) ? account.positions : {};
  const symbols = new Set([...lots.keys(), ...Object.keys(actualPositions)]);
  const positionDiffs = [];
  for (const symbol of [...symbols].sort()) {
    const rebuiltLots = lots.get(symbol) || [];
    const expectedShares = rebuiltLots.reduce((n, lot) => n + lot.shares, 0);
    const expectedBasis = round2(rebuiltLots.reduce((n, lot) => n + lot.basis, 0));
    const p = actualPositions[symbol];
    const positionObjectValid = p === undefined || (p && typeof p === 'object' && !Array.isArray(p));
    const actualShares = p ? Number(p.shares ?? p.qty) : 0;
    const actualBasis = p ? Number(p.basis ?? p.costBasis) : 0;
    const shareDiff = expectedShares - (finite(actualShares) ? actualShares : 0);
    const basisDiff = round2(expectedBasis - (finite(actualBasis) ? actualBasis : 0));
    if (!positionObjectValid || !finite(actualShares) || !Number.isSafeInteger(actualShares) || actualShares < 0 || !finite(actualBasis) || actualBasis < 0 || shareDiff !== 0 || Math.abs(basisDiff) > tolerance) {
      positionDiffs.push({ symbol, expectedShares, actualShares: finite(actualShares) ? actualShares : null, shareDiff, expectedBasis, actualBasis: finite(actualBasis) ? actualBasis : null, basisDiff });
    }
  }
  const complete = missingFee === 0 && invalidTrades === 0 && errors.length === 0 && !!account.positions && typeof account.positions === 'object' && !Array.isArray(account.positions);
  const ok = complete && cashDiff !== null && realizedDiff !== null && Math.abs(cashDiff) <= tolerance && Math.abs(realizedDiff) <= tolerance && positionDiffs.length === 0;
  return {
    ok, complete, tolerance, tradeCount: trades.length, missingFee, invalidTrades,
    cash: { rebuilt: cash, actual: finite(actualCash) ? round2(actualCash) : null, diff: cashDiff },
    realized: { rebuilt: realized, actual: finite(actualRealized) ? round2(actualRealized) : null, diff: realizedDiff },
    positions: { rebuiltSymbols: lots.size, actualSymbols: Object.keys(actualPositions).length, differences: positionDiffs },
    errors
  };
}

module.exports = { reconcilePaperAccount, DEFAULT_TOLERANCE };
