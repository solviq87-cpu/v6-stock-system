'use strict';

// Immutable, hash-linked research batches. This store never opens an account or
// sends a notification. Committed trigger IDs mean observed, never delivered.
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path'), crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {validateObservation, alertsForRecord, MAX_RECORDS} = require('./paper-plan-observer');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seal = value => ({...value, fingerprint: hash(value)});
const validDay = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const validTime = n => Number.isSafeInteger(n) && n > 0 && n < 8e15;
const validHash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const validFile = s => typeof s === 'string' && /^\d{8}-[a-f0-9]{64}\.json$/.test(s);
const MAX_BATCHES = 10000, MAX_BATCH_BYTES = 4 * 1024 * 1024, MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

async function privateDirectory(dir, create = false) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) throw Error('计划观察需要私有绝对目录');
  const root = path.resolve(dir);
  if (root === path.parse(root).root || root.split(path.sep).some(x => x.toLowerCase() === 'public')) throw Error('计划观察禁止存入公开目录');
  let cursor = path.parse(root).root;
  for (const part of root.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { const st = await fsp.lstat(cursor); if (!st.isDirectory() || st.isSymbolicLink()) throw Error('计划观察目录含符号链接或非目录'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (create) await fsp.mkdir(root, {recursive: true, mode: 0o700});
  try { const st = await fsp.lstat(root); if ((st.mode & 0o077) !== 0) throw Error('计划观察目录必须为私有0700'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return root;
}

async function readJson(file, maxBytes, missing = null) {
  let handle;
  try {
    handle = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const st = await handle.stat();
    if (!st.isFile() || st.size > maxBytes || (st.mode & 0o077) !== 0) throw Error('计划观察文件权限、类型或大小无效');
    const result = JSON.parse(await handle.readFile('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('计划观察文件格式无效');
    const {fingerprint, ...payload} = result;
    if (!validHash(fingerprint) || hash(payload) !== fingerprint) throw Error('计划观察文件指纹不一致');
    return result;
  } catch (error) { if (error.code === 'ENOENT') return missing; throw error; }
  finally { if (handle) await handle.close(); }
}

async function writeJson(file, value, immutable = false) {
  const data = JSON.stringify(value) + '\n', temp = file + '.' + crypto.randomBytes(10).toString('hex') + '.tmp';
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600); await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
    if (immutable) {
      try { await fsp.link(temp, file); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // A crash or role change may leave an unreferenced immutable batch.
        // Reuse only identical evidence; never overwrite or silently repair it.
        const previous = await readJson(file, MAX_BATCH_BYTES);
        if (JSON.stringify(previous) !== JSON.stringify(value)) throw Error('计划观察未提交批次内容冲突');
      }
    } else await fsp.rename(temp, file);
  } finally { if (handle) await handle.close(); await fsp.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function guarded(file, fn) {
  const handle = await fsp.open(file, fs.constants.O_CREAT | fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    const st = await handle.stat();
    if (!st.isFile() || (st.mode & 0o077) !== 0) throw Error('计划观察进程锁无效');
    await new Promise((resolve, reject) => {
      const child = spawn('flock', ['-n', '3'], {stdio: ['ignore', 'ignore', 'ignore', handle.fd]});
      child.once('error', () => reject(Error('计划观察存储需要系统flock锁')));
      child.once('close', code => code === 0 ? resolve() : reject(Error('计划观察存储正由另一写者更新')));
    });
    return await fn();
  } finally { await handle.close(); }
}

function empty(day) { return {schemaVersion: 1, day, revision: 0, head: null, recordCount: 0, latest: {}, alertIds: [], researchOnly: true, accountMutated: false}; }
function manifestValid(m, day) {
  if (m.schemaVersion !== 1 || m.day !== day || !Number.isSafeInteger(m.revision) || m.revision < 0 || m.revision > MAX_BATCHES ||
      !Number.isSafeInteger(m.recordCount) || m.recordCount < 0 || m.recordCount > MAX_RECORDS ||
      m.researchOnly !== true || m.accountMutated !== false || !m.latest || typeof m.latest !== 'object' || Array.isArray(m.latest) ||
      !Array.isArray(m.alertIds) || m.alertIds.length > 10000 || new Set(m.alertIds).size !== m.alertIds.length || m.alertIds.some(id => !validHash(id)) ||
      (m.revision === 0 ? m.head !== null : !validFile(m.head?.file) || !validHash(m.head?.fingerprint))) throw Error('计划观察目录清单无效');
  for (const [id, last] of Object.entries(m.latest)) if (!/^plan-[0-9a-f-]{36}$/.test(id) || !validHash(last?.planVersion) ||
      !validHash(last?.fingerprint) || !validTime(last?.observedAt)) throw Error('计划观察版本索引无效');
  return m;
}

function createPaperPlanObservationStore({root, clock = Date.now, canWrite = () => false} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof clock !== 'function' || typeof canWrite !== 'function') throw Error('计划观察存储配置无效');
  let queue = Promise.resolve();
  const allowed = () => { if (canWrite() !== true) throw Error('仅原主实例可追加计划研究观察'); };
  async function appendInner({records = [], alerts = [], now = clock()} = {}) {
    if (!Array.isArray(records) || !Array.isArray(alerts) || records.length > 1000 || alerts.length > 3000 ||
        !validTime(now) || now > clock() || clock() - now > 15000) throw Error('计划观察追加批次或时钟无效');
    if (!records.length) { if (alerts.length) throw Error('触发事件缺少原始观察'); return {added: 0, duplicate: 0, alerts: []}; }
    const day = records[0]?.day, byId = new Map();
    for (const record of records) {
      validateObservation(record, {now, day});
      if (record.observedAt !== now) throw Error('禁止补写历史计划观察时点');
      if (byId.has(record.planId)) throw Error('同一批次冻结计划重复');
      byId.set(record.planId, record);
    }
    const expectedAlerts = records.flatMap(alertsForRecord);
    if (JSON.stringify(alerts) !== JSON.stringify(expectedAlerts)) throw Error('触发事件与原始观察不一致');
    allowed(); const base = await privateDirectory(root, true); allowed();
    const dir = await privateDirectory(path.join(base, day), true);
    return guarded(path.join(dir, 'writer.guard'), async () => {
      const file = path.join(dir, 'manifest.json');
      const before = manifestValid(await readJson(file, MAX_MANIFEST_BYTES, empty(day)), day);
      allowed();
      if (before.head) {
        const head = await readJson(path.join(dir, before.head.file), MAX_BATCH_BYTES);
        if (!head || head.fingerprint !== before.head.fingerprint || head.revision !== before.revision || head.day !== day)
          throw Error('计划观察末批证据缺失或损坏');
      }
      const added = [], latest = {...before.latest};
      for (const record of records) {
        const last = latest[record.planId];
        if (last && last.planVersion !== record.planVersion) throw Error('冻结计划版本已改变，拒绝拼接观察');
        if (last?.fingerprint === record.fingerprint) continue;
        if (last && record.observedAt <= last.observedAt) throw Error('计划观察重放或时点倒序');
        added.push(record); latest[record.planId] = {planVersion: record.planVersion, fingerprint: record.fingerprint, observedAt: record.observedAt};
      }
      if (!added.length) return {added: 0, duplicate: records.length, alerts: []};
      if (before.recordCount + added.length > MAX_RECORDS || before.revision >= MAX_BATCHES) throw Error('单日计划观察已达存储上限，保留证据并停止追加');
      const known = new Set(before.alertIds), addedIds = new Set(added.map(r => r.fingerprint));
      const freshAlerts = expectedAlerts.filter(a => addedIds.has(a.observationId) && !known.has(a.id));
      for (const alert of freshAlerts) known.add(alert.id);
      const revision = before.revision + 1;
      const chunk = seal({schemaVersion: 1, day, revision, previous: before.head, records: added, alerts: freshAlerts,
        researchOnly: true, accountMutated: false});
      const name = String(revision).padStart(8, '0') + '-' + chunk.fingerprint + '.json';
      if (Buffer.byteLength(JSON.stringify(chunk)) > MAX_BATCH_BYTES) throw Error('计划观察批次超过大小上限');
      allowed(); await writeJson(path.join(dir, name), chunk, true);
      const next = seal({schemaVersion: 1, day, revision, head: {file: name, fingerprint: chunk.fingerprint},
        recordCount: before.recordCount + added.length, latest, alertIds: [...known], researchOnly: true, accountMutated: false});
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_MANIFEST_BYTES) throw Error('计划观察索引超过大小上限');
      allowed(); await writeJson(file, next);
      const directory = await fsp.open(dir, 'r'); try { await directory.sync(); } finally { await directory.close(); }
      return {added: added.length, duplicate: records.length - added.length, alerts: freshAlerts};
    });
  }
  function append(input) {
    const run = queue.then(() => appendInner(input));
    queue = run.catch(() => {});
    return run;
  }
  async function read({day, now = clock()} = {}) {
    if (!validDay(day) || !validTime(now)) throw Error('计划观察读取日期或时点无效');
    const base = await privateDirectory(root), dir = await privateDirectory(path.join(base, day));
    const manifest = manifestValid(await readJson(path.join(dir, 'manifest.json'), MAX_MANIFEST_BYTES, empty(day)), day);
    let head = manifest.head, revision = manifest.revision, count = 0;
    const batches = [];
    while (head) {
      if (!validFile(head.file) || !validHash(head.fingerprint)) throw Error('计划观察批次引用无效');
      const chunk = await readJson(path.join(dir, head.file), MAX_BATCH_BYTES);
      if (!chunk || chunk.fingerprint !== head.fingerprint || chunk.schemaVersion !== 1 || chunk.day !== day || chunk.revision !== revision ||
          chunk.researchOnly !== true || chunk.accountMutated !== false || !Array.isArray(chunk.records) || !chunk.records.length ||
          !Array.isArray(chunk.alerts)) throw Error('计划观察历史批次缺失或损坏');
      for (const record of chunk.records) validateObservation(record, {now, day});
      const derived = new Map(chunk.records.flatMap(alertsForRecord).map(a => [a.id, a]));
      for (const alert of chunk.alerts) if (JSON.stringify(alert) !== JSON.stringify(derived.get(alert.id))) throw Error('计划预警与报价证据不一致');
      count += chunk.records.length;
      if (count > MAX_RECORDS || batches.length >= MAX_BATCHES) throw Error('计划观察历史超过读取上限');
      batches.push(chunk); head = chunk.previous; revision--;
    }
    if (revision !== 0 || count !== manifest.recordCount) throw Error('计划观察历史不连续');
    const records = batches.reverse().flatMap(b => b.records), alerts = batches.flatMap(b => b.alerts);
    const latest = {}, seen = new Set(), ids = new Set();
    for (const record of records) {
      const prior = latest[record.planId];
      if (seen.has(record.fingerprint) || prior && (prior.planVersion !== record.planVersion || prior.observedAt >= record.observedAt))
        throw Error('计划观察有重复或版本错位');
      seen.add(record.fingerprint); latest[record.planId] = {planVersion: record.planVersion, fingerprint: record.fingerprint, observedAt: record.observedAt};
    }
    for (const alert of alerts) { if (ids.has(alert.id)) throw Error('计划触发事件重复'); ids.add(alert.id); }
    if (JSON.stringify(latest) !== JSON.stringify(manifest.latest) || JSON.stringify([...ids].sort()) !== JSON.stringify([...manifest.alertIds].sort()))
      throw Error('计划观察索引与原始证据不一致');
    return {day, records, alerts, revision: manifest.revision, status: records.length ? 'observed' : 'missing',
      note: '触发记录仅证明曾观察到条件，不代表已经发送通知或产生买卖成交'};
  }
  return {append, read};
}

module.exports = {createPaperPlanObservationStore};
