'use strict';

// Audit the checked-in gate contract, never GitHub's live administration state.
// This is deliberately a conservative reader for the repository's block-style
// workflows, not a YAML parser. Unknown layouts fail closed; actionlint remains
// the independent syntax/expression validator in the existing CI workflow.
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = ['v6-ci.yml', 'v6-pr-commit-coverage.yml', 'v6-ui-browser.yml'];
const RULESET = '.github/rulesets/v6-dev-required-checks.json';

function entries(lines, indent) {
  const found = [];
  found.unsupported = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() || lines[i].trimStart().startsWith('#') || lines[i].search(/\S/) !== indent) continue;
    const match = lines[i].match(/^( *)([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match || match[1].length !== indent) {
      found.unsupported.push(lines[i].trim());
      continue;
    }
    let end = i + 1;
    while (end < lines.length) {
      const row = lines[end];
      if (row.trim() && !row.trimStart().startsWith('#') && row.search(/\S/) <= indent) break;
      end++;
    }
    found.push({key: match[2], value: (match[3] || '').trim(), body: lines.slice(i + 1, end)});
  }
  return found;
}

function scalar(value) {
  return value.replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
}

function auditIntegrationGates(repoRoot = path.resolve(__dirname, '../..')) {
  const failures = [];
  const fail = (code, file, detail) => failures.push({code, file, detail});
  const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const required = new Set();
  const contexts = new Map();
  const loaded = new Map();
  let browserScripts = [];
  const blocks = (lines, indent, file) => {
    const result = entries(lines, indent);
    for (const row of result.unsupported) fail('unsupported-workflow-layout', file, `Unreviewed mapping syntax: ${row.slice(0, 160)}`);
    return result;
  };

  function onlyEntry(list, key, file) {
    const hits = list.filter(entry => entry.key === key);
    if (hits.length !== 1) {
      fail('unsupported-workflow-layout', file, `Expected one block-style ${key} mapping; found ${hits.length}`);
      return null;
    }
    if (hits[0].value && !hits[0].value.startsWith('#')) {
      fail('unsupported-workflow-layout', file, `${key} must use the reviewed block mapping format`);
      return null;
    }
    return hits[0];
  }

  function checkTrigger(on, event, file) {
    const config = onlyEntry(blocks(on.body, 2, file), event, file);
    if (!config) return;
    const fields = blocks(config.body, 4, file);
    for (const key of ['paths', 'paths-ignore', 'types', 'branches-ignore', 'tags', 'tags-ignore']) {
      if (fields.some(field => field.key === key)) fail('required-check-trigger-filter', file, `${event}.${key} can omit the required result`);
    }
    const branches = fields.filter(field => field.key === 'branches');
    if (branches.length > 1) fail('unsupported-workflow-layout', file, `Duplicate ${event}.branches`);
    if (branches.length === 1) {
      const branch = branches[0];
      let names;
      if (/^\[.*\](?:\s*#.*)?$/.test(branch.value)) {
        names = branch.value.replace(/\s+#.*$/, '').slice(1, -1).split(',').map(scalar);
      } else if (!branch.value) {
        const items = branch.body.filter(line => line.trim() && !line.trimStart().startsWith('#'));
        if (items.every(line => /^      -\s+\S/.test(line))) names = items.map(line => scalar(line.replace(/^      -\s+/, '')));
      }
      // Review unfamiliar patterns instead of guessing glob/expression semantics.
      if (!names || !names.some(name => ['dev', '*', '**'].includes(name)) || names.some(name => name.startsWith('!') && name !== '!archive/**')) {
        fail('required-check-dev-not-guaranteed', file, `${event} must demonstrably include dev`);
      }
    }
  }

  try {
    const ruleset = JSON.parse(read(RULESET));
    const refs = ruleset.conditions?.ref_name;
    if (ruleset.target !== 'branch' || !Array.isArray(refs?.include) || refs.include.length !== 1 || refs.include[0] !== 'refs/heads/dev' || !Array.isArray(refs.exclude) || refs.exclude.length) {
      fail('ruleset-target', RULESET, 'The reviewed candidate must target only refs/heads/dev');
    }
    const rule = ruleset.rules?.filter(item => item.type === 'required_status_checks');
    if (rule?.length !== 1 || !Array.isArray(rule[0].parameters?.required_status_checks)) throw new Error('Expected one required_status_checks rule');
    if (rule[0].parameters.strict_required_status_checks_policy !== true) fail('ruleset-stale-base', RULESET, 'Require checks after updating to the current base');
    for (const check of rule[0].parameters.required_status_checks) {
      if (!check.context || required.has(check.context)) fail('required-check-duplicate', RULESET, String(check.context));
      if (check.integration_id !== 15368) fail('required-check-source', RULESET, `${check.context}: expected the reviewed GitHub Actions App`);
      required.add(check.context);
    }
    for (const context of ['verify', 'verify-web', 'commit-status-coverage', 'visual-geometry']) {
      if (!required.has(context)) fail('required-check-missing', RULESET, context);
    }

    for (const name of WORKFLOWS) {
      const file = `.github/workflows/${name}`;
      const text = read(file);
      const root = blocks(text.split(/\r?\n/), 0, file);
      const on = onlyEntry(root, 'on', file);
      const jobs = onlyEntry(root, 'jobs', file);
      if (!on || !jobs) continue;
      checkTrigger(on, 'pull_request', file);
      if (name !== 'v6-pr-commit-coverage.yml') checkTrigger(on, 'push', file);
      const jobList = blocks(jobs.body, 2, file);
      if (!jobList.length) fail('unsupported-workflow-layout', file, 'No block-style jobs found');
      loaded.set(name, {file, jobList});
      for (const job of jobList) {
        if (job.value && !job.value.startsWith('#')) fail('unsupported-workflow-layout', file, `${job.key}: aliases and inline jobs need explicit review`);
        const fields = blocks(job.body, 4, file);
        const nameField = fields.filter(field => field.key === 'name');
        const context = scalar(nameField[0]?.value || job.key);
        if (nameField.length > 1 || context.includes('${{')) fail('unsupported-workflow-layout', file, `${job.key}: ambiguous check name`);
        if (contexts.has(context)) fail('required-check-ambiguous', file, `${context} is emitted by multiple jobs`);
        contexts.set(context, {file, job});
        if (name === 'v6-ci.yml' && !required.has(context)) fail('full-ci-job-not-required', RULESET, context);
        if (!required.has(context)) continue;
        for (const key of ['if', 'needs', 'strategy']) {
          if (fields.some(field => field.key === key)) fail('required-job-can-skip', file, `${context}.${key} needs explicit review`);
        }
        const ignored = fields.find(field => field.key === 'continue-on-error');
        if (ignored && scalar(ignored.value) !== 'false') fail('required-job-can-ignore-failure', file, context);
      }
    }
    for (const context of required) {
      if (!contexts.has(context)) fail('required-check-without-job', RULESET, context);
    }

    const ui = loaded.get('v6-ui-browser.yml');
    const visual = ui?.jobList.find(job => scalar(entries(job.body, 4).find(field => field.key === 'name')?.value || job.key) === 'visual-geometry');
    if (visual) {
      const steps = onlyEntry(blocks(visual.body, 4, ui.file), 'steps', ui.file);
      browserScripts = fs.readdirSync(path.join(repoRoot, 'V6_BO/scripts')).filter(name => /^fayo-.*browser-check\.js$/.test(name)).sort();
      if (!browserScripts.length) fail('browser-inventory-empty', ui.file, 'No FAYO browser verification scripts found');
      const segments = [];
      for (const line of steps?.body || []) {
        if (/^      -\s/.test(line)) segments.push([]);
        if (segments.length) segments[segments.length - 1].push(line);
      }
      for (const script of browserScripts) {
        const invocation = `node scripts/${script}`;
        const owners = segments.filter(segment => segment.some(line => line.trim() === invocation));
        if (owners.length !== 1) {
          fail('browser-script-not-executed', ui.file, `${script}: expected one unconditional executable command, found ${owners.length}`);
          continue;
        }
        const block = owners[0].join('\n');
        if (/^        if:/m.test(block) || /^        continue-on-error:\s*(?!false\s*$)/m.test(block)) fail('browser-script-can-skip', ui.file, script);
        if (!/^          set -euo pipefail\s*$/m.test(block) || /\|\||\bset\s+\+[^\n]*e/.test(block)) fail('browser-script-can-ignore-failure', ui.file, script);
        if (!/^        run:\s*\|\s*$/m.test(block)) fail('unsupported-workflow-layout', ui.file, `${script}: expected reviewed literal run block`);
      }
    } else {
      fail('browser-job-missing', '.github/workflows/v6-ui-browser.yml', 'visual-geometry must run the real browser suite');
    }
  } catch (error) {
    fail('gate-input-unreadable', RULESET, error.message);
  }
  return {ok: failures.length === 0, scope: 'checked-in-configuration-only', remoteEnforcement: 'not-assessed', requiredChecks: [...required].sort(), browserScripts, failures};
}

if (require.main === module) {
  const result = auditIntegrationGates();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {auditIntegrationGates};
