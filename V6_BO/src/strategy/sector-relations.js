'use strict';

// Pure, bounded descriptions of supplied evidence. No network, forecasts or orders.
const LIMITS = Object.freeze({ sectors: 30, historyDays: 120, edges: 120, members: 10000 });
const finite = x => typeof x === 'number' && Number.isFinite(x);
const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
const dayOK = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
const timestamp = x => Number.isSafeInteger(x) && x > 0 && x <= 8640000000000000 - 8 * 3600000 ? x :
  typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const marketDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identity = (r, s) => JSON.stringify([r.source, r.classificationVersion, s.category, s.code]);
const membersOf = s => Array.isArray(s?.members) && s.members.length > 0 && s.members.length <= LIMITS.members &&
  s.members.every(x => typeof x === 'string' && /^\d{6}$/.test(x)) && new Set(s.members).size === s.members.length ? [...s.members].sort() : null;
const sameMembers = (a, b) => a !== null && b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
const unknown = (reason, extra = {}) => ({ status: 'unknown', reason, ...extra });

function pearson(a, b) {
  if (a.length < 2 || a.length !== b.length || !a.every(finite) || !b.every(finite)) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    aa += da * da; bb += db * db; ab += da * db;
  }
  if (aa <= Number.EPSILON * a.length || bb <= Number.EPSILON * b.length) return null;
  const coefficient = ab / Math.sqrt(aa * bb);
  return finite(coefficient) ? Math.max(-1, Math.min(1, coefficient)) : null;
}

function residuals(values, market) {
  const vm = values.reduce((x, y) => x + y, 0) / values.length;
  const mm = market.reduce((x, y) => x + y, 0) / market.length;
  let variance = 0, covariance = 0;
  for (let i = 0; i < market.length; i++) {
    variance += (market[i] - mm) ** 2;
    covariance += (values[i] - vm) * (market[i] - mm);
  }
  if (variance <= Number.EPSILON * market.length) return null;
  const beta = covariance / variance;
  const adjusted = values.map((x, i) => x - vm - beta * (market[i] - mm));
  return finite(beta) && adjusted.every(finite) ? { beta, values: adjusted } : null;
}

/**
 * Historical rows must be explicitly known by asOf, with an explicit ordered
 * trading-session calendar. Corrections cannot silently overwrite a daily row.
 * Source + classification version + category + code form the sector identity.
 */
function analyzeSectorRelations(options = {}) {
  const { asOf, tradeDates, history = [], current = null } = options || {};
  const clock = timestamp(asOf);
  const memberCache = new WeakMap();
  const membership = s => {
    if (!s || typeof s !== 'object') return null;
    if (!memberCache.has(s)) memberCache.set(s, membersOf(s));
    return memberCache.get(s);
  };
  const fingerprint = row => JSON.stringify([row.source, row.classificationVersion,
    timestamp(row.observedAt), row.marketChangePct,
    row.sectors.map(s => [s.category, s.code, s.name, s.changePct,
      s.mainNetInflow, s.amountCny, membership(s)]).sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)))]);
  const result = {
    schemaVersion: 1, mode: 'research-only', status: 'unknown', reason: null,
    asOf: clock, tradeDates: [], sources: [], classificationVersions: [],
    nodes: [], edges: [], rotation: [],
    coverage: { suppliedHistoryDays: Array.isArray(history) ? history.length : 0,
      acceptedDays: 0, expectedDays: 0, rejectedRows: [], omittedEdges: 0 },
    dailyEvidence: [],
    limits: LIMITS,
    canTrade: false, canNotify: false, verifiedLive: false,
    weightsChanged: false, rankingModified: false, autoPromotion: false,
    limitations: [
      'Same-day Pearson and market-beta residual correlation are descriptive, not causal or leading signals.',
      'Industry and concept memberships overlap; sector flows are never added into whole-market flow.',
      'Opposite observed sector flows do not establish that capital transferred between those sectors.',
      'Continuity verifies supplied dated observations only; it does not authenticate provider accuracy.'
    ]
  };
  const fail = reason => ({ ...result, reason });
  if (!clock) return fail('invalid-as-of');
  if (!Array.isArray(tradeDates) || !tradeDates.length || tradeDates.length > LIMITS.historyDays ||
    tradeDates.some((d, i) => !dayOK(d) || d > marketDay(clock) || i > 0 && d <= tradeDates[i - 1]))
    return fail('invalid-explicit-trading-calendar');
  if (!Array.isArray(history) || history.length > LIMITS.historyDays)
    return fail('history-bound-exceeded-or-invalid');
  result.tradeDates = [...tradeDates];
  result.coverage.expectedDays = tradeDates.length;
  const byDay = new Map(), blocked = new Set();
  const reject = (row, reason) => result.coverage.rejectedRows.push({ tradeDate: dayOK(row?.tradeDate) ? row.tradeDate : null, reason });
  for (const row of [...history, ...(current ? [current] : [])]) {
    if (!row || !dayOK(row.tradeDate) || !tradeDates.includes(row.tradeDate)) { reject(row, 'unlisted-or-invalid-trade-date'); continue; }
    const observedAt = timestamp(row.observedAt);
    if (!observedAt || observedAt > clock || marketDay(observedAt) < row.tradeDate) {
      reject(row, observedAt > clock ? 'future-observation' : 'invalid-observation-time'); continue;
    }
    if (!text(row.source) || !text(row.classificationVersion) || !Array.isArray(row.sectors) ||
      row.sectors.length > LIMITS.sectors || row.sectors.length === 0) {
      reject(row, 'missing-identity-or-sector-bound-exceeded'); continue;
    }
    const seen = new Set();
    if (row.sectors.some(s => !s || !text(s.code) || !text(s.name) || !['industry', 'concept'].includes(s.category) ||
      seen.has(identity(row, s)) || !seen.add(identity(row, s)))) {
      reject(row, 'invalid-or-duplicate-sector-identity'); continue;
    }
    // Duplicate archives are ambiguous daily evidence. A supplied current snapshot
    // may repeat the identical known observation without adding a session.
    if (blocked.has(row.tradeDate)) { reject(row, 'duplicate-daily-evidence'); continue; }
    if (byDay.has(row.tradeDate)) {
      if (row === current && fingerprint(row) === fingerprint(byDay.get(row.tradeDate))) continue;
      byDay.delete(row.tradeDate); blocked.add(row.tradeDate);
      reject(row, 'duplicate-daily-evidence'); continue;
    }
    byDay.set(row.tradeDate, { ...row, observedAt });
  }
  result.coverage.rejectedRows.sort((a, b) => order(a.tradeDate || '', b.tradeDate || '') || order(a.reason, b.reason));
  result.coverage.acceptedDays = byDay.size;
  result.sources = [...new Set([...byDay.values()].map(r => r.source))].sort();
  result.classificationVersions = [...new Set([...byDay.values()].map(r => r.classificationVersion))].sort();
  result.dailyEvidence = tradeDates.filter(d => byDay.has(d)).map(d => {
    const r = byDay.get(d);
    return { tradeDate: d, source: r.source, observedAt: r.observedAt,
      classificationVersion: r.classificationVersion, sectorCount: r.sectors.length };
  });
  const latest = byDay.get(tradeDates.at(-1));
  if (!latest) return fail('latest-session-evidence-missing');
  const rows = tradeDates.map(d => byDay.get(d) || null);
  const maps = rows.map(r => new Map(r ? r.sectors.map(s => [identity(r, s), s]) : []));
  const validIdentity = r => r && r.source === latest.source && r.classificationVersion === latest.classificationVersion;
  const evidenceFor = s => rows.map((r, i) => ({ row: r, sector: maps[i].get(identity(latest, s)) || null }));

  function comparability(evidence, dates) {
    if (dates.some(d => blocked.has(d))) return 'duplicate-daily-evidence';
    if (evidence.some(e => !e.row)) return 'missing-contiguous-session';
    if (evidence.some(e => e.row.source !== latest.source)) return 'mixed-source';
    if (evidence.some(e => e.row.classificationVersion !== latest.classificationVersion)) return 'classification-version-changed';
    if (evidence.some(e => !e.sector)) return 'missing-sector-session';
    const reference = membership(evidence.at(-1).sector);
    if (!reference || evidence.some(e => !membership(e.sector))) return 'membership-unknown';
    if (evidence.some(e => !sameMembers(membership(e.sector), reference))) return 'membership-changed';
    return null;
  }

  function flowHorizon(evidence, n) {
    const window = evidence.slice(-n), dates = tradeDates.slice(-n);
    const count = window.filter(e => validIdentity(e.row) && e.sector && finite(e.sector.mainNetInflow)).length;
    const base = { sessions: n, tradeDates: dates, knownMatchedCount: count,
      netInflowCny: null, positiveSessions: null, negativeSessions: null, direction: 'unknown', observations: [] };
    if (dates.length !== n) return unknown('insufficient-explicit-sessions', base);
    const reason = comparability(window, dates);
    if (reason) return unknown(reason, base);
    if (count !== n) return unknown('missing-flow-observation', base);
    const observations = window.map((e, i) => ({ tradeDate: dates[i], source: e.row.source,
      classificationVersion: e.row.classificationVersion, observedAt: e.row.observedAt,
      mainNetInflow: e.sector.mainNetInflow }));
    const positiveSessions = observations.filter(e => e.mainNetInflow > 0).length;
    const negativeSessions = observations.filter(e => e.mainNetInflow < 0).length;
    const sum = observations.reduce((a, e) => a + e.mainNetInflow, 0);
    if (!finite(sum)) return unknown('numeric-overflow', base);
    return { ...base, status: 'descriptive-unverified', reason: null, observations,
      netInflowCny: sum, positiveSessions, negativeSessions,
      direction: positiveSessions === n ? 'continuous-inflow' : negativeSessions === n ? 'continuous-outflow' : 'mixed-or-flat' };
  }

  result.nodes = latest.sectors.map(s => {
    const evidence = evidenceFor(s), members = membership(s);
    const flow = finite(s.mainNetInflow) ? s.mainNetInflow : null;
    const amount = finite(s.amountCny) && s.amountCny > 0 ? s.amountCny : null;
    return { id: identity(latest, s), code: s.code, name: s.name, category: s.category,
      source: latest.source, classificationVersion: latest.classificationVersion,
      tradeDate: latest.tradeDate, observedAt: latest.observedAt,
      status: 'descriptive-unverified', changePct: finite(s.changePct) ? s.changePct : null,
      mainNetInflow: flow, amountCny: amount,
      flowIntensity: flow !== null && amount !== null && finite(flow / amount) ? flow / amount : null,
      members, memberCount: members ? members.length : null,
      coverage: { expectedSessions: tradeDates.length,
        knownMatchedCount: evidence.filter(e => validIdentity(e.row) && e.sector && finite(e.sector.changePct)).length,
        reason: comparability(evidence, tradeDates) },
      flowContinuity: { threeSession: flowHorizon(evidence, 3), fiveSession: flowHorizon(evidence, 5) }
    };
  }).sort((a, b) => order(a.id, b.id));

  for (let i = 0; i < result.nodes.length; i++) {
    for (let j = i + 1; j < result.nodes.length; j++) {
      const a = result.nodes[i], b = result.nodes[j];
      const ea = evidenceFor(a), eb = evidenceFor(b);
      const matched = ea.map((e, k) => ({ a: e, b: eb[k], date: tradeDates[k] }))
        .filter(e => validIdentity(e.a.row) && e.a.sector && e.b.sector && finite(e.a.sector.changePct) && finite(e.b.sector.changePct));
      let reason = comparability(ea, tradeDates) || comparability(eb, tradeDates);
      if (!reason && matched.length < 20) reason = 'insufficient-matched-sessions';
      if (!reason && matched.length !== tradeDates.length) reason = 'missing-contiguous-return-session';
      const base = { knownMatchedCount: matched.length, requiredMatchedCount: 20,
        expectedSessions: tradeDates.length, tradeDates: matched.map(e => e.date), coefficient: null };
      let correlation = unknown(reason || 'constant-return-series', base);
      const marketMatched = matched.filter(e => finite(e.a.row.marketChangePct));
      let marketResidualCorrelation = unknown(reason || 'missing-market-return', { ...base,
        knownMatchedCount: marketMatched.length, tradeDates: marketMatched.map(e => e.date), betaA: null, betaB: null });
      if (!reason) {
        const av = matched.map(e => e.a.sector.changePct), bv = matched.map(e => e.b.sector.changePct);
        const coefficient = pearson(av, bv);
        if (coefficient !== null) correlation = { ...base, status: 'descriptive-unverified', reason: null, coefficient };
        const market = matched.map(e => e.a.row.marketChangePct);
        const marketCount = market.filter(finite).length;
        marketResidualCorrelation.knownMatchedCount = marketCount;
        marketResidualCorrelation.tradeDates = matched.filter(e => finite(e.a.row.marketChangePct)).map(e => e.date);
        if (market.every(finite)) {
          const ar = residuals(av, market), br = residuals(bv, market);
          const r = ar && br ? pearson(ar.values, br.values) : null;
          marketResidualCorrelation = { ...base, betaA: ar?.beta ?? null, betaB: br?.beta ?? null,
            coefficient: r, status: r === null ? 'unknown' : 'descriptive-unverified',
            reason: !ar || !br ? 'constant-market-series' : r === null ? 'constant-market-residual' : null };
        }
      }
      let membershipOverlap = unknown('membership-unknown', { jaccard: null, sharedMembers: null, unionMembers: null });
      if (a.members && b.members) {
        const sb = new Set(b.members), sharedMembers = a.members.filter(x => sb.has(x));
        const unionMembers = a.members.length + b.members.length - sharedMembers.length;
        membershipOverlap = { status: 'descriptive-unverified', reason: null, jaccard: sharedMembers.length / unionMembers,
          sharedMembers, unionMembers, tradeDate: latest.tradeDate, observedAt: latest.observedAt,
          source: latest.source, classificationVersion: latest.classificationVersion };
      }
      result.edges.push({ from: a.id, to: b.id, source: latest.source,
        classificationVersion: latest.classificationVersion, observedAt: latest.observedAt,
        sameDayCorrelation: correlation, marketResidualCorrelation, membershipOverlap });
      for (const [key, sessions] of [['threeSession', 3], ['fiveSession', 5]]) {
        const af = a.flowContinuity[key], bf = b.flowContinuity[key];
        if (af.status !== 'unknown' && bf.status !== 'unknown' &&
          [af.direction, bf.direction].includes('continuous-inflow') && [af.direction, bf.direction].includes('continuous-outflow')) {
          result.rotation.push({ from: af.direction === 'continuous-outflow' ? a.id : b.id,
            to: af.direction === 'continuous-inflow' ? a.id : b.id, sessions,
            status: 'descriptive-unverified', label: 'opposite-observed-flow-continuity',
            capitalTransferEstablished: false, tradeDates: tradeDates.slice(-sessions),
            source: latest.source, classificationVersion: latest.classificationVersion,
            observedAt: latest.observedAt });
        }
      }
    }
  }
  const edgeOrder = (a, b) => order(a.from, b.from) || order(a.to, b.to);
  result.edges.sort(edgeOrder);
  result.coverage.omittedEdges = Math.max(0, result.edges.length - LIMITS.edges);
  result.edges = result.edges.slice(0, LIMITS.edges);
  result.rotation.sort((a, b) => edgeOrder(a, b) || a.sessions - b.sessions);
  result.rotation = result.rotation.slice(0, LIMITS.edges);
  result.status = result.nodes.length ? 'descriptive-unverified' : 'unknown';
  result.reason = result.nodes.length ? 'supplied-evidence-only' : 'no-sector-evidence';
  return result;
}

module.exports = { analyzeSectorRelations };
