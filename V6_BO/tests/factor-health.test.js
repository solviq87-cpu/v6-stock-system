'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { freezeHealthBaseline: freeze, evaluateFactorHealth: evaluate } = require('../src/core/factor-health');
const start = Date.parse('2026-01-05T08:00:00Z'), frozenAt = start + 1000, asOf = start + 2000, now = asOf + 1000;
function fixture() {
  const feed = { source: 'fixture', provider: 'synthetic-test', datasetId: 'explicit-fixture' };
  const row = (symbol, value, timestamp) => ({ symbol, sectorHeatScore: value, factorEvidence: { sectorHeatScore: { source: feed.provider, timestamp } } });
  return {
    input: { schemaVersion: 1, feed, factorIds: ['sector_heat'], policy: { maxAgeMs: 10000, minValidSamples: 2, minValidFraction: 0.5, maxMeanShift: 10 }, baseline: { schemaVersion: 1, feed, asOf: start, rows: [row('600000', 40, start), row('000001', 60, start)] } },
    current: { schemaVersion: 1, feed, asOf, rows: [row('600000', 50, asOf), row('000001', 60, asOf)] }
  };
}
const frozen = x => freeze(x.input, { now: frozenAt });
const report = x => evaluate(frozen(x), x.current, { now });
test('frozen policy diagnoses cross-sectional drift without changing strategy weights or caller input', () => {
  const x = fixture(), original = structuredClone(x), r = report(x);
  assert.equal(r.factors[0].status, 'within-thresholds');
  assert.equal(r.factors[0].meanShift, 5);
  x.current.rows.forEach(row => row.sectorHeatScore = 80);
  const drift = report(x);
  assert.equal(drift.factors[0].status, 'watch');
  assert.deepEqual(drift.factors[0].reasons, ['mean-shift']);
  assert.equal(drift.canTrade, false); assert.equal(drift.weightsChanged, false); assert.equal(drift.prospectiveCertified, false);
  assert.deepEqual(x.input, original.input); assert.equal(original.current.rows[0].sectorHeatScore, 50);
});
test('missing and invalid values never become neutral or zero observations', () => {
  const x = fixture(); x.current.rows[0].sectorHeatScore = null; x.current.rows[1].sectorHeatScore = '50';
  const f = report(x).factors[0];
  assert.equal(f.status, 'insufficient-data'); assert.equal(f.meanScore, null); assert.equal(f.meanShift, null);
  assert.equal(f.counts.missing, 1); assert.equal(f.counts['invalid-value'], 1); assert.equal(f.validCount, 0);
});
test('per-row reasons distinguish stale, future, simulated, mismatched and missing evidence', () => {
  for (const [status, evidence] of [
    ['stale', { timestamp: asOf - 10001 }], ['future', { timestamp: asOf + 1 }],
    ['simulated', { simulated: true }], ['simulated', { mode: 'simulation' }],
    ['source-mismatch', { source: 'other' }], ['invalid-time', { timestamp: 'not-milliseconds' }],
    ['missing-evidence', null]
  ]) {
    const x = fixture(), row = x.current.rows[0];
    if (evidence === null) delete row.factorEvidence;
    else Object.assign(row.factorEvidence.sectorHeatScore, evidence);
    const f = report(x).factors[0];
    assert.equal(f.counts[status], 1, status); assert.equal(f.status, 'insufficient-data');
    assert.equal(f.meanScore, 60); assert.equal(f.meanShift, null);
  }
});
test('coverage and sample gates are separate, exact thresholds pass and all rows form denominator', () => {
  const x = fixture(); x.input.policy.minValidFraction = 0.75;
  x.current.rows.push({ symbol: '600001' });
  const low = report(x).factors[0]; assert.equal(low.status, 'insufficient-data'); assert.deepEqual(low.reasons, ['low-coverage']);
  x.input.policy.minValidFraction = 2 / 3; x.current.rows[0].sectorHeatScore = 60;
  const exact = report(x).factors[0]; assert.equal(exact.status, 'within-thresholds'); assert.equal(exact.meanShift, 10);
});
test('baseline requires enough valid traceable samples and known unique V6 factor IDs', () => {
  for (const mutate of [x => x.input.baseline.rows[0].sectorHeatScore = null, x => x.input.factorIds = ['unknown'], x => x.input.factorIds.push('sector_heat'), x => x.input.policy.maxMeanShift = 0]) {
    const x = fixture(); mutate(x); assert.throws(() => frozen(x));
  }
});
test('baseline versions, policy, evidence and summary tampering are rejected, including rehashed summaries', () => {
  const crypto = require('node:crypto');
  for (const field of ['policy', 'baseline', 'summaries', 'packVersion']) {
    const x = fixture(), c = frozen(x);
    if (field === 'policy') c.policy.maxMeanShift = 100;
    if (field === 'baseline') c.baseline.rows[0].sectorHeatScore = 0;
    if (field === 'summaries') c.summaries[0].meanScore = 0;
    if (field === 'packVersion') c.packVersion = 'other';
    assert.throws(() => evaluate(c, x.current, { now }), /指纹/);
    const { fingerprint, ...payload } = c;
    c.fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (field !== 'policy') assert.throws(() => evaluate(c, x.current, { now }), /结构|版本/);
  }
});
test('feed changes, pre-freeze/current-future clocks and duplicate stock rows fail closed', () => {
  for (const mutate of [x => x.current.feed = { ...x.current.feed, datasetId: 'other' }, x => x.current.asOf = frozenAt, x => x.current.asOf = now + 1, x => x.current.rows.push(x.current.rows[0])]) {
    const x = fixture(); mutate(x); assert.throws(() => report(x));
  }
  for (const bad of [NaN, Infinity, -1]) {
    const x = fixture(); assert.throws(() => freeze(x.input, { now: bad }), /时钟/);
    assert.throws(() => evaluate(frozen(x), x.current, { now: bad }), /时钟/);
  }
});
test('factors have independent denominators and diagnostic output strips account and raw vendor data', () => {
  const x = fixture(); x.input.factorIds.push('roe_quality');
  for (const snapshot of [x.input.baseline, x.current]) for (const row of snapshot.rows) {
    row.roeQualityScore = 0;
    row.factorEvidence.roeQualityScore = { source: snapshot.feed.provider, timestamp: snapshot.asOf, secret: 'PRIVATE_SENTINEL_BF' };
    row.account = 'PRIVATE_SENTINEL_BF';
  }
  x.current.rows[0].roeQualityScore = null;
  const c = frozen(x), r = evaluate(c, x.current, { now });
  assert.equal(r.factors[0].status, 'within-thresholds'); assert.equal(r.factors[1].status, 'insufficient-data');
  assert.equal(r.factors[1].meanScore, 0); assert.equal(r.factors[1].counts.missing, 1);
  assert.ok(!JSON.stringify([c, r]).includes('PRIVATE_SENTINEL_BF'));
});
test('baseline normalized invalid evidence stays verifiable and fresh boundary is inclusive', () => {
  const x = fixture(); x.input.policy.minValidSamples = 1;
  x.input.baseline.rows[0].sectorHeatScore = 'invalid';
  x.current.rows[0].factorEvidence.sectorHeatScore.timestamp = asOf - 10000;
  const r = report(x); assert.equal(r.factors[0].validCount, 2);
});
test('real CLI creates complete new files, refuses overwrites, links and invalid inputs without partial reports', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factor-health-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const x = fixture(), input = path.join(dir, 'input.json'), base = path.join(dir, 'base.json'), current = path.join(dir, 'current.json'), out = path.join(dir, 'out.json');
  // CLI uses real time; make the frozen instant earlier than a current valid real snapshot.
  fs.writeFileSync(input, JSON.stringify(x.input));
  const script = path.resolve(__dirname, '../scripts/factor-health.js');
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(run(['freeze', input, base]).status, 0);
  const bytes = fs.readFileSync(base), stamp = JSON.parse(bytes).frozenAt;
  assert.equal(run(['freeze', input, base]).status, 1); assert.deepEqual(fs.readFileSync(base), bytes);
  // Synthetic historical baseline is intentional, with a fresh current diagnostic input.
  x.current.asOf = stamp + 1;
  x.current.rows.forEach(row => row.factorEvidence.sectorHeatScore.timestamp = stamp);
  fs.writeFileSync(current, JSON.stringify(x.current));
  assert.equal(run(['evaluate', base, current, out]).status, 0);
  const saved = fs.readFileSync(out); assert.equal(JSON.parse(saved).mode, 'factor-health-diagnostic');
  assert.equal(run(['evaluate', base, current, out]).status, 1); assert.deepEqual(fs.readFileSync(out), saved);
  const link = path.join(dir, 'linked.json'); fs.symlinkSync(input, link);
  assert.equal(run(['freeze', link, path.join(dir, 'no.json')]).status, 1);
  fs.writeFileSync(current, '{}'); assert.equal(run(['evaluate', base, current, path.join(dir, 'no.json')]).status, 1);
  assert.equal(fs.existsSync(path.join(dir, 'no.json')), false);
});
test('sample limits, malformed symbols, future baseline and non-finite policies reject', () => {
  for (const mutate of [
    x => x.input.baseline.asOf = frozenAt + 1,
    x => x.input.baseline.rows[0].symbol = 600000,
    x => x.input.baseline.rows = [],
    x => x.input.baseline.rows = Array.from({ length: 501 }, (_, i) => ({ ...x.input.baseline.rows[0], symbol: String(i).padStart(6, '0') })),
    x => x.input.policy.minValidSamples = 501,
    x => x.input.policy.minValidFraction = NaN,
    x => x.input.policy.maxAgeMs = Infinity
  ]) { const x = fixture(); mutate(x); assert.throws(() => frozen(x)); }
});
test('CLI rejects oversized inputs and symbolic output paths while preserving the target', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factor-health-boundary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json'), target = path.join(dir, 'target.json'), link = path.join(dir, 'link.json');
  const script = path.resolve(__dirname, '../scripts/factor-health.js');
  const run = out => spawnSync(process.execPath, [script, 'freeze', input, out], { encoding: 'utf8' });
  fs.writeFileSync(input, JSON.stringify(fixture().input)); fs.writeFileSync(target, 'KEEP'); fs.symlinkSync(target, link);
  assert.equal(run(link).status, 1); assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP');
  fs.writeFileSync(input, ' '.repeat(8 * 1024 * 1024 + 1));
  const out = path.join(dir, 'no.json'); assert.equal(run(out).status, 1); assert.equal(fs.existsSync(out), false);
});
