'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fetchEastmoneyCurrentBoards } = require('./eastmoney-current-board-members');
const { analyzeSectorRelations } = require('../strategy/sector-relations');
const { createTradingCalendar } = require('./trading-calendar');
const PROVIDER = 'eastmoney-current-board-members';
const LIMITS = { observations: 256, snapshotBytes: 2 * 1024 * 1024, snapshotTotalBytes: 64 * 1024 * 1024,
  rawFiles: 2000, rawBytes: 2 * 1024 * 1024, rawTotalBytes: 128 * 1024 * 1024 };
const FLAGS = { researchOnly: true, verifiedLive: false, canTrade: false, canNotify: false,
  canTrain: false, weightsChanged: false, rankingModified: false, autoPromotion: false };
const RAW_ENDPOINTS = new Set(['https://17.push2.eastmoney.com/api/qt/clist/get',
  'https://79.push2.eastmoney.com/api/qt/clist/get', 'https://29.push2.eastmoney.com/api/qt/clist/get',
  'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value);
const hash = value => digest(encode(value));
const chinaDay = value => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
const time = value => Number.isSafeInteger(value) && value > 0 && value < 4102444800000;
const key = b => b.category + '|' + b.code;
function selection(value) {
  if (!Array.isArray(value) || value.length > 6 || value.some(b => !b || !['industry', 'concept'].includes(b.category) || !/^BK\d{4}$/.test(b.code)) || new Set(value.map(key)).size !== value.length)
    throw Error('板块选择必须为至多6个明确且不重复的行业/概念身份');
  return value.map(b => ({ category: b.category, code: b.code })).sort((a, b) => key(a).localeCompare(key(b)));
}
function privatePath(value, create = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw Error('需要私有绝对目录');
  const full = path.resolve(value);
  if (full === path.parse(full).root || full.split(path.sep).some(p => p.toLowerCase() === 'public')) throw Error('禁止公开存储路径');
  let at = path.parse(full).root;
  for (const part of full.slice(at.length).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    try { const st = fs.lstatSync(at); if (st.isSymbolicLink() || !st.isDirectory()) throw Error('私有路径禁止符号链接或非目录'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (create) fs.mkdirSync(full, { recursive: true, mode: 0o700 });
  if (fs.existsSync(full) && (fs.statSync(full).mode & 0o077)) throw Error('存储目录须为私有0700');
  return full;
}
function readBytes(file, maxBytes) {
  privatePath(path.dirname(file));
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077 || st.size < 1 || st.size > maxBytes) throw Error('档案须为受限私有0600普通文件');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const current = fs.fstatSync(fd); if (current.size > maxBytes) throw Error('档案大小变化'); return fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
}
function publish(dir, name, bytes) {
  privatePath(dir, true);
  const file = path.join(dir, name), temp = path.join(dir, '.stage-' + crypto.randomBytes(12).toString('hex'));
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temp, file); }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
    return true;
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
function inventory(root) {
  const dir = privatePath(path.join(root, 'raw'));
  if (!fs.existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0, bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/^(?:[a-f0-9]{64}\.bin|\.stage-[a-f0-9]{24})$/.test(name)) throw Error('原始响应目录身份无效');
    let st;
    try { st = fs.lstatSync(path.join(dir, name)); }
    catch (error) { if (error.code === 'ENOENT' && /^\.stage-/.test(name)) continue; throw error; }
    if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077 || st.size < (/^\.stage-/.test(name) ? 0 : 1) || st.size > LIMITS.rawBytes) throw Error('原始响应文件类型、权限或大小无效');
    count++; bytes += st.size;
  }
  if (count > LIMITS.rawFiles || bytes > LIMITS.rawTotalBytes) throw Error('原始响应达到容量上限');
  return { count, bytes };
}
function validateSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.provider !== PROVIDER || snapshot.source !== 'eastmoney' ||
    snapshot.collectionMode !== 'current-provider-snapshot' || snapshot.historicalMembershipVerified !== false ||
    !time(snapshot.startedAt) || !time(snapshot.retrievedAt) || snapshot.startedAt > snapshot.retrievedAt ||
    snapshot.retrievedAt - snapshot.startedAt > 45000 || Object.keys(FLAGS).some(k => snapshot[k] !== FLAGS[k]) ||
    !Array.isArray(snapshot.boards) || !Array.isArray(snapshot.rawRefs) || snapshot.rawRefs.length > 20) throw Error('板块来源、时钟或研究门禁无效');
  if (encode(selection(snapshot.selection)) !== encode(snapshot.selection) || snapshot.boards.length !== snapshot.selection.length ||
    snapshot.boards.some((b, i) => key(b) !== key(snapshot.selection[i]))) throw Error('板块来源与冻结选择不一致');
  for (const b of snapshot.boards) {
    if (b.membershipComplete) {
      if (!Array.isArray(b.members) || b.members.length > 1000 || b.members.some(s => typeof s !== 'string' || !/^\d{6}$/.test(s)) ||
        new Set(b.members).size !== b.members.length || encode([...b.members].sort()) !== encode(b.members) ||
        b.membershipFingerprint !== hash(b.members) || !time(b.membersObservedAt) || b.membersObservedAt < snapshot.startedAt || b.membersObservedAt > snapshot.retrievedAt)
        throw Error('完整成员身份或实际观测时间无效');
    } else if (b.members !== null) throw Error('不完整成员不能作为完整清单');
    if (b.quoteAt !== null && (!time(b.quoteAt) || b.quoteAt > snapshot.retrievedAt || chinaDay(b.quoteAt) !== b.quoteDate)) throw Error('报价时点或实际日期无效');
    for (const row of b.flowHistory?.records || []) if (!time(row.knownAt) || row.knownAt < snapshot.startedAt || row.knownAt > snapshot.retrievedAt) throw Error('历史资金不能倒填可得时点');
  }
  const complete = snapshot.boards.length > 0 && snapshot.boards.every(b => b.membershipComplete && b.members?.length && b.name);
  const version = complete ? 'eastmoney-current-members-v1:' + hash(snapshot.boards.map(b => ({ category: b.category, code: b.code, name: b.name, members: b.members }))) : null;
  if (snapshot.classificationVersion !== version) throw Error('板块成员内容指纹不一致');
  const eligible = Boolean(version && snapshot.tradeDate && snapshot.boards.every(b => b.quoteDate === snapshot.tradeDate &&
    chinaDay(b.membersObservedAt) === snapshot.tradeDate && b.changePct !== null));
  if (snapshot.dailyHistoryEligible !== eligible) throw Error('日度成员、报价或真实同日门禁无效');
  if (snapshot.sectorCurrent) {
    const expected = { tradeDate: snapshot.tradeDate, source: PROVIDER, classificationVersion: version,
      observedAt: snapshot.retrievedAt, marketChangePct: null, benchmarkMethod: null, returnMethod: 'vendor-board-reported-change',
      sectors: snapshot.boards.map(b => ({ category: b.category, code: b.code, name: b.name, members: b.members,
        changePct: b.changePct, mainNetInflow: b.mainNetInflow, amountCny: b.amountCny, quoteAt: b.quoteAt,
        quoteDate: b.quoteDate, membersObservedAt: b.membersObservedAt })) };
    if (encode(snapshot.sectorCurrent) !== encode(expected) || !version) throw Error('板块关系派生内容不一致');
  } else if (eligible) throw Error('日度成员证据缺少当前关系行');
  let rawTotal = 0;
  for (const ref of snapshot.rawRefs) {
    let url;
    try { url = new URL(ref.requestUrl); } catch { throw Error('原始响应来源URL无效'); }
    rawTotal += ref.bytes;
    if (ref.source !== 'eastmoney' || ref.hashBasis !== 'raw-response-bytes' || !['catalogue', 'members', 'flow'].includes(ref.kind) ||
      !RAW_ENDPOINTS.has(url.origin + url.pathname) || url.username || url.password || url.hash ||
      !/^[a-f0-9]{64}$/.test(ref.rawHash) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > LIMITS.rawBytes ||
      !time(ref.requestStartedAt) || !time(ref.observedAt) || ref.requestStartedAt < snapshot.startedAt ||
      ref.requestStartedAt > ref.observedAt || ref.observedAt > snapshot.retrievedAt) throw Error('原始响应引用、来源或观测时间无效');
  }
  if (rawTotal > 8 * 1024 * 1024) throw Error('单次原始响应累计超过8MiB');
}
function dailyAdmission(snapshot, recordedAt) {
  if (!snapshot.dailyHistoryEligible) return { eligible: false, reason: 'provider-members-or-same-day-evidence-incomplete' };
  try {
    const calendar = require('../../config/research-calendar-2026.json'), explicit = createTradingCalendar(calendar);
    const known = Date.parse(calendar.firstObservedAt);
    if (!time(known) || known > recordedAt) return { eligible: false, reason: 'calendar-not-known-at-recording' };
    if (!explicit.isOpen(snapshot.tradeDate)) return { eligible: false, reason: 'calendar-session-closed' };
    return { eligible: true, reason: null };
  } catch { return { eligible: false, reason: 'calendar-outside-covered-range-or-invalid' }; }
}
function readChain(root, asOf) {
  root = privatePath(root); const dir = privatePath(path.join(root, 'snapshots')), rawUsage = inventory(root);
  const state = { latest: null, last: null, count: 0, bytes: 0, daily: new Map(), dailyRejected: [], repeatedDaily: 0, rawUsage };
  if (!fs.existsSync(dir)) return state;
  const allNames = fs.readdirSync(dir), verifiedRaw = new Map();
  let stagingBytes = 0;
  for (const name of allNames.filter(n => /^\.stage-[a-f0-9]{24}$/.test(n))) {
    let st;
    try { st = fs.lstatSync(path.join(dir, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077 || st.size > LIMITS.snapshotBytes) throw Error('观察暂存文件类型、权限或大小无效');
    stagingBytes += st.size;
  }
  if (allNames.length > LIMITS.observations * 2 || stagingBytes > LIMITS.snapshotTotalBytes) throw Error('观察暂存文件达到容量上限');
  const names = allNames.filter(n => !/^\.stage-[a-f0-9]{24}$/.test(n)).sort();
  if (names.length > LIMITS.observations) throw Error('板块观察版本达到256上限');
  for (const [i, name] of names.entries()) {
    if (name !== String(i + 1).padStart(6, '0') + '.json') throw Error('板块观察链身份或连续性无效');
    const bytes = readBytes(path.join(dir, name), LIMITS.snapshotBytes); state.bytes += bytes.length;
    if (state.bytes + stagingBytes > LIMITS.snapshotTotalBytes) throw Error('板块观察链超过64MiB');
    const event = JSON.parse(bytes), { snapshotHash, ...payload } = event;
    if (snapshotHash !== hash(payload) || event.schemaVersion !== 1 || event.revision !== i + 1 ||
      event.previousHash !== (state.last?.snapshotHash ?? null) || !time(event.recordedAt) ||
      event.recordedAt < event.snapshot?.retrievedAt || state.last && (event.recordedAt < state.last.recordedAt || event.snapshot.retrievedAt < state.last.snapshot.retrievedAt)) throw Error('板块观察链完整性或真实时钟无效');
    validateSnapshot(event.snapshot);
    for (const ref of event.snapshot.rawRefs) {
      if (!/^[a-f0-9]{64}$/.test(ref.rawHash) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > LIMITS.rawBytes ||
        !time(ref.observedAt) || ref.observedAt < event.snapshot.startedAt || ref.observedAt > event.snapshot.retrievedAt) throw Error('原始响应引用无效');
      if (!verifiedRaw.has(ref.rawHash)) {
        const raw = readBytes(path.join(root, 'raw', ref.rawHash + '.bin'), LIMITS.rawBytes);
        if (raw.length !== ref.bytes || digest(raw) !== ref.rawHash) throw Error('原始响应哈希或大小不一致');
        verifiedRaw.set(ref.rawHash, raw.length);
      }
      if (verifiedRaw.get(ref.rawHash) !== ref.bytes) throw Error('重复原始响应引用大小不一致');
    }
    state.last = event; state.count++;
    if (event.recordedAt <= asOf && event.snapshot.retrievedAt <= asOf) {
      state.latest = event;
      const admission = dailyAdmission(event.snapshot, event.recordedAt);
      if (event.snapshot.dailyHistoryEligible && !admission.eligible) state.dailyRejected.push({ tradeDate: event.snapshot.tradeDate, recordedAt: event.recordedAt, reason: admission.reason });
      if (admission.eligible) {
        const scope = hash(event.snapshot.selection), dailyKey = scope + '|' + event.snapshot.tradeDate;
        if (!state.daily.has(dailyKey)) state.daily.set(dailyKey, { scope, row: event.snapshot.sectorCurrent, snapshotHash, recordedAt: event.recordedAt });
        else state.repeatedDaily++;
      }
    }
  }
  return state;
}
function overlap(boards) {
  const edges = [];
  for (let i = 0; i < boards.length; i++) for (let j = i + 1; j < boards.length; j++) {
    const a = boards[i], b = boards[j];
    if (!a.membershipComplete || !b.membershipComplete || !a.members?.length || !b.members?.length) continue;
    const sb = new Set(b.members), sharedMembers = a.members.filter(s => sb.has(s)), unionMembers = a.members.length + b.members.length - sharedMembers.length;
    edges.push({ from: key(a), to: key(b), status: 'observed-unverified', jaccard: sharedMembers.length / unionMembers,
      sharedMembers, unionMembers, membersObservedAt: { from: a.membersObservedAt, to: b.membersObservedAt }, source: PROVIDER, historicalMembershipVerified: false });
  }
  return edges;
}
function summarize(state, asOf) {
  const snapshot = state.latest?.snapshot ?? null, selected = snapshot?.selection ?? [], scope = hash(selected);
  const daily = [...state.daily.values()].filter(d => d.scope === scope).sort((a, b) => a.row.tradeDate.localeCompare(b.row.tradeDate));
  let dates = [], calendarReason = null, calendarMetadata = null;
  try {
    const calendar = require('../../config/research-calendar-2026.json'), explicit = createTradingCalendar(calendar);
    const known = Date.parse(calendar.firstObservedAt);
    if (!time(known) || known > asOf) throw Error('calendar-not-known-at-asof');
    calendarMetadata = { ...explicit.metadata, firstObservedAt: calendar.firstObservedAt };
    if (daily.length) {
      if (daily[0].row.tradeDate < calendar.from || daily.at(-1).row.tradeDate > calendar.to) throw Error('calendar-outside-covered-range');
      dates = calendar.sessions.filter(s => s.open && s.date >= daily[0].row.tradeDate && s.date <= daily.at(-1).row.tradeDate).map(s => s.date).sort().slice(-120);
      explicit.assertDates(dates);
    }
  } catch (error) { calendarReason = String(error.message); }
  const window = daily.filter(d => dates.includes(d.row.tradeDate));
  const relations = analyzeSectorRelations({ asOf, tradeDates: calendarReason ? [] : dates, history: window.map(d => d.row) });
  const { catalogue, selection: _selection, rawRefs, ...current } = snapshot || {};
  return { schemaVersion: 1, provider: PROVIDER, status: snapshot?.status ?? 'not-observed', selectionRequired: !selected.length,
    catalogue: catalogue ?? { complete: false, records: [], categories: {} }, selection: selected,
    current: snapshot ? { ...current, dailyHistoryAdmission: dailyAdmission(snapshot, state.latest.recordedAt) } : null,
    overlap: overlap(snapshot?.boards || []), relations,
    historyCoverage: { observedVersions: state.count, frozenDailyCount: daily.length, expectedSessions: dates.length,
      acceptedSessions: window.length, missingTradeDates: dates.filter(d => !window.some(w => w.row.tradeDate === d)),
      selectedWindow: { from: dates[0] ?? null, to: dates.at(-1) ?? null, maximumSessions: 120 },
      repeatedSameDayObservations: state.repeatedDaily, calendar: calendarMetadata, calendarReason,
      rejectedDailyEvidence: state.dailyRejected,
      dailyEvidence: window.map(d => ({ tradeDate: d.row.tradeDate, observedAt: d.row.observedAt, recordedAt: d.recordedAt, snapshotHash: d.snapshotHash, classificationVersion: d.row.classificationVersion })) },
    rawRefs: rawRefs || [], archiveUsage: { observations: state.count, snapshotBytes: state.bytes, rawFiles: state.rawUsage.count, rawBytes: state.rawUsage.bytes },
    limits: LIMITS, ...FLAGS };
}
function readPublicSectorResearch(root, { now = Date.now } = {}) {
  const asOf = typeof now === 'function' ? now() : now;
  if (!time(asOf)) throw Error('研究读取时钟无效');
  return summarize(readChain(root, asOf), asOf);
}
async function capturePublicSectorResearch(root, options = {}, { fetchBoards = fetchEastmoneyCurrentBoards, now = Date.now } = {}) {
  const clock = typeof now === 'function' ? now : () => now, startedAt = clock();
  if (!time(startedAt) || typeof fetchBoards !== 'function') throw Error('研究采集时钟或来源函数无效');
  root = privatePath(root);
  const initial = readChain(root, startedAt), previousSelection = initial.last?.snapshot.selection ?? [];
  const selected = options.boards === undefined ? previousSelection : selection(options.boards);
  if (options.boards !== undefined && !selected.length) throw Error('显式板块选择不能为空');
  const source = await fetchBoards(selected.length ? { boards: selected } : {}, { now: clock });
  const receivedAt = clock();
  if (!time(receivedAt) || !time(source?.startedAt) || source.startedAt < startedAt || source.retrievedAt > receivedAt || receivedAt < startedAt || receivedAt - startedAt > 55000 ||
    !Array.isArray(source.rawEvidence) || source.rawEvidence.length > 20 || encode(selection(source.selection)) !== encode(selected)) throw Error('源接收时钟、选择或原始响应不一致');
  const { rawEvidence, ...snapshot } = source;
  snapshot.rawRefs = rawEvidence.map(({ rawBase64, ...ref }) => ref);
  validateSnapshot(snapshot);
  privatePath(root, true);
  let usage = inventory(root);
  for (const e of rawEvidence) {
    if (typeof e.rawBase64 !== 'string' || !/^[a-f0-9]{64}$/.test(e.rawHash)) throw Error('原始响应字节或哈希无效');
    const raw = Buffer.from(e.rawBase64, 'base64');
    if (!raw.length || raw.length > LIMITS.rawBytes || raw.length !== e.bytes || raw.toString('base64') !== e.rawBase64 || digest(raw) !== e.rawHash) throw Error('原始响应字节、大小或哈希不一致');
    const dir = privatePath(path.join(root, 'raw'), true), file = path.join(dir, e.rawHash + '.bin');
    if (!fs.existsSync(file) && (usage.count >= LIMITS.rawFiles || usage.bytes + raw.length > LIMITS.rawTotalBytes)) throw Error('原始响应达到容量上限');
    if (publish(dir, e.rawHash + '.bin', raw)) { usage.count++; usage.bytes += raw.length; }
    if (!readBytes(file, LIMITS.rawBytes).equals(raw)) throw Error('同哈希原始响应内容冲突');
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const recordedAt = clock(), state = readChain(root, recordedAt), latest = state.last;
    if (!time(recordedAt) || recordedAt < receivedAt || recordedAt - receivedAt > 60000 || latest && (recordedAt < latest.recordedAt || snapshot.retrievedAt < latest.snapshot.retrievedAt)) throw Error('板块研究观察或封存时点倒退或迟录');
    if (encode(latest?.snapshot.selection ?? []) !== encode(previousSelection) && encode(latest?.snapshot.selection ?? []) !== encode(selected)) throw Error('并发板块选择已改变，拒绝覆盖');
    if (latest && encode(latest.snapshot) === encode(snapshot)) return { ...summarize(state, recordedAt), changed: false, reused: true };
    const payload = { schemaVersion: 1, revision: state.count + 1, previousHash: latest?.snapshotHash ?? null, recordedAt, snapshot };
    const event = { ...payload, snapshotHash: hash(payload) }, body = Buffer.from(encode(event));
    if (state.count >= LIMITS.observations || body.length > LIMITS.snapshotBytes || state.bytes + body.length > LIMITS.snapshotTotalBytes) throw Error('板块观察档案达到容量上限');
    if (publish(path.join(root, 'snapshots'), String(event.revision).padStart(6, '0') + '.json', body))
      return { ...readPublicSectorResearch(root, { now: recordedAt }), changed: true, reused: false };
  }
  throw Error('板块观察CAS发布冲突');
}

module.exports = { readPublicSectorResearch, capturePublicSectorResearch };
