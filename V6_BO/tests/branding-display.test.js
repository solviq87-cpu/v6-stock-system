'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('天枢智策 is the consistent user-facing name without renaming the V6 version identifier', () => {
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
  assert.match(desktop, /v6-ref-logo">V6<\/span>/);
  assert.match(mobile, /v6-mobile-logo">V6<\/span>/);
  assert.equal((dashboard.match(/<strong>天枢智策<\/strong>/g) || []).length, 2);
});
