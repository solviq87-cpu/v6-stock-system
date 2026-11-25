'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {auditIntegrationGates} = require('../scripts/audit-fayo-integration-gates');

const repoRoot = path.resolve(__dirname, '../..');
const uiFile = '.github/workflows/v6-ui-browser.yml';
const rulesFile = '.github/rulesets/v6-dev-required-checks.json';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fayo-gate-contract-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const file of [rulesFile, uiFile, '.github/workflows/v6-ci.yml', '.github/workflows/v6-pr-commit-coverage.yml']) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(repoRoot, file), target);
  }
  fs.mkdirSync(path.join(root, 'V6_BO/scripts'), {recursive: true});
  for (const name of fs.readdirSync(path.join(repoRoot, 'V6_BO/scripts')).filter(name => /^fayo-.*browser-check\.js$/.test(name))) fs.writeFileSync(path.join(root, 'V6_BO/scripts', name), '// Inventory fixture; never executed.\n');
  return root;
}

function replace(root, file, from, to) {
  const target = path.join(root, file);
  const previous = fs.readFileSync(target, 'utf8');
  assert.ok(previous.includes(from), 'The mutation must affect the current workflow');
  fs.writeFileSync(target, previous.replace(from, to));
}

function rejects(root, code) {
  const result = auditIntegrationGates(root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.code === code), JSON.stringify(result.failures));
  assert.equal(result.remoteEnforcement, 'not-assessed');
}

test('current required checks resolve to real jobs and every FAYO browser entry executes', () => {
  const result = auditIntegrationGates(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.ok(result.requiredChecks.includes('visual-geometry'));
  assert.ok(result.browserScripts.includes('fayo-source-review-browser-check.js'));
  assert.equal(result.remoteEnforcement, 'not-assessed');
});

test('a UI-only PR path filter cannot leave backend-only PRs waiting forever', t => {
  const root = fixture(t);
  replace(root, uiFile, '  pull_request:\n', "  pull_request:\n    paths:\n      - 'V6_BO/public/**'\n");
  rejects(root, 'required-check-trigger-filter');
});

test('ignoring documentation pushes cannot silently remove the required browser result', t => {
  const root = fixture(t);
  replace(root, uiFile, '  push:\n', "  push:\n    paths-ignore:\n      - '**/*.md'\n");
  rejects(root, 'required-check-trigger-filter');
});

test('quoted YAML filter keys require review instead of being mistaken for no filter', t => {
  const root = fixture(t);
  replace(root, uiFile, '  pull_request:\n', '  pull_request:\n    "paths":\n      - "V6_BO/public/**"\n');
  rejects(root, 'unsupported-workflow-layout');
});

test('YAML merge aliases cannot hide filtered events or conditional jobs from the audit', t => {
  const root = fixture(t);
  replace(root, uiFile, '  pull_request:\n', '  pull_request:\n    <<: *filtered_event\n');
  replace(root, '.github/workflows/v6-pr-commit-coverage.yml', '  commit-coverage:\n', '  commit-coverage: *conditional_job\n');
  rejects(root, 'unsupported-workflow-layout');
});

test('missing required browser status and nonexistent renamed jobs both fail closed', t => {
  const root = fixture(t);
  const target = path.join(root, rulesFile);
  const rules = JSON.parse(fs.readFileSync(target, 'utf8'));
  const checks = rules.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  checks.splice(checks.findIndex(check => check.context === 'visual-geometry'), 1);
  checks.push({context: 'nonexistent-browser-result', integration_id: 15368});
  fs.writeFileSync(target, JSON.stringify(rules));
  rejects(root, 'required-check-missing');
  rejects(root, 'required-check-without-job');
});

test('conditional browser jobs and PR event type restrictions cannot bypass checks', t => {
  const root = fixture(t);
  replace(root, uiFile, '  visual-geometry:\n', "  visual-geometry:\n    if: github.event_name != 'pull_request'\n");
  replace(root, uiFile, '  pull_request:\n', '  pull_request:\n    types: [opened]\n');
  rejects(root, 'required-job-can-skip');
  rejects(root, 'required-check-trigger-filter');
});

test('new risk browser evidence is rejected when a script is added without CI wiring', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'V6_BO/scripts/fayo-unwired-risk-browser-check.js'), '// Added by another group without workflow wiring.\n');
  rejects(root, 'browser-script-not-executed');
});

test('a commented-out research browser command is not execution evidence', t => {
  const root = fixture(t);
  replace(root, uiFile, '          node scripts/fayo-source-review-browser-check.js', '          # node scripts/fayo-source-review-browser-check.js');
  rejects(root, 'browser-script-not-executed');
});

test('a swallowed exit code cannot make a failed research browser check green', t => {
  const root = fixture(t);
  replace(root, uiFile, '          node scripts/fayo-source-review-browser-check.js', '          node scripts/fayo-source-review-browser-check.js || true');
  rejects(root, 'browser-script-not-executed');
  rejects(root, 'browser-script-can-ignore-failure');
});

test('continue-on-error on the browser step cannot certify the required gate', t => {
  const root = fixture(t);
  replace(root, uiFile, '      - name: Check actual DOM rectangles and visual screenshots on 9 CSS viewports\n', '      - name: Check actual DOM rectangles and visual screenshots on 9 CSS viewports\n        continue-on-error: true\n');
  rejects(root, 'browser-script-can-skip');
});

test('the required browser workflow must include dev and retain fail-fast execution', t => {
  const root = fixture(t);
  replace(root, uiFile, '    branches: [dev, "fix/**"]', '    branches: [main, "fix/**"]');
  replace(root, uiFile, '          set -euo pipefail\n          node scripts/fayo-browser-check.js', '          set +e\n          node scripts/fayo-browser-check.js');
  rejects(root, 'required-check-dev-not-guaranteed');
  rejects(root, 'browser-script-can-ignore-failure');
});
