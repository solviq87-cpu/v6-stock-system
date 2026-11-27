'use strict';
/** Atomic offline paper-account ledger. No broker connectivity and no live-account writes. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireProcessLock, releaseProcessLock } = require('./process-file-lock');
const {fillEvidenceOf}=require('./paper-fill-evidence');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const numeric = n => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n)) ? Number(n) : NaN;
const safeMoney = n => typeof n === 'number' && Number.isSafeInteger(Math.round((n + Number.EPSILON) * 100));
const money = n => {
  if (!safeMoney(n)) throw new Error('成交金额超出安全计算范围');
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
const validDate = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = new Date(d + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === d;
};
const validId = id => typeof id === 'string' && id.trim().length > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validateAccount(account) {
  if (!plain(account) || account.schemaVersion !== 1 || !safeMoney(account.cash) || account.cash < 0 ||
      !plain(account.positions) || !Array.isArray(account.events) || !plain(account.eventHashes))
    throw new Error('账户账本结构无效');
  if (account.fingerprint !== hash({ cash: account.cash, positions: account.positions, events: account.events }))
    throw new Error('账户账本指纹校验失败');
  // Keep the historical fingerprint format, but never trust a detached retry
  // index: losing an entry must not let recovery debit the same fill twice.
  const ids = new Set();
  for (const event of account.events) {
    const id = event?.eventId;
    if (!validId(id) || ids.has(id) ||
        !Object.hasOwn(account.eventHashes, id) || typeof account.eventHashes[id] !== 'string' || !/^[a-f0-9]{64}$/.test(account.eventHashes[id]))
      throw new Error('账户成交事件与幂等索引不一致');
    ids.add(id);
  }
  if (Object.keys(account.eventHashes).length !== ids.size)
    throw new Error('账户成交事件与幂等索引不一致');
  for (const [symbol, pos] of Object.entries(account.positions)) {
    if (!/^\d{6}$/.test(symbol) || !plain(pos) || !Number.isSafeInteger(pos.quantity) || pos.quantity < 0 || !Array.isArray(pos.lots)) throw new Error('账户持仓数量或结构无效');
    let quantity = 0;
    for (const lot of pos.lots) {
      if (!plain(lot) || !Number.isSafeInteger(lot.quantity) || lot.quantity <= 0 || !validDate(lot.buyDate) ||
          (lot.sellableDate != null && (!validDate(lot.sellableDate) || lot.sellableDate <= lot.buyDate)) ||
          (lot.reserved != null && (!Number.isSafeInteger(lot.reserved) || lot.reserved < 0 || lot.reserved > lot.quantity))) throw new Error('账户持仓批次数量或交易日期无效');
      quantity += lot.quantity;
      if (!Number.isSafeInteger(quantity)) throw new Error('账户持仓数量超出安全范围');
    }
    if (quantity !== pos.quantity) throw new Error('账户持仓数量与批次合计不一致');
  }
}
function atomicWrite(file, value, faultInjector) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    const payload = JSON.stringify(value, null, 2) + '\n';
    if (faultInjector) {
      const split = Math.max(1, Math.floor(payload.length / 2));
      fs.writeSync(fd, payload.slice(0, split));
      faultInjector('during-write');
      fs.writeSync(fd, payload.slice(split));
    } else fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    try { const d = fs.openSync(dir, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch (_) {}
  } catch (e) { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}
function createPaperAccountLedger(filePath, { faultInjector } = {}) {
  const file = path.resolve(filePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  function transact(order, fill, tradeDate) {
    if (!plain(order) || !plain(fill) || !validId(order.orderId) || !['string','number'].includes(typeof order.symbol) || !/^\d{6}$/.test(String(order.symbol)) || !['buy', 'sell'].includes(order.side)) throw new Error('订单或成交信息无效');
    const symbol = String(order.symbol);
    if (fill.orderId !== order.orderId || !validId(fill.eventId)) throw new Error('成交事件与订单不匹配');
    const qty = numeric(fill.quantity), price = numeric(fill.price), fee = Object.hasOwn(fill, 'fee') ? numeric(fill.fee) : 0;
    if (!Number.isSafeInteger(qty) || qty <= 0 || (qty % 100 && !(order.side==='sell'&&order.liquidateOddLot===true)) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fee) || fee < 0) throw new Error('成交数量、价格或费用无效');
    if (!validDate(tradeDate)) throw new Error('交易日期无效');
    const lock = `${file}.lock`;
    const lfd = acquireProcessLock(lock, '账户正在被其他进程更新，拒绝并发写入');
    try {
      let account;
      try {
        const st = fs.lstatSync(file);
        if (st.isSymbolicLink() || !st.isFile() || st.size > 20 * 1024 * 1024) throw new Error('账户文件不安全');
        account = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) { if (e.code === 'ENOENT') throw new Error('账户账本缺失，拒绝自动重建'); throw e; }
      validateAccount(account);
      const eventHash = hash({ orderId: order.orderId, fill, tradeDate });
      if (Object.hasOwn(account.eventHashes, fill.eventId)) {
        const prior = account.events.find(event => event.eventId === fill.eventId);
        // The legacy hash does not bind the order symbol and side. Verify the
        // actual posted event as well without changing historical hashes.
        if (account.eventHashes[fill.eventId] !== eventHash || !prior || prior.orderId !== order.orderId || String(prior.symbol) !== symbol || prior.side !== order.side || prior.quantity !== qty || prior.price !== price || prior.fee !== fee || prior.tradeDate !== tradeDate) throw new Error('成交事件ID冲突');
        return { ...account, idempotent: true };
      }
      const gross = money(qty * price);
      if (gross <= 0) throw new Error('成交金额舍入后必须为正数');
      let costBasis=0;
      if (order.side === 'buy') {
        const debit = money(gross + fee);
        if (debit > account.cash + 1e-8) throw new Error('成交后可用资金不足');
        account.cash = money(account.cash - debit);
        const old = account.positions[symbol] || { quantity: 0, sellable: 0, lots: [] };
        const lots = Array.isArray(old.lots) ? old.lots.slice() : [];
        lots.push({ buyDate: tradeDate, quantity: qty, sellableDate: null, price, fee, cost: debit, sourceEventId: fill.eventId });
        const quantity = old.quantity + qty;
        if (!Number.isSafeInteger(quantity)) throw new Error('账户持仓数量超出安全范围');
        account.positions[symbol] = { quantity, sellable: Number(old.sellable || 0), lots };
      } else {
        const pos = account.positions[symbol];
        if (!pos || !Array.isArray(pos.lots)) throw new Error('缺少可核验的持仓批次');
        if(qty%100&&qty!==pos.quantity)throw new Error('零股卖出必须一次清空剩余持仓');
        let remaining = qty;
        const lots = pos.lots.map(x => ({ ...x }));
        for (const lot of lots) {
          if (remaining <= 0) break;
          if (lot.buyDate >= tradeDate || (lot.sellableDate != null && lot.sellableDate > tradeDate)) continue; // strict T+1: same-day lots are not sellable
          const available = Number(lot.quantity) - Number(lot.reserved || 0);
          const take = Math.min(available, remaining);
          if (take > 0) { const basis=lot.cost == null ? numeric(lot.price)*lot.quantity : numeric(lot.cost);if(!safeMoney(basis)||basis<0)throw new Error('持仓批次成本无效');const consumed=money(basis*take/lot.quantity);costBasis+=consumed;lot.cost=money(basis-consumed);lot.fee=money(Number(lot.fee||0)*(lot.quantity-take)/lot.quantity);lot.quantity -= take; remaining -= take; }
        }
        if (remaining > 0) throw new Error('可卖持仓不足或违反T+1限制');
        const credit = money(gross - fee);
        account.cash = money(account.cash + credit);
        pos.lots = lots.filter(x => x.quantity > 0);
        pos.quantity = pos.lots.reduce((s, x) => s + Number(x.quantity), 0);
        pos.sellable = pos.lots.filter(x => x.buyDate < tradeDate && (x.sellableDate == null || x.sellableDate <= tradeDate)).reduce((s, x) => s + Number(x.quantity), 0);
      }
      if(account.cash<0)throw new Error('成交费用超过现金余额，拒绝透支');
      const fillEvidence=fillEvidenceOf({...fill,symbol,tradeDate});
      const event = { eventId: fill.eventId, orderId: order.orderId, symbol, side: order.side, quantity: qty, price, fee, gross, costBasis:money(costBasis), realizedPnl:order.side==='sell'?money(gross-fee-costBasis):0, tradeDate, cashAfter: account.cash,
        ...(fillEvidence?{timestamp:fillEvidence.executionAt,fillEvidence:JSON.parse(JSON.stringify(fillEvidence))}:{}) };
      account.events.push(event); Object.defineProperty(account.eventHashes, fill.eventId, {value:eventHash, enumerable:true, configurable:true, writable:true});
      account.updatedAt = new Date().toISOString();
      account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
      validateAccount(account);
      if (faultInjector) faultInjector('before-write');
      atomicWrite(file, account, faultInjector);
      if (faultInjector) faultInjector('after-commit');
      return account;
    } finally { releaseProcessLock(lfd, lock); }
  }
  function read() {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 20 * 1024 * 1024) throw new Error('账户文件不安全');
    const a = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateAccount(a);
    return { ...a, paperOnly: true, brokerConnected: false };
  }
  return Object.freeze({ transact, read });
}
module.exports = { createPaperAccountLedger, validateAccount };
