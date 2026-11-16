'use strict';
// These workflows include status and publication credentials. A movable Action
// tag must not be able to replace reviewed code without a repository change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const workflows = fs.readdirSync(path.join(root, '.github/workflows'))
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => ({name, text: fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8')}));

test('external GitHub Actions are pinned to immutable full commit revisions', () => {
  let checked = 0;
  for (const {name, text} of workflows) {
    for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
      const ref = match[1];
      if (ref.startsWith('./')) continue;
      assert.match(ref, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/, `${name}: mutable Action reference`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'No external Actions found; workflow discovery failed');
});

test('checkout never leaves an Actions token in repository Git configuration', () => {
  let checked = 0;
  for (const {name, text} of workflows) {
    for (const match of text.matchAll(/^(\s*)- uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=^\1- |^\S|$(?![\s\S]))/gm)) {
      assert.match(match[2], /^\s+persist-credentials: false\s*$/m, `${name}: checkout retains credentials`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'No checkout steps found; workflow discovery failed');
});

test('reviewable active dev ruleset covers every unconditional full CI job', () => {
  // This validates the desired configuration, not GitHub's live enforcement.
  // The API must independently confirm that repository administration applied it.
  const config = JSON.parse(fs.readFileSync(path.join(root, '.github/rulesets/v6-dev-required-checks.json'), 'utf8'));
  assert.equal(config.enforcement, 'active');
  assert.deepEqual(config.bypass_actors, []);
  assert.deepEqual(config.conditions.ref_name.include, ['refs/heads/dev']);
  const required = new Set(config.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.map(check => check.context));
  const ci = workflows.find(workflow => workflow.name === 'v6-ci.yml').text.split('\njobs:\n')[1];
  for (const match of ci.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)) {
    const displayName = match[2].match(/^    name: (.+)$/m)?.[1] || match[1];
    assert.ok(required.has(displayName), `Missing required full CI check: ${displayName}`);
  }
  assert.ok(required.has('commit-status-coverage'));
});
