'use strict';

// Offline replay of the existing capture protocol. This does not fetch data or
// authenticate a provider, and never replaces source observation clocks.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { bridgeExistingMarketSector } = require('./sector-breadth-market-bridge');
const { freezeSectorMemberIdentity } = require('./sector-member-identity-proof');
const { createTradingCalendar } = require('./trading-calendar');
const { readDaily } = require('../../scripts/sector-rotation-history');

const MAX_BYTES = 32 * 1024 * 1024;
const day = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const time = t => Number.isSafeInteger(t) && t > 0 && t < 4102444800000;
const chinaDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const minute = t => { const d = new Date(t + 8 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = s => s.category + '|' + s.code;
// Persisted JSON cannot preserve the null prototype of study.bySymbol.
const sameJSON = (a, b) => a !== undefined && b !== undefined &&
  isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

function normalizeCalendar(calendar, asOf, { historySessions } = {}) {
  if (!time(asOf)) throw Error('需要明确有效的asOf时点');
  for (const key of ['observedAt', 'firstObservedAt']) if (calendar?.[key] !== undefined) {
    const value = calendar[key], stamp = typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : value;
    if (!time(stamp) || stamp > asOf) throw Error('交易日历观测时间无效或位于研究时点之后');
  }
  let dates, metadata, totalCalendarSessions;
  if (calendar?.source === 'imported' && Array.isArray(calendar.tradeDates)) {
    dates = [...calendar.tradeDates];
    metadata = { source: 'imported', coverageVerified: false };
    totalCalendarSessions = dates.length;
  } else {
    const explicit = createTradingCalendar(calendar);
    dates = calendar.sessions.filter(s => s.open && s.date <= chinaDay(asOf)).map(s => s.date).sort();
    metadata = { ...explicit.metadata, coverageVerified: true };
    totalCalendarSessions = calendar.sessions.filter(s => s.open).length;
  }
  if (historySessions !== undefined && (!Number.isSafeInteger(historySessions) || historySessions < 1 || historySessions > 120))
    throw Error('historySessions须为1至120个明确研究交易日');
  if (!dates.length || historySessions === undefined && dates.length > 120 || dates.some((d, i) => !day(d) || d > chinaDay(asOf) || i && d <= dates[i - 1]))
    throw Error('交易日历必须包含1至120个明确递增、无重复且不晚于研究时点的交易日');
  const availableCalendarSessions = dates.length;
  if (historySessions !== undefined) {
    dates = dates.slice(-historySessions);
    metadata.selectedWindow = { method: 'latest-explicit-open-sessions-at-or-before-asof',
      requestedSessions: historySessions, selectedSessions: dates.length, totalCalendarSessions,
      availableCalendarSessions, omittedEarlierSessions: availableCalendarSessions - dates.length,
      from: dates[0], to: dates.at(-1), asOfChinaDay: chinaDay(asOf), completeCalendarHistory: availableCalendarSessions === dates.length };
  }
  return { dates, metadata: { ...metadata, observedAt: calendar.observedAt ?? calendar.firstObservedAt ?? null,
    firstObservedAt: calendar.firstObservedAt ?? null, sourceAuthenticated: false, sha256: sha(calendar) } };
}

function validateSelection(sectorIds) {
  if (sectorIds === undefined) return null;
  if (!Array.isArray(sectorIds) || !sectorIds.length || sectorIds.length > 30 ||
    new Set(sectorIds).size !== sectorIds.length || sectorIds.some(s => typeof s !== 'string' ||
      !/^(?:industry|concept)\|[A-Za-z0-9_-]{2,30}$/.test(s)))
    throw Error('sectorIds须为1至30个不重复的category|code明确身份');
  return [...sectorIds].sort();
}

function buildSectorRelationsCaptureInput(entries, { asOf, calendar, sectorIds } = {}) {
  return buildCaptureInput(entries, { asOf, sectorIds }, normalizeCalendar(calendar, asOf));
}
function buildCaptureInput(entries, { asOf, sectorIds }, { dates, metadata }) {
  const selection = validateSelection(sectorIds);
  if (!Array.isArray(entries) || entries.length > 120) throw Error('采集历史必须为至多120项的数组');
  const accepted = new Map(), blocked = new Set(), rejectedEntries = [], evidence = [];
  const reject = (date, reason) => { rejectedEntries.push({ tradeDate: day(date) ? date : null, reason }); };
  for (const entry of entries) {
    const { snapshot, membership, archive } = entry || {};
    const date = archive?.tradeDate ?? snapshot?.date;
    if (!day(date) || !dates.includes(date)) { reject(date, 'unlisted-or-invalid-trade-date'); continue; }
    if (accepted.has(date) || blocked.has(date)) {
      accepted.delete(date); blocked.add(date); reject(date, 'duplicate-daily-evidence'); continue;
    }
    // Mark even a rejected first entry: a second copy cannot repair ambiguity.
    blocked.add(date);
    const end = Date.parse(snapshot?.retrievedAt || '');
    if (!time(end) || end > asOf || chinaDay(end) !== date || snapshot?.date !== date ||
      archive?.schemaVersion !== 1 || archive.mode !== 'dated-sector-research-only' ||
      archive.status !== 'imported-unverified' || archive.observedAt !== end ||
      membership?.provider !== 'baostock:query_stock_industry' ||
      membership.provenance?.collectionMode !== 'current-provider-snapshot' ||
      membership.provenance?.historicalMembershipVerified !== false ||
      archive.canTrade !== false || archive.verifiedLive !== false || archive.weightsChanged !== false) {
      reject(date, end > asOf ? 'future-observation' : 'invalid-capture-contract'); continue;
    }
    const replay = bridgeExistingMarketSector(snapshot, membership, { asOf: end });
    if (replay.status !== 'imported-unverified') { reject(date, 'capture-replay-' + replay.reason); continue; }
    const proof = freezeSectorMemberIdentity(membership);
    if (proof.status !== 'identity-frozen-unverified' || !sameJSON(proof, archive.memberIdentity) ||
      !sameJSON(replay, archive.data)) {
      reject(date, 'capture-derived-or-member-identity-mismatch'); continue;
    }
    const available = new Map(membership.sectors.map(s => [id(s), s]));
    if (!selection && available.size > 30) throw Error('板块超过30个，必须提供明确sectorIds，不能自动截取');
    const chosen = selection || [...available.keys()].sort();
    const study = new Map(replay.study.sectors.map(s => [id(s), s]));
    const sectors = chosen.filter(key => available.has(key)).map(key => {
      const s = available.get(key), measured = study.get(key);
      return { category: s.category, code: s.code, name: s.name,
        members: [...s.members].sort(),
        changePct: typeof measured?.changePct === 'number' && Number.isFinite(measured.changePct) ? measured.changePct : null,
        mainNetInflow: null, amountCny: null };
    });
    if (!sectors.length) { reject(date, 'selected-sector-evidence-missing'); continue; }
    const row = { tradeDate: date, source: replay.quoteProvider,
      classificationVersion: replay.classificationVersion, observedAt: end,
      marketChangePct: replay.study.marketChangePct,
      returnMethod: replay.returnMethod, benchmarkMethod: replay.benchmarkMethod, sectors };
    accepted.set(date, row); blocked.delete(date);
    evidence.push({ tradeDate: date, observedAt: end, quoteProvider: replay.quoteProvider,
      membershipProvider: replay.membershipProvider, classificationVersion: replay.classificationVersion,
      membershipObservedAt: membership.observedAt,
      classificationDate: membership.provenance?.classificationDate ?? null,
      marketQuoteCoveragePct: replay.marketQuoteCoveragePct, universeSize: replay.universeSize,
      freshQuotes: replay.freshQuotes, selectedSectorIds: sectors.map(id),
      missingSelectedSectorIds: chosen.filter(key => !available.has(key)),
      inputSha256: { snapshot: sha(snapshot), membership: sha(membership), archive: sha(archive) } });
  }
  const current = accepted.get(dates.at(-1)) || null;
  if (current) {
    const anchor = minute(current.observedAt);
    for (const [date, row] of accepted) if (minute(row.observedAt) > anchor || minute(row.observedAt) < anchor - 30) {
      accepted.delete(date); reject(date, 'unaligned-intraday-capture-window');
    }
  }
  rejectedEntries.sort((a, b) => (a.tradeDate || '').localeCompare(b.tradeDate || '') || a.reason.localeCompare(b.reason));
  return { schemaVersion: 1, mode: 'sector-relations-capture-input-research-only', asOf,
    status: current ? 'descriptive-unverified' : 'unknown',
    reason: current ? 'replayed-supplied-captures-only' : 'latest-session-evidence-missing',
    tradeDates: dates, sectorHistory: dates.filter(d => d !== dates.at(-1) && accepted.has(d)).map(d => accepted.get(d)),
    sectorCurrent: current,
    provenance: { calendar: metadata, selection: selection ? 'explicit-sector-subset' : 'all-supplied-sectors',
      requestedSectorIds: selection, dailyEvidence: evidence.filter(e => accepted.has(e.tradeDate)).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      rejectedEntries, missingTradeDates: dates.filter(d => !accepted.has(d)),
      observationTimeMeaning: 'original-capture-completed-at-not-import-time',
      returnMethod: 'equal-weight-constituents-proxy', benchmarkMethod: 'equal-weight-valid-constituents-universe' },
    limitations: [
      'Provider snapshot and membership identity are replayed, not independently authenticated.',
      'Returns describe observed constituent proxies, not official sector indices or all-market coverage.',
      'Weekly classification changes are preserved; continuous same-version correlations may remain unknown.',
      'No sector flow or turnover is inferred from stock subsets; concept memberships are never summed.',
      'Historical membership is supported only by each supplied frozen observation; no current classification is backfilled.',
      'Local hashes and file names do not prove that an observation was archived at its claimed historical time.'
    ], verifiedLive: false, canTrade: false, canNotify: false, canTrain: false,
    weightsChanged: false, rankingModified: false, autoPromotion: false };
}

function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw Error('需要私有绝对路径');
  const full = path.resolve(value);
  if (full.split(path.sep).includes('public')) throw Error('采集研究禁止公开静态路径');
  let cursor = path.parse(full).root;
  for (const part of full.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('采集研究路径禁止符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
function read(file, limit = MAX_BYTES) {
  file = safePath(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw Error('采集研究JSON类型或大小无效');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readSectorRelationsCaptureInput({ captureRoot, calendarFile, asOf, sectorIds, historySessions = 120 } = {}) {
  const root = safePath(captureRoot), calendarPath = safePath(calendarFile);
  if (root === calendarPath || calendarPath.startsWith(root + path.sep)) throw Error('日历与采集根目录须独立');
  const calendar = read(calendarPath, 4 * 1024 * 1024), normalizedCalendar = normalizeCalendar(calendar, asOf, { historySessions });
  const { dates } = normalizedCalendar;
  validateSelection(sectorIds);
  if (!fs.lstatSync(root).isDirectory()) throw Error('采集根目录无效');
  const archiveRoot = safePath(path.join(root, 'sector-archive'));
  const latest = readDaily(archiveRoot, dates.at(-1), asOf), entries = [];
  let bytes = 0;
  const readBudgeted = file => {
    const stat = fs.lstatSync(safePath(file));
    bytes += stat.size;
    if (bytes > 64 * 1024 * 1024) throw Error('采集输入累计超过64MiB，必须缩小明确日历范围');
    return read(file);
  };
  if (latest) {
    const anchorMinute = minute(latest.observedAt);
    for (const date of dates) {
      const archive = date === dates.at(-1) ? latest : readDaily(archiveRoot, date, asOf, { anchorMinute });
      if (!archive) continue;
      bytes += Buffer.byteLength(JSON.stringify(archive));
      if (bytes > 64 * 1024 * 1024) throw Error('采集输入累计超过64MiB，必须缩小明确日历范围');
      const name = String(archive.observedAt) + '.json';
      let snapshot, membership;
      try {
        snapshot = readBudgeted(path.join(root, 'snapshots', date, name));
        membership = readBudgeted(path.join(root, 'members', date, name));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      entries.push({ snapshot, membership, archive });
    }
  }
  const result = buildCaptureInput(entries, { asOf, sectorIds }, normalizedCalendar);
  result.provenance.sampling = { method: 'latest-at-or-before-asof-with-historical-30-minute-preceding-window',
    anchorChinaMinute: latest ? minute(latest.observedAt) : null, maxHistoricalLagMinutes: 30 };
  return result;
}

module.exports = { buildSectorRelationsCaptureInput, readSectorRelationsCaptureInput };
