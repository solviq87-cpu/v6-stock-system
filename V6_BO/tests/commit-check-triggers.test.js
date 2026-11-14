'use strict';
// Ensure future workflow edits do not silently remove the per-push GitHub checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const workflow = name => fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
const section = (src, from, to) => {
  const start = src.indexOf('\n  ' + from + ':\n');
  const end = src.indexOf('\n  ' + to + ':\n', start + 1);
  assert.ok(start >= 0 && end > start, 'Missing GitHub event ' + from + ' or ' + to);
  return src.slice(start, end);
};
const paths = block => Array.from(block.matchAll(/^      - '([^']+)'$/gm), match => match[1]);

test('every push of a nonarchive V6 code branch invokes full CI', () => {
  const src = workflow('v6-ci.yml');
  const push = section(src, 'push', 'pull_request');
  assert.match(push, /branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
  assert.doesNotMatch(push, /^\s+paths:/m, 'V6 CI must not skip documentation or script commits');
  assert.match(src, /^  workflow_dispatch:\s*$/m);
  assert.match(src, /^  verify:\s*$/m);
  assert.match(src, /^  verify-web:\s*$/m);
  assert.match(src, /npm test/);
  assert.match(src, /npm run check/);
});

test('UI changes on any code branch get a browser check per push', () => {
  const src = workflow('v6-ui-browser.yml');
  const push = section(src, 'push', 'pull_request');
  const pr = section(src, 'pull_request', 'workflow_dispatch');
  assert.match(push, /branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
  assert.deepEqual(paths(push), paths(pr));
  assert.ok(paths(push).includes('V6_BO/public/**'));
  assert.ok(paths(push).includes('V6_WEB/workbuddy/**'));
  assert.ok(paths(push).includes('.github/workflows/v6-ui-browser.yml'));
  assert.match(src, /^  visual-geometry:\s*$/m);
});

test('publisher ownership and release safety checks are unchanged', () => {
  const release = workflow('workbuddy-auto-update.yml');
  const owner = JSON.parse(fs.readFileSync(path.join(root, 'V6_BO/config/repository-auto-update-owner.json'), 'utf8'));
  assert.equal(owner.publisher, 'managed-task');
  assert.match(release, /workflows:\s*\[V6 CI\]/);
  assert.match(release, /branches:\s*\[dev\]/);
});
