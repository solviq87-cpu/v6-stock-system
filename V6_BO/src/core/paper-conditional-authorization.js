'use strict';

// A queued intent outlives a browser request, not the device's authorization.
// Persist only a signed, plan-bound device digest. Never store a bearer token.
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isPlan = value => typeof value === 'string' && /^plan-[0-9a-f-]{36}$/.test(value);
const validTime = value => Number.isSafeInteger(value) && value > 0;

function createConditionalAuthorizer({getAccess, getMachineKey, isCloud = () => true,
  liveSession = () => false, clock = Date.now}) {
  if (typeof getAccess !== 'function' || typeof getMachineKey !== 'function') throw Error('条件单授权依赖不完整');
  function sign(payload) {
    const key = getMachineKey();
    if (typeof key !== 'string' || key.length < 16) throw Error('原实例签名密钥不可用');
    return crypto.createHmac('sha256', key).update('fayo-paper-intent-v1\n' + JSON.stringify(payload)).digest('hex');
  }
  function revoked(access, principal, now) {
    const entry = access?.revoked?.[principal];
    if (!entry) return false;
    const until = entry && typeof entry === 'object' ? Number(entry.graceUntil) : 0;
    return !(Number.isFinite(until) && until > now);
  }
  function payloadOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'expiresAt,generation,issuedAt,mode,planId,principal,signature,version') return null;
    const {version, mode, principal, generation, planId, issuedAt, expiresAt} = value;
    if (version !== 1 || !['device','local','session'].includes(mode) || !isPlan(planId) ||
        !Number.isSafeInteger(generation) || generation < 0 || !validTime(issuedAt) ||
        (mode === 'local' ? principal !== null : !isDigest(principal)) ||
        (mode === 'session' ? !validTime(expiresAt) || expiresAt <= issuedAt : expiresAt !== null)) return null;
    return {version, mode, principal, generation, planId, issuedAt, expiresAt};
  }
  function verify(authorization, planId, now = clock()) {
    try {
      const payload = payloadOf(authorization), access = getAccess();
      if (!payload || !isDigest(authorization.signature) || payload.planId !== planId ||
          !validTime(now) || payload.issuedAt > now || payload.generation !== Number(access?.gen || 0)) return false;
      if (!crypto.timingSafeEqual(Buffer.from(sign(payload),'hex'), Buffer.from(authorization.signature,'hex'))) return false;
      if (payload.mode === 'local') return !isCloud();
      if (payload.mode === 'session') return now < payload.expiresAt &&
        liveSession(payload.principal, payload.generation, payload.expiresAt, now) === true;
      const record = access?.devices?.[payload.principal];
      return !!record && record.role !== 'view' && !revoked(access, payload.principal, now);
    } catch { return false; }
  }
  function issue({planId, editor, local = false, deviceDigest = null,
    sessionToken = '', sessionExpiresAt = null}, now = clock()) {
    if (editor !== true || !isPlan(planId) || !validTime(now)) throw Error('条件单需要原编辑者权限和有效冻结计划');
    const access = getAccess(), generation = Number(access?.gen || 0);
    if (!Number.isSafeInteger(generation) || generation < 0) throw Error('原设备授权世代无效');
    let mode, principal = null, expiresAt = null;
    if (local && !isCloud()) mode = 'local';
    else if (isDigest(deviceDigest)) { mode = 'device'; principal = deviceDigest; }
    else if (typeof sessionToken === 'string' && sessionToken.length >= 24 && validTime(sessionExpiresAt) && sessionExpiresAt > now) {
      mode = 'session'; principal = digest(sessionToken); expiresAt = sessionExpiresAt;
    } else throw Error('请使用原授权设备登录后创建条件单');
    const payload = {version:1, mode, principal, generation, planId, issuedAt:now, expiresAt};
    const result = {...payload, signature:sign(payload)};
    if (!verify(result, planId, now)) throw Error('原设备授权已撤销或失效');
    return result;
  }
  return {issue, verify};
}

module.exports = {createConditionalAuthorizer};
