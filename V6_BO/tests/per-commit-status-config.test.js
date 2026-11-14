'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const source=()=>fs.readFileSync(path.join(root,'.github/workflows/v6-per-commit-smoke.yml'),'utf8');
test('whole forward range selected with strict cap and SHA identity',()=>{
 const s=source();
 for(const term of ["name: V6 Per-Commit Smoke","compareCommits","cmp.ahead_by>32",
 "incomplete-or-wrong-commit-range","context.payload.forced","fail-fast: false",
 "fromJSON(needs.select.outputs.matrix)"])assert.ok(s.includes(term),term);
 assert.match(s,/branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
 assert.match(s, /matrix: \$\{\{ fromJSON\(needs\.select\.outputs\.matrix\) \}\}/);
 assert.ok(!/\$\{(?!\{)[^}\n]+\}/.test(s),'invalid GitHub expression placeholder');
});
test('per revision test is read-only and actually checks out the exact SHA',()=>{
 const s=source().split('\n  smoke:\n')[1]?.split('\n  publish-status:\n')[0];
 assert.ok(s);
 for(const term of ["name: per-sha-","persist-credentials: false",
 "git rev-parse HEAD","node --test --test-timeout=60000",
 "market-feed-consensus.test.js","paper-order-state-machine.test.js"])assert.ok(s.includes(term),term);
 assert.ok(!s.includes("statuses: write"));
 assert.ok(!s.includes("secrets."));
});
test('privileged writer trusts only official GitHub job conclusions',()=>{
 const s=source().split('\n  publish-status:\n')[1];
 assert.ok(s);
 for(const term of ["statuses: write","listJobsForWorkflowRunAttempt",
 "matches.length===1","matches[0].conclusion==='success'","createCommitStatus",
 "context:'v6/per-commit-smoke'"])assert.ok(s.includes(term),term);
 for(const unsafe of ["actions/checkout","node --test","secrets.","execFile"])assert.ok(!s.includes(unsafe),unsafe);
});
test('original full CI and managed publisher are preserved',()=>{
 const full=fs.readFileSync(path.join(root,'.github/workflows/v6-ci.yml'),'utf8');
 assert.match(full,/^  verify:\s*$/m);
 assert.match(full,/^  verify-web:\s*$/m);
 const owner=JSON.parse(fs.readFileSync(path.join(root,'V6_BO/config/repository-auto-update-owner.json'),'utf8'));
 assert.equal(owner.publisher,'managed-task');
});
