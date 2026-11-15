#!/usr/bin/env node
'use strict';
// This controller is deliberately separate from the static WorkBuddy publisher.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const runtime = require('./host-runtime.js');

const REPOSITORY = 'solviq87-cpu/v6-stock-system';
const REMOTE = 'https://github.com/' + REPOSITORY + '.git';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['completed', 'rolled-back', 'aborted']);
const MUTABLE_SEEDS = new Set(['themeMap.json','external_data.json','pushgov.json','changes_state.json']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function requireThat(ok, code) { if (!ok) fail(code); }
function privatePath(value) {
  requireThat(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && value !== '/' && !value.startsWith('/mnt/'), 'unsafe-update-path');
  let current = '/';
  for (const part of value.split('/').filter(Boolean)) {
    requireThat(!['public', 'www', 'htdocs'].includes(part.toLowerCase()), 'unsafe-update-path');
    current = path.join(current, part);
    try { requireThat(!fs.lstatSync(current).isSymbolicLink(), 'unsafe-update-path'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return value;
}
function privateDirectory(dir, create = false) {
  privatePath(dir);
  if (create) { try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  const st = fs.lstatSync(dir);
  requireThat(st.isDirectory() && st.uid === process.getuid() && !(st.mode & 0o077), 'unsafe-update-permissions');
}
function bytes(file, limit = 128 * 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    requireThat(st.isFile() && st.nlink === 1 && st.size <= limit && st.uid === process.getuid(), 'unsafe-update-file');
    const chunks=[];let total=0;
    for(;;){const chunk=Buffer.alloc(Math.min(65536,limit+1-total));const count=fs.readSync(fd,chunk,0,chunk.length,null);if(!count)break;total+=count;requireThat(total<=limit,'unsafe-update-file');chunks.push(chunk.subarray(0,count));}
    const data = Buffer.concat(chunks,total);
    const after = fs.fstatSync(fd);
    requireThat(data.length <= limit && ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].every(k => after[k] === st[k]), 'update-file-changed');
    return data;
  } finally { fs.closeSync(fd); }
}
function readJson(file) { return JSON.parse(bytes(file, 2 * 1024 * 1024)); }
function atomicJson(file, value) {
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function optionalJson(file) { try { return readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function acquireLock(state) {
  const file = path.join(state, 'update.lock');
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || st.mode & 0o077) { fs.closeSync(fd); fail('unsafe-update-lock'); }
  const result = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 2000 });
  if (result.error || result.status !== 0) { fs.closeSync(fd); fail('updater-busy'); }
  return () => fs.closeSync(fd);
}
function enumerate(dir, prefix = '') {
  const result = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const relative = prefix ? prefix + '/' + name : name;
    const full = path.join(dir, name), st = fs.lstatSync(full);
    requireThat(!st.isSymbolicLink() && (st.isDirectory() || st.isFile()) && st.uid === process.getuid(), 'unsafe-backup-entry');
    if (st.isDirectory()) result.push(...enumerate(full, relative));
    else { requireThat(st.nlink === 1 && st.size <= 128 * 1024 * 1024, 'unsafe-backup-entry'); result.push(relative); }
  }
  return result;
}
function treeManifest(dir) { return enumerate(dir).map(file => ({ path: file, sha256: hash(bytes(path.join(dir, file))) })); }
function sameTree(left, right) { return JSON.stringify(treeManifest(left)) === JSON.stringify(treeManifest(right)); }
function copyTree(source, target) {
  privateDirectory(source);
  fs.mkdirSync(target, { mode: 0o700 });
  // Never follow symlinks or duplicate a special file/lock inode into a backup.
  const files=enumerate(source);
  function directories(from,to){for(const entry of fs.readdirSync(from,{withFileTypes:true}))if(entry.isDirectory()){const next=path.join(to,entry.name);fs.mkdirSync(next,{mode:0o700});directories(path.join(from,entry.name),next);}}
  directories(source,target);
  for (const file of files) {
    const destination = path.join(target, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, bytes(path.join(source, file)), { flag: 'wx', mode: 0o600 });
  }
}
function privateStateManifest(root) {
  const manifest = readJson(path.join(root, 'source-manifest.json'));
  const source = new Set(manifest.files.map(item => item.path));
  // Protect all non-source data, including newly introduced private archives.
  return enumerate(path.join(root, 'app')).filter(file => !source.has(file)||MUTABLE_SEEDS.has(file)).map(file => ({ path: file, sha256: hash(bytes(path.join(root, 'app', file))) }));
}
function safeError(error) {
  const code = error?.code;
  return typeof code === 'string' && /^[a-z][a-z0-9-]{1,70}$/.test(code) ? code : 'local-update-failed';
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options });
  requireThat(!result.error && result.status === 0, options.errorCode || 'update-command-failed');
  return result.stdout;
}
async function github(endpoint, { token, fetchImpl = fetch } = {}) {
  // Endpoints are constructed by the controller, never accepted from the CLI.
  requireThat(endpoint.startsWith('/repos/' + REPOSITORY + '/') && !endpoint.split(/[/?]/).includes('..'), 'invalid-update-source');
  let response;
  try {
    response = await fetchImpl('https://api.github.com' + endpoint, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tian-shu-local-updater', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  } catch { fail('update-network-unavailable'); }
  requireThat(response.ok, 'update-source-unavailable');
  let total = 0; const chunks = [];
  try {
    for await (const chunk of response.body) { total += chunk.length; requireThat(total <= 12 * 1024 * 1024, 'update-source-too-large'); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error.code) throw error; fail('invalid-update-response'); }
}
function ciGate(sha, evidence, uiChanged) {
  requireThat(SHA.test(sha), 'invalid-candidate-sha');
  const expected = ['V6 CI', ...(uiChanged ? ['V6 UI Browser Geometry'] : [])];
  const receipt = [];
  for (const name of expected) {
    const item = evidence.find(value => value.name === name);
    requireThat(item && item.head_sha === sha && item.head_branch === 'dev' && item.event === 'push' && item.status === 'completed' && item.conclusion === 'success', 'candidate-ci-not-green');
    requireThat(/^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/actions\/runs\/\d+$/.test(item.html_url), 'invalid-ci-url');
    requireThat(Array.isArray(item.jobs) && item.jobs.length > 0 && item.jobs.every(job => job.status === 'completed' && job.conclusion === 'success'), 'candidate-jobs-not-green');
    const required = name === 'V6 CI' ? ['verify', 'verify-web'] : ['visual-geometry'];
    requireThat(required.every(job => item.jobs.some(value => value.name === job)), 'candidate-required-job-missing');
    receipt.push(item.html_url);
  }
  const smoke = evidence.find(value => value.context === 'v6/per-commit-smoke');
  requireThat(smoke && smoke.sha === sha && smoke.state === 'success' && /^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(smoke.target_url), 'candidate-smoke-not-green');
  receipt.push(smoke.target_url);
  return receipt;
}
async function discover(installed, deps = {}) {
  const request = endpoint => github('/repos/' + REPOSITORY + endpoint, deps);
  const branch = await request('/branches/dev');
  const sha = branch?.commit?.sha;
  requireThat(SHA.test(sha), 'invalid-candidate-sha');
  if (sha === installed) return { sha, changed: false, files: [], ciUrls: [] };
  const comparison = await request('/compare/' + installed + '...' + sha);
  requireThat(comparison.status === 'ahead' && comparison.merge_base_commit?.sha === installed && comparison.commits?.length === comparison.ahead_by && comparison.ahead_by <= 250 && Array.isArray(comparison.files) && comparison.files.length < 300, 'candidate-not-safe-forward-update');
  const files = [...new Set(comparison.files.flatMap(file => [file.filename,...(file.previous_filename?[file.previous_filename]:[])]))];
  const uiChanged = files.some(file => /^V6_BO\/public\/|^V6_BO\/scripts\/ui-|^\.github\/workflows\/v6-ui-browser/.test(file));
  const evidence = [];
  for (const [workflow, name] of [['v6-ci.yml', 'V6 CI'], ...(uiChanged ? [['v6-ui-browser.yml', 'V6 UI Browser Geometry']] : [])]) {
    const value = await request('/actions/workflows/' + workflow + '/runs?head_sha=' + sha + '&branch=dev&event=push&per_page=100');
    requireThat(Array.isArray(value.workflow_runs) && value.workflow_runs.length > 0 && value.total_count <= 100, 'candidate-ci-not-green');
    const latest = value.workflow_runs.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
    const jobs = await request('/actions/runs/' + latest.id + '/attempts/' + latest.run_attempt + '/jobs?per_page=100');
    requireThat(jobs.total_count === jobs.jobs?.length && jobs.total_count <= 100, 'candidate-ci-incomplete');
    evidence.push({ ...latest, name, jobs: jobs.jobs });
  }
  const smokeUrls=[];
  for(const commit of comparison.commits){
    requireThat(SHA.test(commit.sha),'candidate-ci-incomplete');
    const statuses = await request('/commits/' + commit.sha + '/statuses?per_page=100');
    requireThat(Array.isArray(statuses) && statuses.length < 100, 'candidate-ci-incomplete');
    const smoke = statuses.find(item => item.context === 'v6/per-commit-smoke');
    requireThat(smoke&&smoke.state==='success'&&/^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(smoke.target_url),'candidate-smoke-not-green');
    smokeUrls.push(smoke.target_url);
    if(commit.sha===sha)evidence.push({...smoke,sha});
  }
  return { sha, changed: true, files, ciUrls: [...new Set([...ciGate(sha, evidence, uiChanged),...smokeUrls])] };
}
function sensitiveChange(files) {
  // The historical monolith owns ledger writes; a server.js edit is conservatively gated.
  return files.some(file => /^V6_BO\/(?:server\.js|(?:src|scripts|config)\/.*(?:paper|ledger|account|order|migration|schema|cloud-records|holdings)|deploy\/windows-host\/)/i.test(file));
}
function unpackZip(zip, destination) {
  run('python3', ['-c', `import pathlib,stat,sys,zipfile
z=zipfile.ZipFile(sys.argv[1]); out=pathlib.Path(sys.argv[2]); total=0; seen=set()
for i in z.infolist():
 p=pathlib.PurePosixPath(i.filename)
 if p.is_absolute() or '..' in p.parts or '\\\\' in i.filename or not p.parts or p.parts[0]!='tian-shu-windows-host' or i.filename in seen or i.file_size>64*1024*1024: raise ValueError('unsafe-zip')
 seen.add(i.filename); total+=i.file_size
 if total>160*1024*1024 or (i.external_attr>>16)&0o170000 not in (0,stat.S_IFREG): raise ValueError('unsafe-zip')
 dest=out.joinpath(*p.parts[1:]); dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with dest.open('xb') as f: f.write(z.read(i))
 dest.chmod(0o600)
`, zip, destination], { errorCode: 'candidate-package-invalid' });
}
function verifyPackage(bundle, candidate, source) {
  const info = readJson(path.join(bundle, 'source.json'));
  requireThat(info.sourceSha === candidate && info.controlsSourceSha === candidate, 'candidate-package-wrong-sha');
  const checked = runtime.verifyBundle(bundle);
  requireThat(checked.manifest.sourceSha === candidate, 'candidate-package-wrong-sha');
  for (const file of checked.manifest.files) {
    const original = path.join(source, 'V6_BO', file.path);
    requireThat(hash(bytes(original)) === file.sha256, 'candidate-source-mismatch');
  }
  const sums = bytes(path.join(bundle, 'SHA256SUMS.txt'), 8 * 1024 * 1024).toString('utf8').trim().split('\n');
  const names = new Set();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    requireThat(match && !match[2].includes('\\') && !path.isAbsolute(match[2]) && match[2].split('/').every(part => part && part !== '.' && part !== '..') && !names.has(match[2]), 'candidate-package-invalid');
    names.add(match[2]);
    requireThat(hash(bytes(path.join(bundle, match[2]))) === match[1], 'candidate-package-hash-mismatch');
  }
  requireThat(JSON.stringify([...names].sort()) === JSON.stringify(enumerate(bundle).filter(file => file !== 'SHA256SUMS.txt')), 'candidate-package-file-set-mismatch');
  // Controls are executable too. Bind them to the approved Git source bytes.
  for (const file of [...names].filter(file => !file.startsWith('payload/') && !['source.json', 'manifest.json'].includes(file))) {
    const expected = bytes(path.join(source, 'V6_BO/deploy/windows-host', file));
    const normalized = /\.(?:ps1|cmd)$/.test(file) ? Buffer.from(expected.toString().replace(/\r?\n/g, '\r\n')) : expected;
    requireThat(hash(normalized) === hash(bytes(path.join(bundle, file))), 'candidate-control-mismatch');
  }
  return { ...checked, packageHash: hash(bytes(path.join(bundle, 'SHA256SUMS.txt'))) };
}
async function prepareCandidate(candidate, work, deps = {}) {
  const repository = path.join(work, 'repository'), source = path.join(work, 'source'), bundle = path.join(work, 'bundle'), zip = path.join(work, 'runtime.zip');
  const proxyEnv = Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'].filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
  const env = { PATH: process.env.PATH, HOME: work, LANG: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...proxyEnv };
  run('git', ['init', '--bare', repository], { env });
  run('git', ['-C', repository, 'fetch', '--no-tags', '--depth=1', REMOTE, candidate.sha], { env, errorCode: 'candidate-source-fetch-failed' });
  requireThat(run('git', ['-C', repository, 'rev-parse', 'FETCH_HEAD'], { env }).trim() === candidate.sha, 'candidate-source-wrong-sha');
  const tree = run('git', ['-C', repository, 'ls-tree', '-r', candidate.sha], { env });
  requireThat(tree.split('\n').filter(Boolean).every(line => /^(?:100644|100755) blob [a-f0-9]{40}\t/.test(line)), 'candidate-source-special-file');
  run('git', ['-C', repository, 'worktree', 'add', '--detach', source, candidate.sha], { env });
  const app = path.join(source, 'V6_BO');
  const testHome = path.join(work, 'synthetic-home'); fs.mkdirSync(testHome, { mode: 0o700 });
  const testEnv = { PATH: process.env.PATH, HOME: testHome, LANG: 'C.UTF-8', TZ: 'Asia/Shanghai', V6_TEST_CONCURRENCY: '2', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', ...(process.env.V6_MODEL_PYTHON ? { V6_MODEL_PYTHON: process.env.V6_MODEL_PYTHON } : {}) };
  run('npm', ['run', 'check'], { cwd: app, env: testEnv, errorCode: 'candidate-check-failed' });
  const output = run('npm', ['test'], { cwd: app, env: testEnv, timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, errorCode: 'candidate-tests-failed' });
  const tests = /# tests (\d+)\s/.exec(output), failures = /# fail (\d+)\s/.exec(output), skipped = /# skipped (\d+)\s/.exec(output);
  requireThat(tests && Number(tests[1]) > 0 && failures && Number(failures[1]) === 0, 'candidate-test-evidence-missing');
  run(process.execPath,['tests/full-server-isolated-smoke.js'],{cwd:app,env:testEnv,timeout:120000,errorCode:'candidate-http-permissions-smoke-failed'});
  requireThat(run('git',['-C',source,'rev-parse','HEAD'],{env}).trim()===candidate.sha,'candidate-source-wrong-sha');
  run('git',['-C',source,'diff','--exit-code',candidate.sha,'--'],{env,errorCode:'candidate-source-modified-by-tests'});
  run('python3', [path.join(app, 'scripts/build-windows-host-bundle.py'), '--repo', source, '--sha', candidate.sha, '--output', zip], { env: testEnv, errorCode: 'candidate-package-build-failed' });
  fs.mkdirSync(bundle, { mode: 0o700 }); unpackZip(zip, bundle);
  const checked = verifyPackage(bundle, candidate.sha, source);
  run('git',['-C',source,'diff','--exit-code',candidate.sha,'--'],{env,errorCode:'candidate-source-modified-by-build'});
  // This is a new synthetic installation, never seeded with private user state.
  const staging = path.join(work, 'synthetic-installation');
  await runtime.initialize({ root: staging, bundle });
  const port = deps.stagingPort || 18787;
  try {
    const ready = await runtime.start({ root: staging, smoke: true }, { port });
    requireThat(ready.health, 'candidate-staging-unhealthy');
    const auth = await fetch('http://127.0.0.1:' + port + '/api/lock/status');
    const body = await auth.json();
    requireThat(auth.ok && body.hasPassword === false, 'candidate-staging-auth-failed');
  } finally { await runtime.stop({ root: staging }); }
  const restarted = await runtime.start({ root: staging, smoke: true }, { port });
  requireThat(restarted.health, 'candidate-staging-restart-failed');
  await runtime.stop({ root: staging });
  return { bundle, manifest: checked.manifest, packageHash: checked.packageHash, tests: Number(tests[1]), skipped: skipped ? Number(skipped[1]) : null };
}
function overlayRelease(backup, next, prepared, candidate) {
  copyTree(backup, next);
  const previous = readJson(path.join(backup, 'source-manifest.json'));
  const incoming = new Map(prepared.manifest.files.map(file => [file.path, file]));
  // The source manifest is the authority for obsolete code, never a wildcard.
  for (const file of previous.files) if (!incoming.has(file.path)&&!MUTABLE_SEEDS.has(file.path)) fs.unlinkSync(path.join(next, 'app', file.path));
  for (const file of prepared.manifest.files) {
    const destination = path.join(next, 'app', file.path), data = bytes(path.join(prepared.bundle, 'payload', file.path));
    requireThat(hash(data) === file.sha256, 'candidate-package-hash-mismatch');
    if(MUTABLE_SEEDS.has(file.path)&&fs.existsSync(destination))continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.writeFileSync(destination, data, { flag: 'wx', mode: 0o600 });
  }
  const serialized = JSON.stringify(prepared.manifest) + '\n';
  atomicJson(path.join(next, 'source-manifest.json'), prepared.manifest);
  fs.writeFileSync(path.join(next, 'source-sha'), candidate.sha + '\n', { mode: 0o600 });
  atomicJson(path.join(next, 'installation.json'), { schemaVersion: 1, ready: false, sourceSha: candidate.sha, manifestHash: hash(serialized) });
  // The smoke guard contains the installation's absolute path; the final path is unchanged.
  requireThat(JSON.stringify(privateStateManifest(backup)) === JSON.stringify(privateStateManifest(next)), 'candidate-private-state-changed');
}
async function installedAssets(root, candidate, deps = {}) {
  const status = await (deps.runtime || runtime).checkHost({ root },{updateToken:deps.updateToken});
  requireThat(status.code === 'running' && status.health && status.sourceSha === candidate.sha, 'candidate-post-start-unhealthy');
  const processFile = readJson(path.join(root, 'run/process.json'));
  const publicRoot = path.join(root, 'app/public');
  const native = fs.existsSync(path.join(publicRoot, 'nova/index.html'));
  const entries = native ? [['/', 'nova/index.html'], ['/m', 'nova/index.html']] : [['/', 'index.html'], ['/m', 'mobile.html']];
  const documents = [];
  for (const [url, file] of entries) {
    const expected = bytes(path.join(publicRoot, file));
    documents.push(expected.toString('utf8'));
    const response = await fetch('http://127.0.0.1:' + processFile.port + url, {signal: AbortSignal.timeout(5000), redirect: 'error'});
    requireThat(response.ok && hash(Buffer.from(await response.arrayBuffer())) === hash(expected), 'candidate-home-wrong-content');
  }
  const resources = [...documents.join('\n').matchAll(/(?:src|href)="(\/(?:assets|nova)\/[^"?#]+)(?:\?[^"#]*)?"/g)].map(match => match[1]);
  if (native) {
    // Include lazy modules and transitive imports, even before their view opens.
    const manifest = readJson(path.join(root, 'source-manifest.json'));
    for (const file of manifest.files) if (/^public\/nova\/[a-z0-9.-]+$/.test(file.path)) resources.push('/' + file.path.slice('public/'.length));
    resources.push('/sw.js', '/manifest.json', '/assets/model-library-catalog.json');
  }
  for (const resource of [...new Set(resources)]) {
    const expected = bytes(path.join(root, 'app/public', resource));
    const result = await fetch('http://127.0.0.1:' + processFile.port + resource + '?local_sha=' + candidate.sha, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    requireThat(result.ok && hash(Buffer.from(await result.arrayBuffer())) === hash(expected), 'candidate-served-resource-mismatch');
  }
  return resources.length;
}
async function update(options, deps = {}) {
  process.umask(0o077);
  const root = privatePath(options.root || path.join(os.homedir(), '.tian-shu-local'));
  const state = root + '.updater'; privateDirectory(state, true);
  const unlock = acquireLock(state), journal = path.join(state, 'transaction.json');
  const host = deps.runtime || runtime;
  let tx = optionalJson(journal), stopped = false, switched = false, movedOld=false, backup, beforeState;
  const save = phase => { tx.phase = phase; tx.updatedAt = new Date().toISOString(); atomicJson(journal, tx); };
  try {
    if (tx && !TERMINAL.has(tx.phase)) {
      // A power loss is never an excuse to assume which process or data committed.
      return { code: 'interrupted-update-needs-recovery', phase: tx.phase, newStartsBlocked: true, existingProcessVerifiedStopped: false, productionDeployed: false };
    }
    if(tx&&TERMINAL.has(tx.phase)&&optionalJson(path.join(root,'installation.json'))?.ready!==true)return{code:'interrupted-update-needs-recovery',phase:tx.phase,newStartsBlocked:true,existingProcessVerifiedStopped:false,productionDeployed:false};
    if (options.action === 'status') {
      const receipt = optionalJson(path.join(state, 'receipt.json'));
      return { code: 'update-status', paused: fs.existsSync(path.join(state, 'paused.json')), transaction: tx ? { phase: tx.phase, candidateSha: tx.candidateSha } : null, receipt,lastCheck:optionalJson(path.join(state,'last-check.json')) };
    }
    if (options.action === 'pause') { atomicJson(path.join(state, 'paused.json'), { pausedAt: new Date().toISOString() }); return { code: 'updates-paused' }; }
    if (options.action === 'resume') { try { fs.unlinkSync(path.join(state, 'paused.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; } return { code: 'updates-resumed' }; }
    requireThat(!fs.existsSync(path.join(state, 'paused.json')), 'updates-paused');
    privateDirectory(root);
    const installation = readJson(path.join(root, 'installation.json'));
    requireThat(installation.ready === true && SHA.test(installation.sourceSha), 'invalid-update-installation');
    const candidate = await (deps.discover || discover)(installation.sourceSha, deps);
    if (!candidate.changed){const result={ code: 'no-update', installedSha: installation.sourceSha, candidateSha: candidate.sha, checkedAt:new Date().toISOString(),productionDeployed: false };atomicJson(path.join(state,'last-check.json'),result);return result;}
    requireThat(SHA.test(candidate.sha) && candidate.sha !== installation.sourceSha && Array.isArray(candidate.files) && candidate.ciUrls?.length >= 2, 'invalid-update-candidate');
    const approvalRequired = sensitiveChange(candidate.files);
    if (options.action !== 'apply'){const result={ code: 'update-available', installedSha: installation.sourceSha, candidateSha: candidate.sha, ciUrls: candidate.ciUrls, approvalRequired, dryRun: true,checkedAt:new Date().toISOString(), productionDeployed: false };atomicJson(path.join(state,'last-check.json'),result);return result;}
    requireThat(!approvalRequired || options.approveSensitive === candidate.sha, 'sensitive-update-approval-required');
    const current = await host.checkHost({ root });
    requireThat(['running', 'stopped'].includes(current.code) && (current.code !== 'running' || current.health === true), 'installed-host-not-ready');
    (deps.validateInstalled || runtime.safeStartup)(root);
    const id = crypto.randomBytes(12).toString('hex'), work = path.join(state, 'work-' + id);
    fs.mkdirSync(work, { mode: 0o700 });
    const prepared = await (deps.prepare || prepareCandidate)(candidate, work, deps);
    requireThat(prepared.manifest.sourceSha === candidate.sha && HASH.test(prepared.packageHash) && prepared.tests > 0, 'candidate-package-wrong-sha');
    // Re-read exact dev/CI after the potentially long staging tests, before downtime.
    const rechecked = await (deps.discover || discover)(installation.sourceSha, deps);
    requireThat(rechecked.sha === candidate.sha && JSON.stringify(rechecked.files) === JSON.stringify(candidate.files), 'candidate-changed-during-validation');
    tx = { schemaVersion: 1, token: crypto.randomBytes(24).toString('hex'), id, phase: 'prepared', installedSha: installation.sourceSha, candidateSha: candidate.sha, oldMode: current.mode || 'smoke', wasRunning: current.code === 'running', ciUrls: candidate.ciUrls, discoveredAt: new Date().toISOString(), work, next: path.join(state, 'next-' + id), previous: path.join(state, 'previous-' + id), backup: path.join(state, 'backup-' + id) };
    save('stopping');
    const control = { updateToken: tx.token };
    // Old launchers do not know the new journal. ready=false also blocks their
    // existing metadata gate while current controls hold the private lease.
    atomicJson(path.join(root,'installation.json'),{...installation,ready:false});
    await host.stop({ root }, control); stopped = true;
    requireThat((await host.checkHost({ root },control)).code === 'stopped', 'installed-writer-still-running');
    if (deps.step) await deps.step('stopped');
    save('backing-up'); backup = tx.backup;
    copyTree(root, backup);
    if(deps.step)await deps.step('backup-copied');
    requireThat(sameTree(root, backup), 'backup-integrity-failed');
    const rehearsal = path.join(state, 'restore-rehearsal-' + id); copyTree(backup, rehearsal);
    if(deps.step)await deps.step('restore-copied');
    requireThat(sameTree(backup, rehearsal), 'backup-restore-rehearsal-failed');
    beforeState = privateStateManifest(backup);
    if (deps.step) await deps.step('backup-verified');
    save('assembling'); overlayRelease(backup, tx.next, prepared, candidate);
    requireThat(JSON.stringify(beforeState) === JSON.stringify(privateStateManifest(tx.next)), 'candidate-private-state-changed');
    if (deps.step) await deps.step('before-switch');
    save('switching'); fs.renameSync(root, tx.previous);movedOld=true;
    if(deps.step)await deps.step('old-root-moved');
    fs.renameSync(tx.next, root); switched = true;
    save('validating');
    await host.start({ root, smoke: true }, control);
    const verifiedAssets = await (deps.verifyInstalled || installedAssets)(root, candidate, {...deps,updateToken:tx.token});
    await host.stop({ root }, control);
    requireThat(JSON.stringify(beforeState) === JSON.stringify(privateStateManifest(root)), 'new-private-transactions-detected');
    if (deps.step) await deps.step('new-version-verified');
    if (tx.wasRunning) await host.start({ root, smoke: tx.oldMode === 'smoke' }, control);
    const receipt = { schemaVersion: 1, discoveredAt: tx.discoveredAt, installedAt: new Date().toISOString(), installedSha: candidate.sha, previousSha: installation.sourceSha, candidateSha: candidate.sha, ciUrls: candidate.ciUrls, packageHash: prepared.packageHash, sourceManifestHash: hash(bytes(path.join(root, 'source-manifest.json'))), backupVerified: true, restoreRehearsed: true, tests: prepared.tests, skipped: prepared.skipped ?? null, verifiedAssets, rollback: 'not-required', singleInstallationWriterVerified: true,systemSchedulersAudited:false, windowsVerified: false, phoneHttpsVerified: false, productionDeployed: false, code: 'local-update-installed' };
    atomicJson(path.join(state, 'receipt.json'), receipt);
    atomicJson(path.join(root,'installation.json'),{...readJson(path.join(root,'installation.json')),ready:true});
    if(deps.step)await deps.step('before-complete');
    save('completed');
    return receipt;
  } catch (error) {
    const code = safeError(error);
    if (tx && !TERMINAL.has(tx.phase) && stopped) {
      try {
        if(fs.existsSync(root))atomicJson(path.join(root,'installation.json'),{...readJson(path.join(root,'installation.json')),ready:false});
        if(movedOld&&!switched&&!fs.existsSync(root))fs.renameSync(tx.previous,root);
        if (switched) {
          await host.stop({ root }, { updateToken: tx.token });
          requireThat(JSON.stringify(beforeState) === JSON.stringify(privateStateManifest(root)), 'rollback-private-transactions-detected');
          save('rolling-back');
          fs.renameSync(root, path.join(state, 'failed-' + tx.id));
          fs.renameSync(tx.previous, root);
        }
        if (tx.wasRunning) {
          const result = await host.start({ root, smoke: tx.oldMode === 'smoke' }, { updateToken: tx.token });
          requireThat(result.health === true, 'rollback-start-failed');
        }
        atomicJson(path.join(root,'installation.json'),{...readJson(path.join(root,'installation.json')),ready:true});
        save('rolled-back');
        const result = { code, rollback: 'restored-previous-executable', installedSha: tx.installedSha, candidateSha: tx.candidateSha, productionDeployed: false };
        atomicJson(path.join(state, 'receipt.json'), result); return result;
      } catch (rollbackError) {
        tx.failureCode = code; tx.rollbackFailure = safeError(rollbackError); save('recovery-required');
        return { code: 'update-recovery-required', failure: code, rollback: tx.rollbackFailure, newStartsBlocked: true, existingProcessVerifiedStopped: false, productionDeployed: false };
      }
    }
    if (tx && !TERMINAL.has(tx.phase)) { tx.failureCode = code; save('recovery-required'); }
    const result={code,checkedAt:new Date().toISOString(),productionDeployed:false};
    atomicJson(path.join(state,'last-check.json'),result);
    return result;
  } finally { unlock(); }
}
function parseArgs(args) {
  const action = args[0] || 'check'; requireThat(['check', 'apply', 'status', 'pause', 'resume'].includes(action), 'update-usage');
  let root = path.join(os.homedir(), '.tian-shu-local'), approveSensitive;
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]; requireThat(!seen.has(flag), 'update-usage'); seen.add(flag);
    if (flag === '--home') root = args[++i];
    else if (flag === '--approve-sensitive' && action === 'apply') { approveSensitive = args[++i]; requireThat(SHA.test(approveSensitive), 'update-usage'); }
    else fail('update-usage');
  }
  privatePath(root); return { action, root, approveSensitive };
}
async function main(args) { try { return await update(parseArgs(args), { token: process.env.GITHUB_TOKEN }); } catch (error) { return { code: safeError(error), productionDeployed: false }; } }
if (require.main === module) main(process.argv.slice(2)).then(result => { process.stdout.write(JSON.stringify(result) + '\n'); if (!['no-update', 'update-available', 'local-update-installed', 'update-status', 'updates-paused', 'updates-resumed'].includes(result.code)) process.exitCode = 2; });
module.exports = { update, main, parseArgs, discover, ciGate, sensitiveChange, verifyPackage, prepareCandidate, privateStateManifest, treeManifest, acquireLock, installedAssets };
