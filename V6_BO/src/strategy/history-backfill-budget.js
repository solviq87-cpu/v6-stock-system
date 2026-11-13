'use strict';

// This ledger limits historical maintenance, independently of the provider wire
// governor. Reserve before network I/O so a crash cannot refund an attempted batch.
const fs = require('node:fs');
const path = require('node:path');
const DAY_MS = 86400000;
const POLICY = Object.freeze({ dailyLimit: 6000, batchLimit: 60, minIntervalMs: 60000,
  failureDelayMs: 15 * 60000, maxFailureDelayMs: 6 * 3600000, bootstrapDelayMs: 15 * 60000 });
const dayOK = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const chinaDay = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);

function backfillSession(at, isTradeDay) {
  const day = chinaDay(at), civil = d => new Date(d + 'T12:00:00');
  let targetDate = '';
  for (let i = 0; i <= 40; i++) {
    const candidate = new Date(Date.parse(day) - i * DAY_MS).toISOString().slice(0, 10);
    if (isTradeDay(civil(candidate)) && at >= Date.parse(candidate + 'T15:30:00+08:00')) { targetDate = candidate; break; }
  }
  if (!targetDate) throw Error('最近已收盘交易日未知，暂停补历史');
  let nextSessionAt = null;
  for (let i = 1; i <= 40; i++) {
    const candidate = new Date(Date.parse(targetDate) + i * DAY_MS).toISOString().slice(0, 10);
    if (isTradeDay(civil(candidate))) { nextSessionAt = Date.parse(candidate + 'T15:30:00+08:00'); break; }
  }
  return { day, targetDate, cutoffMs: Date.parse(targetDate + 'T15:30:00+08:00'), nextSessionAt };
}

function createHistoryBackfillBudget({ file, now = Date.now, dailyLimit = POLICY.dailyLimit } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('历史预算必须使用固定绝对路径');
  // 0 disables intake; it never means unlimited. Other settings may only lower the cap.
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > POLICY.dailyLimit) throw Error('历史日预算必须为0至6000');
  let state = null, storageError = null;
  const clock = () => { const at = now(); if (!Number.isSafeInteger(at) || at <= 0) throw Error('历史预算时钟无效'); return at; };
  function save() {
    const dir = path.dirname(file), tmp = file + '.tmp';
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(dir).isSymbolicLink() || fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('历史预算路径不可为符号链接');
      const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
      const directory = fs.openSync(dir, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch (e) { storageError = '历史预算无法持久化：' + e.message; throw Error(storageError); }
  }
  function load(at) {
    if (storageError) throw Error(storageError);
    if (state) return;
    try {
      if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4 * 1024 * 1024) throw Error('历史预算文件无效');
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.schemaVersion !== 1 || !dayOK(state.day) || !Number.isSafeInteger(state.attempted) || state.attempted < 0 ||
        !Number.isSafeInteger(state.nextBatchAt) || state.nextBatchAt < 0 || !Number.isSafeInteger(state.cursor) || state.cursor < 0 ||
        !state.items || typeof state.items !== 'object' || Array.isArray(state.items) || Object.keys(state.items).length > 10000 ||
        Object.entries(state.items).some(([code, row]) => !/^\d{6}$/.test(code) || !row ||
          !Number.isSafeInteger(row.failures) || row.failures < 0 || !Number.isSafeInteger(row.nextAttemptAt) ||
          typeof row.reason !== 'string' || row.reason.length > 80)) throw Error('历史预算内容校验失败');
    } catch (e) {
      if (e.code !== 'ENOENT') { state = null; storageError = '历史预算无可信状态：' + e.message; throw Error(storageError); }
      // No pre-upgrade budget evidence is available. Wait, then admit only a bounded day.
      state = { schemaVersion: 1, day: chinaDay(at), attempted: 0, cursor: 0,
        nextBatchAt: at + POLICY.bootstrapDelayMs, bootstrap: 'prior-usage-unknown', items: {} };
      save();
    }
  }
  function reserve(codes, { limit = POLICY.batchLimit, targetDate } = {}) {
    const at = clock(); load(at);
    const day = chinaDay(at);
    if (!dayOK(targetDate) || !Array.isArray(codes) || codes.length > 10000 || codes.some(c => !/^\d{6}$/.test(c))) throw Error('历史队列输入无效');
    if (day < state.day) return { codes: [], reason: 'clock-went-backward', ...summary() };
    if (day > state.day) { state.day = day; state.attempted = 0; save(); }
    if (!dailyLimit || state.attempted >= dailyLimit) return { codes: [], reason: 'daily-budget', ...summary() };
    if (at < state.nextBatchAt) return { codes: [], reason: state.bootstrap === 'prior-usage-unknown' ? 'cold-start-or-batch-cooldown' : 'batch-cooldown', ...summary() };
    const unique = [...new Set(codes)], selected = [];
    const count = Math.min(POLICY.batchLimit, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : POLICY.batchLimit), dailyLimit - state.attempted);
    const start = state.cursor % Math.max(1, unique.length);
    let walked = 0;
    for (; walked < unique.length && selected.length < count; walked++) {
      const code = unique[(start + walked) % unique.length], row = state.items[code];
      if (row && (at < row.nextAttemptAt || row.holdTarget === targetDate)) continue;
      selected.push(code);
    }
    if (!selected.length) return { codes: [], reason: count ? 'code-cooldown-or-empty' : 'disabled-round', ...summary() };
    state.cursor = (start + walked) % unique.length;
    state.attempted += selected.length;
    state.nextBatchAt = at + POLICY.minIntervalMs;
    state.bootstrap = 'bounded-reservations';
    for (const code of selected) {
      const previous = state.items[code];
      state.items[code] = { failures: previous?.failures || 0, reason: 'reserved-before-fetch',
        nextAttemptAt: at + POLICY.failureDelayMs, lastAttemptAt: at };
    }
    save();
    return { codes: selected, reason: 'reserved', ...summary() };
  }
  function finish(code, { success = false, reason = 'source-failed', targetDate, nextSessionAt = null, permanentShort = false } = {}) {
    const at = clock(); load(at);
    if (!/^\d{6}$/.test(code) || !state.items[code]) throw Error('历史结果未预留预算');
    if (success) delete state.items[code];
    else {
      const row = state.items[code], failures = Math.min(32, row.failures + 1);
      state.items[code] = { ...row, failures, reason: String(reason).slice(0, 80),
        nextAttemptAt: at + Math.min(POLICY.maxFailureDelayMs, POLICY.failureDelayMs * 2 ** (failures - 1)) };
      if (reason === 'listed-short-history' && Number.isSafeInteger(nextSessionAt) && nextSessionAt > at) {
        state.items[code].nextAttemptAt = nextSessionAt;
        state.items[code].holdTarget = targetDate;
      } else if (permanentShort) {
        // Only explicit supplier completeness metadata supports this long pause.
        state.items[code].nextAttemptAt = at + 7 * DAY_MS;
      }
    }
    save();
  }
  function summary() {
    return { budgetDay: state?.day || null, attemptedToday: state?.attempted || 0,
      dailyLimit, nextBatchAt: state?.nextBatchAt || null,
      deferredCodes: state ? Object.keys(state.items).length : 0, storageError };
  }
  return { reserve, finish, summary };
}

module.exports = { createHistoryBackfillBudget, backfillSession, chinaDay, POLICY };
