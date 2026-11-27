'use strict';

/**
 * Append-only shadow reconciliation runner for settled paper trades.
 * It is deliberately observational: it never changes account, order or trade state.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { reconcilePaperAccount } = require('./paper-account-reconciliation');
const { withAccountLock } = require('./account-process-lock');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function readLog(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  let raw;
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('影子对账日志文件必须为普通文件');
    raw = fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
  if (!raw) return [];
  // The original writer commits complete JSONL lines. Never append onto a
  // partially written record, even if its remaining JSON happens to parse.
  if (!raw.endsWith('\n')) throw new Error('影子对账日志末行未完整提交');
  const lines = raw.slice(0, -1).split('\n');
  const ids = new Set();
  let previousHash = null;
  return lines.map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`影子对账日志第${index + 1}行损坏`); }
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`影子对账日志第${index + 1}行损坏`);
    const { hash, ...body } = row;
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || sha256(JSON.stringify(body)) !== hash) throw new Error(`影子对账日志第${index + 1}行指纹不匹配`);
    if (row.previousHash !== previousHash) throw new Error(`影子对账日志第${index + 1}行审计链断裂`);
    if (typeof row.eventId !== 'string' || !row.eventId || row.eventId !== row.eventId.trim() || ids.has(row.eventId)) throw new Error(`影子对账日志第${index + 1}行结算事件重复或无效`);
    if (row.schemaVersion !== 1 || !row.result || typeof row.result.ok !== 'boolean' || typeof row.result.complete !== 'boolean' || row.status !== (row.result.ok ? 'PASS' : 'ALERT') || (row.result.ok && !row.result.complete)) throw new Error(`影子对账日志第${index + 1}行对账回执不一致`);
    ids.add(row.eventId);
    previousHash = hash;
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
      // Read the external snapshot without holding a kernel lock. The existing
      // synchronous file guard covers revalidation, deduplication and append
      // across cooperating instances/processes, not only this instance's queue.
      return withAccountLock(file, () => {
        const latest = readLog(file);
        if (latest.length < prior.length || (prior.length && latest[prior.length - 1].hash !== prior.at(-1).hash)) throw new Error('已观察审计链发生截断或替换，拒绝追加');
        const duplicate = latest.find(row => row.eventId === eventId);
        if (duplicate) return { duplicate: true, eventId, prior: duplicate };
        const previousHash = latest.length ? latest[latest.length - 1].hash : null;
        const body = {
          schemaVersion: 1,
          eventId,
          createdAt: new Date().toISOString(),
          status: result.ok ? 'PASS' : 'ALERT',
          result,
          previousHash
        };
        const row = { ...body, hash: sha256(JSON.stringify(body)) };
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0), 0o600);
        try {
          if (!fs.fstatSync(fd).isFile()) throw new Error('影子对账日志文件必须为普通文件');
          fs.writeFileSync(fd, `${JSON.stringify(row)}\n`, 'utf8');
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        return { duplicate: false, eventId, status: row.status, result, hash: row.hash };
      });
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
