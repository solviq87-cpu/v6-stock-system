/* V6 CAS-only client. This file does not automatically connect or modify any page. */
(function (root) {
  'use strict';
  const API = '/api/records';
  const TOKEN = /^[A-Za-z0-9._~-]{8,256}$/;
  const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
  const RECORD = /^v6\.[A-Za-z0-9_.-]{1,96}$/;
  function failure(code) { const e = new Error(code); e.code = code; return e; }
  function plain(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function defaultId() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (!c || typeof c.randomUUID !== 'function') throw failure('SECURE_REQUEST_ID_REQUIRED');
    return 'cas_' + c.randomUUID().replace(/-/g, '');
  }
  function createClient({ fetchImpl, getToken, allowMutations = false, requestIdFactory = defaultId } = {}) {
    if (typeof getToken !== 'function' || typeof requestIdFactory !== 'function' ||
        typeof allowMutations !== 'boolean') throw failure('CLIENT_CONFIG_INVALID');
    const transport = fetchImpl || (typeof globalThis !== 'undefined' && globalThis.fetch);
    if (typeof transport !== 'function') throw failure('FETCH_REQUIRED');
    let snapshot = null, tokenAtLoad = null, pending = null, busy = false, blocked = false, epoch = 0;
    function clear() { epoch++; snapshot = null; tokenAtLoad = null; pending = null; blocked = true; }
    function status() {
      return Object.freeze({
        loaded: !!snapshot, revision: snapshot ? snapshot.revision : null,
        pendingWrite: !!pending, busy, blocked, readOnly: !allowMutations,
        accountRecoveryVerified: false, productionDeployed: false
      });
    }
    function token() {
      let value;
      try { value = getToken(); } catch { clear(); throw failure('LOGIN_REQUIRED'); }
      if (typeof value !== 'string' || !TOKEN.test(value)) {
        clear(); throw failure('LOGIN_REQUIRED');
      }
      if (tokenAtLoad !== null && value !== tokenAtLoad) {
        clear(); throw failure('AUTH_CHANGED');
      }
      return value;
    }
    async function send(method, auth, payload, endpoint = API) {
      const options = {
        method, redirect: 'error', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', mode: 'same-origin',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + auth }
      };
      if (method === 'POST') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(payload);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      options.signal = controller.signal;
      let response;
      try { response = await transport(endpoint, options); }
      catch { throw failure('TRANSPORT_UNCERTAIN'); }
      finally { clearTimeout(timer); }
      if (!response || typeof response.status !== 'number') throw failure('TRANSPORT_UNCERTAIN');
      if (response.status === 401) throw failure('LOGIN_REQUIRED');
      if (response.status === 403) throw failure('ACCESS_DENIED');
      if (response.status === 409) throw failure('REVISION_CONFLICT');
      if (response.status !== 200 || response.ok !== true) throw failure('SERVER_UNVERIFIED');
      let data;
      try { data = await response.json(); } catch { throw failure('RESPONSE_INVALID'); }
      if (!plain(data) || data.ok !== true || data.writeContract !== 'cas-v1')
        throw failure('CAS_CONTRACT_REQUIRED');
      return data;
    }
    function validateRead(data) {
      if (!Number.isSafeInteger(data.revision) || data.revision < 1 ||
          !Array.isArray(data.records) || data.records.length > 32)
        throw failure('RECORDS_INVALID');
      const seen = new Set();
      let accountCount = 0;
      const records = data.records.map(row => {
        if (!plain(row) || typeof row.name !== 'string' || !RECORD.test(row.name) ||
            (typeof row.content !== 'string' && !plain(row.content) && !Array.isArray(row.content)) ||
            seen.has(row.name)) throw failure('RECORDS_INVALID');
        seen.add(row.name);
        if (row.name === 'v6.app.state') {
          accountCount++;
          let state;
          try { state = typeof row.content === 'string' ? JSON.parse(row.content) : row.content; }
          catch { throw failure('LEDGER_INVALID'); }
          if (!plain(state) || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
              typeof state.cash !== 'number' || !Number.isFinite(state.cash) ||
              !Array.isArray(state.positions) || !Array.isArray(state.orders))
            throw failure('LEDGER_INVALID');
        }
        return clone(row);
      });
      if (accountCount !== 1) throw failure('LEDGER_MISSING_OR_DUPLICATED');
      return { revision: data.revision, records };
    }
    async function readWith(auth, originalEpoch) {
      const data = await send('GET', auth);
      if (epoch !== originalEpoch) throw failure('AUTH_CHANGED');
      const result = validateRead(data);
      if (token() !== auth || epoch !== originalEpoch) throw failure('AUTH_CHANGED');
      return result;
    }
    async function load() {
      if (busy) throw failure('CLIENT_BUSY');
      if (pending) throw failure('PENDING_WRITE_MUST_BE_RECONCILED');
      busy = true;
      try {
        const auth = token(), originalEpoch = epoch;
        const result = await readWith(auth, originalEpoch);
        snapshot = result; tokenAtLoad = auth; blocked = false;
        return { revision: result.revision, records: clone(result.records), ...status(), busy: false };
      } catch (e) {
        if (!['CLIENT_BUSY', 'PENDING_WRITE_MUST_BE_RECONCILED'].includes(e.code)) {
          // A failed read is never permission to keep treating an old balance as current.
          snapshot = null; blocked = true;
        }
        throw e;
      } finally { busy = false; }
    }
    function record(name) {
      if (!snapshot) throw failure('NOT_SYNCHRONIZED');
      const found = snapshot.records.find(row => row.name === name);
      return found ? clone(found) : null;
    }
    function normalizeUpdate(input) {
      if (!plain(input) || !RECORD.test(input.name) ||
          !snapshot.records.some(row => row.name === input.name))
        throw failure('RECORD_NOT_CONFIRMED');
      if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 250))
        throw failure('INVALID_RECORD');
      if (input.author !== undefined && (typeof input.author !== 'string' || input.author.length > 100))
        throw failure('INVALID_RECORD');
      if (typeof input.content !== 'string' && !plain(input.content) && !Array.isArray(input.content))
        throw failure('INVALID_RECORD');
      const content = typeof input.content === 'string' ? input.content : JSON.stringify(input.content);
      if (typeof content !== 'string' || content.length > 4 * 1024 * 1024) throw failure('INVALID_RECORD');
      if (input.name === 'v6.app.state') {
        let parsed;
        try { parsed = JSON.parse(content); }
        catch { throw failure('LEDGER_INVALID'); }
        if (!plain(parsed) || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 ||
            typeof parsed.cash !== 'number' || !Number.isFinite(parsed.cash) ||
            !Array.isArray(parsed.positions) || !Array.isArray(parsed.orders))
          throw failure('LEDGER_INVALID');
      }
      return {name: input.name, content,
        ...(input.title === undefined ? {} : {title: input.title}),
        ...(input.author === undefined ? {} : {author: input.author})};
    }
    async function submit(auth, originalEpoch) {
      const job = pending;
      let ack;
      try {
        ack = await send('POST', auth, job.payload);
        if (epoch !== originalEpoch || pending !== job) throw failure('AUTH_CHANGED');
        if (!Number.isSafeInteger(ack.revision) || !Number.isSafeInteger(ack.appliedRevision) ||
            ack.appliedRevision < job.payload.expectedRevision + 1 ||
            ack.revision < ack.appliedRevision || typeof ack.reused !== 'boolean')
          throw failure('WRITE_ACK_UNVERIFIED');
        const latest = await readWith(auth, originalEpoch);
        const current = latest.records.find(row => row.name === job.payload.name);
        if (latest.revision < ack.revision || !current ||
            current.content !== job.payload.content) {
          snapshot = latest; pending = null; blocked = true;
          throw failure('WRITE_SUPERSEDED_OR_UNVERIFIED');
        }
        snapshot = latest; pending = null; blocked = false;
        return {status: 'confirmed', appliedRevision: ack.appliedRevision,
          revision: latest.revision, reused: ack.reused, accountRecoveryVerified: false};
      } catch (e) {
        blocked = true;
        if (e.code === 'LOGIN_REQUIRED' || e.code === 'ACCESS_DENIED' || e.code === 'AUTH_CHANGED') {
          clear();
        } else if (e.code === 'REVISION_CONFLICT' ||
                   e.code === 'WRITE_SUPERSEDED_OR_UNVERIFIED') {
          pending = null;
        }
        // On timeouts, failed responses, invalid acknowledgements, or failed
        // post-write readback, retain the exact request ID/payload in memory.
        // The caller may retry that same idempotent request, never invent a new one.
        throw e;
      }
    }
    async function commit(input) {
      if (!allowMutations) throw failure('READ_ONLY_MODE');
      if (busy) throw failure('CLIENT_BUSY');
      if (pending) throw failure('PENDING_WRITE_MUST_BE_RECONCILED');
      if (blocked || !snapshot) throw failure('NOT_SYNCHRONIZED');
      const auth = token();
      const row = normalizeUpdate(input);
      const id = requestIdFactory();
      if (typeof id !== 'string' || !REQUEST_ID.test(id)) throw failure('SECURE_REQUEST_ID_REQUIRED');
      pending = { payload: {...row, expectedRevision: snapshot.revision, requestId: id} };
      const originalEpoch = epoch;
      busy = true;
      try { return await submit(auth, originalEpoch); } finally { busy = false; }
    }
    async function retryPending() {
      if (!allowMutations) throw failure('READ_ONLY_MODE');
      if (busy) throw failure('CLIENT_BUSY');
      if (!pending || !snapshot) throw failure('NO_PENDING_WRITE');
      const auth = token(), originalEpoch = epoch;
      busy = true;
      try { return await submit(auth, originalEpoch); } finally { busy = false; }
    }
    // Query the verified immutable event chain by an existing request ID.
    // This is not an account login, a successful balance reconciliation, or a new write.
    // A missing receipt is provisional; the original request might still be in flight.
    async function receipt(requestId) {
      if (busy) throw failure('CLIENT_BUSY');
      if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))
        throw failure('INVALID_REQUEST_ID');
      const auth = token(), originalEpoch = epoch;
      busy = true;
      try {
        const data = await send('GET', auth, undefined, API + '/receipts/' + requestId);
        if (epoch !== originalEpoch || token() !== auth) throw failure('AUTH_CHANGED');
        const proof = data.receipt;
        if (!plain(proof) || typeof proof.found !== 'boolean' ||
            !Number.isSafeInteger(proof.currentRevision) || proof.currentRevision < 1 ||
            proof.readOnly !== true || proof.verifiedFromHashChain !== true ||
            proof.accountRecoveryVerified !== false ||
            (proof.found && (proof.status !== 'committed' ||
              !['upsert','bootstrap'].includes(proof.action) ||
              !Number.isSafeInteger(proof.appliedRevision) ||
              proof.appliedRevision < 1 || proof.appliedRevision > proof.currentRevision)) ||
            (!proof.found && (proof.status !== 'not-present-in-verified-ledger' ||
              proof.appliedRevision !== null)))
          throw failure('RECEIPT_UNVERIFIED');
        return Object.freeze({
          found: proof.found, status: proof.status,
          action: proof.found ? proof.action : null,
          appliedRevision: proof.found ? proof.appliedRevision : null,
          currentRevision: proof.currentRevision,
          readOnly: true, accountRecoveryVerified: false
        });
      } catch (e) {
        if (['LOGIN_REQUIRED','ACCESS_DENIED','AUTH_CHANGED'].includes(e.code)) clear();
        throw e;
      } finally { busy = false; }
    }
    return Object.freeze({ load, record, commit, retryPending, receipt, status, clear });
  }
  const api = Object.freeze({ createClient });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.V6CloudCasClient = api;
})(typeof window !== 'undefined' ? window : null);
