'use strict';
/**
 * Isolated server-side persistence primitive for a future authenticated /api/records.
 * It is NOT wired to the current WorkBuddy static host and cannot authorize requests.
 * Every committed write is immutable and linked by hashes; no empty ledger is fabricated.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withAccountLock } = require('./account-process-lock');
const MAX_EVENTS = 10000;
const MAX_EVENT_BYTES = 12 * 1024 * 1024;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const EVENT_NAME = /^([0-9]{6})\.json$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const RECORD_NAME = /^v6\.[A-Za-z0-9_.-]{1,96}$/;
const HASH = /^[a-f0-9]{64}$/;
const error = code => Object.assign(new Error(code), { code });
const stable = (value, depth=0) => {
  if(depth>32) throw error('STRUCTURE_TOO_DEEP');
  if(Array.isArray(value)) return value.map(x=>stable(x,depth+1));
  if(value && typeof value==='object') {
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw error('UNSAFE_JSON_PROTOTYPE');
    const out=Object.create(null);
    for(const key of Object.keys(value).sort()) {
      if(['__proto__','constructor','prototype'].includes(key) || value[key]===undefined) throw error('UNSAFE_JSON_FIELD');
      out[key]=stable(value[key],depth+1);
    }
    return out; }
  return value;
};
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
function safeRoot(root, create=false) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw error('INVALID_PRIVATE_ROOT');
  const absolute = path.resolve(root);
  if (absolute === path.parse(absolute).root || absolute.split(path.sep).some(part => /^(public|www|htdocs|dist)$/i.test(part)))
    throw error('PUBLIC_OR_ROOT_DIRECTORY_FORBIDDEN');
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('UNSAFE_DIRECTORY');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (create) fs.mkdirSync(absolute, { recursive:true, mode:0o700 });
  if (fs.existsSync(absolute) && (fs.statSync(absolute).mode & 0o077)) throw error('PRIVATE_DIRECTORY_PERMISSIONS');
  return absolute;
}
function record(row) {
  if (!plain(row) || !RECORD_NAME.test(row.name) ||
      (typeof row.content !== 'string' && !plain(row.content) && !Array.isArray(row.content)) ||
      (row.title !== undefined && (typeof row.title !== 'string' || row.title.length > 250)) ||
      (row.author !== undefined && (typeof row.author !== 'string' || row.author.length > 100)))
    throw error('INVALID_RECORD');
  const content = typeof row.content === 'string' ? row.content : stable(row.content);
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_RECORD_BYTES) throw error('INVALID_RECORD');
  if (row.name === 'v6.app.state') {
    let state;
    try { state = typeof content === 'string' ? JSON.parse(content) : content; } catch { throw error('INVALID_ACCOUNT_JSON'); }
    if (!plain(state) || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
        typeof state.cash !== 'number' || !Number.isFinite(state.cash) ||
        !Array.isArray(state.positions) || !Array.isArray(state.orders))
      throw error('INVALID_ACCOUNT_SHAPE');
  }
  return { name:row.name, content,
    ...(row.title === undefined ? {} : { title:row.title }),
    ...(row.author === undefined ? {} : { author:row.author }) };
}
function recordsArray(rows) {
  if (!Array.isArray(rows) || rows.length > 32) throw error('INVALID_RECORDS_ARRAY');
  const names = new Set();
  const clean = rows.map(row => {
    const v = record(row);
    if (names.has(v.name)) throw error('DUPLICATE_RECORD_NAME');
    names.add(v.name);
    return v;
  });
  return clean;
}
function eventFile(dir, index) { return path.join(dir,String(index).padStart(6,'0')+'.json'); }
function readEvent(file, index) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size <= 0 || stat.size > MAX_EVENT_BYTES)
      throw error('EVENT_FILE_UNSAFE');
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!plain(value) || value.schemaVersion !== 1 || value.sequence !== index ||
        typeof value.hash !== 'string' || !HASH.test(value.hash)) throw error('EVENT_INVALID');
    const {hash, ...signed} = value;
    if (digest(signed) !== hash) throw error('EVENT_HASH_MISMATCH');
    return value;
  } catch (e) { if (e instanceof SyntaxError) throw error('EVENT_JSON_CORRUPT'); throw e; }
  finally { fs.closeSync(fd); }
}
function inspect(root) {
  const dir = safeRoot(root);
  if (!fs.existsSync(dir)) return {status:'uninitialized', revision:null, records:null, proof:null, events:0};
  const names = fs.readdirSync(dir);
  const eventNames = names.filter(name=>EVENT_NAME.test(name)).sort();
  const unknown = names.filter(name=>!EVENT_NAME.test(name) && name !== 'records.guard' &&
    !/^\.stage-[a-f0-9]{24}$/.test(name));
  if (unknown.length || eventNames.length > MAX_EVENTS) throw error('UNEXPECTED_STORAGE_FILES');
  if (!eventNames.length) return {status:'uninitialized', revision:null, records:null, proof:null, events:0};
  const map = new Map(), requests = new Map();
  let prev = null;
  for (let index = 1; index <= eventNames.length; index++) {
    if (eventNames[index-1] !== path.basename(eventFile(dir,index))) throw error('EVENT_SEQUENCE_GAP');
    const e=readEvent(eventFile(dir,index),index);
    if (e.previousHash !== (prev?.hash || null) || !REQUEST_ID.test(e.requestId) ||
        !['bootstrap','upsert'].includes(e.action)) throw error('EVENT_CHAIN_INVALID');
    if (!HASH.test(e.fingerprint) || requests.has(e.requestId)) throw error('DUPLICATE_REQUEST_EVENT');
    if (index === 1) {
      if (e.action !== 'bootstrap' || !Array.isArray(e.records)) throw error('MISSING_AUTHORITATIVE_BOOTSTRAP');
      const rows=recordsArray(e.records);
      if (!rows.some(x=>x.name === 'v6.app.state')) throw error('MISSING_ACCOUNT_IN_BACKUP');
      for (const row of rows) map.set(row.name,row);
      if (e.fingerprint !== digest({action:'bootstrap',records:rows})) throw error('BOOTSTRAP_FINGERPRINT_INVALID');
    } else {
      if (e.action !== 'upsert' || !Number.isSafeInteger(e.expectedRevision) ||
          e.expectedRevision !== index-1) throw error('UPSERT_SEQUENCE_INVALID');
      const row=record(e.record);
      if (e.fingerprint !== digest({action:'upsert',record:row})) throw error('UPSERT_FINGERPRINT_INVALID');
      map.set(row.name,row);
    }
    requests.set(e.requestId,{fingerprint:e.fingerprint,sequence:index});
    prev=e;
  }
  return {status:'ready', revision:eventNames.length, records:[...map.values()], proof:prev.hash,
    events:eventNames.length, _requests:requests};
}
function atomicCreate(file, value, {injectFault} = {}) {
  const dir = path.dirname(file), stage=path.join(dir,'.stage-'+crypto.randomBytes(12).toString('hex'));
  let fd;
  try {
    const payload = JSON.stringify(value)+'\n';
    if (Buffer.byteLength(payload) > MAX_EVENT_BYTES) throw error('EVENT_TOO_LARGE');
    fd=fs.openSync(stage,'wx',0o600);
    const bytes=Buffer.from(payload,'utf8'), middle = Math.max(1,Math.floor(bytes.length/2));
    function writeAll(start,count){let offset=0;while(offset<count){const n=fs.writeSync(fd,bytes,start+offset,count-offset);if(n<=0)throw error('SHORT_WRITE');offset+=n;}}
    writeAll(0,middle);
    injectFault?.('during-write');
    writeAll(middle,bytes.length-middle);
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    injectFault?.('before-rename');
    // Exclusive append: never overwrite a previous committed revision.
    fs.linkSync(stage,file);
    const dirfd=fs.openSync(dir,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
    injectFault?.('after-commit');
  } finally {
    if (fd !== undefined) try{fs.closeSync(fd);}catch{}
    try{fs.unlinkSync(stage);}catch{}
  }
}
function append(dir,entry,options) {
  const signed={schemaVersion:1,...entry};
  const value={...signed,hash:digest(signed)};
  atomicCreate(eventFile(dir,entry.sequence),value,options);
  return value;
}
function createCloudRecordsCasStore(root) {
  function read() {
    const { _requests, ...publicState }=inspect(root);
    return {...publicState, offlineOnly:true, authenticatedSessionVerified:false,
      productionDeployed:false, canTrade:false};
  }
  function bootstrap({records, expectedSourceHash, operatorApproved, requestId},options={}) {
    if (operatorApproved !== true || !REQUEST_ID.test(requestId) || !HASH.test(expectedSourceHash))
      throw error('EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
    const snapshot=recordsArray(records);
    if (!snapshot.some(x=>x.name === 'v6.app.state') || digest({records:snapshot}) !== expectedSourceHash)
      throw error('AUTHORITATIVE_BACKUP_PROOF_REQUIRED');
    const dir=safeRoot(root,true);
    return withAccountLock(path.join(dir,'records'),()=>{
      const current=inspect(dir);
      if (current.status !== 'uninitialized') throw error('BOOTSTRAP_WOULD_OVERWRITE_EXISTING_DATA');
      append(dir,{sequence:1,previousHash:null,action:'bootstrap',requestId,
        fingerprint:digest({action:'bootstrap',records:snapshot}),records:snapshot},options);
      return read();
    });
  }
  function upsert({expectedRevision,requestId,record:input},options={}) {
    if (!REQUEST_ID.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw error('EXPECTED_REVISION_REQUIRED');
    const row=record(input),fingerprint=digest({action:'upsert',record:row});
    const dir=safeRoot(root);
    if (!fs.existsSync(dir)) throw error('NO_AUTHORITATIVE_SNAPSHOT');
    return withAccountLock(path.join(dir,'records'),()=>{
      const state=inspect(dir);
      if (state.status!=='ready') throw error('NO_AUTHORITATIVE_SNAPSHOT');
      const old=state._requests.get(requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw error('IDEMPOTENCY_CONTENT_CONFLICT');
        return {reused:true,appliedRevision:old.sequence,currentRevision:state.revision,
          proof:state.proof,offlineOnly:true};
      }
      if (state.revision!==expectedRevision) throw error('REVISION_CONFLICT');
      if (state.revision>=MAX_EVENTS) throw error('HISTORY_CAPACITY_REACHED');
      const item=append(dir,{sequence:state.revision+1,previousHash:state.proof,
        action:'upsert',requestId,expectedRevision,record:row,fingerprint},options);
      return {reused:false,appliedRevision:item.sequence,currentRevision:item.sequence,
        proof:item.hash,offlineOnly:true};
    });
  }
  return {read,bootstrap,upsert};
}
module.exports={createCloudRecordsCasStore,digest};
