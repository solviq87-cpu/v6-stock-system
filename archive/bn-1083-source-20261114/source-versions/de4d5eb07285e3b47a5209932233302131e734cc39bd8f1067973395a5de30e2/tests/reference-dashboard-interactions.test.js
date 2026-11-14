'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'reference-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets', 'v6-reference-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'v6-reference-dashboard.css'), 'utf8');
test('ranking tabs and sort selector are real accessible controls', () => {
  for (const key of ['all','focus','signal','strategy']) assert.match(html, new RegExp(`data-rank-filter="${key}"`));
  assert.match(html, /<select id="rank-sort"/);
  assert.match(js, /addEventListener\('click'/);
  assert.match(js, /addEventListener\('change'/);
  assert.match(css, /\.rank-tab:focus-visible/);
});
test('all untrusted ranking text fields are escaped before HTML insertion', () => {
  assert.match(js, /const esc = \(v\)/);
  assert.match(js, /const name = esc\(/);
  assert.match(js, /const reasons = esc\(/);
  assert.match(js, /const source = esc\(/);
  assert.match(js, /const risk = esc\(/);
});
test('per-strategy counts are never inferred from a mixed candidate list', () => {
  assert.match(js, /d\?\.strategyCounts/);
  assert.match(js, /待独立统计/);
  assert.doesNotMatch(js, /s\.includes\('十四'\).*counts\.rule14\+\+/s);
});
test('ranking rows support keyboard activation', () => {
  assert.match(js, /tabindex="0" role="button"/);
  assert.match(js, /e\.key === 'Enter' \|\| e\.key === ' '/);
});
