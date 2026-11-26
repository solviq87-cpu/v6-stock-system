'use strict';

// Runtime observations are written only by the existing server's collector.
// There is intentionally no import/backfill method or caller-supplied day/time.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {withAccountLock} = require('./account-process-lock');
const {aShareCalendarDate} = require('./a-share-calendar');
const {readResearchCalendar} = require('./research-calendar-source');
const {inspectReleaseProvenanceAsync} = require('./release-provenance');
const {quoteObservationView,quoteSourceAllowsUse}=require('./quote-observation-view');
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const DAY = /^\d{4}-\d\d-\d\d$/, MAX_DAY_BYTES = 2 * 1024 * 1024, MAX_DAYS = 400, MAX_SAMPLES = 600;
const validDay = day => typeof day === 'string' && DAY.test(day) && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10) === day;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const truth = value => typeof value === 'boolean' ? value : null;
const version = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value) ? value : null;
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
// Names come only from the existing repository task inventory, not request evidence.
const TASK_TITLES = Object.freeze(Object.fromEntries(require('../../config/deep-research-tasks.json').map(row=>[row.id,row.title])));
const DEFAULT_CRITERIA = Object.freeze({version:'runtime-observation-v1', minimumSlots:40, minimumSessionSlots:20,
  minimumFreshCoverage:0.8, maximumCollectionP95Ms:5000, maximumDeliveryDelayMs:30000,
  minimumMatureSamples:null, maximumDrawdownPct:null, maximumCalibrationError:null});

function criteriaProfile(input = {}) {
  const p = {...DEFAULT_CRITERIA};
  for (const name of ['minimumFreshCoverage','maximumCollectionP95Ms','maximumDeliveryDelayMs','minimumMatureSamples','maximumDrawdownPct','maximumCalibrationError']) {
    if (input[name] === undefined) continue;
    const n = number(input[name]);
    if (n === null || n < 0 || name === 'minimumFreshCoverage' && n > 1 || name === 'minimumMatureSamples' && !Number.isSafeInteger(n))
      throw Error('acceptance-invalid-criteria');
    p[name] = n;
  }
  return p;
}

function marketSlot(now) {
  const date = new Date(now + 8 * 3600000), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (minute >= 570 && minute < 690) return Math.floor((minute - 570) / 5);
  if (minute >= 780 && minute < 900) return 24 + Math.floor((minute - 780) / 5);
  return null;
}

function privateRoot(root, create = false) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw Error('acceptance-private-root-required');
  root = path.resolve(root);
  if (root === path.parse(root).root || root.split(path.sep).some(p => ['public','www','htdocs'].includes(p.toLowerCase())))
    throw Error('acceptance-public-root-forbidden');
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { const st = fs.lstatSync(current); if (!st.isDirectory() || st.isSymbolicLink()) throw Error('acceptance-unsafe-directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (create) fs.mkdirSync(root, {recursive:true, mode:0o700});
  if (fs.existsSync(root) && (fs.lstatSync(root).mode & 0o077)) throw Error('acceptance-private-permissions-required');
  return root;
}

function readDay(root, day) {
  if (!DAY.test(day) || new Date(day + 'T00:00:00Z').toISOString().slice(0,10) !== day) throw Error('acceptance-invalid-day');
  const file = path.join(root, day + '.jsonl'); let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_DAY_BYTES || before.mode & 0o077) throw Error('acceptance-unsafe-file');
    const raw = fs.readFileSync(fd, 'utf8'), after = fs.fstatSync(fd);
    if (Buffer.byteLength(raw) > MAX_DAY_BYTES || ['dev','ino','size','mtimeMs','ctimeMs'].some(k => before[k] !== after[k]))
      throw Error('acceptance-file-changed');
    if (!raw.endsWith('\n')) throw Error('acceptance-incomplete-write-preserved');
    const rows = raw.trim().split('\n').map(line => JSON.parse(line));
    if (!rows.length || rows.length > MAX_SAMPLES) throw Error('acceptance-sample-limit');
    let previous = null, priorAt = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], {fingerprint, ...body} = row;
      if (row.schemaVersion !== 1 || row.kind !== 'server-runtime-observation' || row.day !== day ||
          row.sequence !== i + 1 || row.previous !== previous || !HASH.test(fingerprint || '') || digest(body) !== fingerprint ||
          !Number.isSafeInteger(row.observedAt) || row.observedAt <= priorAt || aShareCalendarDate(row.observedAt) !== day ||
          row.slot !== marketSlot(row.observedAt) || !HASH.test(row.criteriaHash || '') || !row.metrics ||
          row.businessRecordsMutated !== false || row.origin !== 'server-collector') throw Error('acceptance-history-integrity-failed');
      if(Object.hasOwn(row,'evidenceReadyAt')){
        const ready=row.evidenceReadyAt,late=Array.isArray(row.exclusions)&&row.exclusions.includes('collection-window-exceeded');
        if(ready===null?!late:!Number.isSafeInteger(ready)||ready<row.observedAt||(ready-row.observedAt>15000&&!late))throw Error('acceptance-history-integrity-failed');
      }
      previous = fingerprint; priorAt = row.observedAt;
    }
    return rows;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function listDays(root) {
  if (!fs.existsSync(root)) return [];
  const days = fs.readdirSync(root).filter(name => DAY.test(name.slice(0,-6)) && name.endsWith('.jsonl')).map(n => n.slice(0,-6)).sort();
  if (days.length > MAX_DAYS) throw Error('acceptance-day-limit');
  return days;
}

function calendarView(value, now) {
  const unavailable={available:false,runtimeEligible:false,source:null,hash:null,tradeDates:[],sourceAuthenticated:null};
  if (!value) return unavailable;
  const metadata = value.metadata || {}, dates = value.tradeDates;
  const qualification={runtimeEligible:metadata.runtimeEligible===true,sourceAuthenticated:truth(metadata.sourceAuthenticated??metadata.verifiedExternal)};
  if (metadata.from!=null&&!validDay(metadata.from)||metadata.to!=null&&!validDay(metadata.to)||metadata.from&&metadata.to&&metadata.from>metadata.to) return unavailable;
  if (value.status === 'available' && Array.isArray(dates) && dates.length <= 1000 &&
      dates.every(d => validDay(d)&&(!metadata.from||d>=metadata.from)&&(!metadata.to||d<=metadata.to)) && typeof metadata.source === 'string') return {available:true,...qualification,
    source: version(metadata.source), hash: HASH.test(metadata.sha256 || '') ? metadata.sha256 : null,
    tradeDates: [...new Set(dates)].sort(), from:metadata.from || null, to:metadata.to || null};
  // Existing authority-calendar object can be injected by the server. It is not
  // accepted from an HTTP body; the same explicit calendar checks each date.
  if (typeof value.isOpen === 'function' && validDay(metadata.from) && validDay(metadata.to) &&
      typeof metadata.source === 'string') {
    const tradeDates = [], limit = Math.min(Date.parse(metadata.to), now), start = Date.parse(metadata.from);
    if (!Number.isFinite(start) || limit - start > 1000 * 86400000) return unavailable;
    for (let t = start; t <= limit; t += 86400000) {
      const day = new Date(t).toISOString().slice(0,10);
      if (value.isOpen(day)) tradeDates.push(day);
    }
    return {available:true,...qualification,source:version(metadata.source), hash:HASH.test(metadata.sha256 || '') ? metadata.sha256 : null,
      tradeDates, from:metadata.from, to:metadata.to};
  }
  return unavailable;
}

// Original paper-account reads are already validated by the existing service.
// Preserve proof of each exact book and the opening/quantity-flow scope; no
// account contents, exceptions or external-broker assertions enter the journal.
const JOINT_RECONCILIATION_SCOPE='original-paper-local-joint-reconciliation-v1';
function observeOriginalAccountReconciliation({readBook,now,clock=Date.now}={}){
  if(typeof readBook!=='function'||!Number.isSafeInteger(now)||now<=0||typeof clock!=='function')throw Error('acceptance-invalid-account-observer');
  const {reconcileAccountSnapshot}=require('./account-safety-state');
  let fills=0;
  const accounts=['pool','pre'].map(account=>{
    const unavailable={account,status:'unavailable',revision:null,snapshotFingerprint:null,quantityFlowVerified:null};
    try{
      const book=readBook(account);
      if(!book||book.schemaVersion!==1||book.paperOnly!==true||book.brokerConnected!==false||!Number.isSafeInteger(book.revision)||book.revision<1) return unavailable;
      const {fingerprint,...payload}=book,{cash,positions,events}=book.account;
      if(!HASH.test(fingerprint||'')||digest(payload)!==fingerprint||digest({cash,positions,events})!==book.account.fingerprint||!Array.isArray(events))return unavailable;
      const check=reconcileAccountSnapshot(book,{tradeDate:aShareCalendarDate(now)});
      if(check.accountRevision!==book.revision||check.completeExternalReconciliation!==false)return unavailable;
      const status=check.internallyConsistent===true&&check.status==='consistent'?'consistent':check.status==='restricted'?'restricted':'mismatch';
      fills+=events.length;
      return {account,status,revision:book.revision,snapshotFingerprint:fingerprint,quantityFlowVerified:check.quantityFlowVerified===true};
    }catch{return unavailable;}
  });
  const checkedAt=clock(),reconciled=accounts.every(a=>a.status==='consistent');
  return {paperFills:accounts.every(a=>a.status!=='unavailable')?fills:null,reconciled,
    reconciliationReceipt:normalizeJointReconciliation({scope:JOINT_RECONCILIATION_SCOPE,observedAt:now,checkedAt,accounts,verifiedExternal:false},now)};
}
function normalizeJointReconciliation(receipt,now){
  if(receipt?.scope!==JOINT_RECONCILIATION_SCOPE||receipt.observedAt!==now||receipt.verifiedExternal!==false||
    !Number.isSafeInteger(receipt.checkedAt)||receipt.checkedAt<now||receipt.checkedAt-now>15000||aShareCalendarDate(receipt.checkedAt)!==aShareCalendarDate(now)||
    !Array.isArray(receipt.accounts)||receipt.accounts.length!==2)return null;
  const accounts=[];
  for(const account of ['pool','pre']){
    const rows=receipt.accounts.filter(a=>a?.account===account);
    if(rows.length!==1)return null;
    const a=rows[0];
    if(a.status==='unavailable'){
      if(a.revision!==null||a.snapshotFingerprint!==null||a.quantityFlowVerified!==null)return null;
    }else if(!['consistent','restricted','mismatch'].includes(a.status)||!Number.isSafeInteger(a.revision)||a.revision<1||!HASH.test(a.snapshotFingerprint||'')||typeof a.quantityFlowVerified!=='boolean')return null;
    accounts.push({account,status:a.status,revision:a.revision,snapshotFingerprint:a.snapshotFingerprint,quantityFlowVerified:a.quantityFlowVerified});
  }
  return {scope:JOINT_RECONCILIATION_SCOPE,observedAt:now,checkedAt:receipt.checkedAt,accounts,verifiedExternal:false};
}
function jointReconciliationOutcome(execution,observedAt,cutoff){
  const receipt=normalizeJointReconciliation(execution?.reconciliationReceipt,observedAt);
  if(receipt&&receipt.checkedAt>cutoff)return 'unknown';
  if(execution?.reconciled===false||receipt?.accounts.some(a=>a.status!=='consistent'))return 'failed';
  if(execution?.reconciled===true&&receipt?.accounts.every(a=>a.status==='consistent'&&a.quantityFlowVerified===true))return 'verified-local';
  return 'unknown';
}

function normalizeHeldMonitor(value,now){
  if(value?.scope!=='original-monitor-held-symbols-v1'||value.verifiedExternal!==false||value.observedAt!==now||
    !Number.isSafeInteger(value.checkedAt)||value.checkedAt>now||now-value.checkedAt>15000||aShareCalendarDate(value.checkedAt)!==aShareCalendarDate(now)||
    !['observed','fetch-failed'].includes(value.status)||!HASH.test(value.populationHash||''))return null;
  const {expectedSymbols,requestedSymbols,freshSymbols,conflictingSymbols}=value;
  if([expectedSymbols,requestedSymbols,freshSymbols,conflictingSymbols].some(n=>count(n)===null)||
    requestedSymbols>220||requestedSymbols>expectedSymbols||freshSymbols+conflictingSymbols>requestedSymbols||
    value.status==='fetch-failed'&&(freshSymbols!==0||conflictingSymbols!==0))return null;
  return {scope:value.scope,status:value.status,checkedAt:value.checkedAt,observedAt:now,populationHash:value.populationHash,
    expectedSymbols,requestedSymbols,freshSymbols,conflictingSymbols,verifiedExternal:false};
}

function normalizeMetrics(input, now, collectionMs) {
  const m = input?.market || {}, supplied=Array.isArray(m.quotes)?m.quotes:[],quotes=supplied.slice(0,10000),unique=new Map();
  const inputHash=crypto.createHash('sha256').update('fayo-runtime-quote-input-v1\n');
  const sample=[],flagNames=['canTrade','simulated','readOnlyBackup','imported','fixture','mock','synthetic','tradable','suspended','sourceConflict','conflict'];
  let duplicateInputs=0,invalidIdentities=0;
  for (const q of quotes) {
    const source=version(q?.quoteSource??q?.source),row={...q,quoteSource:source},view=quoteObservationView(row,now),sourceAllowed=quoteSourceAllowsUse(row);
    const sourceConflict=q?.sourceConflict===true||q?.conflict===true||q?.evidenceStatus==='conflict'||q?.quoteStatus==='conflict'||
      (q?.source!=null&&q?.quoteSource!=null&&q.source!==q.quoteSource)||
      (q?.tradeDate!=null&&view.quoteAt!==null&&q.tradeDate!==view.tradeDate);
    const clean={code:typeof q?.code==='string'&&/^\d{6}$/.test(q.code)?q.code:null,source,price:number(q?.price),
      quoteAt:view.quoteAt,receivedAt:view.receivedAt,quoteMode:version(q?.quoteMode),mode:version(q?.mode),sourceAllowed,sourceConflict,
      flags:Object.fromEntries(flagNames.filter(key=>typeof q?.[key]==='boolean').map(key=>[key,q[key]]))};
    // Hash every whitelisted input within the explicit processing limit,
    // including duplicate/invalid identities. Never hash or retain credentials.
    inputHash.update(JSON.stringify(clean)+'\n');
    if(!clean.code){invalidIdentities++;continue;}
    const prior=unique.get(clean.code);
    if(prior){
      duplicateInputs++;
      // One current row per symbol. Exact repeated evidence is harmless, but
      // differing records have no established ordering/selection authority.
      if(JSON.stringify(prior.clean)!==JSON.stringify(clean))prior.duplicateConflict=true;
      prior.nonLive=prior.nonLive||!sourceAllowed;
      prior.explicitConflict=prior.explicitConflict||sourceConflict;
      continue;
    }
    unique.set(clean.code,{view,clean,duplicateConflict:false,explicitConflict:sourceConflict,nonLive:!sourceAllowed});
  }
  let fresh=0,known=0,missing=0,stale=0,future=0,nonLive=0,invalidPrice=0,conflictingSymbols=0;const sources=new Set();
  for (const {view,clean,duplicateConflict,explicitConflict,nonLive:nonLiveInput} of unique.values()) {
    const allowed=clean.sourceAllowed&&!nonLiveInput,conflicting=explicitConflict||duplicateConflict;
    if(conflicting)conflictingSymbols++;
    const validPrice=clean.price!==null&&clean.price>0,at=view.quoteAt,received=view.receivedAt;
    if(!validPrice)invalidPrice++;
    if(!allowed)nonLive++;
    if(at!==null&&at>now||received!==null&&(received>now||at!==null&&received<at))future++;
    else if(at===null||!clean.source||received===null)missing++;
    else{known++;sources.add(clean.source);if(now-at>15000)stale++;}
    const eligibleFresh=validPrice&&allowed&&!conflicting&&view.quoteStatus==='recent-unverified'&&view.missingReason===null&&view.tradeDate===aShareCalendarDate(now);
    if(eligibleFresh)fresh++;
    if(sample.length<10)sample.push({...clean,sampled:true,quoteStatus:conflicting?'conflict':view.quoteStatus,eligibleFresh,
      reason:duplicateConflict?'duplicate-quote-conflict':explicitConflict?'source-conflict':!validPrice?'invalid-price':!allowed?'observation-only-source':view.missingReason||(eligibleFresh?'fresh-original-quote':'unclassified-quote')});
  }
  const expected = count(m.expectedSymbols), r = input?.risk || {}, e = input?.execution || {}, s = input?.strategy || {}, c = input?.clients || {};
  const observed = unique.size, attempts = count(m.attempts), successes = count(m.successes);
  return {market:{expectedSymbols:expected, observedSymbols:observed, freshQuotes:fresh, knownOriginalTimes:known,
    missingOriginalTimes:missing,staleQuotes:stale,futureQuotes:future,nonLiveQuotes:nonLive,invalidPrice,conflictingSymbols,duplicateInputs,invalidIdentities,
    sources:[...sources].sort().slice(0,32),sourceCount:sources.size,sourcesTruncated:sources.size>32,
    quoteEvidence:{schemaVersion:1,conflictPolicy:'explicit-and-duplicate-v1',sampled:true,sampling:'first-10-unique-symbols-in-server-input-order',sampleLimit:10,samples:sample,
      sampleTruncated:unique.size>sample.length,totalSeen:supplied.length,processedInputs:quotes.length,maxInputs:10000,
      truncated:supplied.length>quotes.length,inputDigest:inputHash.digest('hex'),
      digestScope:supplied.length>quotes.length?'whitelisted-processed-prefix':'all-whitelisted-inputs',observedAt:now},
    coverage:supplied.length===quotes.length&&expected > 0 && observed <= expected ? observed / expected : null,
    freshCoverage:supplied.length===quotes.length&&expected > 0 && observed <= expected ? fresh / expected : null,
    attempts, successes, collectionSuccess:attempts > 0 && successes !== null && successes <= attempts ? successes / attempts : null,
    ...(m.heldMonitor==null?{}:{heldMonitor:normalizeHeldMonitor(m.heldMonitor,now)})},
    risk:Object.fromEntries(['observed','queued','delivered','resolved','falsePositives','falseNegatives'].map(k => [k,count(r[k])]).concat([
      ['deliveryDelayMs',number(r.deliveryDelayMs) !== null && r.deliveryDelayMs >= 0 ? r.deliveryDelayMs : null]])),
    execution:{...Object.fromEntries(['intents','submittedOrders','confirmedFills','paperFills'].map(k => [k,count(e[k])])),
      reconciled:truth(e.reconciled), recoveryVerified:truth(e.recoveryVerified),
      ...(e.reconciliationReceipt==null?{}:{reconciliationReceipt:normalizeJointReconciliation(e.reconciliationReceipt,now)})},
    strategy:{matureSamples:count(s.matureSamples), netReturnPct:number(s.netReturnPct), maxDrawdownPct:number(s.maxDrawdownPct), calibrationError:number(s.calibrationError)},
    clients:{desktopVersion:version(c.desktopVersion),mobileVersion:version(c.mobileVersion),apiVersion:version(c.apiVersion),
      permissionsConsistent:truth(c.permissionsConsistent),featuresConsistent:truth(c.featuresConsistent)},
    system:{collectionMs:Math.max(0,Math.round(collectionMs * 100) / 100), rssBytes:process.memoryUsage().rss, uptimeSeconds:Math.round(process.uptime())}};
}

function summarizeDay(day, rows, now, criteria) {
  // Older records remain intact, but a prior boolean without the now-required
  // runtime calendar and quote audit evidence cannot certify a real day.

  const populationMismatch=m=>m.expectedSymbols!=null&&m.observedSymbols>m.expectedSymbols;
  const live=rows.filter(row=>row.liveEligible&&qualifiedRuntimeRow(row)&&row.metrics.market.freshQuotes>0&&
    row.metrics.market.quoteEvidence.truncated!==true&&!(row.metrics.market.conflictingSymbols>0)&&!(row.metrics.market.invalidIdentities>0)&&
    !(row.metrics.market.futureQuotes>0)&&!(row.metrics.market.invalidPrice>0)&&!populationMismatch(row.metrics.market)),liveSet=new Set(live),slots=new Set(live.map(r=>r.slot));
  const attempts=rows.filter(row=>liveSet.has(row)||runtimeQualityAttempt(row));
  const morning = [...slots].filter(n => n < 24).length, afternoon = [...slots].filter(n => n >= 24).length;
  const ended = day < aShareCalendarDate(now) || day === aShareCalendarDate(now) && new Date(now + 8 * 3600000).getUTCHours() >= 16;
  const fullCoverage = slots.size >= criteria.minimumSlots && morning >= criteria.minimumSessionSlots && afternoon >= criteria.minimumSessionSlots &&
    slots.has(0) && slots.has(23) && slots.has(24) && slots.has(47);
  const sourceShas = [...new Set(attempts.map(r => r.sourceSha))], profileHashes = [...new Set(rows.map(r => r.criteriaHash))];
  const calendarVersions=[...new Map(attempts.map(r=>[JSON.stringify([r.calendar?.source??null,r.calendar?.hash??null]),{source:r.calendar?.source??null,hash:r.calendar?.hash??null}])).values()];
  const metric = (fn, values = attempts) => values.map(fn).filter(v => v !== null && v !== undefined);
  // A failed but qualified live attempt is part of the observation population.
  // Keep the previous successful snapshot separate; never substitute it for
  // the newest failed attempt or omit failed timings from latency statistics.
  const latencies = metric(r => r.metrics.system.collectionMs).sort((a,b) => a-b);
  const latestLive=live.at(-1)?.metrics||null;
  const latest=attempts.at(-1)?.metrics||rows.at(-1)?.metrics||null;
  const accountOutcomes=attempts.map(r=>{
    const outcome=jointReconciliationOutcome(r.metrics?.execution,r.observedAt,now);
    return outcome==='verified-local'&&r.exclusions.includes('collection-window-exceeded')?'unknown':outcome;
  });
  const heldMonitorReceipts=attempts.map(r=>r.exclusions.includes('collection-window-exceeded')?null:normalizeHeldMonitor(r.metrics.market.heldMonitor,r.observedAt));
  const knownHeld=heldMonitorReceipts.filter(Boolean);
  const heldExpected=knownHeld.reduce((sum,m)=>sum+m.expectedSymbols,0),heldFresh=knownHeld.reduce((sum,m)=>sum+m.freshSymbols,0);
  const unknown = [], failures = [];
  for (const [name, present] of [
    ['marketCoverage',attempts.length > 0 && attempts.every(r => r.metrics.market.freshCoverage != null)],
    ['collectionSuccess',attempts.length > 0 && attempts.every(r => r.metrics.market.collectionSuccess != null)],
    ['quoteConflictReview',attempts.length > 0 && attempts.every(r=>r.metrics.market.quoteEvidence?.conflictPolicy==='explicit-and-duplicate-v1')],
    ['riskEffectiveness',latest?.risk.falsePositives !== null && latest?.risk.falsePositives !== undefined && latest?.risk.falseNegatives !== null && latest?.risk.falseNegatives !== undefined],
    ['notificationDelivery',latest?.risk.delivered !== null && latest?.risk.delivered !== undefined && latest?.risk.deliveryDelayMs !== null && latest?.risk.deliveryDelayMs !== undefined],
    ['accountReconciliation',accountOutcomes.length>0&&accountOutcomes.every(value=>value!=='unknown')],
    ['recoveryEvidence',latest?.execution.recoveryVerified !== null && latest?.execution.recoveryVerified !== undefined],
    ['strategyOutcomes',latest?.strategy.matureSamples > 0 && latest?.strategy.netReturnPct !== null && latest?.strategy.maxDrawdownPct !== null],
    ['modelCalibration',latest?.strategy.calibrationError !== null && latest?.strategy.calibrationError !== undefined],
    ['dualClientParity',latest?.clients.permissionsConsistent !== null && latest?.clients.permissionsConsistent !== undefined && latest?.clients.featuresConsistent !== null && latest?.clients.featuresConsistent !== undefined && !!latest?.clients.desktopVersion && !!latest?.clients.mobileVersion && !!latest?.clients.apiVersion]
  ]) if (!present) unknown.push(name);
  if (!fullCoverage) failures.push('insufficient-session-coverage');
  if (sourceShas.length > 1 || profileHashes.length > 1) failures.push('version-or-criteria-changed-within-day');
  if (attempts.some(r => r.metrics.market.freshCoverage != null && r.metrics.market.freshCoverage < criteria.minimumFreshCoverage)) failures.push('quote-coverage-below-criterion');
  if (attempts.some(r=>r.metrics.market.conflictingSymbols>0)) failures.push('quote-source-conflict');
  if (attempts.some(r=>r.metrics.market.invalidIdentities>0)) failures.push('invalid-quote-identity');
  if (attempts.some(r=>r.metrics.market.quoteEvidence?.truncated===true)) failures.push('quote-input-limit-exceeded');
  if (attempts.some(r=>populationMismatch(r.metrics.market))) failures.push('quote-population-mismatch');
  if (attempts.some(r=>r.exclusions.includes('collection-window-exceeded'))) failures.push('collection-window-exceeded');
  if (rows.some(r => r.collectFailed)) failures.push('collector-failure');
  if (rows.some(r => r.metrics.market.futureQuotes > 0)) failures.push('future-original-quote-time');
  if (rows.some(r => r.metrics.market.invalidPrice > 0)) failures.push('invalid-original-quote-price');
  const p95 = latencies.length ? latencies[Math.min(latencies.length-1,Math.ceil(latencies.length * .95)-1)] : null;
  if (p95 !== null && p95 > criteria.maximumCollectionP95Ms) failures.push('collection-latency');
  // A qualified failed market sample cannot certify positive evidence, but
  // known business safety failures must not disappear because quotes are stale.
  // Isolated/replay observations are not in attempts.
  if (attempts.some(r => r.metrics.risk.falseNegatives > 0)) failures.push('risk-false-negative-observed');
  if (attempts.some(r => r.metrics.risk.deliveryDelayMs > criteria.maximumDeliveryDelayMs)) failures.push('notification-delay');
  if (accountOutcomes.includes('failed')) failures.push('account-reconciliation-failed');
  if (attempts.some(r => r.metrics.execution.recoveryVerified === false)) failures.push('recovery-not-verified');
  if (attempts.some(r => r.metrics.clients.permissionsConsistent === false || r.metrics.clients.featuresConsistent === false ||
      r.metrics.clients.desktopVersion && r.metrics.clients.mobileVersion && r.metrics.clients.apiVersion &&
      new Set([r.metrics.clients.desktopVersion,r.metrics.clients.mobileVersion,r.metrics.clients.apiVersion]).size > 1)) failures.push('dual-client-mismatch');
  if (criteria.minimumMatureSamples !== null && (latest?.strategy.matureSamples ?? 0) < criteria.minimumMatureSamples) failures.push('insufficient-mature-samples');
  if (criteria.maximumDrawdownPct !== null && latest?.strategy.maxDrawdownPct > criteria.maximumDrawdownPct) failures.push('drawdown-limit');
  if (criteria.maximumCalibrationError !== null && latest?.strategy.calibrationError > criteria.maximumCalibrationError) failures.push('calibration-limit');
  return {day,status:!rows.length?'missing':!ended?'in-progress':!live.length?'excluded':!fullCoverage?'observed-partial':failures.length?'observed-with-failures':unknown.length?'observed-awaiting-evidence':'observed-reviewable',
    samples:rows.length,liveSamples:live.length,attemptSamples:attempts.length,excludedSamples:rows.length-live.length,slots:slots.size,morningSlots:morning,afternoonSlots:afternoon,
    completeObservation:ended && fullCoverage,sourceShas,criteriaHashes:profileHashes,calendarVersions,
    firstObservedAt:rows[0]?.observedAt || null,lastObservedAt:rows.at(-1)?.observedAt || null,
    collectionP95Ms:p95,minimumFreshCoverage:attempts.length&&attempts.every(r=>r.metrics.market.freshCoverage!=null)?Math.min(...attempts.map(r=>r.metrics.market.freshCoverage)):null,
    unknown,failures:[...new Set(failures)],latest,latestLive,
    heldMonitorCoverage:{scope:'original-monitor-held-symbols-v1',attemptedMinutes:attempts.length,observedMinutes:knownHeld.length,
      missingMinutes:attempts.length-knownHeld.length,observedExpectedSymbolMinutes:heldExpected,observedFreshSymbolMinutes:heldFresh,
      observedOnlyRatio:heldExpected>0?heldFresh/heldExpected:null,fullMarketCertified:false},
    accountReconciliation:{scope:JOINT_RECONCILIATION_SCOPE,attempted:accountOutcomes.length,verifiedLocal:accountOutcomes.filter(v=>v==='verified-local').length,
      unsuccessful:accountOutcomes.filter(v=>v==='failed').length,unknown:accountOutcomes.filter(v=>v==='unknown').length,verifiedExternal:false},
    exclusionReasons:[...new Set(rows.flatMap(r=>[...r.exclusions,
      ...(r.liveEligible&&!liveSet.has(r)?['legacy-observation-evidence-not-revalidated']:[])]))],head:rows.at(-1)?.fingerprint || null};
}

function buildUnifiedTaskStatus(evidence = []) {
  const axes = ['code','interface','realData','validation','deployed','observation'];
  const allowed = new Set(['unknown','missing','partial','implemented','connected','available','passed','failed','deployed','not-deployed','waiting','blocked','observing','verified']);
  const safeRef = value => typeof value==='string'&&value.length<=300&&(
    /^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/(?:pull\/[1-9]\d*|commit\/[a-f0-9]{40}|actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?)(?:#[A-Za-z0-9_-]+)?$/.test(value)||
    /^(?:V6_BO|docs|tests)\//.test(value)&&!/[\\?:#\x00-\x20]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  const byId = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) if (Number.isInteger(item?.id) && item.id >= 1 && item.id <= 78 && !byId.has(item.id)) byId.set(item.id,item);
  return Array.from({length:78},(_,index) => {
    const id = index + 1, item = byId.get(id);
    const row = {id,title:TASK_TITLES[id] || null,source:item?.sourceState==='integrated-candidate-inventory'?'integrated-candidate-inventory':id <= 66?'existing-six-group-evidence-required':'depth-decision-increment',
      sourceSha:SHA.test(item?.sourceSha || '')?item.sourceSha:null};
    for (const axis of axes) {
      const value = item?.[axis], refs = Array.isArray(value?.evidence) ? value.evidence.filter(safeRef).slice(0,12) : [];
      row[axis] = {status:allowed.has(value?.status) && refs.length ? value.status:'unknown', evidence:refs};
    }
    return row;
  });
}

function createRuntimeAcceptance({root,appRoot=path.resolve(__dirname,'../..'),canWrite=()=>false,collect=async()=>({}),clock=Date.now,running=null,
  calendar=({asOf})=>readResearchCalendar({asOf}),release=({now})=>inspectReleaseProvenanceAsync({appRoot,now,running}),criteria={},env=process.env,taskEvidence=[],liveCollector=false}={}) {
  privateRoot(root); const profile = criteriaProfile(criteria), profileHash = digest(profile);
  if (typeof canWrite !== 'function' || typeof collect !== 'function' || typeof clock !== 'function' || typeof calendar !== 'function' || typeof release !== 'function') throw Error('acceptance-invalid-adapter');
  let busy = false, lastTick = null, lastError = null, lastObservedAt = null, cachedRelease=null, releaseCheckedAt=null;
  function status() { return {running:busy,lastTick,lastObservedAt,lastError,criteria:profile,criteriaHash:profileHash,readOnlyAccount:true,
    releaseCheckedAt,releaseRecheckIntervalMs:300000}; }
  async function tick() {
    if (busy) return {recorded:false,reason:'busy'};
    if (canWrite() !== true) return {recorded:false,reason:'replica-or-write-disabled'};
    busy = true;
    try {
      const now = clock(); lastTick = now;
      if (!Number.isSafeInteger(now) || now <= 0) throw Error('acceptance-invalid-clock');
      const day = aShareCalendarDate(now), slot = marketSlot(now), cal = calendarView(await calendar({asOf:now}),now);
      if (!cal.available || !cal.tradeDates.includes(day) || slot === null) return {recorded:false,reason:!cal.available?'calendar-unavailable':!cal.tradeDates.includes(day)?'not-trading-day':'outside-observation-session'};
      let snapshot, collectFailed = false; const started = performance.now();
      try { snapshot = await collect({now,day}); } catch { snapshot = {}; collectFailed = true; }
      const metrics = normalizeMetrics(snapshot,now,performance.now()-started), exclusions = [];
      if (!cachedRelease || releaseCheckedAt > now || now-releaseCheckedAt >= 300000) {cachedRelease=await release({now});releaseCheckedAt=now;}
      const proof=cachedRelease;
      if(cal.runtimeEligible!==true)exclusions.push('calendar-not-runtime-eligible');
      if (env.V6_ISOLATED_BOOT_SMOKE === '1' || env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT || !(snapshot?.mode === 'live'||collectFailed&&liveCollector===true)) exclusions.push('isolated-replay-or-unidentified-run');
      if (proof?.verifiedInstalled !== true || !SHA.test(proof?.sourceSha || '')) exclusions.push('verified-installation-required');
      if (!metrics.market.freshQuotes) exclusions.push('no-original-fresh-market-evidence');
      if(metrics.market.nonLiveQuotes>0)exclusions.push('non-live-quote-input');
      if(metrics.market.conflictingSymbols>0)exclusions.push('quote-source-conflict');
      if(metrics.market.invalidIdentities>0)exclusions.push('invalid-quote-identity');
      if(metrics.market.futureQuotes>0)exclusions.push('future-original-quote-time');
      if(metrics.market.invalidPrice>0)exclusions.push('invalid-original-quote-price');
      if(metrics.market.quoteEvidence.truncated===true)exclusions.push('quote-input-limit-exceeded');
      if(metrics.market.expectedSymbols!=null&&metrics.market.observedSymbols>metrics.market.expectedSymbols)exclusions.push('quote-population-mismatch');
      if (collectFailed) exclusions.push('collector-failure');
      const collectedAt=clock();
      if(!Number.isSafeInteger(collectedAt)||collectedAt<now||collectedAt-now>15000)exclusions.push('collection-window-exceeded');
      if (canWrite() !== true) return {recorded:false,reason:'write-authorization-changed'};
      privateRoot(root,true);
      const receipt = withAccountLock(path.join(root,'observations'),()=>{
        if (canWrite() !== true) throw Error('acceptance-write-authorization-changed');
        const days = listDays(root);
        if (days.at(-1) > day) throw Error('acceptance-clock-regressed');
        if (days.length >= MAX_DAYS && !days.includes(day)) throw Error('acceptance-day-limit');
        const rows = readDay(root,day), previous = rows.at(-1);
        if (previous && now <= previous.observedAt) throw Error('acceptance-clock-regressed');
        if (previous && Math.floor(now/60000) === Math.floor(previous.observedAt/60000)) return {recorded:false,reason:'already-observed-minute'};
        if (rows.length >= MAX_SAMPLES) throw Error('acceptance-sample-limit');
        // Receipt preparation time is local evidence, not an external clock or fsync attestation.
        const ready=clock(),evidenceReadyAt=Number.isSafeInteger(ready)&&Number.isSafeInteger(collectedAt)&&collectedAt>=now&&ready>=collectedAt?ready:null;
        if((evidenceReadyAt===null||evidenceReadyAt-now>15000)&&!exclusions.includes('collection-window-exceeded'))exclusions.push('collection-window-exceeded');
        const body = {schemaVersion:1,kind:'server-runtime-observation',origin:'server-collector',sequence:rows.length+1,previous:previous?.fingerprint || null,
          day,observedAt:now,evidenceReadyAt,slot,sourceSha:SHA.test(proof?.sourceSha || '')?proof.sourceSha:null,criteriaHash:profileHash,
          calendar:{source:cal.source,hash:cal.hash,runtimeEligible:cal.runtimeEligible,sourceAuthenticated:cal.sourceAuthenticated},
          releaseCheckedAt,liveEligible:exclusions.length===0,
          // A verified live collector may attempt and fail. Preserve the day in
          // the original review window without counting it as valid coverage.
          attemptEligible:exclusions.every(reason=>RUNTIME_ATTEMPT_REASONS.has(reason))&&metrics.market.nonLiveQuotes===0,
          exclusions,collectFailed,metrics,businessRecordsMutated:false};
        const row = {...body,fingerprint:digest(body)}, bytes=JSON.stringify(row)+'\n', file=path.join(root,day+'.jsonl');
        if (Buffer.byteLength(bytes)>16384) throw Error('acceptance-record-limit');
        const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
        try { const st=fs.fstatSync(fd); if(!st.isFile()||st.nlink!==1||st.mode&0o077||st.size+Buffer.byteLength(bytes)>MAX_DAY_BYTES)throw Error('acceptance-unsafe-file');
          fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
        return {recorded:true,day,liveEligible:row.liveEligible,exclusions,sourceSha:row.sourceSha,fingerprint:row.fingerprint};
      });
      if(receipt.recorded)lastObservedAt=now;lastError=null;return receipt;
    } catch(error) { lastError=/^acceptance-/.test(error.message)?error.message:'acceptance-collection-or-storage-unavailable';return {recorded:false,reason:lastError}; }
    finally {busy=false;}
  }
  async function report() {
    const now=clock();privateRoot(root);const names=listDays(root), byDay=new Map();
    for(const day of names){const rows=readDay(root,day);if(rows.some(r=>r.observedAt>now||r.evidenceReadyAt>now))throw Error('acceptance-future-record');byDay.set(day,summarizeDay(day,rows,now,profile));await yieldTurn();}
    let cal;
    try{cal=calendarView(await calendar({asOf:now}),now);}catch{cal=calendarView(null,now);}
    const attemptedDays=names.filter(d=>byDay.get(d).attemptSamples>0),first=attemptedDays[0]||null,today=aShareCalendarDate(now);
    const currentMinute=new Date(now+8*3600000).getUTCHours()*60+new Date(now+8*3600000).getUTCMinutes();
    const expected=first&&cal.available&&cal.runtimeEligible?cal.tradeDates.filter(day=>day>=first&&day<=today):[];
    const expectedSet=new Set(expected),omittedAttemptDays=cal.available&&cal.runtimeEligible?attemptedDays.filter(day=>!expectedSet.has(day)):[];
    const comparable=cal.available&&cal.runtimeEligible&&typeof cal.source==='string'&&HASH.test(cal.hash||'');
    const versionMismatchDays=comparable?attemptedDays.filter(day=>byDay.get(day).calendarVersions.some(v=>typeof v.source==='string'&&HASH.test(v.hash||'')&&(v.source!==cal.source||v.hash!==cal.hash))):[];
    const unverifiedVersionDays=attemptedDays.filter(day=>!comparable||byDay.get(day).calendarVersions.some(v=>typeof v.source!=='string'||!HASH.test(v.hash||'')));
    const windowCoverageConfirmed=first===null?null:!!(comparable&&validDay(cal.from)&&validDay(cal.to)&&cal.from<=first&&cal.to>=today&&!omittedAttemptDays.length&&!versionMismatchDays.length&&!unverifiedVersionDays.length);
    // A later calendar must not erase an originally qualified attempt (even a
    // failed one), or silently reset the five/twenty/sixty-day review window.
    // Without comparable calendar evidence these are known days, not a complete
    // elapsed trading-day population. No stored journal is rewritten.
    const population=[...new Set([...expected,...attemptedDays])].sort();
    const days=population.map(day=>byDay.get(day)||summarizeDay(day,[],now,profile));
    const completed=days.filter(d=>d.day<today||d.day===today&&currentMinute>=960);
    const criteriaReady=['minimumMatureSamples','maximumDrawdownPct','maximumCalibrationError'].every(k=>profile[k]!==null);
    const stages=[5,20,60].map(target=>{
      const window=completed.slice(0,target),reached=window.length>=target;
      const blockers=[...new Set(window.flatMap(d=>[...d.failures,...d.unknown.map(s=>'unknown:'+s)]))];
      if(cal.runtimeEligible!==true)blockers.push('calendar-not-runtime-eligible');
      if(windowCoverageConfirmed===false)blockers.push('calendar-window-coverage-unverified');
      if(omittedAttemptDays.length)blockers.push('calendar-attempt-days-omitted');
      if(versionMismatchDays.length)blockers.push('calendar-version-changed-requires-review');
      if(unverifiedVersionDays.length)blockers.push('calendar-version-evidence-unverified');
      if(!criteriaReady)blockers.push('strategy-acceptance-criteria-not-established');
      if(window.some(d=>!d.completeObservation))blockers.push('incomplete-observation-day');
      if(new Set(window.flatMap(d=>d.sourceShas)).size>1)blockers.push('multiple-versions-require-comparability-review');
      if(window.some(d=>d.criteriaHashes.some(h=>h!==profileHash)))blockers.push('criteria-changed-requires-review');
      return {tradingDays:target,elapsedTradingDays:window.length,completeObservationDays:window.filter(d=>d.completeObservation).length,
        windowReached:reached,status:!reached?'pending-real-observation':blockers.length?'evidence-or-remediation-required':'ready-for-independent-review',
        passed:false,blockers:[...new Set(blockers)],from:window[0]?.day||null,to:window.at(-1)?.day||null};
    });
    const segments=[];
    for(const d of days)for(const sha of d.sourceShas){let s=segments.find(x=>x.sourceSha===sha);if(!s){s={sourceSha:sha,firstDay:d.day,lastDay:d.day,observedDays:0};segments.push(s);}s.lastDay=d.day;s.observedDays++;}
    return {schemaVersion:1,task:78,generatedAt:new Date(now).toISOString(),kind:'real-runtime-acceptance',criteria:profile,criteriaHash:profileHash,
      calendar:{status:!cal.available?'unavailable':cal.runtimeEligible?'available':'research-only',source:cal.source,hash:cal.hash,
        runtimeEligible:cal.runtimeEligible,sourceAuthenticated:cal.sourceAuthenticated,
        windowCoverageConfirmed,omittedAttemptDays,versionMismatchDays,unverifiedVersionDays,
        restriction:cal.runtimeEligible?null:'calendar-not-runtime-eligible'},
      observedTradingDays:days.filter(d=>d.liveSamples>0).length,completeObservationDays:completed.filter(d=>d.completeObservation).length,
      elapsedTradingDays:completed.length,elapsedTradingDaysComplete:windowCoverageConfirmed,missingTradingDays:completed.filter(d=>d.status==='missing').map(d=>d.day),
      isolatedOrUnverifiedDays:names.filter(d=>!byDay.get(d).liveSamples),excludedDayEvidence:names.filter(d=>!byDay.get(d).liveSamples).map(d=>byDay.get(d)),days,stages,versionSegments:segments,
      tasks:buildUnifiedTaskStatus(taskEvidence),businessRecordsMutated:false,longTermAccepted:false,
      distinctions:{warning:'observation only',queued:'not delivery',delivered:'receipt required',intent:'not an order',submittedOrder:'not a fill',confirmedFill:'original execution evidence only'},
      limitations:['Local records are not external clock or source attestations.','Elapsed time and perturbation stability do not establish strategy profitability.','Historical imports and synthetic runs never add live observation days.']};
  }
  return {tick,report,status};
}

// Explicit operator-only quality projection. The original sampler remains the
// sole writer; no caller-supplied observations can be promoted to live evidence.
const RUNTIME_QUALITY_POPULATION='original-runtime-collector-and-dual-account-minute-checks';
const RUNTIME_ATTEMPT_REASONS=new Set(['no-original-fresh-market-evidence','collector-failure','collection-window-exceeded','quote-source-conflict','quote-input-limit-exceeded','quote-population-mismatch','invalid-quote-identity','future-original-quote-time','invalid-original-quote-price']);
const qualifiedRuntimeRow=row=>row.calendar?.runtimeEligible===true&&SHA.test(row.sourceSha||'')&&
  row.metrics?.market?.quoteEvidence?.schemaVersion===1&&row.metrics.market.nonLiveQuotes===0;
function runtimeQualityAttempt(row){
  return qualifiedRuntimeRow(row)&&(row.attemptEligible===true||row.liveEligible===true)&&Array.isArray(row.exclusions)&&
    row.exclusions.every(reason=>RUNTIME_ATTEMPT_REASONS.has(reason));
}
// Old on-time rows only establish an upper bound on collection completion.
// Untimed late/clock-regressed rows are known on a current local read, but
// must not invent a completion time in an earlier point-in-time projection.
function runtimeEvidenceAvailable(row,cutoff,now){
  if(Number.isSafeInteger(row.evidenceReadyAt))return row.evidenceReadyAt<=cutoff;
  if(cutoff===now)return true;
  return !Object.hasOwn(row,'evidenceReadyAt')&&Array.isArray(row.exclusions)&&
    !row.exclusions.includes('collection-window-exceeded')&&row.observedAt+15000<=cutoff;
}
function evaluateRuntimeQuality({root,input,now=Date.now()}={}){
  const {evaluateProductQuality,fingerprintPlan}=require('./product-quality-evaluation');
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['revision','asOf','window','scope','plan'].includes(key)))
    throw Error('acceptance-quality-plan-only');
  const {revision,asOf,window,scope,plan}=input;
  // Reuse the original metric, date, scope and safety-threshold validation.
  evaluateProductQuality({...input,observations:[]});
  if(scope.kind!=='real-market-paper'||scope.population!==RUNTIME_QUALITY_POPULATION||!window||!plan)
    throw Error('acceptance-quality-scope-required');
  const start=Date.parse(window.start),end=Date.parse(window.end),cutoff=Date.parse(asOf),schedule=plan.runtimeSchedule;
  if(!Number.isSafeInteger(now)||cutoff>now||start%60000||end%60000||end-start>120*86400000)
    throw Error('acceptance-quality-window-invalid');
  if(!schedule||Array.isArray(schedule)||Object.keys(schedule).some(key=>!['calendarSource','calendarHash','tradeDates','heldPopulation'].includes(key))||
     typeof schedule.calendarSource!=='string'||version(schedule.calendarSource)!==schedule.calendarSource||
     typeof schedule.calendarHash!=='string'||!HASH.test(schedule.calendarHash)||
     !Array.isArray(schedule.tradeDates)||!schedule.tradeDates.length||schedule.tradeDates.length>60||
     !schedule.tradeDates.every((day,index)=>validDay(day)&&(!index||day>schedule.tradeDates[index-1])))
    throw Error('acceptance-quality-schedule-invalid');
  const heldPopulation=schedule.heldPopulation;
  if(heldPopulation!==undefined&&(!heldPopulation||Array.isArray(heldPopulation)||typeof heldPopulation!=='object'||
    Object.keys(heldPopulation).some(key=>!['sha256','count'].includes(key))||!HASH.test(heldPopulation.sha256||'')||
    !Number.isSafeInteger(heldPopulation.count)||heldPopulation.count<1||heldPopulation.count>10000))
    throw Error('acceptance-quality-held-population-invalid');
  const expected=new Set();
  for(const day of schedule.tradeDates){
    const midnight=Date.parse(day+'T00:00:00+08:00');let minutes=0;
    for(let m=570;m<900;m++){
      const at=midnight+m*60000;
      if(marketSlot(at)===null||at<start||at>=end)continue;
      expected.add(at);minutes++;
    }
    if(!minutes)throw Error('acceptance-quality-schedule-outside-window');
  }
  if(!expected.size)throw Error('acceptance-quality-schedule-empty');
  const directory=privateRoot(root),first=aShareCalendarDate(start),last=aShareCalendarDate(end-1),records=[];
  const days=listDays(directory).filter(day=>day>=first&&day<=last);
  const seen=new Set();let incomparable=0,unknownAccountChecks=0,knownAccountFailures=0,verifiedLocalAccountChecks=0,operationSamples=0,operationFailures=0,heldSamples=0,heldFresh=0;
  for(const day of days)for(const row of readDay(directory,day)){
    if(row.observedAt>now||row.evidenceReadyAt>now)throw Error('acceptance-future-record');
    if(row.observedAt<start||row.observedAt>=end||row.observedAt>cutoff||!runtimeEvidenceAvailable(row,cutoff,now))continue;
    const minute=Math.floor(row.observedAt/60000)*60000;
    if(seen.has(minute))throw Error('acceptance-quality-duplicate-minute');
    seen.add(minute);
    const qualified=runtimeQualityAttempt(row),sameVersion=row.sourceSha===revision;
    if(qualified&&sameVersion&&!expected.has(minute))throw Error('acceptance-quality-schedule-omits-observation');
    if(!expected.has(minute))continue;
    records.push(row.fingerprint);
    const sameCalendar=row.calendar?.source===schedule.calendarSource&&row.calendar?.hash===schedule.calendarHash;
    if(!qualified||!sameVersion){incomparable++;continue;}
    // Older positive booleans remain unknown. A local positive receipt needs
    // both original books, verified opening/quantity flow and matching calendar.
    // A known unsuccessful check is retained even if calendar scope differs.
    const accountOutcome=jointReconciliationOutcome(row.metrics?.execution,row.observedAt,cutoff);
    if(accountOutcome==='failed')knownAccountFailures++;
    else if(accountOutcome==='verified-local'&&sameCalendar&&!row.exclusions.includes('collection-window-exceeded'))verifiedLocalAccountChecks++;
    else unknownAccountChecks++;
    if(!sameCalendar||row.metrics.market.quoteEvidence.conflictPolicy!=='explicit-and-duplicate-v1'){
      incomparable++;continue;
    }
    const m=row.metrics.market;
    const held=normalizeHeldMonitor(m.heldMonitor,row.observedAt);
    if(heldPopulation&&held&&held.populationHash===heldPopulation.sha256&&held.expectedSymbols===heldPopulation.count&&
      !row.exclusions.includes('collection-window-exceeded')){
      heldSamples+=held.expectedSymbols;heldFresh+=held.freshSymbols;
    }
    const failed=row.collectFailed===true||row.exclusions.length>0||m.futureQuotes>0||m.invalidPrice>0||
      m.conflictingSymbols>0||m.invalidIdentities>0||m.quoteEvidence.truncated===true||
      m.expectedSymbols!=null&&m.observedSymbols>m.expectedSymbols;
    if(failed){operationSamples++;operationFailures++;}
    else if(row.collectFailed===false&&row.liveEligible===true&&m.freshQuotes>0){operationSamples++;}
  }
  // This fingerprint references the exact locally-read row hash chain subset,
  // including excluded versions/failed rows. Empty reads are not live evidence.
  const refs=[{id:'runtime-observation-window-row-hashes-v1',sha256:digest({revision,window,cutoff,schedule,records})}];
  const common={revision,window,scopeKind:scope.kind,population:scope.population,planVersion:plan.version,planFingerprint:fingerprintPlan(plan),
    unit:'ratio',denominator:expected.size,evidenceRefs:refs};
  const report=evaluateProductQuality({...input,observations:[
    {...common,metricId:'operation-failure',numerator:operationFailures,sampleCount:operationSamples},
    {...common,metricId:'ledger-reconciliation',numerator:verifiedLocalAccountChecks,sampleCount:knownAccountFailures+verifiedLocalAccountChecks},
    ...(heldPopulation?[{...common,metricId:'valid-data-coverage',denominator:expected.size*heldPopulation.count,numerator:heldFresh,sampleCount:heldSamples}]:[])
  ]});
  return {...report,runtimeEvidence:{mode:'original-runtime-journal-readonly',population:RUNTIME_QUALITY_POPULATION,
    expectedMinutes:expected.size,recordedMinutes:records.length,comparableOperationMinutes:operationSamples,incomparableMinutes:incomparable,
    unsuccessfulJointAccountChecks:knownAccountFailures,verifiedLocalJointAccountChecks:verifiedLocalAccountChecks,unprovenJointAccountChecks:unknownAccountChecks,
    rowHashesFingerprint:refs[0].sha256,calendarSource:schedule.calendarSource,calendarHash:schedule.calendarHash,
    evidenceTimeBasis:'local-receipt-preparation; legacy-on-time-15s-collection-bound; untimed-late-current-read-only',
    scheduleVerification:'input-declared-not-independently-certified',operationScope:'local-runtime-observation-tick-not-all-business-operations',
    accountScope:'original-paper-local-joint-reconciliation-only-no-external-broker-verification',
    heldCoverage:heldPopulation?{scope:'original-monitor-held-symbols-v1',expectedSymbolMinutes:expected.size*heldPopulation.count,
      observedSymbolMinutes:heldSamples,freshSymbolMinutes:heldFresh,missingSymbolMinutes:expected.size*heldPopulation.count-heldSamples,fullMarketCertified:false}:null,
    sourceRecordsMutated:false,verifiedExternal:false}};
}

module.exports={createRuntimeAcceptance,buildUnifiedTaskStatus,marketSlot,DEFAULT_CRITERIA,TASK_TITLES,evaluateRuntimeQuality,RUNTIME_QUALITY_POPULATION,observeOriginalAccountReconciliation};
