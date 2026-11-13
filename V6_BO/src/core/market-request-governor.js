'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomBytes} = require('node:crypto');

// One instance owns physical request starts for a supplier family. Callers must
// also put every retry and transport fallback through run(), then check the HTTP
// response before interpreting its body. This module never performs network I/O.
const RESTRICTION_CODE = 'MARKET_RESTRICTED';
const FAMILIES = new Set(['eastmoney', 'tencent', 'sina', 'ths', 'other']);
const MAX_STATE_BYTES = 16384;
const belongsTo = (host, domain) => host === domain || host.endsWith('.' + domain);

function providerFor(target) {
  let host;
  try { host = new URL(target).hostname.toLowerCase(); }
  catch { throw new TypeError('Invalid market request URL'); }
  if (belongsTo(host, 'eastmoney.com')) return 'eastmoney';
  if (['gtimg.cn', 'gtimg.com', 'qq.com'].some(domain => belongsTo(host, domain))) return 'tencent';
  if (['sinajs.cn', 'sina.com.cn', 'sina.cn'].some(domain => belongsTo(host, domain))) return 'sina';
  if (belongsTo(host, '10jqka.com.cn')) return 'ths';
  // Unknown hosts share a conservative bucket; changing a hostname does not
  // create an unlimited collection of independent queues.
  return 'other';
}

function isMarketRestrictionError(error) {
  return !!error && error.code === RESTRICTION_CODE;
}

function restrictionError(provider, status, resumeAt) {
  return Object.assign(new Error('Market supplier temporarily restricted'), {
    name: 'MarketRestrictionError', code: RESTRICTION_CODE,
    provider, status, statusCode: status, resumeAt
  });
}

function unavailableError(provider) {
  const error = restrictionError(provider, null, Number.MAX_SAFE_INTEGER);
  error.message = 'Market request state unavailable';
  error.stateUnavailable = true;
  return error;
}

function checkOwner(stat) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw Error('Invalid state owner');
}

// Validate every existing path component so a symlink cannot move private state
// into another tree. Only the final private directory must have mode 0700;
// existing ancestors such as /tmp and the home directory may have normal modes.
function checkStateDirectory(stateFile, create) {
  if (typeof stateFile !== 'string' || !path.isAbsolute(stateFile)) throw Error('Invalid state path');
  const dir = path.dirname(stateFile), root = path.parse(dir).root;
  let current = root;
  for (const part of dir.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return false;
      try { fs.mkdirSync(current, {mode: 0o700}); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Invalid state directory');
    if (current === dir) {
      checkOwner(stat);
      if ((stat.mode & 0o777) !== 0o700) throw Error('Invalid state directory permissions');
    }
  }
  if (dir === root) throw Error('State directory must be private');
  return true;
}

function readPrivateState(stateFile, {ownLock = false} = {}) {
  if (!checkStateDirectory(stateFile, false)) return {};
  if (!ownLock) {
    let lockExists = false;
    try { fs.lstatSync(stateFile + '.lock'); lockExists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // A crash may leave the lock before the first cooldown has been published.
    // Its absence from cooldown.json must not look like a fresh installation.
    if (lockExists) throw Error('State write lock requires operator inspection');
  }
  let stat;
  try { stat = fs.lstatSync(stateFile); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw Error('Invalid state file');
  checkOwner(stat);
  if ((stat.mode & 0o777) !== 0o600 || stat.size > MAX_STATE_BYTES) throw Error('Invalid state file permissions or size');
  let descriptor;
  try {
    descriptor = fs.openSync(stateFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor);
    checkOwner(opened);
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600 ||
        opened.size > MAX_STATE_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) throw Error('Invalid opened state file');
    const input = fs.readFileSync(descriptor, 'utf8');
    if (Buffer.byteLength(input) > MAX_STATE_BYTES) throw Error('State file too large');
    const parsed = JSON.parse(input);
    if (!parsed || parsed.schemaVersion !== 1 || Object.keys(parsed).some(key => !['schemaVersion', 'providers'].includes(key)) ||
        !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) throw Error('Invalid state schema');
    const result = {};
    for (const [family, value] of Object.entries(parsed.providers)) {
      if (!FAMILIES.has(family) || !value || Object.keys(value).some(key => !['blockedUntil', 'status'].includes(key)) ||
          !Number.isSafeInteger(value.blockedUntil) || value.blockedUntil < 1 || ![403, 429].includes(value.status)) throw Error('Invalid provider state');
      result[family] = {blockedUntil: value.blockedUntil, status: value.status};
    }
    return result;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function queueError(code) {
  return Object.assign(new Error(code === 'MARKET_QUEUE_FULL'
    ? 'Market request queue is full' : 'Market request queue wait expired'), {code});
}

function retryAfterMs(headers, at) {
  let value;
  if (headers && typeof headers.get === 'function') value = headers.get('retry-after');
  else if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find(name => name.toLowerCase() === 'retry-after');
    if (key) value = headers[key];
  }
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const text = String(value).trim();
  const milliseconds = /^\d+(?:\.\d+)?$/.test(text)
    ? Number(text) * 1000 : Date.parse(text) - at;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= Number.MAX_SAFE_INTEGER - at
    ? Math.ceil(milliseconds) : 0;
}

function createMarketRequestGovernor({
  now = Date.now, setTimeout: setTimer = global.setTimeout,
  clearTimeout: clearTimer = global.clearTimeout,
  minIntervalMs = 1000, maxActive = 1, maxQueue = 100, maxWaitMs = 30000,
  cooldown429Ms = 60000, cooldown403Ms = 15 * 60 * 1000,
  stateFile = null
} = {}) {
  if (typeof stateFile === 'string') stateFile = path.normalize(stateFile);
  if ([now, setTimer, clearTimer].some(fn => typeof fn !== 'function')) throw new TypeError('Invalid market request clock');
  for (const [name, value, minimum] of [
    ['minIntervalMs', minIntervalMs, 0], ['maxActive', maxActive, 1],
    ['maxQueue', maxQueue, 0], ['maxWaitMs', maxWaitMs, 1],
    ['cooldown429Ms', cooldown429Ms, 60000], ['cooldown403Ms', cooldown403Ms, 900000]
  ]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError('Invalid market request option: ' + name);
  }
  const buckets = new Map();
  let stateUnavailable = false;
  function bucketFor(provider) {
    if (!buckets.has(provider)) buckets.set(provider, {
      provider, active: 0, queue: [], lastStartAt: null,
      cooldownUntil: 0, restrictionStatus: null, timer: null
    });
    return buckets.get(provider);
  }
  function cancelTimer(bucket) {
    if (bucket.timer !== null) clearTimer(bucket.timer);
    bucket.timer = null;
  }
  function startsAt(bucket) {
    return bucket.lastStartAt === null ? -Infinity : bucket.lastStartAt + minIntervalMs;
  }
  function rejectRestrictedQueue(bucket) {
    cancelTimer(bucket);
    for (const item of bucket.queue.splice(0)) item.reject(restrictionError(
      bucket.provider, bucket.restrictionStatus, bucket.cooldownUntil));
  }
  function failClosed() {
    stateUnavailable = true;
    for (const bucket of buckets.values()) {
      cancelTimer(bucket);
      for (const item of bucket.queue.splice(0)) item.reject(unavailableError(bucket.provider));
    }
  }
  function mergeState(providers) {
    for (const [family, value] of Object.entries(providers)) {
      const bucket = bucketFor(family);
      if (value.blockedUntil > bucket.cooldownUntil) {
        bucket.cooldownUntil = value.blockedUntil;
        bucket.restrictionStatus = value.status;
      }
    }
  }
  function refreshState() {
    if (stateUnavailable) return false;
    if (stateFile === null) return true;
    try { mergeState(readPrivateState(stateFile)); return true; }
    catch { failClosed(); return false; }
  }
  function persistRestriction() {
    if (stateFile === null) return;
    let lockDescriptor, temporary, temporaryDescriptor;
    const lockFile = stateFile + '.lock';
    try {
      checkStateDirectory(stateFile, true);
      // Serialize only restriction writes. An existing/stale lock fails closed;
      // it is never stolen and is not a cross-process request-start budget.
      lockDescriptor = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT |
        fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      fs.fchmodSync(lockDescriptor, 0o600);
      mergeState(readPrivateState(stateFile, {ownLock: true}));
      const providers = {};
      for (const [family, bucket] of buckets) if (bucket.cooldownUntil > 0) {
        providers[family] = {blockedUntil: bucket.cooldownUntil, status: bucket.restrictionStatus};
      }
      const output = JSON.stringify({schemaVersion: 1, providers});
      if (Buffer.byteLength(output) > MAX_STATE_BYTES) throw Error('State output too large');
      temporary = path.join(path.dirname(stateFile), '.cooldown-' + process.pid + '-' + randomBytes(12).toString('hex') + '.tmp');
      temporaryDescriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT |
        fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      fs.fchmodSync(temporaryDescriptor, 0o600);
      fs.writeFileSync(temporaryDescriptor, output, 'utf8');
      fs.fsyncSync(temporaryDescriptor);
      fs.closeSync(temporaryDescriptor); temporaryDescriptor = undefined;
      fs.renameSync(temporary, stateFile); temporary = undefined;
    } catch { failClosed(); }
    finally {
      // Cleanup errors must not turn a restriction into an ordinary transport
      // failure that could activate a caller's source fallback.
      try {
        if (temporaryDescriptor !== undefined) fs.closeSync(temporaryDescriptor);
        if (temporary !== undefined) fs.unlinkSync(temporary);
        if (lockDescriptor !== undefined) { fs.closeSync(lockDescriptor); fs.unlinkSync(lockFile); }
      } catch { failClosed(); }
    }
  }
  function start(bucket, item, at) {
    if (!refreshState()) { item.reject(unavailableError(bucket.provider)); return; }
    at = now();
    if (at < bucket.cooldownUntil) {
      item.reject(restrictionError(bucket.provider, bucket.restrictionStatus, bucket.cooldownUntil));
      rejectRestrictedQueue(bucket); return;
    }
    if (at >= item.deadline) { item.reject(queueError('MARKET_QUEUE_TIMEOUT')); return; }
    // Reservation and invocation are synchronous: concurrent callers cannot all
    // observe the same old lastStartAt and wake into a burst.
    bucket.active++;
    bucket.lastStartAt = at;
    let result;
    try { result = item.task(); }
    catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(
      value => { bucket.active--; item.resolve(value); pump(bucket); },
      error => { bucket.active--; item.reject(error); pump(bucket); }
    );
  }
  function pump(bucket) {
    cancelTimer(bucket);
    if (!refreshState()) return;
    let at = now();
    if (at < bucket.cooldownUntil) { rejectRestrictedQueue(bucket); return; }
    // Deadlines are checked at dispatch, including after an event-loop stall.
    // Expired work is discarded, never sent late to the supplier.
    for (let i = 0; i < bucket.queue.length;) {
      if (at >= bucket.queue[i].deadline) bucket.queue.splice(i, 1)[0].reject(queueError('MARKET_QUEUE_TIMEOUT'));
      else i++;
    }
    while (bucket.queue.length && bucket.active < maxActive && at >= startsAt(bucket)) {
      start(bucket, bucket.queue.shift(), at);
      at = now();
      if (stateUnavailable) return;
      // A task can synchronously discover a restriction in checkResponse().
      if (at < bucket.cooldownUntil) { rejectRestrictedQueue(bucket); return; }
    }
    if (!bucket.queue.length) return;
    const deadline = Math.min(...bucket.queue.map(item => item.deadline));
    const wakeAt = bucket.active < maxActive ? Math.min(deadline, startsAt(bucket)) : deadline;
    // Node caps long timer durations. Waking early is safe because pump rechecks.
    bucket.timer = setTimer(() => { bucket.timer = null; pump(bucket); }, Math.min(0x7fffffff, Math.max(0, wakeAt - at)));
  }
  function run(target, task) {
    let provider;
    try {
      provider = providerFor(target);
      if (typeof task !== 'function') throw new TypeError('Market request task must be a function');
    } catch (error) { return Promise.reject(error); }
    const bucket = bucketFor(provider), at = now();
    if (!refreshState()) return Promise.reject(unavailableError(provider));
    if (at < bucket.cooldownUntil) return Promise.reject(restrictionError(provider, bucket.restrictionStatus, bucket.cooldownUntil));
    return new Promise((resolve, reject) => {
      const item = {task, resolve, reject, deadline: at + maxWaitMs};
      if (!bucket.queue.length && bucket.active < maxActive && at >= startsAt(bucket)) {
        start(bucket, item, at);
      } else if (bucket.queue.length >= maxQueue) reject(queueError('MARKET_QUEUE_FULL'));
      else { bucket.queue.push(item); pump(bucket); }
    });
  }
  function checkResponse(target, status, headers) {
    const provider = providerFor(target);
    if (status !== 429 && status !== 403) return;
    if (!refreshState()) throw unavailableError(provider);
    const bucket = bucketFor(provider), at = now();
    const minimum = status === 429 ? cooldown429Ms : cooldown403Ms;
    bucket.cooldownUntil = Math.max(bucket.cooldownUntil, at + Math.max(minimum, retryAfterMs(headers, at)));
    bucket.restrictionStatus = status;
    rejectRestrictedQueue(bucket);
    persistRestriction();
    if (stateUnavailable) throw unavailableError(provider);
    throw restrictionError(provider, status, bucket.cooldownUntil);
  }
  function state(target) {
    const provider = providerFor(target), bucket = buckets.get(provider);
    // A detached, frozen snapshot contains no URL, query, credentials or headers.
    return Object.freeze({
      provider, active: bucket ? bucket.active : 0, queued: bucket ? bucket.queue.length : 0,
      cooldownUntil: stateUnavailable ? Number.MAX_SAFE_INTEGER : bucket ? bucket.cooldownUntil : 0,
      cooldownLeftMs: stateUnavailable ? Number.MAX_SAFE_INTEGER : bucket ? Math.max(0, bucket.cooldownUntil - now()) : 0,
      lastStartAt: bucket ? bucket.lastStartAt : null, stateUnavailable
    });
  }
  refreshState();
  return Object.freeze({run, checkResponse, state});
}

const configuredDirectory = process.env.V6_MARKET_REQUEST_STATE_DIR;
const singletonStateFile = configuredDirectory
  ? path.isAbsolute(configuredDirectory) ? path.join(configuredDirectory, 'cooldown.json') : 'invalid-state-directory'
  : path.join(os.homedir(), '.v6-private', 'market-requests', 'cooldown.json');
const marketRequests = createMarketRequestGovernor({stateFile: singletonStateFile});
module.exports = {marketRequests, createMarketRequestGovernor, isMarketRestrictionError};
