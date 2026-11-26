'use strict';
// Isolated HTTP evidence: no live accounts, prices, model approvals or network suppliers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const source = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const freePort = () => new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    listener.close(() => resolve(port));
  });
});
function request(port, url, {token = '', headers = {}, method = 'GET'} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path: url, method, timeout: 10000,
      headers: {...headers, ...(token ? {Authorization: 'Bearer ' + token} : {})}}, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({status: res.statusCode, headers: res.headers, body: JSON.parse(raw)}); }
        catch { reject(Error('isolated HTTP returned a non-JSON body')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('isolated HTTP request timed out')));
    req.end();
  });
}

test('原研究治理 HTTP 复用编辑者权限和双端来源，GET 不改档案或连接供应商', {timeout: 40000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fayo-governance-http-'));
  let child, logs = '';
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
  };
  try {
    const copy = name => fs.cpSync(path.join(source, name), path.join(dir, name), {recursive: true});
    for (const name of ['src', 'scripts', 'strategies', 'public', 'config', 'package.json']) copy(name);
    for (const name of fs.readdirSync(source)) if (name.endsWith('.js')) copy(name);
    const editor = crypto.randomBytes(32).toString('hex');
    const viewer = crypto.randomBytes(32).toString('hex');
    const account = () => {
      const salt = crypto.randomBytes(16).toString('hex');
      return {salt, hash: crypto.scryptSync('isolated-test-password', salt, 32).toString('hex'), devices: {}};
    };
    const access = account();
    access.view = account();
    access.devices[hash(editor)] = {role: 'edit', name: 'isolated editor', ts: Date.now()};
    access.view.devices[hash(viewer)] = {role: 'view', name: 'isolated viewer', ts: Date.now()};
    fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify(access));

    const researchRoot = path.join(dir, 'private-research');
    fs.mkdirSync(researchRoot, {mode: 0o700});
    const {shortlineJob} = await import('../src/research/shortline/store.mjs');
    const initial = (await shortlineJob({root: researchRoot, book: 'main'})).state;
    const state = structuredClone(initial);
    delete state.catalog;
    delete state.permissions;
    state.revision = 7;
    state.notes = [{id: 'private-note', text: 'PRIVATE_NOTE_MUST_NOT_APPEAR_IN_GOVERNANCE'}];
    const archiveFile = path.join(researchRoot, 'research.json');
    fs.writeFileSync(archiveFile, JSON.stringify({digest: hash(JSON.stringify(state)), state}), {mode: 0o600});
    const before = fs.readFileSync(archiveFile);
    const historyRoot = path.join(dir, 'unused-center-history');
    const guard = path.join(dir, 'reads-started');
    const mutations = path.join(dir, 'unexpected-write.log');
    const egress = path.join(dir, 'unexpected-egress.log');
    const preload = path.join(dir, 'guard.cjs');
    fs.writeFileSync(preload, `
const fs=require('node:fs'),exists=fs.existsSync.bind(fs),append=fs.appendFileSync.bind(fs);
const guard=${JSON.stringify(guard)},mutations=${JSON.stringify(mutations)},egress=${JSON.stringify(egress)};
const deny=name=>{append(egress,name+'\\n');throw Error('isolated governance forbids egress');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>deny(name);}
const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=()=>deny('socket');
require('node:tls').connect=()=>deny('tls');global.fetch=()=>Promise.reject(deny('fetch'));
const block=name=>{append(mutations,name+'\\n');throw Error('isolated governance reads forbid writes');};
for(const name of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmdirSync','rmSync','linkSync','symlinkSync','truncateSync','chmodSync','writeSync']){const original=fs[name];fs[name]=function(...args){if(exists(guard))block(name);return original.apply(this,args);};}
for(const name of ['writeFile','appendFile','rename','unlink','mkdir','rmdir','rm','link','symlink','truncate','chmod']){const original=fs.promises[name];fs.promises[name]=async function(...args){if(exists(guard))block(name);return original.apply(this,args);};}
const writes=flags=>typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):!/^rs?$/.test(flags);
const open=fs.openSync;fs.openSync=function(file,flags,...args){if(exists(guard)&&writes(flags))block('open-write');return open.call(this,file,flags,...args);};
const promiseOpen=fs.promises.open;fs.promises.open=async function(file,flags,...args){if(exists(guard)&&writes(flags))block('promise-open-write');return promiseOpen.call(this,file,flags,...args);};
`);
    const port = await freePort();
    child = spawn(process.execPath, ['--require', preload, 'server.js'], {cwd: dir,
      env: {...process.env, PORT: String(port), HOST: '127.0.0.1', QD_CLOUD: '1', V6_ISOLATED_BOOT_SMOKE: '1',
        V6_SHORTLINE_DIR: researchRoot, V6_CENTER_HISTORY_DIR: historyRoot}, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.on('data', value => logs += value);
    child.stderr.on('data', value => logs += value);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw Error('isolated server exited: ' + logs.slice(-1200));
      try { if ((await request(port, '/api/lock/status')).status === 200) { ready = true; break; } } catch {}
      await delay(50);
    }
    assert.equal(ready, true, 'isolated server booted');
    fs.writeFileSync(guard, 'readonly HTTP phase');
    for (const token of ['', viewer]) {
      const denied = await request(port, '/api/decision-center/research', {token});
      assert.notEqual(denied.body.ok, true);
      assert.equal(denied.body.result, undefined);
    }
    const priorRisk = await request(port, '/api/research/risk-center', {token: editor});
    assert.equal(priorRisk.body.ok, true);
    assert.equal(priorRisk.body.result.strategyDecay.status, 'unknown');
    assert.equal(priorRisk.body.result.strategyDecay.sourceFingerprint, null);
    const [desktop, mobile] = await Promise.all([
      request(port, '/api/decision-center/research', {token: editor, headers: {'User-Agent': 'isolated-desktop'}}),
      request(port, '/api/decision-center/research?book=demo&root=/etc&now=1', {token: editor,
        headers: {'User-Agent': 'isolated-mobile', 'x-v6-research-book': 'demo'}})
    ]);
    for (const response of [desktop, mobile]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true, JSON.stringify(response.body));
      assert.match(response.headers['cache-control'], /no-store/);
      const report = response.body.result;
      assert.equal(report.authority, 'fayo-intelligence-research');
      assert.equal(report.feedback.archiveRevision, 7);
      assert.equal(report.governance.schemaVersion, 1);
      assert.equal(report.governance.canTrade, false);
      assert.equal(report.governance.canApprove, false);
      assert.equal(report.governance.productionWeightsChanged, false);
      assert.equal(report.governance.decay.verifiedDecay, false);
      assert.equal(report.governance.probability.calibrationCertified, false);
      assert.equal(report.governance.modelComparison.reviewSupported, false);
      const probability = report.governance.probabilityResearch;
      assert.equal(probability.schemaVersion, 1);
      assert.equal(probability.mode, 'fayo-probability-journal-v1');
      assert.equal(probability.scope, 'formal');
      assert.equal(probability.status, 'missing-evidence');
      assert.equal(probability.registeredPlans, 0);
      assert.equal(probability.predictions, 0);
      assert.equal(probability.outcomes, 0);
      assert.deepEqual(probability.plans, []);
      assert.equal(probability.calibrationCertified, false);
      assert.equal(probability.canTrade, false);
      assert.equal(probability.canApprove, false);
      assert.equal(JSON.stringify(response.body).includes(state.notes[0].text), false);
      assert.equal(JSON.stringify(response.body).includes(researchRoot), false);
    }
    assert.equal(desktop.body.result.day, mobile.body.result.day);
    assert.deepEqual(desktop.body.result.governance.probability, mobile.body.result.governance.probability);
    const risk = await request(port, '/api/research/risk-center', {token: editor});
    assert.equal(risk.body.ok, true);
    assert.match(risk.headers['cache-control'], /no-store/);
    const projection = risk.body.result.strategyDecay;
    assert.equal(projection.verifiedDecay, false);
    assert.equal(projection.estimate, null);
    assert.ok(projection.evidenceAsOf <= risk.body.result.generatedAt);
    const reports = [desktop.body.result, mobile.body.result];
    const referenced = reports.find(report => report.fingerprint === projection.sourceFingerprint);
    assert.ok(referenced, 'risk observation references a real authorized report');
    assert.equal(projection.evidenceAsOf, referenced.governance.asOf);
    assert.equal(JSON.stringify(risk.body).includes(state.notes[0].text), false);
    assert.equal(JSON.stringify(risk.body).includes(researchRoot), false);
    assert.deepEqual(fs.readFileSync(archiveFile), before);
    assert.deepEqual(fs.readdirSync(researchRoot), ['research.json']);
    assert.equal(fs.existsSync(historyRoot), false);
    assert.equal(fs.existsSync(mutations), false, 'GET did not write files');
    assert.equal(fs.existsSync(egress), false, 'GET did not contact suppliers');
  } finally {
    await stop();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
