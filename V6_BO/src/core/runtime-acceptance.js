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
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const truth = value => typeof value === 'boolean' ? value : null;
const version = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value) ? value : null;
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const TASK_TITLES = Object.freeze({67:'事件影响研究库',68:'预期差分析',69:'产业与公司关系图谱',70:'盘口与竞价研究',
  71:'交易时段策略适用性',72:'主题拥挤与集中风险',73:'组合目标权重研究',74:'换仓收益与成本门槛',
  75:'决策稳健性检查',76:'事前决策对照复盘',77:'交付来源与版本可信验证',78:'全系统真实运行验收'});
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
  if (value.status === 'available' && Array.isArray(dates) && dates.length <= 1000 &&
      dates.every(d => DAY.test(d)) && typeof metadata.source === 'string') return {available:true,...qualification,
    source: version(metadata.source), hash: HASH.test(metadata.sha256 || '') ? metadata.sha256 : null,
    tradeDates: [...new Set(dates)].sort(), from:metadata.from || null, to:metadata.to || null};
  // Existing authority-calendar object can be injected by the server. It is not
  // accepted from an HTTP body; the same explicit calendar checks each date.
  if (typeof value.isOpen === 'function' && DAY.test(metadata.from || '') && DAY.test(metadata.to || '') &&
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

function normalizeMetrics(input, now, collectionMs) {
  const m = input?.market || {}, supplied=Array.isArray(m.quotes)?m.quotes:[],quotes=supplied.slice(0,10000),unique=new Map();
  const inputHash=crypto.createHash('sha256').update('fayo-runtime-quote-input-v1\n');
  const sample=[],flagNames=['canTrade','simulated','readOnlyBackup','imported','fixture','mock','synthetic','tradable','suspended'];
  for (const q of quotes) {
    const source=version(q?.source),row={...q,quoteSource:source},view=quoteObservationView(row,now),sourceAllowed=quoteSourceAllowsUse(row);
    const clean={code:typeof q?.code==='string'&&/^\d{6}$/.test(q.code)?q.code:null,source,price:number(q?.price),
      quoteAt:view.quoteAt,receivedAt:view.receivedAt,quoteMode:version(q?.quoteMode),mode:version(q?.mode),sourceAllowed,
      flags:Object.fromEntries(flagNames.filter(key=>typeof q?.[key]==='boolean').map(key=>[key,q[key]]))};
    // Hash every whitelisted input within the explicit processing limit,
    // including duplicate/invalid identities. Never hash or retain credentials.
    inputHash.update(JSON.stringify(clean)+'\n');
    if (!clean.code || unique.has(clean.code)) continue;
    unique.set(clean.code,{view,clean});
  }
  let fresh=0,known=0,missing=0,stale=0,future=0,nonLive=0,invalidPrice=0;const sources=new Set();
  for (const {view,clean} of unique.values()) {
    const allowed=clean.sourceAllowed;
    const validPrice=clean.price!==null&&clean.price>0,at=view.quoteAt,received=view.receivedAt;
    if(!validPrice)invalidPrice++;
    if(!allowed)nonLive++;
    if(at!==null&&at>now||received!==null&&(received>now||at!==null&&received<at))future++;
    else if(at===null||!clean.source||received===null)missing++;
    else{known++;sources.add(clean.source);if(now-at>15000)stale++;}
    const eligibleFresh=validPrice&&allowed&&view.quoteStatus==='recent-unverified'&&view.missingReason===null;
    if(eligibleFresh)fresh++;
    if(sample.length<10)sample.push({...clean,sampled:true,quoteStatus:view.quoteStatus,eligibleFresh,
      reason:!validPrice?'invalid-price':!allowed?'observation-only-source':view.missingReason||(eligibleFresh?'fresh-original-quote':'unclassified-quote')});
  }
  const expected = count(m.expectedSymbols), r = input?.risk || {}, e = input?.execution || {}, s = input?.strategy || {}, c = input?.clients || {};
  const observed = unique.size, attempts = count(m.attempts), successes = count(m.successes);
  return {market:{expectedSymbols:expected, observedSymbols:observed, freshQuotes:fresh, knownOriginalTimes:known,
    missingOriginalTimes:missing,staleQuotes:stale,futureQuotes:future,nonLiveQuotes:nonLive,invalidPrice,
    sources:[...sources].sort().slice(0,32),sourceCount:sources.size,sourcesTruncated:sources.size>32,
    quoteEvidence:{schemaVersion:1,sampled:true,sampling:'first-10-unique-symbols-in-server-input-order',sampleLimit:10,samples:sample,
      sampleTruncated:unique.size>sample.length,totalSeen:supplied.length,processedInputs:quotes.length,maxInputs:10000,
      truncated:supplied.length>quotes.length,inputDigest:inputHash.digest('hex'),
      digestScope:supplied.length>quotes.length?'whitelisted-processed-prefix':'all-whitelisted-inputs',observedAt:now},
    coverage:expected > 0 && observed <= expected ? observed / expected : null,
    freshCoverage:expected > 0 && fresh <= expected ? fresh / expected : null,
    attempts, successes, collectionSuccess:attempts > 0 && successes !== null && successes <= attempts ? successes / attempts : null},
    risk:Object.fromEntries(['observed','queued','delivered','resolved','falsePositives','falseNegatives'].map(k => [k,count(r[k])]).concat([
      ['deliveryDelayMs',number(r.deliveryDelayMs) !== null && r.deliveryDelayMs >= 0 ? r.deliveryDelayMs : null]])),
    execution:{...Object.fromEntries(['intents','submittedOrders','confirmedFills','paperFills'].map(k => [k,count(e[k])])),
      reconciled:truth(e.reconciled), recoveryVerified:truth(e.recoveryVerified)},
    strategy:{matureSamples:count(s.matureSamples), netReturnPct:number(s.netReturnPct), maxDrawdownPct:number(s.maxDrawdownPct), calibrationError:number(s.calibrationError)},
    clients:{desktopVersion:version(c.desktopVersion),mobileVersion:version(c.mobileVersion),apiVersion:version(c.apiVersion),
      permissionsConsistent:truth(c.permissionsConsistent),featuresConsistent:truth(c.featuresConsistent)},
    system:{collectionMs:Math.max(0,Math.round(collectionMs * 100) / 100), rssBytes:process.memoryUsage().rss, uptimeSeconds:Math.round(process.uptime())}};
}

function summarizeDay(day, rows, now, criteria) {
  // Older records remain intact, but a prior boolean without the now-required
  // runtime calendar and quote audit evidence cannot certify a real day.
  const live=rows.filter(row=>row.liveEligible&&row.calendar?.runtimeEligible===true&&
    row.metrics?.market?.quoteEvidence?.schemaVersion===1&&row.metrics.market.freshQuotes>0),liveSet=new Set(live),slots=new Set(live.map(r=>r.slot));
  const attempts=rows.filter(row=>liveSet.has(row)||row.attemptEligible===true&&row.calendar?.runtimeEligible===true&&SHA.test(row.sourceSha||'')&&row.metrics?.market?.quoteEvidence?.schemaVersion===1&&row.metrics.market.nonLiveQuotes===0&&Array.isArray(row.exclusions)&&row.exclusions.every(reason=>['no-original-fresh-market-evidence','collector-failure','collection-window-exceeded'].includes(reason)));
  const morning = [...slots].filter(n => n < 24).length, afternoon = [...slots].filter(n => n >= 24).length;
  const ended = day < aShareCalendarDate(now) || day === aShareCalendarDate(now) && new Date(now + 8 * 3600000).getUTCHours() >= 16;
  const fullCoverage = slots.size >= criteria.minimumSlots && morning >= criteria.minimumSessionSlots && afternoon >= criteria.minimumSessionSlots &&
    slots.has(0) && slots.has(23) && slots.has(24) && slots.has(47);
  const sourceShas = [...new Set(attempts.map(r => r.sourceSha))], profileHashes = [...new Set(rows.map(r => r.criteriaHash))];
  const metric = (fn, values = live) => values.map(fn).filter(v => v !== null && v !== undefined);
  const latencies = metric(r => r.metrics.system.collectionMs).sort((a,b) => a-b);
  const latest = live.at(-1)?.metrics || rows.at(-1)?.metrics || null;
  const unknown = [], failures = [];
  for (const [name, present] of [
    ['marketCoverage',live.length > 0 && live.every(r => r.metrics.market.freshCoverage !== null)],
    ['collectionSuccess',live.length > 0 && live.every(r => r.metrics.market.collectionSuccess !== null)],
    ['riskEffectiveness',latest?.risk.falsePositives !== null && latest?.risk.falsePositives !== undefined && latest?.risk.falseNegatives !== null && latest?.risk.falseNegatives !== undefined],
    ['notificationDelivery',latest?.risk.delivered !== null && latest?.risk.delivered !== undefined && latest?.risk.deliveryDelayMs !== null && latest?.risk.deliveryDelayMs !== undefined],
    ['accountReconciliation',latest?.execution.reconciled !== null && latest?.execution.reconciled !== undefined],
    ['recoveryEvidence',latest?.execution.recoveryVerified !== null && latest?.execution.recoveryVerified !== undefined],
    ['strategyOutcomes',latest?.strategy.matureSamples > 0 && latest?.strategy.netReturnPct !== null && latest?.strategy.maxDrawdownPct !== null],
    ['modelCalibration',latest?.strategy.calibrationError !== null && latest?.strategy.calibrationError !== undefined],
    ['dualClientParity',latest?.clients.permissionsConsistent !== null && latest?.clients.permissionsConsistent !== undefined && latest?.clients.featuresConsistent !== null && latest?.clients.featuresConsistent !== undefined && !!latest?.clients.desktopVersion && !!latest?.clients.mobileVersion && !!latest?.clients.apiVersion]
  ]) if (!present) unknown.push(name);
  if (!fullCoverage) failures.push('insufficient-session-coverage');
  if (sourceShas.length > 1 || profileHashes.length > 1) failures.push('version-or-criteria-changed-within-day');
  if (live.some(r => r.metrics.market.freshCoverage !== null && r.metrics.market.freshCoverage < criteria.minimumFreshCoverage)) failures.push('quote-coverage-below-criterion');
  if (rows.some(r => r.collectFailed)) failures.push('collector-failure');
  if (rows.some(r => r.metrics.market.futureQuotes > 0)) failures.push('future-original-quote-time');
  if (rows.some(r => r.metrics.market.invalidPrice > 0)) failures.push('invalid-original-quote-price');
  const p95 = latencies.length ? latencies[Math.min(latencies.length-1,Math.ceil(latencies.length * .95)-1)] : null;
  if (p95 !== null && p95 > criteria.maximumCollectionP95Ms) failures.push('collection-latency');
  if (live.some(r => r.metrics.risk.falseNegatives > 0)) failures.push('risk-false-negative-observed');
  if (live.some(r => r.metrics.risk.deliveryDelayMs > criteria.maximumDeliveryDelayMs)) failures.push('notification-delay');
  if (attempts.some(r => r.metrics.execution.reconciled === false)) failures.push('account-reconciliation-failed');
  if (live.some(r => r.metrics.execution.recoveryVerified === false)) failures.push('recovery-not-verified');
  if (live.some(r => r.metrics.clients.permissionsConsistent === false || r.metrics.clients.featuresConsistent === false ||
      r.metrics.clients.desktopVersion && r.metrics.clients.mobileVersion && r.metrics.clients.apiVersion &&
      new Set([r.metrics.clients.desktopVersion,r.metrics.clients.mobileVersion,r.metrics.clients.apiVersion]).size > 1)) failures.push('dual-client-mismatch');
  if (criteria.minimumMatureSamples !== null && (latest?.strategy.matureSamples ?? 0) < criteria.minimumMatureSamples) failures.push('insufficient-mature-samples');
  if (criteria.maximumDrawdownPct !== null && latest?.strategy.maxDrawdownPct > criteria.maximumDrawdownPct) failures.push('drawdown-limit');
  if (criteria.maximumCalibrationError !== null && latest?.strategy.calibrationError > criteria.maximumCalibrationError) failures.push('calibration-limit');
  return {day,status:!rows.length?'missing':!ended?'in-progress':!live.length?'excluded':!fullCoverage?'observed-partial':failures.length?'observed-with-failures':unknown.length?'observed-awaiting-evidence':'observed-reviewable',
    samples:rows.length,liveSamples:live.length,attemptSamples:attempts.length,excludedSamples:rows.length-live.length,slots:slots.size,morningSlots:morning,afternoonSlots:afternoon,
    completeObservation:ended && fullCoverage,sourceShas,criteriaHashes:profileHashes,
    firstObservedAt:rows[0]?.observedAt || null,lastObservedAt:rows.at(-1)?.observedAt || null,
    collectionP95Ms:p95,minimumFreshCoverage:live.length && live.every(r=>r.metrics.market.freshCoverage!==null)?Math.min(...live.map(r=>r.metrics.market.freshCoverage)):null,
    unknown,failures:[...new Set(failures)],latest,
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
    const row = {id,title:TASK_TITLES[id] || null,source:id <= 66?'existing-six-group-evidence-required':'depth-decision-increment',
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
      if (collectFailed) exclusions.push('collector-failure');
      if (clock() < now || clock() - now > 15000) exclusions.push('collection-window-exceeded');
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
        const body = {schemaVersion:1,kind:'server-runtime-observation',origin:'server-collector',sequence:rows.length+1,previous:previous?.fingerprint || null,
          day,observedAt:now,slot,sourceSha:SHA.test(proof?.sourceSha || '')?proof.sourceSha:null,criteriaHash:profileHash,
          calendar:{source:cal.source,hash:cal.hash,runtimeEligible:cal.runtimeEligible,sourceAuthenticated:cal.sourceAuthenticated},
          releaseCheckedAt,liveEligible:exclusions.length===0,
          // A verified live collector may attempt and fail. Preserve the day in
          // the original review window without counting it as valid coverage.
          attemptEligible:exclusions.every(reason=>['no-original-fresh-market-evidence','collector-failure','collection-window-exceeded'].includes(reason))&&metrics.market.nonLiveQuotes===0,
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
    for(const day of names){const rows=readDay(root,day);if(rows.some(r=>r.observedAt>now))throw Error('acceptance-future-record');byDay.set(day,summarizeDay(day,rows,now,profile));await yieldTurn();}
    const cal=calendarView(await calendar({asOf:now}),now),first=names.find(d=>byDay.get(d).attemptSamples>0)||null,today=aShareCalendarDate(now);
    const currentMinute=new Date(now+8*3600000).getUTCHours()*60+new Date(now+8*3600000).getUTCMinutes();
    const expected=first&&cal.available?cal.tradeDates.filter(day=>day>=first&&day<=today):[];
    const days=expected.map(day=>byDay.get(day)||summarizeDay(day,[],now,profile));
    const completed=days.filter(d=>d.day<today||d.day===today&&currentMinute>=960);
    const criteriaReady=['minimumMatureSamples','maximumDrawdownPct','maximumCalibrationError'].every(k=>profile[k]!==null);
    const stages=[5,20,60].map(target=>{
      const window=completed.slice(0,target),reached=window.length>=target;
      const blockers=[...new Set(window.flatMap(d=>[...d.failures,...d.unknown.map(s=>'unknown:'+s)]))];
      if(cal.runtimeEligible!==true)blockers.push('calendar-not-runtime-eligible');
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
        restriction:cal.runtimeEligible?null:'calendar-not-runtime-eligible'},
      observedTradingDays:days.filter(d=>d.liveSamples>0).length,completeObservationDays:completed.filter(d=>d.completeObservation).length,
      elapsedTradingDays:completed.length,missingTradingDays:completed.filter(d=>d.status==='missing').map(d=>d.day),
      isolatedOrUnverifiedDays:names.filter(d=>!byDay.get(d).liveSamples),excludedDayEvidence:names.filter(d=>!byDay.get(d).liveSamples).map(d=>byDay.get(d)),days,stages,versionSegments:segments,
      tasks:buildUnifiedTaskStatus(taskEvidence),businessRecordsMutated:false,longTermAccepted:false,
      distinctions:{warning:'observation only',queued:'not delivery',delivered:'receipt required',intent:'not an order',submittedOrder:'not a fill',confirmedFill:'original execution evidence only'},
      limitations:['Local records are not external clock or source attestations.','Elapsed time and perturbation stability do not establish strategy profitability.','Historical imports and synthetic runs never add live observation days.']};
  }
  return {tick,report,status};
}

module.exports={createRuntimeAcceptance,buildUnifiedTaskStatus,marketSlot,DEFAULT_CRITERIA,TASK_TITLES};
