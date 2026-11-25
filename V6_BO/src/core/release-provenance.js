'use strict';

// Local integrity is deliberately separate from release approval. A hash
// manifest detects changed bytes; it is not a signature or a CI attestation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {Worker,isMainThread,parentPort,workerData} = require('node:worker_threads');
const workerBudget=require('../server/worker-admission-budget');
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const mutableSeeds = new Set(['themeMap.json', 'external_data.json', 'pushgov.json', 'changes_state.json']);
const safeRelative = name => typeof name === 'string' && name.length < 500 && !/[\\\x00-\x1f:]/.test(name) &&
  !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..');

function regularBytes(file, limit = 8 * 1024 * 1024) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('release-symlink');
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw Error('release-unsafe-file');
    const data = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (data.length > limit || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k]))
      throw Error('release-file-changed');
    return data;
  } finally { fs.closeSync(fd); }
}

function sourceVersions(appRoot) {
  const text = file => { try { return regularBytes(path.join(appRoot, file), 4 * 1024 * 1024).toString('utf8'); } catch { return ''; } };
  const server = text('server.js'), page = text('public/nova/index.html'), sw = text('public/sw.js');
  const appVersion = /\bconst\s+APP_VER\s*=\s*['"]([A-Za-z0-9._-]+)['"]/.exec(server)?.[1] || null;
  const frontendVersion = /<meta\s+name=["']application-version["']\s+content=["']([A-Za-z0-9._-]+)["']/.exec(page)?.[1] || null;
  const frontendRevision = /<meta\s+name=["']frontend-revision["']\s+content=["']([A-Za-z0-9._-]+)["']/.exec(page)?.[1] || null;
  const serviceWorkerVersion = /\bconst\s+APP_VER\s*=\s*['"]([A-Za-z0-9._-]+)['"]/.exec(sw)?.[1] || null;
  const sharedEntry = /if\s*\(fayoEntries\.has\(p\)\)\s*p\s*=\s*['"]\/nova\/index\.html['"]/.test(server);
  return {appVersion, frontendVersion, frontendRevision, serviceWorkerVersion,
    desktopAndMobileShareEntry: sharedEntry,
    compatible: !!(appVersion && frontendRevision && appVersion === frontendVersion && appVersion === serviceWorkerVersion && sharedEntry),
    browserCacheObserved: false, browserPermissionsObserved: false};
}

function sbomSummary(manifest, appRoot) {
  const bom = manifest?.sbom, locked = manifest?.provenance?.dependencyLockSha256;
  if (!bom || bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5' || !Array.isArray(bom.components))
    return {status: 'missing', componentCount: null, lockMatches: null, installedDependenciesVerified: false};
  let lockMatches = false, dependencyVersions = {status:'unavailable',checked:0,missingOptional:0,mismatches:0};
  try {
    const lockBytes=regularBytes(path.join(appRoot, 'package-lock.json'));
    lockMatches = HASH.test(locked || '') && hash(lockBytes) === locked;
    if(lockMatches){
      const lock=JSON.parse(lockBytes),entries=Object.entries(lock.packages||{}).filter(([name])=>name),known=new Set(entries.map(([name])=>name));
      dependencyVersions={status:'matched',checked:0,missingOptional:0,mismatches:0};
      for(const [name,item]of entries){
        if(!safeRelative(name)||!name.startsWith('node_modules/')){dependencyVersions.mismatches++;continue;}
        try{const installed=JSON.parse(regularBytes(path.join(appRoot,name,'package.json'),512*1024));
          if(installed.version!==item.version)dependencyVersions.mismatches++;else dependencyVersions.checked++;
        }catch(error){if(error.code==='ENOENT'&&(item.optional||item.dev))dependencyVersions.missingOptional++;else dependencyVersions.mismatches++;}
      }
      const modules=path.join(appRoot,'node_modules');
      if(fs.existsSync(modules))for(const item of fs.readdirSync(modules,{withFileTypes:true})){
        if(item.name.startsWith('.'))continue;
        if(item.name.startsWith('@')&&item.isDirectory())for(const child of fs.readdirSync(path.join(modules,item.name)))
          {if(!known.has('node_modules/'+item.name+'/'+child))dependencyVersions.mismatches++;}
        else if(!known.has('node_modules/'+item.name))dependencyVersions.mismatches++;
      }
      if(dependencyVersions.mismatches)dependencyVersions.status='mismatch';
    }
  } catch {}
  return {status: lockMatches ? 'lock-inventory-verified' : 'lock-mismatch', componentCount: bom.components.length,
    lockMatches, installedDependenciesVerified: false,
    scope: 'declared-lockfile-components',dependencyVersions,optionalPythonEnvironmentVerified: false};
}

function unexpectedExecutables(appRoot,names){
  let visited=0;
  function walk(dir,prefix){
    if(!fs.existsSync(dir))return false;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(++visited>30000)throw Error('release-source-scan-limit');
      const relative=prefix+'/'+entry.name,full=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('release-symlink');
      if(entry.isDirectory()){if(walk(full,relative))return true;}
      else if(/\.(?:js|mjs|cjs|html|css|wasm|node|py|sh|ps1)$/i.test(relative)&&!names.has(relative))return true;
    }
    return false;
  }
  return ['src','public','scripts','strategies','tools','third_party'].some(dir=>walk(path.join(appRoot,dir),dir));
}

function captureRunningRelease({appRoot = path.resolve(__dirname, '../..'),appVersion}={}) {
  const captured={schemaVersion:1,capturedAt:Date.now(),processId:process.pid,
    appVersion:typeof appVersion==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(appVersion)?appVersion:null,
    sourceSha:null,serverSha256:null,status:'unbound-source',signatureVerified:false};
  if(typeof appRoot!=='string'||!path.isAbsolute(appRoot))return Object.freeze(captured);
  try {
    captured.serverSha256=hash(regularBytes(path.join(appRoot,'server.js'),4*1024*1024));
    if(path.basename(appRoot)==='app'){
      const parent=path.dirname(appRoot),raw=regularBytes(path.join(parent,'source-manifest.json')),
        manifest=JSON.parse(raw),installation=JSON.parse(regularBytes(path.join(parent,'installation.json'),16384));
      const source=manifest.files?.find(f=>f.path==='server.js');
      if(installation.schemaVersion===1&&installation.ready===true&&SHA.test(installation.sourceSha||'')&&
        installation.sourceSha===manifest.sourceSha&&installation.manifestHash===hash(raw)&&source?.sha256===captured.serverSha256){
        captured.sourceSha=manifest.sourceSha;captured.status='captured-installed-source';
      }
    }
  } catch {captured.status='unreadable-source';}
  return Object.freeze(captured);
}

function inspectReleaseProvenance({appRoot = path.resolve(__dirname, '../..'), now = Date.now(),running=null} = {}) {
  const checkedAt = typeof now === 'number' && Number.isFinite(now) ? new Date(now).toISOString() : null;
  const safeRoot = typeof appRoot === 'string' && path.isAbsolute(appRoot);
  const versions = safeRoot ? sourceVersions(appRoot) : {compatible:false};
  const base = {schemaVersion: 1, task: 77, checkedAt, sourceSha: null, status: 'unverified', verifiedInstalled: false,
    versions, signatureVerified: false, ciVerified: false, businessRecordsRestored: false,
    rollbackPolicy: 'preserve-current-business-records-and-revert-program-only'};
  if (!safeRoot) return {...base, reason: 'release-absolute-root-required'};
  const installRoot = path.dirname(appRoot);
  const manifestFile = path.join(installRoot, 'source-manifest.json'), installFile = path.join(installRoot, 'installation.json');
  if (path.basename(appRoot) === 'app' && (fs.existsSync(manifestFile) || fs.existsSync(installFile))) {
    try {
      const raw = regularBytes(manifestFile), manifest = JSON.parse(raw), installation = JSON.parse(regularBytes(installFile, 16384));
      if (installation?.schemaVersion !== 1 || installation.ready !== true || !SHA.test(installation.sourceSha || '') ||
          installation.sourceSha !== manifest.sourceSha || installation.manifestHash !== hash(raw) || manifest.schemaVersion !== 1 ||
          !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 20000) throw Error('release-manifest-invalid');
      const names = new Set(); let checkedFiles = 0;
      for (const item of manifest.files) {
        if (!safeRelative(item?.path) || !HASH.test(item.sha256 || '') || names.has(item.path)) throw Error('release-manifest-invalid');
        names.add(item.path);
        if (mutableSeeds.has(item.path)) continue;
        if (hash(regularBytes(path.join(appRoot, item.path), 64 * 1024 * 1024)) !== item.sha256) throw Error('release-code-mismatch');
        checkedFiles++;
      }
      for (const required of ['server.js', 'package.json', 'package-lock.json', 'public/nova/index.html', 'public/sw.js'])
        if (!names.has(required)) throw Error('release-required-source-missing');
      if(unexpectedExecutables(appRoot,names))throw Error('release-unmanifested-executable');
      const sbom = sbomSummary(manifest, appRoot), provenance = manifest.provenance;
      const provenanceMatches = provenance?.schemaVersion === 1 && provenance.sourceSha === manifest.sourceSha &&
        HASH.test(provenance.builderSha256 || '') && SHA.test(provenance.sourceTree || '');
      const runningMatches=running?.schemaVersion===1&&running.status==='captured-installed-source'&&running.processId===process.pid&&
        Number.isSafeInteger(running.capturedAt)&&running.capturedAt<=now&&running.sourceSha===manifest.sourceSha&&
        running.appVersion===versions.appVersion&&running.serverSha256===manifest.files.find(f=>f.path==='server.js')?.sha256;
      const verifiedInstalled = versions.compatible && sbom.lockMatches === true && provenanceMatches && sbom.dependencyVersions?.status==='matched'&&runningMatches;
      return {...base, sourceSha: manifest.sourceSha, status: verifiedInstalled ? 'verified-local-manifest' : 'incomplete-release-evidence',
        verifiedInstalled, manifestSha256: hash(raw), checkedFiles, sbom,runningMatches,
        running:{appVersion:running?.appVersion||null,sourceSha:SHA.test(running?.sourceSha||'')?running.sourceSha:null,
          capturedAt:Number.isSafeInteger(running?.capturedAt)?running.capturedAt:null},
        sourceCommittedAt: provenance?.sourceCommittedAt || null,
        buildTime: null, buildTimeBasis: 'external-build-receipt',
        reason: verifiedInstalled ? null : !versions.compatible ? 'release-version-mismatch' : !runningMatches ? 'running-source-binding-mismatch-or-missing' : 'release-inventory-or-provenance-missing',
        approval: 'CI-and-release-approval-require-external-receipts'};
    } catch (error) {
      return {...base, status: 'integrity-failed', reason: /^release-/.test(error.message) ? error.message : 'release-evidence-unreadable'};
    }
  }
  // Development checkouts remain useful evidence but never count as deployed
  // and verified installations for the long-running acceptance counter.
  const command = args => spawnSync('git', ['-C', appRoot, ...args], {encoding: 'utf8', timeout: 3000,
    maxBuffer: 64 * 1024, env: {PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0'}});
  try {
    const head = command(['rev-parse', '--verify', 'HEAD']), status = command(['status', '--porcelain', '--untracked-files=normal']);
    const sha = head.stdout?.trim();
    if (head.status === 0 && status.status === 0 && SHA.test(sha)) return {...base, sourceSha: sha,
      status: status.stdout ? 'development-modified' : 'development-source-only',
      reason: 'installed-release-receipt-required', sbom: {status: 'not-built', installedDependenciesVerified: false}};
  } catch {}
  return {...base, reason: 'installed-release-receipt-required'};
}

function inspectReleaseProvenanceAsync({appRoot = path.resolve(__dirname, '../..'), now = Date.now(),running=null} = {}) {
  return new Promise(resolve => {
    const lease=workerBudget.tryAcquire('release-provenance');
    let worker, timer, done = false;
    const finish = async value => { if(done)return;done=true;clearTimeout(timer);if(lease)await lease.stop();resolve(value); };
    const unavailable = () => finish({schemaVersion:1,task:77,status:'verification-unavailable',verifiedInstalled:false,sourceSha:null,
      checkedAt:new Date(now).toISOString(),signatureVerified:false,ciVerified:false,reason:'release-worker-unavailable-or-deadline'});
    if(!lease){void unavailable();return;}
    try {
      const options=lease.options({job:'inspect-release-provenance',appRoot,now,running});
      worker = lease.watch(new Worker(__filename,{...options,resourceLimits:{...options.resourceLimits,maxYoungGenerationSizeMb:16,stackSizeMb:4}}));
      timer=setTimeout(unavailable,8000);timer.unref();
      worker.once('message',finish);worker.once('error',unavailable);worker.once('exit',()=>{if(!done)unavailable();});
    } catch { unavailable(); }
  });
}
if(!isMainThread&&workerData?.job==='inspect-release-provenance')parentPort.postMessage(inspectReleaseProvenance(workerData));

module.exports = {captureRunningRelease,inspectReleaseProvenance, inspectReleaseProvenanceAsync, sourceVersions};
