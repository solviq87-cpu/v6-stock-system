'use strict';

/**
 * Append-only shadow reconciliation runner for settled paper trades.
 * It is deliberately observational: it never changes account, order or trade state.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { reconcilePaperAccount } = require('./paper-account-reconciliation');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw) return [];
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`影子对账日志第${index + 1}行损坏`); }
    const { hash, ...body } = row;
    if (!hash || sha256(JSON.stringify(body)) !== hash) throw new Error(`影子对账日志第${index + 1}行指纹不匹配`);
    return row;
  });
}

function createPaperShadowReconciler(options = {}) {
  const file = path.resolve(options.auditLogPath || path.join(process.cwd(), 'data', 'paper-shadow-reconciliation.jsonl'));
  if (typeof options.readSnapshot !== 'function') throw new TypeError('readSnapshot 必须是函数');
  if (!Number.isFinite(Number(options.initialCash)) || Number(options.initialCash) < 0) throw new TypeError('initialCash 必须是非负有限数值');
  let queue = Promise.resolve();

  async function run(settlement) {
    const task = async () => {
      if (!settlement || typeof settlement !== 'object' || Array.isArray(settlement)) throw new TypeError('settlement 必须是对象');
      const eventId = String(settlement.settlementId || settlement.tradeId || '').trim();
      if (!eventId) throw new TypeError('结算事件必须提供 settlementId 或 tradeId');
      if (!['FILLED', 'PARTIALLY_FILLED', 'SETTLED'].includes(String(settlement.status || '').toUpperCase())) {
        return { skipped: true, reason: '事件尚未结算', eventId };
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const prior = readLog(file);
      if (prior.some(row => row.eventId === eventId)) return { duplicate: true, eventId, prior: prior.find(row => row.eventId === eventId) };

      const snapshot = await options.readSnapshot();
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('账户快照读取失败，影子对账未执行');
      const result = reconcilePaperAccount({
        initialCash: options.initialCash,
        trades: snapshot.trades,
        account: snapshot.account,
        tolerance: options.tolerance
      });
      const previousHash = prior.length ? prior[prior.length - 1].hash : null;
      const body = {
        schemaVersion: 1,
        eventId,
        createdAt: new Date().toISOString(),
        status: result.ok ? 'PASS' : 'ALERT',
        result,
        previousHash
      };
      const row = { ...body, hash: sha256(JSON.stringify(body)) };
      const fd = fs.openSync(file, 'a', 0o600);
      try {
        fs.writeSync(fd, `${JSON.stringify(row)}\n`, null, 'utf8');
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      return { duplicate: false, eventId, status: row.status, result, hash: row.hash };
    };
    const next = queue.then(task, task);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  function inspectLog() {
    return readLog(file).map(row => ({ ...row }));
  }

  return Object.freeze({ run, inspectLog, auditLogPath: file });
}

module.exports = { createPaperShadowReconciler };
