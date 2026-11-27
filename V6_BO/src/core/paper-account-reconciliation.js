'use strict';

/**
 * Read-only three-way reconciliation for an offline paper account.
 * Rebuilds cash, realized P&L and FIFO position lots from immutable trade rows,
 * then compares them with the account snapshot. It never mutates either input.
 */
const DEFAULT_TOLERANCE = 0.02;
// Monetary evidence must remain representable as safe integer cents. An
// unrepresentable calculation is unknown, never a complete reconciliation.
const round2 = n => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const cents = Math.round((n + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
};
// Validate raw evidence before conversion; keep explicitly supplied numeric strings.
const finite = n => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n));
const numeric = n => finite(n) ? Number(n) : null;
const monetary = n => { const v = numeric(n); return round2(v) !== null ? v : null; };
const quantity = n => { const v = numeric(n); return Number.isSafeInteger(v) && v >= 0 ? v : null; };
const nonnegativeMoney = n => { const v = monetary(n); return v !== null && v >= 0 ? v : null; };
const record = v => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
function own(o, k) {
  const d = o == null ? undefined : Object.getOwnPropertyDescriptor(o, k);
  return d && Object.hasOwn(d, 'value') ? d.value : undefined;
}
// An explicitly supplied missing or conflicting alias is invalid evidence.
// A legacy alternative field alone is still accepted. Never invoke getters.
function aliases(row, keys, normalize) {
  const supplied = keys.filter(k => Object.hasOwn(row, k));
  const values = supplied.map(k => normalize(own(row, k)));
  return values.length && values[0] !== null && values.every(v => v === values[0]) ? values[0] : null;
}
const identity = v => typeof v === 'string' ? v.trim() : Number.isSafeInteger(v) && v > 0 ? String(v) : '';
const sideOf = side => {
  const s = typeof side === 'string' ? side.trim().toUpperCase() : '';
  if (['BUY', 'B', '买', '买入'].includes(s)) return 'BUY';
  if (['SELL', 'S', '卖', '卖出'].includes(s)) return 'SELL';
  return null;
};

function reconcilePaperAccount(input = {}) {
  const errors = [];
  if (!record(input)) return { ok: false, complete: false, errors: ['对账输入必须是记录对象'], tolerance: DEFAULT_TOLERANCE };
  const initialCash = nonnegativeMoney(own(input, 'initialCash'));
  const account = own(input, 'account');
  const rawTrades = own(input, 'trades');
  const trades = Array.isArray(rawTrades) ? rawTrades : null;
  const rawTolerance = own(input, 'tolerance');
  const tolerance = finite(rawTolerance) ? Math.max(0, Number(rawTolerance)) : DEFAULT_TOLERANCE;
  const actualPositions = own(account, 'positions');
  if (initialCash === null) errors.push('initialCash 必须是安全范围内的非负金额');
  if (!trades) errors.push('trades 必须是数组');
  if (!record(account)) errors.push('account 必须是对象');
  if (!record(actualPositions)) errors.push('account.positions 必须是持仓快照对象');
  if (errors.length) return { ok: false, complete: false, errors, tolerance };

  let cash = round2(initialCash), realized = 0, missingFee = 0, invalidTrades = 0, arithmeticFailed = false;
  const lots = new Map(), quantities = new Map();
  const seenTradeIds = new Set();
  const failArithmetic = i => { invalidTrades++; arithmeticFailed = true; errors.push(`第${i + 1}笔流水累计金额或股数超出安全计算范围`); };
  const ordered = Array.from({ length: trades.length }, (_, i) => ({ t: own(trades, i), i })).sort((a, b) => {
    const at = own(a.t, 't'), bt = own(b.t, 't');
    return (typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 ? at : Infinity) - (typeof bt === 'number' && Number.isSafeInteger(bt) && bt >= 0 ? bt : Infinity) || a.i - b.i;
  });
  for (const { t, i } of ordered) {
    if (!record(t)) { invalidTrades++; errors.push(`第${i + 1}笔流水无效`); continue; }
    const side = sideOf(own(t, 'side')), code = identity(own(t, 'code'));
    const shares = quantity(own(t, 'shares')), amount = monetary(own(t, 'amount')), timestamp = own(t, 't');
    const tradeId = own(t, 'tradeId') ?? own(t, 'trade_id') ?? own(t, 'id');
    if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0) { invalidTrades++; errors.push(`第${i + 1}笔流水缺少有效非负整数时间戳`); continue; }
    if (tradeId !== undefined && tradeId !== null) {
      if (typeof tradeId !== 'string' && !Number.isSafeInteger(tradeId)) { invalidTrades++; errors.push(`第${i + 1}笔流水ID无效`); continue; }
      const normalizedId = String(tradeId).trim();
      if (normalizedId) {
        if (seenTradeIds.has(normalizedId)) { invalidTrades++; errors.push(`重复成交流水ID：${normalizedId}`); continue; }
        seenTradeIds.add(normalizedId);
      }
    }
    if (!side) { invalidTrades++; errors.push(`第${i + 1}笔流水方向无法识别`); continue; }
    if (!code || shares === null || shares <= 0 || amount === null || amount <= 0) {
      invalidTrades++; errors.push(`第${i + 1}笔流水股票代码、股数或金额无效`); continue;
    }
    const fee = nonnegativeMoney(own(t, 'fee'));
    if (fee === null) { missingFee++; errors.push(`第${i + 1}笔流水缺少有效费用`); continue; }
    if (side === 'BUY') {
      const basis = round2(amount + fee);
      const nextCash = basis !== null ? round2(cash - basis) : null;
      const totalShares = (quantities.get(code) || 0) + shares;
      if (nextCash === null || basis === null || !Number.isSafeInteger(totalShares)) { failArithmetic(i); break; }
      cash = nextCash;
      // The comparison tolerance cannot authorize a historical overdraft.
      if (cash < 0) errors.push(`第${i + 1}笔买入导致重算现金为负数`);
      const queue = lots.get(code) || [];
      queue.push({ shares, basis });
      lots.set(code, queue);
      quantities.set(code, totalShares);
    } else {
      const credit = round2(amount - fee);
      const nextCash = credit !== null ? round2(cash + credit) : null;
      if (nextCash === null) { failArithmetic(i); break; }
      cash = nextCash;
      if (cash < 0) errors.push(`第${i + 1}笔卖出导致重算现金为负数`);
      let remaining = shares, basis = 0;
      const queue = lots.get(code) || [];
      while (remaining > 0 && queue.length) {
        const lot = queue[0], take = Math.min(remaining, lot.shares);
        // Match the authoritative ledger: round consumed cost once, then
        // subtract that exact amount from the remaining lot.
        const consumed = round2(lot.basis * take / lot.shares);
        const nextBasis = consumed !== null ? round2(basis + consumed) : null;
        const remainingBasis = consumed !== null ? round2(lot.basis - consumed) : null;
        if (nextBasis === null || remainingBasis === null) { failArithmetic(i); break; }
        basis = nextBasis;
        lot.shares -= take;
        lot.basis = remainingBasis;
        remaining -= take;
        if (lot.shares === 0) queue.shift();
      }
      if (arithmeticFailed) break;
      quantities.set(code, (quantities.get(code) || 0) - (shares - remaining));
      if (remaining > 0) { invalidTrades++; errors.push(`第${i + 1}笔卖出超过可追溯买入数量 ${remaining} 股`); }
      else {
        const tradeRealized = round2(amount - fee - basis);
        realized = tradeRealized !== null ? round2(realized + tradeRealized) : null;
        if (realized === null) { failArithmetic(i); break; }
      }
      lots.set(code, queue);
    }
  }
  if (arithmeticFailed) { cash = null; realized = null; }

  const actualCash = nonnegativeMoney(own(account, 'cash')), actualRealized = monetary(own(account, 'realized'));
  if (actualCash === null || actualRealized === null) errors.push('账户现金或已实现盈亏缺少安全范围内的有效金额');
  const cashDiff = cash !== null && actualCash !== null ? round2(cash - actualCash) : null;
  const realizedDiff = realized !== null && actualRealized !== null ? round2(realized - actualRealized) : null;
  if (cashDiff === null || realizedDiff === null) errors.push('现金或盈亏差额无法安全计算');
  const symbols = new Set([...lots.keys(), ...Object.keys(actualPositions)]);
  const positionDiffs = [];
  for (const symbol of [...symbols].sort()) {
    const rebuiltLots = lots.get(symbol) || [];
    const rebuiltShares = rebuiltLots.reduce((n, lot) => n + lot.shares, 0);
    const expectedShares = !arithmeticFailed && Number.isSafeInteger(rebuiltShares) ? rebuiltShares : null;
    const expectedBasis = !arithmeticFailed ? round2(rebuiltLots.reduce((n, lot) => n + lot.basis, 0)) : null;
    const present = Object.hasOwn(actualPositions, symbol);
    const p = present ? own(actualPositions, symbol) : undefined;
    const positionObjectValid = !present || record(p);
    const actualShares = !present ? 0 : positionObjectValid ? aliases(p, ['shares', 'qty'], quantity) : null;
    const actualBasis = !present ? 0 : positionObjectValid ? aliases(p, ['basis', 'costBasis'], nonnegativeMoney) : null;
    const shareDiff = expectedShares !== null && actualShares !== null ? expectedShares - actualShares : null;
    const basisDiff = expectedBasis !== null && actualBasis !== null ? round2(expectedBasis - actualBasis) : null;
    const valid = positionObjectValid && actualShares !== null && actualBasis !== null && Number.isSafeInteger(shareDiff) && basisDiff !== null;
    if (!valid) errors.push(`持仓 ${symbol} 缺少有效股数或成本证据，或累计计算超出安全范围`);
    if (!valid || shareDiff !== 0 || Math.abs(basisDiff) > tolerance) {
      positionDiffs.push({ symbol, expectedShares, actualShares, shareDiff, expectedBasis, actualBasis, basisDiff });
    }
  }
  const complete = missingFee === 0 && invalidTrades === 0 && errors.length === 0;
  const ok = complete && cashDiff !== null && realizedDiff !== null && Math.abs(cashDiff) <= tolerance && Math.abs(realizedDiff) <= tolerance && positionDiffs.length === 0;
  return {
    ok, complete, tolerance, tradeCount: trades.length, missingFee, invalidTrades,
    cash: { rebuilt: cash, actual: round2(actualCash), diff: cashDiff },
    realized: { rebuilt: realized, actual: round2(actualRealized), diff: realizedDiff },
    positions: { rebuiltSymbols: lots.size, actualSymbols: Object.keys(actualPositions).length, differences: positionDiffs },
    errors
  };
}

module.exports = { reconcilePaperAccount, DEFAULT_TOLERANCE };
