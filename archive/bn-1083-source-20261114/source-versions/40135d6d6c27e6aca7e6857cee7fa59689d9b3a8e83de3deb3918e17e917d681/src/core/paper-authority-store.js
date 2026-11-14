'use strict';
// One atomic file owns both account snapshots and immutable commit events.
// No shadow balance, no separate order journal and no broker side effects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const copy = v => JSON.parse(JSON.stringify(v));
function atomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    const d = fs.openSync(dir, 'r');
    try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  } catch (e) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}
function createPaperAuthorityStore(file, keys = ['pool', 'pre']) {
  const location = path.resolve(file);
  let current = null;
  if (fs.existsSync(location)) {
    const st = fs.lstatSync(location);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 32 * 1024 * 1024) throw Error('权威账户文件不安全');
    current = JSON.parse(fs.readFileSync(location, 'utf8'));
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw Error('权威账户格式错误');
    if (current.__authority) {
      const a = current.__authority;
      if (a.schema !== 1 || !Array.isArray(a.events) || !Number.isSafeInteger(a.revision) || a.revision !== a.events.length || a.checksum !== hash({ accounts: accounts(current), events: a.events, revision: a.revision })) throw Error('权威账户校验失败：拒绝静默重置');
    }
  }
  function accounts(doc) { return Object.fromEntries(keys.map(k => [k, copy(doc[k] || {})])); }
  function read() { return current ? copy(current) : null; }
  function commit(nextAccounts, event = { type: 'account-commit' }) {
    if (!nextAccounts || typeof nextAccounts !== 'object' || !event || typeof event.type !== 'string') throw Error('非法提交');
    const prev = current || {};
    const before = accounts(prev);
    const after = accounts(nextAccounts);
    for (const k of keys) {
      const a = after[k];
      if (!Number.isFinite(a.cash) || a.cash < -0.005 || !a.positions || typeof a.positions !== 'object' || !Array.isArray(a.trades)) throw Error('账户状态不合法: ' + k);
    }
    const old = prev.__authority || { revision: 0, events: [] };
    const revision = old.revision + 1;
    const entry = { revision, type: event.type, detail: copy(event.detail || {}), beforeHash: hash(before), afterHash: hash(after), previousEventHash: old.events.length ? hash(old.events[old.events.length - 1]) : null };
    const events = old.events.concat([entry]);
    if (events.length > 20000) throw Error('权威事件达到容量上限，禁止截断');
    const doc = { ...after, __authority: { schema: 1, revision, events, checksum: hash({ accounts: after, events, revision }) } };
    atomic(location, doc);
    current = doc; // only publish after fsync and rename
    return { revision, event: copy(entry) };
  }
  return Object.freeze({ read, commit });
}
module.exports = { createPaperAuthorityStore };
