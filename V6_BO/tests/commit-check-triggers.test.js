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
  assert.doesNotMatch(push, /^\s+paths(?:-ignore)?:/m, 'A required browser check must run for backend-only pushes too');
  assert.doesNotMatch(pr, /^\s+paths(?:-ignore)?:/m, 'A required browser check must not leave non-UI PRs pending');
  assert.match(pr, /branches:\s*\[[^\n]*\bdev\b/);
  assert.match(src, /^  visual-geometry:\s*$/m);
});

test('publisher ownership and release safety checks are unchanged', () => {
  const release = workflow('workbuddy-auto-update.yml');
  const owner = JSON.parse(fs.readFileSync(path.join(root, 'V6_BO/config/repository-auto-update-owner.json'), 'utf8'));
  assert.equal(owner.publisher, 'managed-task');
  assert.match(release, /workflows:\s*\[V6 CI\]/);
  assert.match(release, /branches:\s*\[dev\]/);
});

test('stacked audit and integration fixes run the full PR gate set on the target branch', () => {
  for (const name of ['v6-ci.yml', 'v6-pr-commit-coverage.yml', 'v6-ui-browser.yml']) {
    const src = workflow(name);
    const event = src.match(/\n  pull_request:\n([\s\S]*?)(?=\n(?:  [A-Za-z_]+:|[A-Za-z_]+:)|$)/)?.[1];
    assert.ok(event, name + ': pull_request configuration missing');
    const names = event.match(/branches:\s*\[([^\]]+)\]/)?.[1].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
    assert.ok(names, name + ': reviewed branch list missing');
    for (const target of ['dev', 'main', 'feat/**', 'fix/**', 'chore/**', 'audit/**', 'integration/**'])
      assert.ok(names.includes(target), name + ': required PR gate omits ' + target);
    assert.doesNotMatch(event, /^\s+paths(?:-ignore)?:/m, name + ': stacked backend fixes must not omit checks');
  }
});

// Exercise the actual inline workflow scripts: selection and status publishing
// must agree, including the merge of a PR with more than 32 verified commits.
const vm = require('node:vm');
const commitSha = n => n.toString(16).padStart(40, '0');
function smokeScript(index) {
  const lines = workflow('v6-per-commit-smoke.yml').split('\n');
  const starts = lines.flatMap((line, i) => line === '          script: |' ? [i] : []);
  assert.equal(starts.length, 2);
  let end = starts[index] + 1;
  while (end < lines.length && (lines[end].startsWith('            ') || !lines[end].trim())) end++;
  return lines.slice(starts[index] + 1, end).map(line => line.slice(12)).join('\n');
}
function executeSmoke(index, globals) {
  return vm.runInNewContext('(async()=>{\n' + smokeScript(index) + '\n})()', globals, {timeout: 1000});
}
function rangeFixture(n, {merge = false, badFirstParent = false, missingSecondParent = false, forced = false, created = false, incomplete = false, duplicate = false, nonforward = false} = {}) {
  const before = commitSha(1000), after = commitSha(n);
  const commits = Array.from({length:n}, (_, i) => ({sha:commitSha(i+1), parents:[{sha:i===0?before:commitSha(i)}]}));
  if (merge) commits[n-1].parents = [{sha:badFirstParent?commitSha(999):before},{sha:missingSecondParent?commitSha(998):commitSha(n-1)}];
  if (duplicate) commits[1].sha = commits[0].sha;
  if (incomplete) commits.splice(0,1);
  const outputs = {};
  const context = {repo:{owner:'solviq87-cpu',repo:'v6-stock-system'},sha:after,payload:{before:created?'0'.repeat(40):before,after,forced,created}};
  const github = {rest:{repos:{compareCommits:async args=>{
    assert.equal(args.base,before);assert.equal(args.head,after);assert.equal(args.per_page,100);assert.equal(args.page,1);
    return {data:{status:nonforward?'diverged':'ahead',ahead_by:n,commits}};
  }}}};
  const core = {setOutput:(key,value)=>{outputs[key]=JSON.parse(value);},summary:{addRaw(){return this;},async write(){}}};
  return {globals:{context,github,core},outputs,expected:created?[after]:Array.from({length:n},(_,i)=>commitSha(i+1))};
}
test('a forward merge of 57 PR commits and its merge commit tests all 58 SHAs', async()=>{
  const x=rangeFixture(58,{merge:true});
  await executeSmoke(0,x.globals);
  assert.deepEqual(x.outputs.shas,x.expected);
  assert.deepEqual(x.outputs.matrix.include,x.expected.map(sha=>({sha})));
});
test('ordinary push retains the 32-commit bound; verified merge capacity is 65', async()=>{
  for(const [n,merge] of [[32,false],[65,true]]){
    const x=rangeFixture(n,{merge});await executeSmoke(0,x.globals);assert.deepEqual(x.outputs.shas,x.expected);
  }
  for(const [n,merge] of [[33,false],[66,true]]) await assert.rejects(executeSmoke(0,rangeFixture(n,{merge}).globals),/nonforward-or-over-/);
});
test('large non-direct merges, truncated ranges, duplicate SHAs and unsafe pushes fail closed',async()=>{
  for(const opts of [{merge:true,badFirstParent:true},{merge:true,missingSecondParent:true},{merge:true,incomplete:true},{merge:true,duplicate:true},{merge:true,nonforward:true},{merge:true,forced:true}]){
    await assert.rejects(executeSmoke(0,rangeFixture(58,opts).globals));
  }
});
test('a new ref validates only its exact head, not unrelated historical ancestors',async()=>{
  const x=rangeFixture(58,{created:true});await executeSmoke(0,x.globals);assert.deepEqual(x.outputs.shas,x.expected);
});
function publisherFixture(n, missing = false) {
  const shas=Array.from({length:n},(_,i)=>commitSha(i+1)), statuses=[];
  const jobs=shas.filter((_,i)=>!missing||i!==0).map(sha=>({name:'per-sha-'+sha,status:'completed',conclusion:'success'}));
  const globals={context:{repo:{owner:'solviq87-cpu',repo:'v6-stock-system'},runId:123},process:{env:{COVERAGE_SHAS:JSON.stringify(shas),GITHUB_RUN_ATTEMPT:'1'}},github:{rest:{actions:{listJobsForWorkflowRunAttempt:async()=>({data:{total_count:jobs.length,jobs}})},repos:{createCommitStatus:async args=>{statuses.push(args);}}}},core:{summary:{addRaw(){return this;},async write(){}}}};
  return {globals,shas,statuses};
}
test('merge-size publisher requires and records one successful job per SHA',async()=>{
  const x=publisherFixture(65);await executeSmoke(1,x.globals);
  assert.equal(x.statuses.length,65);assert.deepEqual(x.statuses.map(s=>s.sha),x.shas);assert.ok(x.statuses.every(s=>s.state==='success'&&s.context==='v6/per-commit-smoke'));
  const missing=publisherFixture(58,true);await assert.rejects(executeSmoke(1,missing.globals),/per-sha-smoke-failed:1/);
  assert.equal(missing.statuses.length,58);assert.equal(missing.statuses[0].state,'failure');
  const tooMany=publisherFixture(66);await assert.rejects(executeSmoke(1,tooMany.globals),/invalid-coverage-targets/);assert.equal(tooMany.statuses.length,0);
});
