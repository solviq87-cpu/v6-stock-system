'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fetchEastmoneyCurrentBoards: fetchBoards } = require('../src/core/eastmoney-current-board-members');
const NOW = Date.parse('2026-11-12T16:05:00+08:00'), QUOTE = Date.parse('2026-11-12T15:00:00+08:00');
const selection = [{ category: 'industry', code: 'BK1034' }, { category: 'concept', code: 'BK1234' }];
const wrap = json => ({ raw: JSON.stringify(json) });
const page = (diff, total = diff.length) => ({ rc: 0, data: { total, diff } });
const board = (code, name, extra = {}) => ({ f12: code, f14: name, f3: 1.5, f6: 100000, f62: 0,
  f66: 20, f72: -20, f104: 3, f105: 2, f124: QUOTE / 1000, ...extra });
const member = code => ({ f12: code, f13: 1, f14: '股票', f124: QUOTE / 1000 });
function source(overrides = {}) {
  const targets = [];
  const requestJson = async (target, options) => {
    const u = new URL(target); targets.push({ u, options });
    if (overrides.request) {
      const result = await overrides.request(u, options);
      if (result !== undefined) return result;
    }
    if (u.pathname.includes('daykline')) return wrap({ rc: 0, data: { code: u.searchParams.get('secid').slice(3), market: 90,
      klines: ['2026-11-11,100,-20,-30,40,60,1,-2,-3,4,6,0,0,0,0', '2026-11-12,0,0,-, ,50,0,0,0,0,0,0,0,0,0'] } });
    const fs = u.searchParams.get('fs');
    if (fs.startsWith('b:')) return wrap(page(fs.includes('BK1034') ? [member('600001'), member('600002')] : [member('600002'), member('600003')]));
    return wrap(page(fs.includes('t:2') ? [board('BK1034', '汽车服务', overrides.quote)] : [board('BK1234', '概念样本', overrides.quote)]));
  };
  return { requestJson, targets };
}
test('catalogue discovery requires explicit selection and never chooses permanent top boards', async () => {
  const s = source(), r = await fetchBoards({}, { now: NOW, requestJson: s.requestJson });
  assert.equal(r.selectionRequired, true); assert.deepEqual(r.selection, []); assert.deepEqual(r.boards, []);
  assert.equal(r.catalogue.complete, true); assert.equal(r.catalogue.records.length, 2);
  assert.equal(r.sectorCurrent, null); assert.equal(r.classificationVersion, null); assert.equal(r.dailyHistoryEligible, false);
  assert.equal(r.requestCount, 2); assert.equal(s.targets.length, 2);
});
test('complete selection preserves real members, raw bytes, current fund units and separate historical availability', async () => {
  const s = source(), r = await fetchBoards({ boards: selection }, { now: NOW, requestJson: s.requestJson });
  assert.equal(r.provider, 'eastmoney-current-board-members'); assert.equal(r.source, 'eastmoney');
  assert.equal(r.collectionMode, 'current-provider-snapshot'); assert.equal(r.historicalMembershipVerified, false);
  assert.equal(r.tradeDate, '2026-11-12'); assert.equal(r.dailyHistoryEligible, true); assert.equal(r.requestCount, 6);
  assert.ok(r.classificationVersion.startsWith('eastmoney-current-members-v1:'));
  const b = r.boards.find(b => b.category === 'industry');
  assert.deepEqual(b.members, ['600001', '600002']); assert.equal(b.membershipComplete, true);
  assert.equal(b.quoteAt, QUOTE); assert.equal(b.membersObservedAt, NOW); assert.equal(b.amountCny, 100000);
  assert.equal(b.mainNetInflow, 0); assert.equal(b.superNetInflow, 20); assert.equal(b.bigNetInflow, -20);
  assert.equal(b.flowHistory.records[0].mainNetInflow, 100); assert.equal(b.flowHistory.records[0].knownAt, NOW);
  assert.equal(b.flowHistory.records[1].mainNetInflow, 0); assert.equal(b.flowHistory.records[1].midNetInflow, null);
  assert.equal(b.flowHistory.records[1].bigNetInflow, null); assert.equal(b.flowHistory.historicalMembershipVerified, false);
  assert.equal(r.sectorCurrent.marketChangePct, null); assert.equal(r.sectorCurrent.benchmarkMethod, null);
  assert.equal(r.sectorCurrent.sectors.length, 2); assert.equal(r.sectorCurrent.source, r.provider);
  for (const e of r.rawEvidence) {
    const raw = Buffer.from(e.rawBase64, 'base64');
    assert.equal(createHash('sha256').update(raw).digest('hex'), e.rawHash);
    assert.equal(raw.length, e.bytes); assert.equal(e.observedAt, NOW); assert.equal(e.hashBasis, 'raw-response-bytes');
    assert.ok(e.requestUrl.startsWith('https://'));
  }
  assert.equal(r.canTrain, false); assert.equal(r.canTrade, false); assert.equal(r.canNotify, false);
  assert.equal(r.verifiedLive, false); assert.equal(r.weightsChanged, false); assert.equal(r.rankingModified, false);
});
test('fingerprint ignores observation clocks, amounts and membership ordering but preserves actual identity changes', async () => {
  const first = source(), a = await fetchBoards({ boards: selection }, { now: NOW, requestJson: first.requestJson });
  const next = source({ quote: { f62: 999, f6: 1234 }, request: u => {
    if (u.searchParams.get('fs')?.startsWith('b:')) return wrap(page([member('600002'), member('600001')]));
  } });
  const b = await fetchBoards({ boards: [...selection].reverse() }, { now: NOW + 1000, requestJson: next.requestJson });
  // Only industry identities agree; concept's changed actual members change the complete version.
  assert.notEqual(a.classificationVersion, b.classificationVersion);
  const industry = [{ category: 'industry', code: 'BK1034' }];
  const c = await fetchBoards({ boards: industry }, { now: NOW, requestJson: source().requestJson });
  const d = await fetchBoards({ boards: industry }, { now: NOW + 1000, requestJson: next.requestJson });
  assert.equal(c.classificationVersion, d.classificationVersion);
  assert.equal(c.boards[0].membershipFingerprint, d.boards[0].membershipFingerprint);
});
test('membership observed after the quote day cannot acquire a historical daily sample', async () => {
  const now = Date.parse('2026-11-13T04:00:00+08:00');
  const r = await fetchBoards({ boards: selection }, { now, requestJson: source().requestJson });
  assert.equal(r.requestedDate, '2026-11-13'); assert.equal(r.tradeDate, '2026-11-12');
  assert.equal(r.boards[0].quoteTimeStatus, 'historical-snapshot'); assert.equal(r.dailyHistoryEligible, false);
  assert.equal(r.sectorCurrent.observedAt, now); assert.equal(r.boards[0].membersObservedAt, now);
});
test('missing, invalid and future quote timestamps never borrow a flow date or observation clock', async () => {
  for (const f124 of [undefined, null, '', 'bad', NOW / 1000 + 1]) {
    const r = await fetchBoards({ boards: selection }, { now: NOW, requestJson: source({ quote: { f124 } }).requestJson });
    assert.equal(r.tradeDate, null); assert.equal(r.sectorCurrent, null); assert.equal(r.dailyHistoryEligible, false);
    assert.equal(r.boards[0].quoteAt, null); assert.equal(r.boards[0].changePct, null); assert.equal(r.boards[0].mainNetInflow, null);
    assert.equal(r.boards[0].flowHistory.lastTradeDate, '2026-11-12');
  }
});
test('incomplete, duplicated and changing membership pagination prevents a whole selection stable version', async () => {
  for (const bad of [page([member('600001')], 2), page([member('600001'), member('600001')]), page([member('bad')]),
    page([member('600001'), { ...member('600002'), f13: 2 }]), { rc: 1, data: null }]) {
    const s = source({ request: u => u.searchParams.get('fs')?.includes('b:BK1034') ? wrap(bad) : undefined });
    const r = await fetchBoards({ boards: selection }, { now: NOW, requestJson: s.requestJson });
    const b = r.boards.find(x => x.code === 'BK1034'); assert.equal(b.membershipComplete, false); assert.equal(b.members, null);
    assert.equal(r.classificationVersion, null); assert.equal(r.sectorCurrent, null); assert.equal(r.dailyHistoryEligible, false);
    assert.equal(r.boards.find(x => x.code === 'BK1234').membershipComplete, true);
  }
});
test('complete multi-page lists preserve all identities; changed total and member cap remain partial', async () => {
  for (const mode of ['complete', 'changed-total', 'over-cap']) {
    const s = source({ request: u => {
      if (!u.searchParams.get('fs')?.startsWith('b:')) return;
      const pn = +u.searchParams.get('pn'), total = mode === 'over-cap' ? 1001 : mode === 'changed-total' && pn === 2 ? 102 : 101;
      const n = Math.min(100, total - (pn - 1) * 100);
      return wrap(page(Array.from({ length: n }, (_, i) => member(String(600001 + (pn - 1) * 100 + i))), total));
    } });
    const r = await fetchBoards({ boards: selection.slice(0, 1) }, { now: NOW, requestJson: s.requestJson });
    assert.equal(r.boards[0].membershipComplete, mode === 'complete');
    assert.equal(r.boards[0].members?.length ?? null, mode === 'complete' ? 101 : null);
    assert.ok(r.requestCount <= 20);
    assert.equal(r.boards[0].provenance.membership.pages, mode === 'over-cap' ? 10 : 2);
  }
});
test('response raw bytes are mandatory and authoritative over injected parsed json', async () => {
  const plain = await fetchBoards({}, { now: NOW, requestJson: async () => page([]) });
  assert.equal(plain.catalogue.complete, false); assert.equal(plain.rawEvidence.length, 0); assert.equal(plain.errors.length, 2);
  const s = source();
  const r = await fetchBoards({}, { now: NOW, requestJson: async (u, o) => ({ ...await s.requestJson(u, o), json: { rc: 9, data: null } }) });
  assert.equal(r.catalogue.complete, true);
  const malformed = await fetchBoards({}, { now: NOW, requestJson: async () => ({ raw: '{bad-json' }) });
  assert.equal(malformed.rawEvidence.length, 2); assert.equal(malformed.errors.length, 2);
});
test('503, oversized responses and future/duplicate flow rows remain unknown without retry or backfill', async () => {
  const failed = await fetchBoards({ boards: selection.slice(0, 1) }, { now: NOW, requestJson: async () => { throw Error('HTTP 503'); } });
  assert.equal(failed.status, 'unknown'); assert.equal(failed.requestCount, 4); assert.equal(failed.errors.length, 4);
  assert.equal(failed.boards[0].members, null); assert.equal(failed.boards[0].flowHistory.status, 'unknown');
  const big = await fetchBoards({}, { now: NOW, requestJson: async () => ({ raw: ' '.repeat(2 * 1024 * 1024 + 1) }) });
  assert.equal(big.rawEvidence.length, 0); assert.equal(big.catalogue.complete, false);
  for (const klines of [['2026-11-13,1,2,3,4,5,6,7,8,9,10,0,0,0,0'],
    ['2026-11-12,1,2,3,4,5,6,7,8,9,10,0,0,0,0', '2026-11-12,1,2,3,4,5,6,7,8,9,10,0,0,0,0']]) {
    const r = await fetchBoards({ boards: selection.slice(0, 1) }, { now: NOW, requestJson: source({ request: u =>
      u.pathname.includes('daykline') ? wrap({ rc: 0, data: { code: 'BK1034', market: 90, klines } }) : undefined }).requestJson });
    assert.equal(r.boards[0].flowHistory.status, 'unknown'); assert.deepEqual(r.boards[0].flowHistory.records, []);
  }
});
test('two concurrent requests, fixed verified endpoints and strict input bounds', async () => {
  let active = 0, maximum = 0; const s = source();
  const r = await fetchBoards({ boards: selection }, { now: NOW, requestJson: async (u, o) => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve));
    try { return await s.requestJson(u, o); } finally { active--; }
  } });
  assert.equal(maximum, 2); assert.equal(r.limits.collectionTimeoutMs, 45000);
  for (const { u, options } of s.targets) {
    assert.ok(['17.push2.eastmoney.com', '79.push2.eastmoney.com', '29.push2.eastmoney.com', 'push2his.eastmoney.com'].includes(u.hostname));
    assert.equal(u.protocol, 'https:'); assert.ok(options.timeoutMs <= 12000); assert.equal(options.maxBytes, 2 * 1024 * 1024);
    assert.ok(options.signal instanceof AbortSignal);
  }
  for (const input of [{ maxBoards: 7 }, { historyDays: 0 }, { historyDays: 121 }, { boards: [] },
    { boards: [selection[0], selection[0]] }, { boards: [{ category: 'industry', code: 'https://evil' }] }])
    await assert.rejects(() => fetchBoards(input, { now: NOW, requestJson: () => assert.fail('invalid input must not fetch') }));
});
test('20-request collection budget cannot be bypassed by additional selected-board requests', async () => {
  let calls = 0;
  const r = await fetchBoards({ boards: [{ category: 'industry', code: 'BK0001' }] }, { now: NOW, requestJson: async target => {
    calls++; const u = new URL(target), start = (+u.searchParams.get('pn') - 1) * 100;
    assert.ok(!u.searchParams.get('fs').startsWith('b:'), 'catalogue budget exhaustion cannot start member HTTP requests');
    return wrap(page(Array.from({ length: 100 }, (_, i) => board('BK' + String(start + i).padStart(4, '0'), '板块' + (start + i))), 1000));
  } });
  assert.equal(calls, 20); assert.equal(r.requestCount, 20); assert.equal(r.classificationVersion, null);
  assert.equal(r.boards[0].membershipComplete, false); assert.equal(r.boards[0].flowHistory.status, 'unknown');
  assert.ok(r.errors.some(e => e.message.includes('20次')));
});
test('backwards, cross-day and over-45-second clocks cannot certify a collection', async () => {
  for (const later of [NOW - 1, NOW + 45001, Date.parse('2026-11-13T00:00:00+08:00')]) {
    let ticks = 0;
    await assert.rejects(() => fetchBoards({}, { now: () => ticks++ ? later : NOW, requestJson: source().requestJson }), /时钟|跨日|45秒/);
  }
});
