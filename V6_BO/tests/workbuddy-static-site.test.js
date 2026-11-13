'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildWorkBuddyStatic, parseStaticRelease, MAX_BYTES } = require('../scripts/build-workbuddy-static');

const SOURCE = path.resolve(__dirname, '../../V6_WEB/workbuddy/index.html');
const SHA = 'a'.repeat(40);
const SIMPLE = '<!DOCTYPE html>\n<html><head><title>Fixture</title></head><body><button>Keep</button><script>window.fixture=1;</script></body></html>\n';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t, html = SIMPLE) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-static-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'source.html');
  fs.writeFileSync(sourceFile, html);
  return { sourceFile, outputFile: path.join(directory, 'artifact.html') };
}

test('canonical source bytes and all visual/script markup survive deterministic builds', t => {
  const files = fixture(t);
  const before = fs.readFileSync(files.sourceFile);
  const first = buildWorkBuddyStatic({ ...files, sha: SHA });
  const second = buildWorkBuddyStatic({ sourceFile: files.sourceFile, sha: SHA });
  assert.equal(first.html, second.html);
  assert.deepEqual(fs.readFileSync(files.sourceFile), before);
  assert.equal(fs.readFileSync(files.outputFile, 'utf8'), first.html);
  assert.equal(first.html.replace(/\n<!-- v6-static-release:begin -->[^]*?\n<!-- v6-static-release:end -->/, ''), before.toString());
  assert.deepEqual(parseStaticRelease(first.html), {
    sha: SHA, contentHash: digest(before), artifactHash: digest(first.html),
    releaseId: `${SHA}-${digest(before).slice(0, 12)}`, scope: 'static-frontend-only'
  });
  assert.equal(parseStaticRelease(SIMPLE).sha, undefined);
  assert.equal(parseStaticRelease(SIMPLE).artifactHash, digest(SIMPLE));
  const legacy = SIMPLE.replace('window.fixture=1;', "const SHARE='legacy-fixture-only';");
  assert.deepEqual(parseStaticRelease(legacy), { sha: undefined, contentHash: undefined, artifactHash: digest(legacy), releaseId: undefined });
});

test('imported current site keeps inline V6Core and query-derived records access', () => {
  const before = fs.readFileSync(SOURCE);
  const release = buildWorkBuddyStatic({ sourceFile: SOURCE, sha: SHA });
  assert.equal(release.contentHash, digest(before));
  assert.match(release.html, /SHARE=new URLSearchParams\(location.search\).get\('sharecode'\)\|\|''/);
  assert.match(release.html, /url.searchParams.set\('sharecode',SHARE\)/);
  assert.match(release.html, /V6Core/);
  assert.deepEqual(fs.readFileSync(SOURCE), before);
});

test('invalid commit IDs and source overwrite attempts fail before changing source', t => {
  const files = fixture(t);
  for (const sha of [undefined, '', 'main', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), `${SHA}\n`, '<script>']) {
    assert.throws(() => buildWorkBuddyStatic({ ...files, sha }), /full lowercase Git commit SHA/);
  }
  assert.throws(() => buildWorkBuddyStatic({ sourceFile: files.sourceFile, outputFile: files.sourceFile, sha: SHA }), /must not overwrite/);
  const link = path.join(path.dirname(files.sourceFile), 'link.html');
  fs.symlinkSync(files.sourceFile, link);
  assert.throws(() => buildWorkBuddyStatic({ sourceFile: files.sourceFile, outputFile: link, sha: SHA }), /must not overwrite/);
  const hardlink = path.join(path.dirname(files.sourceFile), 'hardlink.html');
  fs.linkSync(files.sourceFile, hardlink);
  assert.throws(() => buildWorkBuddyStatic({ sourceFile: files.sourceFile, outputFile: hardlink, sha: SHA }), /must not overwrite/);
  assert.equal(fs.readFileSync(files.sourceFile, 'utf8'), SIMPLE);
});

test('tampered, duplicated, incomplete and conflicting release markers are rejected', t => {
  const files = fixture(t);
  const release = buildWorkBuddyStatic({ ...files, sha: SHA });
  for (const html of [
    release.html.replace('Keep', 'Changed'),
    release.html.replace('v6-repository-sha', 'v6-source-sha'),
    release.html.replace(SHA, 'b'.repeat(40)),
    release.html.replace('static-frontend-only', 'backend'),
    release.html.replace('</head>', `<meta name="v6-repository-sha" content="${SHA}"></head>`),
    release.html.replace('<!-- v6-static-release:begin -->', '<!-- moved -->'),
    SIMPLE.replace('</head>', `<meta name="v6-source-sha" content="${SHA}"></head>`)
  ]) assert.throws(() => parseStaticRelease(html));
  fs.writeFileSync(files.sourceFile, release.html);
  assert.throws(() => buildWorkBuddyStatic({ ...files, sha: SHA }), /must not contain release metadata/);
});

test('malformed, oversized, external dependency and embedded credential HTML fail closed', t => {
  const files = fixture(t);
  for (const html of [
    '', SIMPLE.replace('<!DOCTYPE html>', ''), SIMPLE.replace('<title>Fixture</title>', ''),
    SIMPLE.replace('</html>', ''), SIMPLE + 'x', SIMPLE + ' '.repeat(MAX_BYTES),
    SIMPLE.replace('</head>', '<script src="./app.js"></script></head>'),
    SIMPLE.replace('</head>', '<link rel="stylesheet" href="/assets/style.css"></head>'),
    SIMPLE.replace('</head>', '<style>body{background:url(https://example.invalid/x)}</style></head>'),
    SIMPLE.replace('window.fixture=1;', "const SHARE='fixture-do-not-publish';"),
    SIMPLE.replace('window.fixture=1;', "const apiKey='fixture-do-not-publish';"),
    SIMPLE.replace('window.fixture=1;', 'window.OPENAI_API_KEY;'),
    SIMPLE.replace('window.fixture=1;', "window['openai-api-key'];"),
    SIMPLE.replace('window.fixture=1;', "fetch('https://api.openai.com/v1/responses');")
  ]) {
    fs.writeFileSync(files.sourceFile, html);
    assert.throws(() => buildWorkBuddyStatic({ ...files, sha: SHA }));
  }
  fs.writeFileSync(files.sourceFile, Buffer.from([0xff, 0xfe, 0xfd]));
  assert.throws(() => buildWorkBuddyStatic({ ...files, sha: SHA }), /UTF-8/);
});
