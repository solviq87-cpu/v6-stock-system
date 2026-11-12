'use strict';

// Current provider observations only. No BaoStock compatibility branch, historical
// member reconstruction, independent-source claim, or account/strategy writes.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { sourceQuoteTimeSeconds } = require('./market-snapshot-quote-time');
const run = promisify(execFile);
const CLIST = '/api/qt/clist/get';
const INDUSTRY = 'https://17.push2.eastmoney.com' + CLIST;
const CONCEPT = 'https://79.push2.eastmoney.com' + CLIST;
const MEMBERS = 'https://29.push2.eastmoney.com' + CLIST;
const FLOW = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';
const LIMITS = Object.freeze({ maxBoards: 6, pageSize: 100, catalogueMembers: 1000,
  membersPerBoard: 1000, maxRequests: 20, concurrentRequests: 2, requestTimeoutMs: 12000,
  collectionTimeoutMs: 45000, responseBytes: 2 * 1024 * 1024, totalResponseBytes: 8 * 1024 * 1024 });
const hash = value => createHash('sha256').update(value).digest('hex');
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const chinaDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const time = t => Number.isSafeInteger(t) && t > 946684800000 && t < 4102444800000;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value :
  typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const nameOK = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !/[\u0000-\u001f<>]/.test(value);
const boardID = b => b.category + '|' + b.code;
const makeURL = (base, params) => base + '?' + new URLSearchParams(params).toString();

async function requestCurrentBoardJSON(target, { timeoutMs, maxBytes, signal }) {
  const parsed = new URL(target);
  if (![INDUSTRY, CONCEPT, MEMBERS, FLOW].includes(parsed.origin + parsed.pathname) || parsed.username || parsed.password || parsed.hash)
    throw Error('禁止任意URL');
  const { stdout } = await run('curl', ['--fail', '--silent', '--show-error', '--max-time',
    String(timeoutMs / 1000), '--max-filesize', String(maxBytes), '--proto', '=https',
    '--user-agent', 'Mozilla/5.0', '--header', 'Accept: application/json', target],
  { timeout: timeoutMs + 100, maxBuffer: maxBytes, encoding: 'buffer', signal });
  return { raw: stdout };
}

async function fetchEastmoneyCurrentBoards(options = {}, dependencies = {}) {
  const { boards: requestedBoards, maxBoards = 6, historyDays = 5 } = options;
  const { now = Date.now, requestJson = requestCurrentBoardJSON } = dependencies;
  if (!Number.isSafeInteger(maxBoards) || maxBoards < 1 || maxBoards > 6 ||
    !Number.isSafeInteger(historyDays) || historyDays < 1 || historyDays > 120 || typeof requestJson !== 'function')
    throw Error('板块数量或资金历史范围无效');
  if (requestedBoards !== undefined && (!Array.isArray(requestedBoards) || !requestedBoards.length || requestedBoards.length > maxBoards ||
    requestedBoards.some(b => !b || !['industry', 'concept'].includes(b.category) || !/^BK\d{4}$/.test(b.code)) ||
    new Set(requestedBoards.map(boardID)).size !== requestedBoards.length)) throw Error('需要1至6个明确且不重复的行业/概念板块身份');
  const selection = (requestedBoards || []).map(b => ({ category: b.category, code: b.code })).sort((a, b) => boardID(a).localeCompare(boardID(b)));
  const clock = typeof now === 'function' ? now : () => now;
  const startedAt = clock(), wallStart = performance.now();
  if (!time(startedAt)) throw Error('采集时钟无效');
  const requestedDate = chinaDay(startedAt), errors = [], rawEvidence = [];
  let lastAt = startedAt, requestCount = 0, totalBytes = 0, active = 0;
  const waiting = [];
  const stamp = () => {
    const t = clock();
    if (!time(t) || t < lastAt || t - startedAt > LIMITS.collectionTimeoutMs || chinaDay(t) !== requestedDate)
      throw Error('采集时钟倒退、跨日或超过45秒');
    lastAt = t; return t;
  };
  const captureError = (kind, code, error) => errors.push({ source: kind, code: code || null,
    message: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 200) });
  async function request(target, kind, code) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    active++;
    let timer;
    const controller = new AbortController();
    try {
      const remaining = Math.floor(LIMITS.collectionTimeoutMs - (performance.now() - wallStart));
      if (remaining <= 0 || requestCount >= LIMITS.maxRequests) throw Error('采集总时限或20次请求上限');
      requestCount++; const requestStartedAt = stamp(), timeoutMs = Math.min(12000, remaining);
      const returned = await Promise.race([
        Promise.resolve().then(() => requestJson(target, { timeoutMs, maxBytes: LIMITS.responseBytes, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('有界公共请求超时')); }, timeoutMs); })
      ]);
      const observedAt = stamp();
      // The raw response is the sole parse source; an injected json property
      // cannot disagree with the bytes later archived by the caller.
      const raw = Buffer.isBuffer(returned?.raw) ? returned.raw : typeof returned?.raw === 'string' ? Buffer.from(returned.raw, 'utf8') : null;
      if (!raw || raw.length < 1 || raw.length > LIMITS.responseBytes) throw Error('必须提供至多2MiB实际响应原始字节');
      totalBytes += raw.length;
      if (totalBytes > LIMITS.totalResponseBytes) throw Error('响应累计超过8MiB');
      const rawHash = hash(raw), evidence = { source: 'eastmoney', kind, code: code || null,
        requestUrl: target, requestStartedAt, observedAt, sourceTimestamp: null,
        rawHash, rawBase64: raw.toString('base64'), bytes: raw.length, hashBasis: 'raw-response-bytes' };
      rawEvidence.push(evidence);
      return { json: JSON.parse(raw.toString('utf8')), observedAt, rawHash };
    } finally {
      clearTimeout(timer); active--; const release = waiting.shift(); if (release) release();
    }
  }
  async function pages(base, category, code = null) {
    const rows = [], seen = new Set(), proofs = [];
    let total = null, observedAt = null, complete = false;
    try {
      for (let pn = 1; pn <= 10; pn++) {
        const target = makeURL(base, { pn: String(pn), pz: '100', po: '1', np: '1', fltt: '2', invt: '2', fid: 'f12',
          ut: 'bd1d9ddb04089700cf9c27f6f7426281', fs: code ? 'b:' + code + ' f:!50' : 'm:90 t:' + (category === 'industry' ? '2' : '3') + ' f:!50',
          fields: 'f12,f13,f14,f3,f6,f62,f66,f72,f104,f105,f124' });
        const result = await request(target, code ? 'members' : 'catalogue', code || category);
        const d = result.json?.data;
        observedAt = result.observedAt; proofs.push(result.rawHash);
        if (result.json?.rc !== 0 || !d || count(d.total) === null || d.total > 10000 || !Array.isArray(d.diff) || d.diff.length > 100)
          throw Error('分页响应缺少有效总数或列表');
        if (total === null) total = d.total;
        if (d.total !== total) throw Error('分页期间总数变化');
        const expected = Math.min(100, Math.max(0, total - (pn - 1) * 100));
        if (d.diff.length !== expected) throw Error('分页记录缺失或重叠');
        for (const row of d.diff) {
          const key = row?.f12;
          if (typeof key !== 'string' || !(code ? /^\d{6}$/ : /^BK\d{4}$/).test(key) || seen.has(key) ||
            (code ? ![0, 1].includes(row.f13) : !nameOK(row.f14))) throw Error('分页身份、名称、市场或唯一性无效');
          seen.add(key); rows.push(row);
        }
        if (rows.length === total) { complete = true; break; }
      }
      if (!complete) throw Error('成员或分类目录超过1000条有界上限');
    } catch (error) { captureError(code ? 'members' : 'catalogue', code || category, error); }
    return { rows, total, observedAt, complete, pages: proofs.length, rawHashes: proofs };
  }
  const catalogueParts = await Promise.all([pages(INDUSTRY, 'industry'), pages(CONCEPT, 'concept')]);
  const catalogue = { status: catalogueParts.every(p => p.complete) ? 'observed-unverified' : 'partial-evidence',
    complete: catalogueParts.every(p => p.complete), fingerprint: null, records: [], categories: {} };
  catalogueParts.forEach((p, i) => {
    const category = i ? 'concept' : 'industry';
    catalogue.categories[category] = { complete: p.complete, declaredTotal: p.total, fetchedCount: p.rows.length,
      observedAt: p.observedAt, pages: p.pages, rawHashes: p.rawHashes };
    catalogue.records.push(...p.rows.map(row => ({ category, code: row.f12, name: row.f14,
      quoteAt: sourceQuoteTimeSeconds(row.f124), raw: row, observedAt: p.observedAt })));
  });
  catalogue.records.sort((a, b) => boardID(a).localeCompare(boardID(b)));
  if (catalogue.complete) catalogue.fingerprint = hash(JSON.stringify(catalogue.records.map(b => [b.category, b.code, b.name])));
  const byID = new Map(catalogue.records.map(b => [boardID(b), b]));
  async function flow(code) {
    try {
      const target = makeURL(FLOW, { lmt: String(historyDays), klt: '101', secid: '90.' + code,
        fields1: 'f1,f2,f3,f7', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65', ut: 'b2884a393a59ad64002292a3e90d46a5' });
      const result = await request(target, 'flow', code), data = result.json?.data;
      if (result.json?.rc !== 0 || !data || !Array.isArray(data.klines) || data.klines.length > 2000 ||
        data.code !== undefined && data.code !== code || data.market !== undefined && String(data.market) !== '90') throw Error('资金响应来源身份或序列无效');
      const seen = new Set(), records = [];
      for (const line of data.klines) {
        const p = typeof line === 'string' ? line.split(',') : [];
        if (p.length !== 15 || !day(p[0]) || p[0] > requestedDate || seen.has(p[0])) throw Error('资金日期、重复或字段无效');
        seen.add(p[0]); const n = p.slice(1).map(number);
        records.push({ tradeDate: p[0], mainNetInflow: n[0], smallNetInflow: n[1], midNetInflow: n[2],
          bigNetInflow: n[3], superNetInflow: n[4], mainNetInflowPct: n[5], smallNetInflowPct: n[6],
          midNetInflowPct: n[7], bigNetInflowPct: n[8], superNetInflowPct: n[9], knownAt: result.observedAt });
      }
      records.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      return { status: records.length ? 'observed-unverified' : 'unknown', records: records.slice(-historyDays),
        observedAt: result.observedAt, lastTradeDate: records.at(-1)?.tradeDate ?? null, sourceTimestamp: null,
        rawHash: result.rawHash, historicalMembershipVerified: false, unit: 'CNY', completeness: 'upstream-does-not-declare-total-history' };
    } catch (error) { captureError('flow', code, error); return { status: 'unknown', records: [], lastTradeDate: null, sourceTimestamp: null, historicalMembershipVerified: false, unit: 'CNY' }; }
  }
  const boards = await Promise.all(selection.map(async selected => {
    const found = byID.get(boardID(selected));
    const [members, flowHistory] = await Promise.all([pages(MEMBERS, selected.category, selected.code), flow(selected.code)]);
    const raw = found?.raw, quoteAt = found?.quoteAt ?? null;
    const validQuote = quoteAt !== null && quoteAt <= found.observedAt;
    const quoteDate = validQuote ? chinaDay(quoteAt) : null;
    const changePct = number(raw?.f3), amount = number(raw?.f6), memberCodes = members.complete ? members.rows.map(r => r.f12).sort() : null;
    return { ...selected, name: found?.name ?? null, members: memberCodes, membershipComplete: members.complete,
      membersObservedAt: members.observedAt, membershipFingerprint: memberCodes ? hash(JSON.stringify(memberCodes)) : null,
      quoteAt: validQuote ? quoteAt : null, quoteDate,
      quoteTimeStatus: !quoteAt ? 'unknown' : !validQuote ? 'future' : quoteDate === requestedDate ? 'dated-source-unverified' : 'historical-snapshot',
      changePct: validQuote && changePct !== null && changePct >= -100 && changePct <= 100 ? changePct : null,
      mainNetInflow: validQuote ? number(raw?.f62) : null,
      amountCny: validQuote && amount !== null && amount >= 0 ? amount : null,
      superNetInflow: validQuote ? number(raw?.f66) : null, bigNetInflow: validQuote ? number(raw?.f72) : null,
      flowHistory, provenance: { membership: { declaredTotal: members.total, fetchedCount: members.rows.length,
        pages: members.pages, rawHashes: members.rawHashes }, catalogueRawHashes: catalogue.categories[selected.category].rawHashes,
        quoteObservedAt: found?.observedAt ?? null, quoteField: 'f124-provider-unix-seconds',
        sourceTimeVerified: false, units: 'vendor-CNY-unverified', fundsMethod: 'vendor-order-size-estimate',
        historicalMembershipVerified: false, collectionMode: 'current-provider-snapshot' } };
  }));
  const retrievedAt = stamp();
  const stable = boards.length > 0 && boards.every(b => b.membershipComplete && b.members?.length && b.name);
  const classificationVersion = stable ? 'eastmoney-current-members-v1:' + hash(JSON.stringify(boards.map(b => ({ category: b.category,
    code: b.code, name: b.name, members: b.members })))) : null;
  const quoteDates = [...new Set(boards.map(b => b.quoteDate).filter(Boolean))];
  const tradeDate = quoteDates.length === 1 && boards.every(b => b.quoteDate === quoteDates[0]) ? quoteDates[0] : null;
  const dailyHistoryEligible = Boolean(classificationVersion && tradeDate && boards.every(b =>
    time(b.membersObservedAt) && chinaDay(b.membersObservedAt) === tradeDate && b.quoteDate === tradeDate && b.changePct !== null));
  const sectorCurrent = classificationVersion && tradeDate ? { tradeDate, source: 'eastmoney-current-board-members',
    classificationVersion, observedAt: retrievedAt, marketChangePct: null, benchmarkMethod: null,
    returnMethod: 'vendor-board-reported-change', sectors: boards.map(b => ({ category: b.category, code: b.code,
      name: b.name, members: b.members, changePct: b.changePct, mainNetInflow: b.mainNetInflow, amountCny: b.amountCny,
      quoteAt: b.quoteAt, quoteDate: b.quoteDate, membersObservedAt: b.membersObservedAt })) } : null;
  // Large raw quote rows are already preserved exactly in rawEvidence.
  catalogue.records = catalogue.records.map(({ raw, ...row }) => row);
  return { schemaVersion: 1, provider: 'eastmoney-current-board-members', source: 'eastmoney',
    collectionMode: 'current-provider-snapshot', historicalMembershipVerified: false, startedAt, retrievedAt,
    requestedDate, tradeDate, catalogue, selection, selectionRequired: requestedBoards === undefined,
    boards, sectorCurrent, classificationVersion,
    classificationVersionMeaning: 'observed-content-fingerprint-not-provider-taxonomy-version',
    dailyHistoryEligible, errors, rawEvidence, requestCount, totalResponseBytes: totalBytes, limits: LIMITS,
    status: sectorCurrent ? 'observed-unverified' : boards.length ? 'unknown' : catalogue.records.length ? 'catalogue-only' : 'unknown',
    limitations: ['Current membership is not backfilled into historical flow records.',
      'All endpoints share Eastmoney upstream; they are not independent sources.',
      'Board returns are provider reports, not independently authenticated official indices.',
      'Concept flows and overlapping constituents are never added into a whole-market total.',
      'Main flow already includes big and super orders; no institutional account identity is established.',
      'Daily history requires complete current members observed on the actual quote date.'],
    researchOnly: true, verifiedLive: false, canTrade: false, canNotify: false, canTrain: false,
    rankingModified: false, weightsChanged: false, autoPromotion: false };
}

module.exports = { fetchEastmoneyCurrentBoards };
