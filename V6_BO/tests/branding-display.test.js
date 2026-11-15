'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('天枢智策 is the consistent user-facing brand; V6 remains an internal version identifier', () => {
  const desktop = read('index.html');
  const mobile = read('mobile.html');
  const research = read('research.html');
  const dashboard = read('assets/terminal-dashboard.js');
  const manifest = JSON.parse(read('manifest.json'));
  for (const [name, file] of Object.entries({desktop, mobile, research, dashboard})) {
    assert.match(file, /天枢智策/, name);
    assert.doesNotMatch(file, /天书智能/, name);
  }
  assert.equal(manifest.name, '天枢智策');
  assert.equal(manifest.short_name, '天枢智策');
  // November 15 explicitly replaces the old V6 logo with the brand emblem.
  // Version identifiers in paths and protocol fields must remain compatible.
  assert.match(desktop, /v6-ref-logo"[^>]*>◈<\/span>/);
  assert.match(mobile, /v6-mobile-logo"[^>]*>◈<\/span>/);
  assert.equal((dashboard.match(/<strong(?:\s[^>]*)?>天枢智策<\/strong>/g) || []).length, 2);
  assert.match(dashboard, /<strong role="heading" aria-level="1">天枢智策<\/strong>/);
});
