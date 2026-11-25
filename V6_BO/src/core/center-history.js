'use strict';
/** Independent HFQ research archive. Never writes lastPx, old K-line caches,
 * shortline bars, accounts, permissions or production weights. New histories
 * retain the actual receipt time even when the vendor row describes an old day.
 */
const fs = require('node:fs'), path = require('node:path');
const {execFile,spawnSync} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash} = require('node:crypto');
const store = require('./research-workspace-store');
const {sourceLineage} = require('./data-source-lineage');
const {requestResearchBytes} = require('./research-curl-bytes');
const {marketRequests} = require('./market-request-governor');
const run = promisify(execFile);
const PROTOCOL = 'center-hfq-history-v1', MAX_CODES = 20, MAX_DAYS = 400;
const flags = {researchOnly:true, canTrade:false, canNotify:false, productionWeightsChanged:false};
const codeOk = code => typeof code === 'string' && /^(?:60|68|00|30)\d{4}$/.test(code);
const dayOk = day => typeof day === 'string' && /^\d{4}-\d\d-\d\d$/.test(day) &&
  Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
const timeOk = at => Number.isSafeInteger(at) && at > 0 && at < 8e15;
const cnDay = at => new Date(at + 28800000).toISOString().slice(0,10);
const close = day => Date.parse(day + 'T15:00:00+08:00');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const number = value => typeof value === 'number' && Number.isFinite(value) ? value :
  typeof value === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
const addDays = (day, count) => new Date(Date.parse(day) + count * 86400000).toISOString().slice(0,10);
const fields = ['open','high','low','close','volume','amount'];
const endpoint = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

function requestUrl(code, day, historyDays) {
  if (!codeOk(code) || !dayOk(day) || !Number.isSafeInteger(historyDays) || historyDays < 2 || historyDays > MAX_DAYS)
    throw Error('中心历史采集代码、日期或范围无效');
  return endpoint + '?' + new URLSearchParams({secid:(code.startsWith('6') ? '1.' : '0.') + code,
    klt:'101', fqt:'2', lmt:String(historyDays), end:day.replaceAll('-',''),
    fields1:'f1,f2,f3,f4,f5,f6', fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'});
}
function captureBase(source, code, day, receivedAt, raw, request) {
  if (!codeOk(code) || !dayOk(day) || !timeOk(receivedAt) || receivedAt < close(day) ||
      !Buffer.isBuffer(raw) || !raw.length || raw.length > 1024 * 1024) throw Error('中心历史原始回执无效');
  return {protocol:PROTOCOL, source, code, throughDay:day, receivedAt, request,
    rawHash:hash(raw), rawEvidence:{encoding:'base64', data:raw.toString('base64'),
      byteLength:raw.length, hashBasis:source === 'baostock' ? 'sdk-field-snapshot' : 'raw-response-bytes'}, ...flags};
}
function checkedBar(raw, base, date, values, suspended, turn) {
  if (!dayOk(date) || date > base.throughDay || close(date) > base.receivedAt) throw Error('历史日期未闭合或超出请求');
  const [open, high, low, last, volume, amount] = values;
  if (![open,high,low,last,volume,amount].every(Number.isFinite) || Math.min(open,high,low,last) <= 0 ||
      high < Math.max(open,last,low) || low > Math.min(open,last) || !Number.isSafeInteger(volume) || volume < 0 ||
      amount < 0 || (volume === 0) !== (amount === 0) || suspended === true && volume !== 0)
    throw Error('历史 OHLCV、成交额或停牌字段无效');
  return {code:base.code, date, day:date, market:'CN', role:'stock', period:'日K',
    adjustment:'hfq', source:base.source, currency:'CNY', volumeUnit:'shares', amountUnit:'CNY',
    open, high, low, close:last, volume, amount, suspended,
    ...(Number.isFinite(turn) && turn >= 0 && turn <= 100 ? {turnover:turn} : {}),
    // periodEndAt describes the row's bar interval, not when it was published or
    // first known. observedAt/knownAt always remain the actual collection clock.
    observedAt:base.receivedAt, knownAt:base.receivedAt, sourceTimestamp:null,
    periodEndAt:close(date), sourceDate:date, observationKind:'historical-daily-bar',
    captureProtocol:PROTOCOL, rawHash:base.rawHash, rawRowHash:hash(JSON.stringify(raw)),
    firstKnownBasis:'actual-provider-receipt', sampleSet:'real', ...flags};
}
function normalizeEastmoney(raw, {code, day, historyDays, receivedAt}) {
  const target = requestUrl(code,day,historyDays), base = captureBase('eastmoney-public-history',code,day,receivedAt,raw,target);
  const data = JSON.parse(raw.toString('utf8')), payload = data?.data;
  if (data.rc !== 0 || payload?.code !== code || payload.market !== (code.startsWith('6') ? 1 : 0) ||
      !Array.isArray(payload.klines) || payload.klines.length > historyDays) throw Error('东财后复权证券身份或行数无效');
  let previous = '';
  const bars = payload.klines.map(row => {
    const v = typeof row === 'string' ? row.split(',') : [];
    if (v.length !== 11 || v[0] <= previous) throw Error('东财后复权日线结构或排序无效');
    previous = v[0];
    return checkedBar(row,base,v[0],[number(v[1]),number(v[3]),number(v[4]),number(v[2]),number(v[5])*100,number(v[6])],
      number(v[5]) === 0 ? null : false, number(v[10]));
  });
  return {...base,status:bars.length ? 'observed' : 'empty',bars,calendar:null,
    adjustmentEvidence:{requestField:'fqt',value:'2',mode:'hfq',
      reference:'https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_hist_em.py'},
    limitations:['供应商未提供历史首次发布时间；首次可知时间采用实际取得时刻。']};
}
function normalizeBaoStock(raw, {code,day,historyDays,receivedAt}) {
  const payload = JSON.parse(raw.toString('utf8'));
  if (['missing-dependency','source-failed'].includes(payload?.status))
    return {source:'baostock',status:payload.status,bars:[],calendar:null,receivedAt,...flags};
  const request = payload?.request;
  if (payload?.schemaVersion !== 1 || payload.source !== 'baostock' || payload.code !== code ||
      payload.captureKind !== 'sdk-field-snapshot' || request?.adjustflag !== '1' || request.frequency !== 'd' ||
      request.end !== day || !dayOk(request.start) || request.start >= day ||
      !timeOk(payload.startedAt) || !timeOk(payload.receivedAt) || !timeOk(payload.completedAt) ||
      payload.startedAt > payload.receivedAt || payload.receivedAt > payload.completedAt || payload.completedAt > receivedAt ||
      !Array.isArray(payload.rows) || payload.rows.length > 500) throw Error('BaoStock 后复权原始证据无效');
  const base = captureBase('baostock',code,day,payload.receivedAt,raw,request), originalCode = (code.startsWith('6') ? 'sh.' : 'sz.') + code;
  let previous = '';
  const bars = payload.rows.map(row => {
    if (row.code !== originalCode || row.adjustflag !== '1' || !['0','1'].includes(row.tradestatus) ||
        row.date <= previous || row.date < request.start) throw Error('BaoStock 证券、复权、交易状态或日期无效');
    previous = row.date;
    return checkedBar(row,base,row.date,['open','high','low','close','volume','amount'].map(key=>number(row[key])),row.tradestatus === '0',number(row.turn));
  }).slice(-historyDays);
  const c = payload.calendar;
  if (c?.source !== 'baostock:query_trade_dates' || !timeOk(c.receivedAt) || c.receivedAt < payload.receivedAt ||
      c.receivedAt > receivedAt || !Array.isArray(c.rows) || c.rows.length > 550 || c.start !== request.start ||
      !dayOk(c.end) || c.end < day || c.end > addDays(day,14)) throw Error('BaoStock 原交易日历证据无效');
  previous = '';
  const days = c.rows.filter(row => {
    if (!dayOk(row.calendar_date) || row.calendar_date <= previous || row.calendar_date < c.start ||
        row.calendar_date > c.end || !['0','1'].includes(row.is_trading_day)) throw Error('BaoStock 日历缺失、重复或越界');
    previous = row.calendar_date;
    return row.is_trading_day === '1';
  }).map(row=>row.calendar_date);
  if (days.length < 2 || !days.includes(day) || bars.some(row=>!days.includes(row.date))) throw Error('BaoStock 日线未与原交易日历一致');
  return {...base,status:bars.length ? 'observed' : 'empty',bars,
    calendar:{days,source:c.source,knownAt:c.receivedAt,originalReceiptAt:c.receivedAt},
    adjustmentEvidence:{requestField:'adjustflag',value:'1',mode:'hfq',
      reference:'https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md'},
    limitations:['SDK 字段快照不是网络原始字节；后补历史不得倒填首次可知时间。']};
}

async function fetchBaoStock({code,day,historyDays}, {clock=Date.now,python=process.env.V6_PYTHON || 'python3',governor=marketRequests}={}) {
  const start = addDays(day,-Math.min(500,Math.ceil(historyDays*1.8))), end = addDays(day,14);
  const {stdout} = await governor.run('https://baostock.com/api/',()=>run(python,
    [path.join(__dirname,'../../scripts/collect-center-hfq.py'),'--code',code,'--start',start,'--end',day,'--calendar-end',end],
    {timeout:24000,maxBuffer:1024*1024,encoding:'buffer'}));
  return normalizeBaoStock(stdout,{code,day,historyDays,receivedAt:clock()});
}
async function fetchEastmoney({code,day,historyDays}, {clock=Date.now,request=requestResearchBytes}={}) {
  const {raw} = await request(requestUrl(code,day,historyDays),{timeoutMs:10000,processTimeoutMs:11000,maxBytes:1024*1024});
  return normalizeEastmoney(raw,{code,day,historyDays,receivedAt:clock()});
}
function archiveRoot(root, create=false) { return store.privateRoot(root,create); }
function codeRoot(root, code, create=false) {
  if (!codeOk(code)) throw Error('中心历史代码无效');
  return store.privateRoot(path.join(archiveRoot(root,create),code),create);
}
function captureEvents(root,code,now) {
  return store.readEvents(codeRoot(root,code),{asOf:now}).filter(event=>event.data?.protocol === PROTOCOL);
}
async function withCaptureLock(root,code,operation) {
  const dir=archiveRoot(root,true),fd=fs.openSync(path.join(dir,'capture-'+code+'.guard'),
    fs.constants.O_CREAT|fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0),0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw Error('中心历史采集锁无效');
    const lock=spawnSync('flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]});
    if(lock.error)throw Error('中心历史采集需要既有 flock 进程锁');
    if(lock.status!==0)return {ok:false,status:'collection-in-progress',code,...flags};
    return await operation();
  } finally {fs.closeSync(fd);}
}
function checkedCapture(event) {
  const data = event.data;
  if (data.code !== path.basename(data.code) || !codeOk(data.code) || !dayOk(data.day) ||
      data.capturedAt !== event.recordedAt || !Array.isArray(data.providers) || data.providers.length !== 2)
    throw Error('中心历史归档协议损坏');
  const sources = new Set();
  for (const provider of data.providers) {
    if (!['eastmoney-public-history','baostock'].includes(provider.source) || sources.has(provider.source)) throw Error('中心历史来源重复或无效');
    sources.add(provider.source);
    if (provider.rawEvidence) {
      const raw = Buffer.from(provider.rawEvidence.data,'base64');
      if (raw.length !== provider.rawEvidence.byteLength || hash(raw) !== provider.rawHash) throw Error('中心历史原始回执哈希不一致');
    }
  }
  return data;
}
function calendarUnion(calendars) {
  const edges = new Map(), conflicts = new Set(), days = new Set();
  for (const calendar of calendars.sort((a,b)=>a.knownAt-b.knownAt)) {
    for (const day of calendar.days) days.add(day);
    for (let i=0;i<calendar.days.length-1;i++) {
      const day=calendar.days[i], next=calendar.days[i+1], prior=edges.get(day);
      if (prior && prior.nextTradingDay !== next) { conflicts.add(day);continue; }
      if (!prior) edges.set(day,{nextTradingDay:next,source:calendar.source,knownAt:calendar.knownAt});
    }
  }
  for (const day of conflicts) edges.delete(day);
  if (!calendars.length) return {};
  return {CN:{days:[...days].sort(),source:'center-archived-provider-calendars',knownAt:Math.min(...calendars.map(row=>row.knownAt)),
    nextEvidenceByDay:Object.fromEntries(edges),conflictingDays:[...conflicts],
    note:'每条交易日边沿用首次真实取得时间；修订冲突隔离，不推断节假日。'}};
}

function readCenterHistory({root,codes,now=Date.now()}={}) {
  archiveRoot(root);
  const existing = fs.existsSync(root) ? fs.readdirSync(root).filter(codeOk).sort() : [];
  const chosen = codes === undefined ? existing.slice(0,MAX_CODES) : [...new Set(codes.filter(codeOk))].slice(0,MAX_CODES);
  const retained = new Map(), frozen = new Map(), revisions = [], quarantined = [], calendars = [], sourceStatus = [], summaries = [], comparisons = new Map();
  let captures=0;
  for (const code of chosen) {
    const events = captureEvents(root,code,now);
    for (const event of events) {
      const data = checkedCapture(event);captures++;
      if (data.code !== code) throw Error('中心历史证券目录与回执不一致');
      const providers = data.providers;
      for (const provider of providers) {
        if (provider.calendar) calendars.push(provider.calendar);
        sourceStatus.push({code,day:data.day,source:provider.source,status:provider.status,receivedAt:provider.receivedAt ?? null,
          reason:provider.reason || null});
      }
      for (const row of data.admittedBars || []) {
        const key = [row.market,row.code,row.date,row.adjustment,row.source].join('/'), prior=retained.get(key);
        if (prior && fields.some(field=>prior[field] !== row[field])) {
          revisions.push({code:row.code,day:row.date,source:row.source,firstKnownAt:prior.knownAt,laterKnownAt:row.knownAt,
            reason:'later-provider-revision-keeps-first-frozen-value'});continue;
        }
        if (!prior) retained.set(key,{...row,archiveSequence:event.sequence,archiveHash:event.hash});
      }
      quarantined.push(...(data.rejected || []));
      for(const comparison of data.comparisons||[])comparisons.set([code,comparison.day].join('/'),comparison);
      for (const row of data.observations || []) {
        const key = row.code+'/'+row.day;
        if (!frozen.has(key)) frozen.set(key,row);
      }
      summaries.push({code,day:data.day,capturedAt:data.capturedAt,status:data.status,admittedGroups:data.admittedGroups,
        rejectedRecords:data.rejected?.length||0});
    }
  }
  const available=[...retained.values()];
  const allowed = new Map(chosen.map(code=>[code,new Set([...new Set(available.filter(row=>row.code===code).map(row=>row.date))].sort().slice(-MAX_DAYS))]));
  const bars = available.filter(row=>allowed.get(row.code).has(row.date))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code)||a.source.localeCompare(b.source));
  const lastStatus = new Map(sourceStatus.map(row=>[row.code+'/'+row.source,row]));
  const eligibleObservations=[...frozen.values()].filter(row=>allowed.get(row.code)?.has(row.day)).sort((a,b)=>a.signalAt-b.signalAt);
  const compared=chosen.flatMap(code=>[...comparisons.values()].filter(row=>row.code===code)
    .sort((a,b)=>a.day.localeCompare(b.day)).slice(-MAX_DAYS)),comparable=compared.filter(row=>row.independentSources>=2&&
    !['duplicate-upstream-evidence','too-many-source-records'].includes(row.status));
  return {bars,frozenObservations:eligibleObservations.slice(-5000),
    marketCalendars:calendarUnion(calendars),coverage:{status:bars.length ? 'observed-hfq-archive' : captures ? 'no-admitted-hfq-evidence' : 'missing-hfq-history',
    protocol:PROTOCOL,codes:chosen,captures,admittedRows:bars.length,sourceStatus:[...lastStatus.values()],
    rejectedRecords:quarantined.length,rejectionExamples:quarantined.slice(-12),revisionConflicts:revisions.length,
    intakeQuality:{scope:'latest-capture-per-code-and-trading-day',comparableGroups:comparable.length,
      consistentGroups:comparable.filter(row=>row.status==='admitted').length,
      missingIndependentGroups:compared.filter(row=>row.status==='missing-independent-source').length,
      examples:compared.filter(row=>row.status!=='admitted').slice(-12)},
    revisionExamples:revisions.slice(-12),latestCaptures:summaries.slice(-20),omittedCodes:Math.max(0,existing.length-chosen.length),
    omittedEarlierObservations:Math.max(0,eligibleObservations.length-5000),
    acquisitionClock:'actual-receipt-no-historical-backdating',
    missing:!bars.length ? ['缺少通过独立来源一致性核对的真实后复权历史；查看逐源采集状态。'] : [],...flags},...flags};
}

// Pending labels come from persisted signals, not today's selected pool. A
// stock dropping out tomorrow must not silently lose its outcome observation.
// Page through bounded code batches; callers retain unresolved codes between
// pages and remember nextCursor so a growing archive cannot starve later codes.
function readPendingCenterHistory({root,archive=null,day,now=Date.now(),cursor=0}={}) {
  if(!dayOk(day)||!timeOk(now)||day>cnDay(now)||!Number.isSafeInteger(cursor)||cursor<0)
    throw Error('中心待补历史查询时点或游标无效');
  archiveRoot(root);
  const engine=require('./intelligence-research'),original=engine.extractArchiveResearchInputs(archive,{now}).observations;
  const existing=fs.existsSync(root)?fs.readdirSync(root).filter(codeOk):[];
  const all=[...new Set([...existing,...original.map(row=>row.code).filter(codeOk)])].sort();
  const start=all.length?cursor%all.length:0,scanned=[];
  for(let i=0;i<Math.min(40,all.length);i++)scanned.push(all[(start+i)%all.length]);
  const pending=[],excluded=[],waiting=[];
  for(const code of scanned) {
    const history=readCenterHistory({root,codes:[code],now}),calendar=history.marketCalendars.CN;
    const gate=engine.auditCenterInputs(history.bars,{purpose:'backtest',now,marketCalendars:history.marketCalendars});
    const prices=new Map(gate.admitted.map(row=>[row.day,row]));
    const observations=[...original.filter(row=>row.code===code),...history.frozenObservations].sort((a,b)=>a.signalAt-b.signalAt);
    let task=null;
    for(const row of observations) {
      const current=prices.get(row.day),edge=calendar?.nextEvidenceByDay?.[row.day],targetDay=edge?.nextTradingDay;
      // The current day can still establish a *new* receipt-time freeze. An
      // older check without its prior-known t price is permanently ineligible;
      // fetching that price tomorrow cannot repair causality.
      if(row.day===day&&!current&&cnDay(row.signalAt)===day) {
        task=task||{code,signalDay:row.day,nextTradingDay:targetDay||null,signalAt:row.signalAt,
          reason:'today-check-awaiting-hfq-freeze'};continue;
      }
      const invalid=!edge||!timeOk(edge.knownAt)||edge.knownAt>row.signalAt?'missing-prior-known-calendar':
        !current||current.consensusKnownAt>row.signalAt?'missing-prior-known-signal-price':
        cnDay(row.signalAt)!==row.day||row.signalAt>=Date.parse(targetDay+'T09:30:00+08:00')?'invalid-original-signal-time':
        current.suspended===true?'suspended-signal-window':null;
      if(invalid){excluded.push({code,signalDay:row.day,reason:invalid});continue;}
      if(targetDay>day||now<close(targetDay)){waiting.push({code,signalDay:row.day,nextTradingDay:targetDay});continue;}
      if(prices.has(targetDay))continue;
      // Collection retains at least the last 160 calendar days within the
      // bounded 160-row request. Older unresolved labels remain disclosed, not
      // endlessly retried or filled with a different trading day.
      if(targetDay<addDays(day,-160)){excluded.push({code,signalDay:row.day,reason:'label-outside-bounded-history-window'});continue;}
      const value={code,signalDay:row.day,nextTradingDay:targetDay,signalAt:row.signalAt,reason:'missing-admitted-next-day-hfq'};
      if(!task||task.reason==='today-check-awaiting-hfq-freeze'||value.signalAt<task.signalAt)task=value;
    }
    if(task)pending.push(task);
  }
  // Preserve rotating scan order when trimming. Sorting by code here would
  // repeatedly drop the same later codes on overlapping pages.
  return {ok:true,codes:pending.slice(0,30).map(row=>row.code),pending:pending.slice(0,30),
    coverage:{availableCodes:all.length,inspectedCodes:scanned.length,scanLimit:40,resultLimit:30,
      nextCursor:all.length?(start+scanned.length)%all.length:0,truncated:scanned.length<all.length||pending.length>30,
      omittedPendingCodes:Math.max(0,pending.length-30),waitingForNextClose:waiting.length,
      excludedSignals:excluded.length,exclusionExamples:excluded.slice(-12),
      currentPoolRequired:false,acquisitionClock:'actual-receipt-no-historical-backdating'},...flags};
}

async function collectCenterHistory({root,code,day,historyDays=160,replica=false,archive=null}={}, deps={}) {
  requestUrl(code,day,historyDays);
  if (replica) return {ok:false,status:'replica-read-only',code,day,...flags};
  const clock=deps.clock || Date.now, startedAt=clock();
  if (!timeOk(startedAt) || day > cnDay(startedAt)) throw Error('中心历史采集时点无效');
  // BaoStock's completed daily research feed is checked after 16:00. A task
  // arriving at 15:15 records no fabricated same-day completeness.
  if (day === cnDay(startedAt) && startedAt < Date.parse(day+'T16:00:00+08:00'))
    return {ok:false,status:'waiting-provider-close',code,day,nextEligibleAt:Date.parse(day+'T16:00:00+08:00'),...flags};
  for (const source of ['eastmoney-public-history','baostock'])
    if (sourceLineage(source)?.access !== 'guarded-research') throw Error('中心历史来源未通过既有研究访问门禁');
  return withCaptureLock(root,code,async()=>{
  const events=captureEvents(root,code,startedAt), sameDay=events.filter(event=>event.data.day===day);
  const complete=sameDay.find(event=>event.data.status==='admitted');
  if (complete) return {ok:true,status:'already-collected',code,day,reused:true,admittedGroups:complete.data.admittedGroups,...flags};
  const prior=sameDay.at(-1);
  if (sameDay.length >= 3 || prior && startedAt-prior.recordedAt < 15*60000)
    return {ok:false,status:'bounded-retry-wait',code,day,attempts:sameDay.length,
      nextEligibleAt:sameDay.length>=3 ? null : prior.recordedAt+15*60000,...flags};
  const providers=[];
  for (const [source,fetcher] of [['eastmoney-public-history',deps.fetchEastmoney||fetchEastmoney],['baostock',deps.fetchBaoStock||fetchBaoStock]]) {
    try { providers.push(await fetcher({code,day,historyDays},{clock})); }
    catch(error) { providers.push({source,status:'source-failed',bars:[],calendar:null,receivedAt:clock(),
      reason:error.code==='MARKET_RESTRICTED' ? '供应商限流或拒绝访问，保持原退避门禁' : '供应商回执缺失或未通过身份、复权、时点、量价校验',...flags}); }
  }
  const capturedAt=clock();
  if (!timeOk(capturedAt) || capturedAt<startedAt) throw Error('中心历史采集时钟回退');
  const records=providers.flatMap(row=>row.bars||[]), marketCalendars=calendarUnion(providers.map(row=>row.calendar).filter(Boolean));
  const gate=require('./intelligence-research').auditCenterInputs(records,{purpose:'backtest',now:capturedAt,marketCalendars});
  const admittedBars=gate.admitted.flatMap(row=>row.evidence.map(evidence=>({...evidence,date:evidence.day})));
  const currentAdmitted=gate.admitted.some(row=>row.code===code&&row.day===day),
    status=gate.admittedGroups>0 && !gate.excludedRecords && currentAdmitted ? 'admitted' : gate.admittedGroups>0 ? 'partially-admitted' : 'quarantined';
  const observations=[];
  if (currentAdmitted && cnDay(capturedAt)===day) {
    const observed=require('./intelligence-research').extractArchiveResearchInputs(archive,{now:capturedAt}).observations
      .filter(row=>row.code===code&&row.day===day&&row.signalAt<=capturedAt).sort((a,b)=>b.signalAt-a.signalAt)[0];
    if (observed) observations.push({...observed,id:'center-'+store.digest({checkId:observed.id,capturedAt}).slice(0,40),
      originCheckId:observed.id,originalSignalAt:observed.signalAt,signalAt:capturedAt,
      recordedAt:new Date(capturedAt).toISOString(),asOf:new Date(capturedAt).toISOString(),captureProtocol:PROTOCOL,
      note:'因子值来自原已冻结校验；这是历史价格取得后实际新冻结的当前信号，没有修改原校验的时间。'});
  }
  const comparisons=gate.comparisons.map(({code,day,market,adjustment,status,independentSources,supportingSources,excludedSources})=>
    ({code,day,market,adjustment,status,independentSources,supportingSources,excludedSources}));
  const data={protocol:PROTOCOL,code,day,capturedAt,historyDays,status,providers,admittedBars,observations,comparisons,
    admittedGroups:gate.admittedGroups,rejected:gate.rejected,...flags};
  const event=store.appendEvent(codeRoot(root,code,true),'diagnostic',data,
    {requestId:'hfq-'+day.replaceAll('-','')+'-'+store.digest({providers,status}).slice(0,40),now:capturedAt});
  return {ok:true,status,code,day,reused:event.reused,admittedGroups:gate.admittedGroups,rejectedRecords:gate.excludedRecords,
    sources:providers.map(row=>({source:row.source,status:row.status,rows:row.bars.length,reason:row.reason||null})),
    fingerprint:event.hash,...flags};
  });
}

module.exports={PROTOCOL,requestUrl,normalizeEastmoney,normalizeBaoStock,fetchEastmoney,fetchBaoStock,
  collectCenterHistory,readCenterHistory,readPendingCenterHistory};
