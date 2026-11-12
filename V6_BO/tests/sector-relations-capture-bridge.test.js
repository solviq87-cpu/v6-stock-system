'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { buildSectorRelationsCaptureInput: build, readSectorRelationsCaptureInput: read } = require('../src/core/sector-relations-capture-bridge');
const { bridgeExistingMarketSector } = require('../src/core/sector-breadth-market-bridge');
const { freezeSectorMemberIdentity } = require('../src/core/sector-member-identity-proof');
const { analyzeSectorRelations } = require('../src/strategy/sector-relations');
const { main } = require('../scripts/sector-relations-capture-report');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(count = 24, groups = 3) {
  const tradeDates = [];
  for (let ms = Date.parse('2026-09-01T00:00:00Z'); tradeDates.length < count; ms += 86400000) {
    const d = new Date(ms);
    if (![0, 6].includes(d.getUTCDay())) tradeDates.push(d.toISOString().slice(0, 10));
  }
  const entries = tradeDates.map((date, index) => {
    const end = Date.parse(date + 'T10:03:00+08:00');
    const sectors = Array.from({ length: groups }, (_, j) => ({ category: 'industry', code: 'BS_GROUP_' + j,
      name: '行业' + j, memberCount: 5, members: Array.from({ length: 5 }, (_, i) => String(600001 + j * 100 + i)) }));
    const membership = { schemaVersion: 1, source: 'imported', provider: 'baostock:query_stock_industry',
      classificationVersion: 'baostock-csrc-frozen-v1', tradeDate: date, observedAt: end - 120000,
      sectors, provenance: { classificationDate: '2026-08-31', collectionMode: 'current-provider-snapshot',
        historicalMembershipVerified: false }, canTrade: false };
    const snapshot = { source: 'eastmoney-clist-unverified-live', date, universeSize: groups * 5,
      startedAt: new Date(end - 60000).toISOString(), retrievedAt: new Date(end).toISOString(), verifiedLive: false,
      stocks: sectors.flatMap((s, j) => s.members.map((code, i) => ({ code, vendorQuoteAt: end - 5000,
        pctChange: Math.sin(index * .4 + j) * 3 + Math.cos(index * .7) + i * .1 }))) };
    const data = bridgeExistingMarketSector(snapshot, membership, { asOf: end });
    assert.equal(data.status, 'imported-unverified');
    const archive = { schemaVersion: 1, mode: 'dated-sector-research-only', status: data.status,
      reason: null, tradeDate: date, observedAt: end, data,
      memberIdentity: freezeSectorMemberIdentity(membership), verifiedLive: false, canTrade: false, weightsChanged: false };
    return { snapshot, membership, archive };
  });
  return { entries, calendar: { source: 'imported', tradeDates }, asOf: entries.at(-1).archive.observedAt + 60000 };
}
function report(input) { return analyzeSectorRelations({ asOf: input.asOf, tradeDates: input.tradeDates, history: input.sectorHistory, current: input.sectorCurrent }); }
test('replays actual protocol, preserves identities and proxy scope without inventing flows', () => {
  const f = fixture(), before = clone(f), result = build(f.entries, f), r = report(result);
  assert.equal(result.sectorHistory.length, 23); assert.equal(result.sectorCurrent.tradeDate, f.calendar.tradeDates.at(-1));
  assert.equal(result.sectorCurrent.source, 'eastmoney-clist-unverified-live');
  assert.equal(result.sectorCurrent.benchmarkMethod, 'equal-weight-valid-constituents-universe');
  assert.deepEqual(result.sectorCurrent.sectors[0].members, f.entries.at(-1).membership.sectors[0].members);
  assert.equal(result.provenance.dailyEvidence[0].membershipProvider, 'baostock:query_stock_industry');
  assert.equal(r.edges[0].sameDayCorrelation.status, 'descriptive-unverified');
  assert.equal(r.edges[0].marketResidualCorrelation.status, 'descriptive-unverified');
  assert.equal(r.nodes[0].flowContinuity.fiveSession.reason, 'missing-flow-observation');
  assert.equal(result.sectorCurrent.sectors[0].mainNetInflow, null); assert.equal(result.canTrain, false);
  assert.deepEqual(clone(f), before);
});
test('source, snapshot, members, frozen proof and derived tampering are rejected', () => {
  for (const mutate of [
    e => { e.snapshot.source = 'another-provider'; },
    e => { e.membership.provider = 'another-membership-provider'; },
    e => { e.snapshot.stocks[0].pctChange = 50; },
    e => { e.membership.sectors[0].members[0] = '600099'; },
    e => { e.archive.memberIdentity.sectors[0].memberSha256 = 'a'.repeat(64); },
    e => { e.archive.data.study.sectors[0].changePct += 1; },
    e => { e.archive.observedAt += 1; },
    e => { e.snapshot.stocks.forEach(s => { s.vendorQuoteAt -= 301000; }); }
  ]) {
    const f = fixture(3); mutate(f.entries.at(-1));
    const input = build(f.entries, f);
    assert.equal(input.status, 'unknown'); assert.equal(input.sectorCurrent, null);
    assert.equal(input.provenance.rejectedEntries.length, 1);
    assert.equal(report(input).reason, 'latest-session-evidence-missing');
  }
});
test('adapted membership must retain the explicit current-snapshot provenance gate', () => {
  for (const mutate of [
    e => { delete e.membership.provenance; },
    e => { delete e.membership.provenance.collectionMode; },
    e => { e.membership.provenance.collectionMode = 'historical-membership'; },
    e => { delete e.membership.provenance.historicalMembershipVerified; },
    e => { e.membership.provenance.historicalMembershipVerified = true; }
  ]) {
    const f = fixture(3), last = f.entries.at(-1); mutate(last);
    // Recomputing every derived field cannot bypass the consumer declaration.
    last.archive.data = bridgeExistingMarketSector(last.snapshot, last.membership, { asOf: last.archive.observedAt });
    last.archive.memberIdentity = freezeSectorMemberIdentity(last.membership);
    const input = build(f.entries, f);
    assert.equal(input.status, 'unknown');
    assert.equal(input.sectorCurrent, null);
    assert.equal(input.provenance.rejectedEntries.at(-1).reason, 'invalid-capture-contract');
  }
});
test('missing, future and duplicate captures never acquire fabricated daily observations', () => {
  const f = fixture(), missing = build(f.entries.filter((_, i) => i !== 4), f);
  assert.equal(report(missing).nodes[0].coverage.reason, 'missing-contiguous-session');
  const future = build(f.entries, { ...f, asOf: f.entries.at(-1).archive.observedAt - 1 });
  assert.equal(future.sectorCurrent, null); assert.equal(future.provenance.rejectedEntries.at(-1).reason, 'future-observation');
  const duplicated = build([...f.entries, f.entries[4]], f);
  assert.equal(duplicated.sectorHistory.length, 22);
  assert.ok(duplicated.provenance.rejectedEntries.some(x => x.reason === 'duplicate-daily-evidence'));
});
test('weekly classification changes remain unknown and never rewrite original version', () => {
  const f = fixture(), last = f.entries.at(-1);
  last.membership.classificationVersion = 'baostock-csrc-next-week-v2';
  last.archive.data = bridgeExistingMarketSector(last.snapshot, last.membership, { asOf: last.archive.observedAt });
  last.archive.memberIdentity = freezeSectorMemberIdentity(last.membership);
  const input = build(f.entries, f), r = report(input);
  assert.equal(input.sectorCurrent.classificationVersion, 'baostock-csrc-next-week-v2');
  assert.equal(r.edges[0].sameDayCorrelation.reason, 'classification-version-changed');
});
test('over 30 sectors require explicit identities; selection retains full quote benchmark', () => {
  const f = fixture(3, 31);
  assert.throws(() => build(f.entries, f), /超过30/);
  const result = build(f.entries, { ...f, sectorIds: ['industry|BS_GROUP_0'] });
  assert.equal(result.provenance.selection, 'explicit-sector-subset');
  assert.equal(result.sectorCurrent.sectors.length, 1);
  assert.equal(result.sectorCurrent.marketChangePct, f.entries.at(-1).archive.data.study.marketChangePct);
  assert.equal(result.provenance.dailyEvidence.at(-1).universeSize, 155);
  assert.throws(() => build(f.entries, { ...f, sectorIds: ['BS_GROUP_0'] }), /category/);
});
test('full daily calendar verifies coverage while imported dates retain explicit uncertainty', () => {
  const f = fixture(3), dates = f.calendar.tradeDates;
  const calendar = { schemaVersion: 1, source: 'exchange-calendar-export', exchange: 'SSE', from: dates[0], to: dates.at(-1),
    sessions: dates.map(date => ({ date, open: true })), observedAt: f.asOf - 1 };
  assert.equal(build(f.entries, { ...f, calendar }).provenance.calendar.coverageVerified, true);
  assert.equal(build(f.entries, f).provenance.calendar.coverageVerified, false);
  calendar.sessions.splice(1, 1);
  assert.throws(() => build(f.entries, { ...f, calendar }), /覆盖范围/);
  assert.throws(() => build(f.entries, { ...f, calendar: { ...f.calendar, observedAt: f.asOf + 1 } }), /观测时间/);
  assert.throws(() => build(f.entries, { ...f, calendar: { source: 'imported', tradeDates: [...dates].reverse() } }), /递增/);
});
test('calendar ISO and numeric clocks preserve actual values and reject either future availability field', () => {
  const f = fixture(3), stamp = new Date(f.asOf - 1).toISOString();
  for (const key of ['observedAt', 'firstObservedAt']) for (const value of [f.asOf - 1, stamp]) {
    const result = build(f.entries, { ...f, calendar: { ...f.calendar, [key]: value } });
    assert.equal(result.provenance.calendar.observedAt, value);
    if (key === 'firstObservedAt') assert.equal(result.provenance.calendar.firstObservedAt, value);
  }
  for (const key of ['observedAt', 'firstObservedAt']) for (const value of [f.asOf + 1, new Date(f.asOf + 1).toISOString(), '2026-09-01T10:00:00', 'invalid']) {
    assert.throws(() => build(f.entries, { ...f, calendar: { ...f.calendar, [key]: value } }), /观测时间/);
  }
  assert.throws(() => build(f.entries, { ...f, calendar: { ...f.calendar, observedAt: stamp, firstObservedAt: f.asOf + 1 } }), /观测时间/);
});
function disk(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-relation-capture-')), captureRoot = path.join(dir, 'captures'), calendarFile = path.join(dir, 'calendar.json');
  fs.writeFileSync(calendarFile, JSON.stringify(f.calendar));
  for (const e of f.entries) for (const [folder, value] of [['snapshots', e.snapshot], ['members', e.membership], ['sector-archive', e.archive]]) {
    const directory = path.join(captureRoot, folder, e.archive.tradeDate);
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, e.archive.observedAt + '.json'), JSON.stringify(value));
  }
  return { dir, captureRoot, calendarFile, asOf: f.asOf };
}
test('IO validates the full bundled calendar and explicitly records a bounded selected history window', () => {
  const f = fixture(3), conf = disk(f);
  try {
    const calendar = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/research-calendar-2026.json'), 'utf8'));
    const asOf = Date.parse(calendar.firstObservedAt) + 1000;
    fs.writeFileSync(conf.calendarFile, JSON.stringify(calendar));
    assert.throws(() => build([], { calendar, asOf }), /1至120/);
    assert.throws(() => read({ ...conf, asOf: Date.parse(calendar.firstObservedAt) - 1 }), /观测时间/);
    const result = read({ ...conf, asOf }), metadata = result.provenance.calendar;
    assert.equal(result.tradeDates.length, 120);
    assert.equal(metadata.observedAt, calendar.firstObservedAt);
    assert.equal(metadata.firstObservedAt, calendar.firstObservedAt);
    assert.equal(metadata.coverageVerified, true);
    assert.equal(metadata.selectedWindow.requestedSessions, 120);
    assert.equal(metadata.selectedWindow.totalCalendarSessions, calendar.sessions.filter(s => s.open).length);
    assert.equal(metadata.selectedWindow.selectedSessions, 120);
    assert.ok(metadata.selectedWindow.omittedEarlierSessions > 0);
    assert.equal(metadata.selectedWindow.completeCalendarHistory, false);
    assert.equal(metadata.selectedWindow.from, result.tradeDates[0]);
    const smaller = read({ ...conf, asOf, historySessions: 20 });
    assert.equal(smaller.tradeDates.length, 20);
    assert.equal(smaller.provenance.calendar.selectedWindow.requestedSessions, 20);
    for (const historySessions of [0, 121, '20']) assert.throws(() => read({ ...conf, asOf, historySessions }), /historySessions/);
    calendar.sessions.splice(1, 1); fs.writeFileSync(conf.calendarFile, JSON.stringify(calendar));
    assert.throws(() => read({ ...conf, asOf }), /覆盖范围/);
  } finally { fs.rmSync(conf.dir, { recursive: true, force: true }); }
});
test('IO and CLI reuse selected complete captures without writes, missing members stay unknown', () => {
  const f = fixture(3), conf = disk(f);
  try {
    const rootBefore = fs.readdirSync(conf.dir), result = read(conf);
    assert.equal(result.sectorHistory.length, 2); assert.equal(result.provenance.sampling.maxHistoricalLagMinutes, 30);
    const output = main([conf.captureRoot, conf.calendarFile, String(conf.asOf)]);
    assert.equal(output.report.nodes.length, 3); assert.deepEqual(fs.readdirSync(conf.dir), rootBefore);
    assert.equal(output.report.edges[0].sameDayCorrelation.reason, 'insufficient-matched-sessions');
    const e = f.entries.at(-1); fs.unlinkSync(path.join(conf.captureRoot, 'members', e.archive.tradeDate, e.archive.observedAt + '.json'));
    assert.equal(read(conf).sectorCurrent, null);
  } finally { fs.rmSync(conf.dir, { recursive: true, force: true }); }
});
test('historical sampling keeps missing time windows and rejects private path and file violations', () => {
  const f = fixture(3), conf = disk(f);
  try {
    // A historical record outside the preceding 30 minute window is not read.
    const e = f.entries[0], archiveDir = path.join(conf.captureRoot, 'sector-archive', e.archive.tradeDate);
    fs.renameSync(path.join(archiveDir, e.archive.observedAt + '.json'), path.join(archiveDir, (e.archive.observedAt - 3600000) + '.json'));
    assert.equal(read(conf).sectorHistory.length, 1);
    const alias = path.join(conf.dir, 'alias'); fs.symlinkSync(conf.captureRoot, alias);
    assert.throws(() => read({ ...conf, captureRoot: alias }), /符号链接/);
    assert.throws(() => read({ ...conf, captureRoot: path.join(conf.dir, 'public') }), /公开/);
    const last = f.entries.at(-1), member = path.join(conf.captureRoot, 'members', last.archive.tradeDate, last.archive.observedAt + '.json');
    fs.unlinkSync(member); fs.symlinkSync(conf.calendarFile, member);
    assert.throws(() => read(conf), /符号链接/);
  } finally { fs.rmSync(conf.dir, { recursive: true, force: true }); }
});
test('oversized, unknown and excessive local archive files fail before producing a report', () => {
  const f = fixture(3), conf = disk(f);
  try {
    const last = f.entries.at(-1), name = last.archive.observedAt + '.json';
    const snapshot = path.join(conf.captureRoot, 'snapshots', last.archive.tradeDate, name);
    const fd = fs.openSync(snapshot, 'w'); fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1); fs.closeSync(fd);
    assert.throws(() => read(conf), /大小/);
    const archiveDir = path.join(conf.captureRoot, 'sector-archive', last.archive.tradeDate);
    const unexpected = path.join(archiveDir, 'unexpected.json'); fs.writeFileSync(unexpected, '{}');
    assert.throws(() => read(conf), /未知文件名/); fs.unlinkSync(unexpected);
    for (let i = 1; i <= 512; i++) fs.writeFileSync(path.join(archiveDir, (last.archive.observedAt + i) + '.json'), '{}');
    assert.throws(() => read(conf), /512/);
  } finally { fs.rmSync(conf.dir, { recursive: true, force: true }); }
});
