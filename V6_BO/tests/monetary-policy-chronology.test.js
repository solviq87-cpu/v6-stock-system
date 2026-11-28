'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createFixture} = require('./helpers/v6-studio-fixture');
const {appendBatch} = require('../src/core/news-evidence-journal');
const {documents} = require('../../docs/validation/fayo-policy-implementation/replay.json');

test('降准宣布、实施报道和后续央行报告按本机实际入档时间分段可见', async t => {
  const [announcement, effective, retrospective] = documents;
  assert.deepEqual(documents.map(x => x.stage), ['announced','effective-as-reported','issuer-retrospective']);
  for (const doc of documents) {
    const digest = createHash('sha256').update(doc.input.body).digest('hex');
    assert.equal(doc.input.sourceRevisionId, 'content-' + digest);
    assert.ok(doc.archivedAt >= doc.input.receivedAt);
    if (process.env.FAYO_POLICY_ORIGINALS_DIR) {
      const raw = fs.readFileSync(path.join(process.env.FAYO_POLICY_ORIGINALS_DIR, doc.originalFile));
      assert.equal(raw.length, doc.originalSize);
      assert.equal(createHash('sha256').update(raw).digest('hex'), doc.originalSha256);
    }
  }
  // Freeze the isolated server at the recorded replay, leaving the host clock alone.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fayo-policy-clock-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  const clockFile = path.join(dir, 'clock');
  fs.writeFileSync(clockFile, String(retrospective.archivedAt + 1));
  const fixture = await createFixture({count:0,clockFile});
  t.after(() => fixture.close());
  const archive = path.join(fixture.tmp, 'data/news-evidence');
  const batch = (items, now) => appendBatch(archive, items.map(x => x.input), {now}).results;
  const first = batch([announcement,effective], announcement.archivedAt);
  const second = batch([retrospective], retrospective.archivedAt);
  assert.deepEqual([...first,...second].map(r => r.eventHash), documents.map(d => d.eventHash));
  assert.ok(batch(documents, retrospective.archivedAt + 1).every(r => r.reused));

  const before = Date.parse('2024-09-27T23:59:59+08:00');
  const reportDay = Date.parse('2024-11-08T23:59:59+08:00');
  for (const [cutoff, expected] of [
    [before, []], [reportDay, []], [retrospective.input.receivedAt, []],
    [announcement.archivedAt, [announcement,effective]], [retrospective.archivedAt, documents]
  ]) {
    const {status,body} = await fixture.request('/api/research/news-evidence?asOf=' + cutoff);
    assert.equal(status, 200);
    const {rows, canTrade, canTrain, canNotify} = body.result;
    assert.deepEqual([canTrade,canTrain,canNotify], [false,false,false]);
    assert.deepEqual(rows.map(r => r.eventHash).sort(), expected.map(d => d.eventHash).sort());
    for (const row of rows) {
      const src = expected.find(d => d.eventHash === row.eventHash);
      assert.equal(row.recordedAt, src.archivedAt);
      assert.equal(row.evidence.receivedAt, src.input.receivedAt);
      assert.equal(row.evidence.publishedAt, src.input.publishedAt);
      assert.equal(row.eligibleForResearchSupport, false);
      assert.deepEqual(row.evidence.securities, []);
    }
  }
  assert.equal(effective.input.publishedAt, null);
  assert.equal(retrospective.input.publishedAt, null);
});
