'use strict';
/** Atomic offline paper-account ledger. No broker connectivity and no live-account writes. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
function atomicWrite(file, value) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    try { const d = fs.openSync(dir, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch (_) {}
  } catch (e) { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}
function createPaperAccountLedger(filePath) {
  const file = path.resolve(filePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  function transact(order, fill, tradeDate) {
    if (!order || !fill || !/^\d{6}$/.test(String(order.symbol)) || !['buy', 'sell'].includes(order.side)) throw new Error('订单或成交信息无效');
    if (fill.orderId !== order.orderId || !fill.eventId) throw new Error('成交事件与订单不匹配');
    const qty = Number(fill.quantity), price = Number(fill.price), fee = Number(fill.fee || 0);
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty % 100 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fee) || fee < 0) throw new Error('成交数量、价格或费用无效');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tradeDate))) throw new Error('交易日期无效');
    const lock = `${file}.lock`; let lfd;
    try { lfd = fs.openSync(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw new Error('账户正在被其他进程更新，拒绝并发写入'); throw e; }
    try {
      let account;
      try {
        const st = fs.lstatSync(file);
        if (st.isSymbolicLink() || !st.isFile() || st.size > 20 * 1024 * 1024) throw new Error('账户文件不安全');
        account = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) { if (e.code !== 'ENOENT') throw e; account = { schemaVersion: 1, cash: 0, positions: {}, events: [], eventHashes: {} }; }
      if (account.schemaVersion !== 1 || !Number.isFinite(account.cash) || account.cash < 0 || !account.positions || !Array.isArray(account.events)) throw new Error('账户账本结构无效');
      if (account.fingerprint && account.fingerprint !== hash({ cash: account.cash, positions: account.positions, events: account.events })) throw new Error('账户账本指纹校验失败');
      const eventHash = hash({ orderId: order.orderId, fill, tradeDate });
      if (account.eventHashes[fill.eventId]) {
        if (account.eventHashes[fill.eventId] !== eventHash) throw new Error('成交事件ID冲突');
        return { ...account, idempotent: true };
      }
      const gross = money(qty * price);
      if (order.side === 'buy') {
        const debit = money(gross + fee);
        if (debit > account.cash + 1e-8) throw new Error('成交后可用资金不足');
        account.cash = money(account.cash - debit);
        const old = account.positions[order.symbol] || { quantity: 0, sellable: 0, lots: [] };
        const lots = Array.isArray(old.lots) ? old.lots.slice() : [];
        lots.push({ buyDate: tradeDate, quantity: qty, sellableDate: null, price, fee, cost: debit, sourceEventId: fill.eventId });
        account.positions[order.symbol] = { quantity: Number(old.quantity || 0) + qty, sellable: Number(old.sellable || 0), lots };
      } else {
        const pos = account.positions[order.symbol];
        if (!pos || !Array.isArray(pos.lots)) throw new Error('缺少可核验的持仓批次');
        let remaining = qty;
        const lots = pos.lots.map(x => ({ ...x }));
        for (const lot of lots) {
          if (remaining <= 0) break;
          if (String(lot.buyDate) >= tradeDate) continue; // strict T+1: same-day lots are not sellable
          const available = Number(lot.quantity) - Number(lot.reserved || 0);
          const take = Math.min(available, remaining);
          if (take > 0) { lot.quantity -= take; remaining -= take; }
        }
        if (remaining > 0) throw new Error('可卖持仓不足或违反T+1限制');
        const credit = money(gross - fee);
        account.cash = money(account.cash + credit);
        pos.lots = lots.filter(x => x.quantity > 0);
        pos.quantity = pos.lots.reduce((s, x) => s + Number(x.quantity), 0);
        pos.sellable = pos.lots.filter(x => String(x.buyDate) < tradeDate).reduce((s, x) => s + Number(x.quantity), 0);
      }
      const event = { eventId: fill.eventId, orderId: order.orderId, symbol: order.symbol, side: order.side, quantity: qty, price, fee, gross, tradeDate, cashAfter: account.cash };
      account.events.push(event); account.eventHashes[fill.eventId] = eventHash;
      account.updatedAt = new Date().toISOString();
      account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
      atomicWrite(file, account);
      return account;
    } finally { try { fs.closeSync(lfd); } catch (_) {} try { fs.unlinkSync(lock); } catch (_) {} }
  }
  function read() {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 20 * 1024 * 1024) throw new Error('账户文件不安全');
    const a = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fp = hash({ cash: a.cash, positions: a.positions, events: a.events });
    if (a.fingerprint !== fp) throw new Error('账户账本指纹校验失败');
    return { ...a, paperOnly: true, brokerConnected: false };
  }
  return Object.freeze({ transact, read });
}
module.exports = { createPaperAccountLedger };
