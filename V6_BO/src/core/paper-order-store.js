'use strict';
/** Durable, single-writer paper-order event store. Offline only; never talks to a broker. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { reducePaperOrderEvents } = require('./paper-order-state-machine');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function safeName(id) {
  const s = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) throw new Error('订单ID不能用于安全文件名');
  return s;
}
function readRegular(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile() || st.size > 10 * 1024 * 1024) throw new Error('订单存储文件无效');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function atomicReplace(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    try { const d = fs.openSync(dir, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch (_) { /* directory fsync is platform-dependent */ }
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}
function withLock(file, fn) {
  const lock = `${file}.lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('订单正在被其他进程更新，已安全拒绝并发写入'); throw e; }
  try { fs.writeFileSync(fd, `${process.pid}\n`); fs.fsyncSync(fd); return fn(); }
  finally { try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(lock); } catch (_) {} }
}
function createPaperOrderStore(root) {
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  function fileOf(id) { return path.join(dir, `${safeName(id)}.order.json`); }
  function create(order) {
    const file = fileOf(order && order.orderId);
    return withLock(file, () => {
      const initial = { schemaVersion: 1, order, events: [], state: reducePaperOrderEvents(order, []), journalHash: hash([]) };
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(initial, null, 2) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      return initial.state;
    });
  }
  function append(orderId, event) {
    const file = fileOf(orderId);
    return withLock(file, () => {
      const record = readRegular(file);
      if (record.schemaVersion !== 1 || !Array.isArray(record.events) || !record.order) throw new Error('订单日志结构无效');
      const id = String(event && event.eventId || '');
      const old = record.events.find(x => String(x.eventId) === id);
      if (old) {
        if (hash(old) !== hash(event)) throw new Error('相同 eventId 对应不同事件内容，拒绝幂等冲突');
        return record.state;
      }
      const events = [...record.events, event];
      const state = reducePaperOrderEvents(record.order, events);
      const next = { schemaVersion: 1, order: record.order, events, state, journalHash: hash(events) };
      atomicReplace(file, next);
      return state;
    });
  }
  function get(orderId) {
    const record = readRegular(fileOf(orderId));
    if (record.schemaVersion !== 1 || !Array.isArray(record.events) || record.journalHash !== hash(record.events)) throw new Error('订单日志指纹校验失败');
    const rebuilt = reducePaperOrderEvents(record.order, record.events);
    if (rebuilt.fingerprint !== record.state.fingerprint) throw new Error('订单状态与事件日志不一致');
    return { ...record, state: rebuilt, paperOnly: true, brokerConnected: false };
  }
  return Object.freeze({ create, append, get });
}
module.exports = { createPaperOrderStore };
