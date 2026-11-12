'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { fetchEastmoneyCurrentBoards } = require('../src/core/eastmoney-current-board-members');
const { readPublicSectorResearch: read, capturePublicSectorResearch: capture } = require('../src/core/public-sector-research');
const BASE = Date.parse('2026-11-16T16:05:00+08:00');
const BOARDS = [{ category: 'industry', code: 'BK1034' }, { category: 'concept', code: 'BK1234' }];
const wrap = json => ({ raw: JSON.stringify(json) });
const page = diff => ({ rc: 0, data: { total: diff.length, diff } });
function setup() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-sector-store-')); fs.chmodSync(root, 0o700); return root; }
function provider(now, { quoteDay = new Date(now + 8 * 3600000).toISOString().slice(0, 10), members = ['600001', '600002'], fail = false } = {}) {
  const calls = [];
  const fetchBoards = (options, dependencies) => {
    calls.push(options);
    return fetchEastmoneyCurrentBoards(options, { ...dependencies, requestJson: async target => {
      if (fail) throw Error('HTTP 503');
      const u = new URL(target);
      if (u.pathname.includes('daykline')) return wrap({ rc: 0, data: { code: u.searchParams.get('secid').slice(3), market: 90,
        klines: [quoteDay + ',0,1,2,3,-3,0,0,0,0,0,0,0,0,0'] } });
      const query = u.searchParams.get('fs');
      if (query.startsWith('b:')) return wrap(page(members.map(f12 => ({ f12, f13: 1 }))));
      const industry = query.includes('t:2');
      return wrap(page([{ f12: industry ? 'BK1034' : 'BK1234', f14: industry ? '行业' : '概念', f3: 1,
        f62: industry ? 100 : -100, f6: 10000, f124: Date.parse(quoteDay + 'T15:00:00+08:00') / 1000 }]));
    } });
  };
  return { fetchBoards, calls, now };
}
test('empty read has no side effects; catalogue discovery never chooses a watchlist or exposes raw bytes', async () => {
  const root = setup();
  try {
    assert.equal(read(root, { now: BASE }).status, 'not-observed'); assert.deepEqual(fs.readdirSync(root), []);
    const deps = provider(BASE), r = await capture(root, {}, deps);
    assert.equal(r.selectionRequired, true); assert.deepEqual(r.selection, []); assert.equal(r.catalogue.records.length, 2);
    assert.equal(r.current.dailyHistoryEligible, false); assert.equal(r.historyCoverage.frozenDailyCount, 0);
    assert.ok(r.rawRefs.length > 0); assert.ok(!JSON.stringify(r).includes('rawBase64'));
    assert.equal(read(root, { now: BASE }).catalogue.records.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('explicit selections persist and automatically reuse; current and daily records remain immutable', async () => {
  const root = setup();
  try {
    const first = await capture(root, { boards: BOARDS }, provider(BASE));
    assert.equal(first.selectionRequired, false); assert.equal(first.historyCoverage.frozenDailyCount, 1);
    assert.equal(first.current.provider, 'eastmoney-current-board-members'); assert.equal(first.current.sectorCurrent.marketChangePct, null);
    assert.equal(first.overlap.length, 1); assert.equal(first.overlap[0].jaccard, 1);
    const firstFile = path.join(root, 'snapshots', '000001.json'), before = fs.readFileSync(firstFile);
    const later = provider(BASE + 1000), second = await capture(root, {}, later);
    assert.deepEqual(later.calls[0].boards, first.selection); assert.equal(second.historyCoverage.observedVersions, 2);
    assert.equal(second.historyCoverage.frozenDailyCount, 1); assert.equal(second.historyCoverage.repeatedSameDayObservations, 1);
    assert.deepEqual(fs.readFileSync(firstFile), before);
    assert.equal(second.historyCoverage.dailyEvidence[0].observedAt, BASE);
    assert.equal(second.current.retrievedAt, BASE + 1000); assert.equal(second.current.classificationVersion, first.current.classificationVersion);
    for (const dir of ['raw', 'snapshots']) for (const name of fs.readdirSync(path.join(root, dir))) assert.equal(fs.statSync(path.join(root, dir, name)).mode & 0o777, 0o600);
    const repeated = await capture(root, {}, later); assert.equal(repeated.reused, true); assert.equal(repeated.changed, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('late current members and stale quote days only produce current overlap, no retrospective daily archive', async () => {
  const root = setup();
  try {
    const now = Date.parse('2026-11-17T04:00:00+08:00');
    const r = await capture(root, { boards: BOARDS }, provider(now, { quoteDay: '2026-11-16' }));
    assert.equal(r.current.tradeDate, '2026-11-16'); assert.equal(r.current.dailyHistoryEligible, false);
    assert.equal(r.historyCoverage.frozenDailyCount, 0); assert.equal(r.overlap[0].jaccard, 1);
    assert.equal(r.current.boards[0].membersObservedAt, now);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('missing actual trading sessions and changed members stay unknown instead of inventing calendar or taxonomy stability', async () => {
  const root = setup();
  try {
    await capture(root, { boards: BOARDS }, provider(BASE));
    const later = Date.parse('2026-11-18T16:05:00+08:00');
    const r = await capture(root, {}, provider(later, { members: ['600001', '600003'] }));
    assert.deepEqual(r.historyCoverage.missingTradeDates, ['2026-11-17']);
    assert.equal(r.historyCoverage.expectedSessions, 3); assert.equal(r.historyCoverage.acceptedSessions, 2);
    assert.equal(r.relations.edges[0].sameDayCorrelation.status, 'unknown');
    assert.equal(r.relations.nodes[0].coverage.reason, 'missing-contiguous-session');
    assert.equal(r.current.sectorCurrent.marketChangePct, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('source failures remain diagnostic, retain selection, and do not add daily evidence', async () => {
  const root = setup();
  try {
    await capture(root, { boards: BOARDS }, provider(BASE));
    const later = await capture(root, {}, provider(BASE + 1000, { fail: true }));
    assert.deepEqual(later.selection, read(root, { now: BASE }).selection);
    assert.equal(later.current.status, 'unknown'); assert.equal(later.historyCoverage.frozenDailyCount, 1);
    assert.equal(later.current.errors.length, 6); assert.equal(later.overlap.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('source byte tampering and persisted raw or snapshot corruption are rejected', async () => {
  for (const kind of ['incoming-raw', 'raw', 'snapshot']) {
    const root = setup();
    try {
      const deps = provider(BASE);
      if (kind === 'incoming-raw') {
        const original = deps.fetchBoards;
        deps.fetchBoards = async (...args) => { const r = await original(...args); r.rawEvidence[0].rawBase64 = Buffer.from('{}').toString('base64'); return r; };
        await assert.rejects(() => capture(root, { boards: BOARDS }, deps), /字节|哈希/);
        continue;
      }
      const r = await capture(root, { boards: BOARDS }, deps);
      if (kind === 'raw') fs.writeFileSync(path.join(root, 'raw', r.rawRefs[0].rawHash + '.bin'), '{}');
      else fs.appendFileSync(path.join(root, 'snapshots', '000001.json'), 'x');
      assert.throws(() => read(root, { now: BASE }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
test('CAS publishes a contiguous chain and competing selection changes cannot silently replace one another', async () => {
  const root = setup();
  try {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const slow = provider(BASE), actual = slow.fetchBoards;
    slow.fetchBoards = async (...args) => { await gate; return actual(...args); };
    const pending = capture(root, { boards: [BOARDS[0]] }, slow);
    await capture(root, { boards: [BOARDS[1]] }, provider(BASE)); release();
    await assert.rejects(() => pending, /并发板块选择/);
    assert.deepEqual(read(root, { now: BASE }).selection, [BOARDS[1]]);
    const same = provider(BASE + 1000);
    const results = await Promise.all([capture(root, {}, same), capture(root, {}, same)]);
    assert.equal(results.filter(r => r.changed).length, 1);
    assert.deepEqual(fs.readdirSync(path.join(root, 'snapshots')).sort(), ['000001.json', '000002.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('private paths, permissions, symlinks, future sources and source declarations fail closed', async () => {
  const root = setup();
  try {
    assert.throws(() => read(path.join(root, 'public'), { now: BASE }), /公开/);
    const alias = root + '-link'; fs.symlinkSync(root, alias);
    try { await assert.rejects(() => capture(alias, {}, provider(BASE)), /符号链接/); } finally { fs.unlinkSync(alias); }
    for (const mutate of [r => { r.retrievedAt = BASE + 1; }, r => { r.historicalMembershipVerified = true; },
      r => { r.boards[0].membersObservedAt = BASE - 1; }, r => { r.dailyHistoryEligible = false; }]) {
      const deps = provider(BASE), actual = deps.fetchBoards;
      deps.fetchBoards = async (...args) => { const r = await actual(...args); mutate(r); return r; };
      await assert.rejects(() => capture(root, { boards: BOARDS }, deps));
    }
    await capture(root, { boards: BOARDS }, provider(BASE));
    const file = path.join(root, 'raw', read(root, { now: BASE }).rawRefs[0].rawHash + '.bin');
    fs.unlinkSync(file); fs.symlinkSync('/etc/passwd', file);
    assert.throws(() => read(root, { now: BASE }), /类型|普通文件/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('two OS processes publish one identical CAS observation without losing the first daily evidence', async () => {
  const root = setup();
  try {
    const snapshot = await provider(BASE).fetchBoards({ boards: BOARDS }, { now: () => BASE });
    const script = `const {capturePublicSectorResearch:c}=require(process.argv[1]);
      c(process.argv[2],{boards:JSON.parse(process.argv[3]).selection},{now:()=>Number(process.argv[4]),fetchBoards:async()=>{
        process.send('ready');await new Promise(r=>process.once('message',r));return JSON.parse(process.argv[3]);
      }}).then(r=>{process.stdout.write(JSON.stringify({changed:r.changed}));process.disconnect();}).catch(e=>{console.error(e.message);process.exit(1);});`;
    const children = [0, 1].map(() => spawn(process.execPath, ['-e', script, require.resolve('../src/core/public-sector-research'), root, JSON.stringify(snapshot), String(BASE)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }));
    const done = children.map(child => new Promise((resolve, reject) => {
      let out = '', error = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { error += b; });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(Error(error)));
    }));
    await Promise.all(children.map(child => new Promise(resolve => child.once('message', resolve))));
    children.forEach(child => child.send('go'));
    const results = await Promise.all(done);
    assert.equal(results.filter(r => r.changed).length, 1);
    const state = read(root, { now: BASE }); assert.equal(state.archiveUsage.observations, 1); assert.equal(state.historyCoverage.frozenDailyCount, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('abandoned unpublished staging does not mask committed evidence, and oversized or unknown files are bounded', async () => {
  const root = setup();
  try {
    await capture(root, { boards: BOARDS }, provider(BASE));
    const stage = path.join(root, 'snapshots', '.stage-' + 'a'.repeat(24)); fs.writeFileSync(stage, '', { mode: 0o600 });
    assert.equal(read(root, { now: BASE }).archiveUsage.observations, 1);
    const fd = fs.openSync(stage, 'w'); fs.ftruncateSync(fd, 2 * 1024 * 1024 + 1); fs.closeSync(fd);
    assert.throws(() => read(root, { now: BASE }), /暂存/); fs.unlinkSync(stage);
    const unknown = path.join(root, 'snapshots', 'unexpected.json'); fs.writeFileSync(unknown, '{}', { mode: 0o600 });
    assert.throws(() => read(root, { now: BASE }), /身份|连续性/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('supplier same-day quotes on an explicitly closed session cannot create daily research evidence', async () => {
  const root = setup();
  try {
    const saturday = Date.parse('2026-11-14T16:05:00+08:00');
    const r = await capture(root, { boards: BOARDS }, provider(saturday));
    assert.equal(r.current.dailyHistoryEligible, true, 'preserve the provider declaration separately');
    assert.equal(r.current.dailyHistoryAdmission.eligible, false);
    assert.equal(r.current.dailyHistoryAdmission.reason, 'calendar-session-closed');
    assert.equal(r.historyCoverage.frozenDailyCount, 0);
    assert.equal(r.historyCoverage.rejectedDailyEvidence[0].reason, 'calendar-session-closed');
    assert.equal(r.overlap.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
