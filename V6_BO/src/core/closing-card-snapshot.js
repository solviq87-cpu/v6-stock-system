'use strict';
// Last pre-close presentation, separate from prices, accounts and execution state.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { quoteObservationView } = require('./quote-observation-view');
const { marketFieldDay } = require('./market-display-snapshot');
const STATE_FIELDS = [
  'pool',
  'global',
  'external',
  'sectors',
  'sectorsDay',
  'sectorsAt',
  'auction',
  'ztPool',
  'ztDay',
  'ztDayProbed',
  'ztDayTag',
  'ztExcluded',
  'nameClans',
  'ztBySector',
  'ztTopics',
  'ztTopicSrc',
  'ztReasonHit',
  'ztPre',
  'ztPreBasis',
  'trendScan',
  'trendScanBasis',
  'steadyUp',
  'steadyUpBasis',
  'trendPool',
  'trendRej',
  'smallyang',
  'myrules',
  'nextplan',
  'signals',
  'mainline',
  'bigMoney',
  'abMove',
  'extLink',
  'preselect',
  'pre',
  'buzhang',
  'idxDisc',
  'ztNameClanScans',
  'stocksAt',
  'mood',
];
const DASHBOARD_FIELDS = [
  'rows',
  'indices',
  'mood',
  'sectors',
  'counts',
  'strategies',
  'observedAt',
  'indexObservedAt',
  'factorCatalog',
];
const KINDS = new Set([
  'state',
  'mobile',
  'quant',
  'auction',
  'intraday',
  'wash',
  'preseal',
  'shortline',
]);
const forbidden =
  /token|password|secret|credential|webhook|cookie|holding|account|balance|cash/i;
const dayOf = (n) =>
  new Date(n + 28800000).toISOString().slice(0, 10).replaceAll('-', '');
// Candidate evidence stays frozen; a later dated index observation must not be
// replaced by the last browser request before close. Compare complete rows only.
function latestIndexObservations(saved, current, now) {
  const allowed = new Set(['1.000001', '0.399001', '0.399006', '1.000688']);
  const valid = (r) => r && allowed.has(r.code) &&
    Number.isFinite(r.price) && r.price > 0 &&
    typeof r.quoteSource === 'string' && r.quoteSource.trim() &&
    Number.isSafeInteger(r.quoteAt) && r.quoteAt > 0 && r.quoteAt <= now &&
    Number.isSafeInteger(r.receivedAt) && r.receivedAt >= r.quoteAt && r.receivedAt <= now;
  const rows = new Map((Array.isArray(saved) ? saved : []).filter(r=>r && allowed.has(r.code)).map(r=>[r.code,r]));
  for (const row of Array.isArray(current) ? current : []) {
    const prior = rows.get(row?.code);
    if (valid(row) && (!valid(prior) || row.quoteAt > prior.quoteAt)) rows.set(row.code,row);
  }
  return [...rows.values()].map(r=>({...r,...quoteObservationView(r,now)}));
}
function beforeClose(now) {
  const d = new Date(now + 28800000),
    m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (m >= 555 && m <= 690) || (m >= 780 && m < 900);
}
function clean(v, depth = 0) {
  if (depth > 24) throw Error('snapshot depth');
  if (v === null || ['string', 'boolean'].includes(typeof v)) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v))
      if (
        !forbidden.test(k) &&
        !['__proto__', 'prototype', 'constructor'].includes(k) &&
        x !== undefined
      )
        out[k] = ['canTrade', 'canNotify'].includes(k)
          ? false
          : clean(x, depth + 1);
    return out;
  }
  return null;
}
function pick(v, fields) {
  return Object.fromEntries(
    fields
      .filter((k) => Object.hasOwn(v || {}, k))
      .map((k) => [k, clean(v[k])]),
  );
}
function selectPayload(kind, value) {
  if (kind !== 'state' && kind !== 'mobile') return clean(value);
  return {
    ...pick(value, STATE_FIELDS),
    ...(value.dashboard
      ? { dashboard: pick(value.dashboard, DASHBOARD_FIELDS) }
      : {}),
  };
}
function validKey(key) {
  const [kind, board, ...extra] = String(key).split(':');
  return (
    KINDS.has(kind) && ['all', 'main', 'gem'].includes(board) && !extra.length
  );
}
function createClosingCardSnapshot({
  file,
  clock = Date.now,
  onError = () => {},
} = {}) {
  let saved = {},
    dirty = false,
    lastWrite = 0;
  try {
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let data;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > 16 * 1024 * 1024 || st.mode & 0o077)
        throw Error('snapshot file');
      data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally {
      fs.closeSync(fd);
    }
    if (data.schemaVersion !== 1 || !data.entries)
      throw Error('snapshot schema');
    for (const [key, e] of Object.entries(data.entries))
      if (
        validKey(key) &&
        Number.isSafeInteger(e.capturedAt) &&
        e.capturedAt > 0 &&
        beforeClose(e.capturedAt) &&
        dayOf(e.capturedAt) === e.day &&
        e.value &&
        typeof e.value === 'object'
      )
        saved[key] = { ...e, value: selectPayload(key.split(':')[0], e.value) };
  } catch (e) {
    if (e.code !== 'ENOENT') onError('closing-card-snapshot-read');
  }
  function flush(force = false) {
    if (!file || !dirty || (!force && clock() - lastWrite < 30000)) return;
    const temp = file + '.' + crypto.randomBytes(10).toString('hex') + '.tmp';
    let fd;
    try {
      const raw = JSON.stringify({ schemaVersion: 1, entries: saved });
      if (Buffer.byteLength(raw) > 16 * 1024 * 1024)
        throw Error('snapshot capacity');
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, file);
      const dir = fs.openSync(path.dirname(file), 'r');
      try {
        fs.fsyncSync(dir);
      } finally {
        fs.closeSync(dir);
      }
      lastWrite = clock();
      dirty = false;
    } catch {
      onError('closing-card-snapshot-write');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temp);
      } catch {}
    }
  }
  function remember(key, value, { session, sourceDay } = {}) {
    const now = clock();
    if (
      !validKey(key) ||
      !session?.trading ||
      !beforeClose(now) ||
      sourceDay !== dayOf(now) ||
      session.day !== sourceDay ||
      !value ||
      value.locked ||
      value.error ||
      value.ok === false ||
      value.needAuth
    )
      return false;
    if (
      value.board !== undefined &&
      value.board !== key.split(':')[1] &&
      value.boardFallback !== true
    )
      return false;
    const kind = key.split(':')[0],
      next = selectPayload(kind, value);
    if (Buffer.byteLength(JSON.stringify(next)) > 2 * 1024 * 1024) return false;
    const old = saved[key];
    if (old?.capturedAt > now) return false;
    if (
      old?.day === sourceDay &&
      old.value.asOf === next.asOf &&
      Number.isSafeInteger(next.asOf) &&
      old.value.items?.length > next.items?.length
    )
      return false;
    // A transient empty result cannot erase an already observed nonempty card.
    if (old?.day === sourceDay && kind !== 'state' && kind !== 'mobile')
      for (const rows of ['items', 'candidates'])
        if (
          Array.isArray(next[rows]) &&
          !next[rows].length &&
          old.value[rows]?.length
        )
          return false;
    saved[key] = { day: sourceDay, capturedAt: now, value: next };
    dirty = true;
    flush();
    return true;
  }
  function read(key) {
    const now = clock(),
      e = saved[key];
    flush(!beforeClose(now));
    if (!e || e.capturedAt > now || e.day > dayOf(now)) return null;
    return {
      value: clean(e.value),
      meta: {
        marketFrozen: true,
        isSnapshot: true,
        snapshotRetained: true,
        snapshotDay: e.day,
        snapshotCapturedAt: e.capturedAt,
        canTrade: false,
        canNotify: false,
        displayOnly: true,
      },
    };
  }
  function project(kind, value, context) {
    const key = kind + ':all';
    if (context.session.trading && beforeClose(clock())) {
      remember(key, value, context);
      return value;
    }
    const e = read(key);
    if (!e) return { ...value, marketFrozen: true, freezeUnavailable: true };
    const { dashboard, ...fields } = e.value;
    // Rebind the dates of every restored field to the same saved payload,
    // including older files that did not persist individual field dates.
    const now = clock(), snapshotFieldDays = { ...value.snapshotFieldDays };
    for (const key of Object.keys(fields)) snapshotFieldDays[key] = marketFieldDay(key, fields, now);
    if (Object.hasOwn(fields, 'pool')) snapshotFieldDays.candidatePool = snapshotFieldDays.pool;
    if (dashboard && Object.hasOwn(dashboard, 'rows'))
      snapshotFieldDays.dashboard = marketFieldDay('dashboard', { dashboard }, now);
    return {
      ...value,
      ...fields,
      snapshotFieldDays,
      ...(dashboard
        ? { dashboard: { ...value.dashboard, ...dashboard, ...e.meta, snapshotFieldDays,
            indices: latestIndexObservations(dashboard.indices, value.dashboard?.indices, now),
            indexSnapshotPolicy: 'latest-original-time' } }
        : {}),
      ...e.meta,
    };
  }
  return { remember, read, project, flush };
}
module.exports = {
  createClosingCardSnapshot,
  beforeClose,
  STATE_FIELDS,
  DASHBOARD_FIELDS,
};
