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
const ATTEMPT_PROTOCOL = 'center-hfq-attempt-v1';
const REVIEW_PROTOCOL = 'center-hfq-quarantine-review-v1';
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

function allowedSource(source) {
  if(!['eastmoney-public-history','baostock'].includes(source)||sourceLineage(source)?.access!=='guarded-research')return false;
  if(source==='baostock'){
    try{return require('../../config/data-source-catalog.json').sources.some(row=>row.id===source&&row.access==='enabled-private-research');}
    catch{return false;}
  }
  return true;
}

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
    return {...captureBase('baostock',code,day,receivedAt,raw,null),status:payload.status,bars:[],calendar:null,...flags};
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
  const days = c.rows.filter((row,index) => {
    if (!dayOk(row.calendar_date) || row.calendar_date <= previous || row.calendar_date < c.start ||
        row.calendar_date > c.end || row.calendar_date!==addDays(c.start,index) ||
        !['0','1'].includes(row.is_trading_day)) throw Error('BaoStock 日历缺失、重复或越界');
    previous = row.calendar_date;
    return row.is_trading_day === '1';
  }).map(row=>row.calendar_date);
  if(previous!==c.end)throw Error('BaoStock 原交易日历查询尾部不完整');
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
    [path.join(__dirname,'../../scripts/collect-center-hfq.py'),'--code',code,'--start',start,'--end',day,'--calendar-end',end,'--allow-research-fetch'],
    {timeout:24000,maxBuffer:1024*1024,encoding:'buffer'}));
  const receivedAt=clock();
  try{return normalizeBaoStock(stdout,{code,day,historyDays,receivedAt});}
  catch{return rejectedRaw('baostock',stdout,{code,day,receivedAt});}
}
async function fetchEastmoney({code,day,historyDays}, {clock=Date.now,request=requestResearchBytes}={}) {
  const {raw} = await request(requestUrl(code,day,historyDays),{timeoutMs:10000,processTimeoutMs:11000,maxBytes:1024*1024});
  const receivedAt=clock();
  try{return normalizeEastmoney(raw,{code,day,historyDays,receivedAt});}
  catch{return rejectedRaw('eastmoney-public-history',raw,{code,day,receivedAt,request:requestUrl(code,day,historyDays)});}
}
// Preserve the original bytes even if JSON parsing, identity or units fail.
// The raw response stays in the existing private archive, never in a UI reply.
function rejectedRaw(source,raw,{code,day,receivedAt,request=null}) {
  return {...captureBase(source,code,day,receivedAt,raw,request),status:'quarantined',bars:[],calendar:null,
    reason:'原始回执未通过既有身份、复权、时点或量价校验',reasonCode:'NORMALIZATION_REJECTED',
    scope:{code,throughDay:day,source,adjustment:'hfq'},...flags};
}
function archiveRoot(root, create=false) { return store.privateRoot(root,create); }
function codeRoot(root, code, create=false) {
  if (!codeOk(code)) throw Error('中心历史代码无效');
  return store.privateRoot(path.join(archiveRoot(root,create),code),create);
}
function captureEvents(root,code,now) {
  return store.readEvents(codeRoot(root,code),{asOf:now}).filter(event=>event.data?.protocol === PROTOCOL);
}
function attemptRoot(root,code,create=false) {
  if(!codeOk(code))throw Error('中心历史尝试代码无效');
  return store.privateRoot(path.join(archiveRoot(root,create),'attempts',code),create);
}
function attemptEvents(root,code,now) {
  return store.readEvents(attemptRoot(root,code),{asOf:now}).filter(event=>event.data?.protocol===ATTEMPT_PROTOCOL);
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
      if (provider.rawEvidence.encoding!=='base64'||raw.length !== provider.rawEvidence.byteLength ||
          !raw.length || raw.length>1024*1024 || raw.toString('base64')!==provider.rawEvidence.data ||
          hash(raw) !== provider.rawHash || !timeOk(provider.receivedAt) || provider.receivedAt>data.capturedAt)
        throw Error('中心历史原始回执哈希或接收时点不一致');
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

/** A projection of the original hash-chained captures, not another database.
 * Provider publication/revision times are deliberately null: a receipt proves
 * when this installation saw bytes, not when a vendor first published them.
 */
function projectGovernance(events,{decisionAt,codes}) {
  const captures=events.filter(event=>event.data.protocol===PROTOCOL),reviewIndex=new Map(),
    latest=new Map(),frozen=new Map(),versions=[],factorSnapshots=[],quarantine=[],revisionEntries=[];
  let rawReceipts=0,missingRawReceipts=0,revisionCount=0,dataVersions=0,factorSnapshotsWithoutVersion=0,
    quarantineCount=0,quarantineOpen=0,quarantineReviewed=0,revisionQuarantineCount=0;
  const tail=(list,value,limit)=>{list.push(value);if(list.length>limit)list.shift();};
  for(const event of events){
    const target=event.data.replayOf||(event.data.protocol===REVIEW_PROTOCOL?event.data.captureHash:null);if(!target)continue;
    const previous=reviewIndex.get(target)||{count:0,lastAt:0,resolved:false};
    reviewIndex.set(target,{count:previous.count+1,lastAt:Math.max(previous.lastAt,event.recordedAt),
      resolved:previous.resolved||event.data.protocol===PROTOCOL&&event.data.status==='admitted'&&!event.data.rejected?.length});
  }
  for(const event of captures.sort((a,b)=>a.recordedAt-b.recordedAt||a.data.code.localeCompare(b.data.code)||a.sequence-b.sequence)){
    const data=checkedCapture(event),admitted=new Set((data.admittedBars||[]).map(row=>row.source+'/'+row.rawRowHash));
    for(const provider of data.providers){
      if(provider.rawEvidence)rawReceipts++;else missingRawReceipts++;
      for(const row of provider.bars||[]){
        const id=[row.market,row.code,row.date,row.adjustment,provider.source].join('/');
        const payloadHash=store.digest(Object.fromEntries(['code','date','adjustment','source','currency','volumeUnit','amountUnit',...fields,'suspended']
          .map(key=>[key,row[key]??null]))),prior=latest.get(id),passed=admitted.has(provider.source+'/'+row.rawRowHash);
        if(prior?.payloadHash===payloadHash){
          if(passed&&prior.availableAt===null){prior.availableAt=event.recordedAt;prior.admissionArchiveHash=event.hash;prior.gateStatus='admitted-research';}
          if(passed&&!frozen.has(id)){frozen.set(id,payloadHash);prior.selectedForResearch=true;}
          continue;
        }
        const version=(prior?.version||0)+1;if(prior)revisionCount++;
        if(passed&&!frozen.has(id))frozen.set(id,payloadHash);
        const item={id,code:row.code,day:row.date,source:provider.source,version,eventAt:row.periodEndAt,
          originalAt:null,receivedAt:provider.receivedAt,firstKnownAt:provider.receivedAt,rawAvailableAt:event.recordedAt,
          availableAt:passed?event.recordedAt:null,admissionArchiveHash:passed?event.hash:null,
          revisedAt:null,revisionDetectedAt:prior?event.recordedAt:null,dataVersion:payloadHash,factorVersion:null,payloadHash,
          rawHash:provider.rawHash,rawRowHash:row.rawRowHash,archiveHash:event.hash,archiveSequence:event.sequence,
          gateStatus:passed?'admitted-research':'quarantined',selectedForResearch:passed&&frozen.get(id)===payloadHash,
          sourcePublicationVerified:false,sourceRevisionVerified:false};
        latest.set(id,item);dataVersions++;tail(versions,item,24);
        if(frozen.has(id)&&frozen.get(id)!==payloadHash){revisionQuarantineCount++;tail(revisionEntries,
          {code:row.code,day:row.date,source:provider.source,archiveHash:event.hash,dataVersion:payloadHash,
            frozenDataVersion:frozen.get(id),reason:'later-source-revision-keeps-first-frozen-value'},12);}
      }
    }
    for(const observation of data.observations||[]){
      const versionLabel=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value)?value:null;
      // Read the versions frozen with each original factor. Today's installed
      // catalog must never fill missing dictionary or semantic evidence.
      const factorVersions=Object.keys(observation.values||{}).sort().map(factorId=>{
        const original=observation.evidence?.[factorId];
        return {factorId,factorVersion:versionLabel(original?.factorVersion),dictionaryVersion:versionLabel(original?.dictionaryVersion),
          semanticVersion:versionLabel(original?.semanticVersion),
          definitionFingerprint:/^[a-f0-9]{64}$/.test(original?.definitionFingerprint||'')?original.definitionFingerprint:null};
      }),topLevelVersion=versionLabel(observation.factorVersion),knownVersions=factorVersions.map(row=>row.factorVersion||row.dictionaryVersion),
        allVersioned=factorVersions.length>0&&knownVersions.every(Boolean),
        sharedVersion=allVersioned&&new Set(knownVersions).size===1?knownVersions[0]:null,
        factorVersion=topLevelVersion||sharedVersion;
      if(!topLevelVersion&&!allVersioned)factorSnapshotsWithoutVersion++;
      tail(factorSnapshots,{code:data.code,day:observation.day,signalAt:observation.signalAt,availableAt:event.recordedAt,
        archiveHash:event.hash,snapshotHash:store.digest({values:observation.values||{},evidence:observation.evidence||{}}),factorVersion,
        factorVersionBasis:topLevelVersion?'original-frozen-observation':sharedVersion?'common-original-factor-evidence-version':null,
        factorVersionCoverage:topLevelVersion?'observed-top-level-version':allVersioned?'observed-original-factor-versions':
          knownVersions.some(Boolean)?'partial-original-factor-versions':'missing-original-factor-versions',
        factorVersions:factorVersions.slice(0,128),omittedFactorVersions:Math.max(0,factorVersions.length-128)},12);
    }
    if(data.status!=='admitted'||data.rejected?.length||data.providers.some(row=>row.status==='quarantined')){
      const review=reviewIndex.get(event.hash)||{count:0,lastAt:0,resolved:false};
      quarantineCount++;if(!review.resolved)quarantineOpen++;if(review.count)quarantineReviewed++;
      tail(quarantine,{id:event.hash,code:data.code,day:data.day,availableAt:event.recordedAt,
        status:review.resolved?'reviewed-original-gates-passed':'quarantined',affectedRows:data.rejected?.length||0,
        reasons:[...new Set([...(data.rejected||[]).map(row=>row.reason),...data.providers.filter(row=>row.status!=='observed')
          .map(row=>row.reasonCode||row.status)])],scope:{code:data.code,throughDay:data.day,adjustment:'hfq'},
        rawEvidencePreserved:data.providers.every(row=>Boolean(row.rawEvidence)),
        reviewCount:review.count,lastReviewAt:review.lastAt||null},12);
    }
  }
  return {schemaVersion:1,mode:'original-center-archive-point-in-time',status:captures.length?'observed-with-source-clock-gaps':'missing-data',
    decisionAt,codes,captures:captures.length,rawReceipts,missingRawReceipts,
    versionedFields:latest.size,dataVersions,revisionCount,versions,
    factorSnapshots,factorSnapshotsWithoutVersion,
    quarantine:{captures:quarantineCount,open:quarantineOpen,reviewed:quarantineReviewed,entries:quarantine,
      revisionConflicts:revisionQuarantineCount,revisionEntries},
    selectionPolicy:'first-admitted-value-frozen; later-source-versions-retained-for-audit',
    completePointInTime:false,missing:['供应商原始发布时间和修订发布时间未提供',
      ...(factorSnapshotsWithoutVersion?['部分因子快照缺少原始版本标识；已有逐因子字典、语义版本与定义指纹按原档展示']:[])],
    note:'按原私有归档可用时点回放；实际接收时间不冒充供应商发布时间，后补和复核数据不倒填旧决策。',...flags};
}

function readCenterHistoryGovernance(options={}) {return readCenterHistory(options).coverage.governance;}

function recheckQuarantine(data,code,now){
  const providers=data.providers.map(provider=>{
    if(!provider.rawEvidence)return {source:provider.source,status:'missing-raw-evidence',bars:[],calendar:null,
      receivedAt:provider.receivedAt??null,reason:'缺少原始回执，不能复核补造',...flags};
    const raw=Buffer.from(provider.rawEvidence.data,'base64'),opts={code,day:data.day,historyDays:data.historyDays,receivedAt:data.capturedAt};
    try{return provider.source==='eastmoney-public-history'?normalizeEastmoney(raw,{...opts,receivedAt:provider.receivedAt}):normalizeBaoStock(raw,opts);}
    catch{return rejectedRaw(provider.source,raw,{code,day:data.day,receivedAt:provider.receivedAt,request:provider.request});}
  });
  const marketCalendars=calendarUnion(providers.map(row=>row.calendar?{...row.calendar,knownAt:now}:null).filter(Boolean)),
    records=providers.flatMap(provider=>(provider.bars||[]).map(row=>({...row,availableAt:now}))),
    gate=require('./intelligence-research').auditCenterInputs(records,{purpose:'backtest',now,marketCalendars});
  const current=gate.admitted.some(row=>row.code===code&&row.day===data.day),
    status=gate.admittedGroups&&!gate.excludedRecords&&current?'admitted':gate.admittedGroups?'partially-admitted':'reviewed-still-quarantined';
  return {providers,gate,status};
}
function previewCenterHistoryQuarantine({root,code,captureHash,now=Date.now()}={}){
  if(!codeOk(code)||!/^[a-f0-9]{64}$/.test(captureHash||'')||!timeOk(now)||now>Date.now())throw Error('隔离预检范围或时点无效');
  const event=captureEvents(root,code,now).find(event=>event.hash===captureHash);
  if(!event)throw Error('隔离原始归档不存在或尚不可用');
  const data=checkedCapture(event);
  if(data.code!==code||data.status==='admitted'&&!data.rejected?.length)throw Error('仅允许预检原隔离或部分接纳的归档');
  for(const source of ['eastmoney-public-history','baostock'])if(!allowedSource(source))throw Error('中心历史来源未通过既有研究访问门禁');
  const {providers,gate,status}=recheckQuarantine(data,code,now);
  return {mode:'read-only-original-quarantine-recheck',status,code,day:data.day,captureHash,
    scopeHash:store.digest({root:archiveRoot(root),code,captureHash}),admittedGroups:gate.admittedGroups,rejectedRecords:gate.excludedRecords,
    reasons:[...new Set(gate.rejected.map(row=>row.reason))],
    sources:providers.map(row=>({source:row.source,status:row.status,rawHash:row.rawHash||null,rows:row.bars.length})),
    proposedAvailableAt:now,writes:false,...flags};
}

/** Explicit, authenticated caller only. A review records who/why, re-parses
 * immutable bytes and runs the original source/identity/consensus gates. There
 * is no override flag, provider substitution, network fetch or past freeze.
 */
async function replayCenterHistoryQuarantine({root,code,captureHash,reviewerId,reason,requestId,replica=false,authorizationScope=null}={},deps={}) {
  if(!codeOk(code)||!/^[a-f0-9]{64}$/.test(captureHash||'')||
      typeof reviewerId!=='string'||!reviewerId.trim()||reviewerId.length>128||/[\x00-\x1f\x7f]/.test(reviewerId)||
      typeof reason!=='string'||reason.trim().length<8||reason.length>1000||/[\x00-\x1f\x7f]/.test(reason)||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId||''))throw Error('隔离回放需要明确的原归档、审核人、原因及请求ID');
  if(authorizationScope!==null&&(!authorizationScope||authorizationScope.mode!=='local-private-research-archive'||
      !/^[a-f0-9]{64}$/.test(authorizationScope.archiveScopeHash||'')||! /^(?:[a-f0-9]{64})$/.test(authorizationScope.instanceConfigHash||'')||
      !Number.isSafeInteger(authorizationScope.operatorUid)||authorizationScope.operatorUid<0||
      authorizationScope.archiveScopeHash!==store.digest({root:archiveRoot(root),code,captureHash})))throw Error('隔离回放授权范围哈希无效');
  const canWrite=()=>{try{return !replica&&(!deps.canWrite||deps.canWrite()===true);}catch{return false;}};
  if(!canWrite())return {ok:false,status:'read-only-instance',...flags};
  const now=(deps.clock||Date.now)();
  if(!timeOk(now)||now>Date.now())throw Error('隔离复核时点无效');
  for(const source of ['eastmoney-public-history','baostock'])if(!allowedSource(source))throw Error('中心历史来源未通过既有研究访问门禁');
  return withCaptureLock(root,code,async()=>{
    if(!canWrite())return {ok:false,status:'read-only-instance',...flags};
    const events=store.readEvents(codeRoot(root,code),{asOf:now}),prior=events.find(event=>event.requestId===requestId);
    if(prior){
      if((prior.data.captureHash||prior.data.replayOf)!==captureHash||prior.data.review?.reviewerId!==reviewerId||prior.data.review?.reason!==reason||
          store.digest(prior.data.review?.authorizationScope??null)!==store.digest(authorizationScope))
        throw Error('同一复核请求ID内容冲突');
      return {ok:true,status:prior.data.status,reused:true,fingerprint:prior.hash,
        admittedGroups:prior.data.admittedGroups||0,rejectedRecords:prior.data.rejected?.length||0,...flags};
    }
    const original=events.find(event=>event.hash===captureHash&&event.data.protocol===PROTOCOL);
    if(!original)throw Error('隔离原始归档不存在或尚不可用');
    const data=checkedCapture(original);
    if(data.code!==code||data.status==='admitted'&&!data.rejected?.length)throw Error('仅允许复核原隔离或部分接纳的归档');
    const {providers,gate,status}=recheckQuarantine(data,code,now),
      review={reviewerId,reason,reviewedAt:now,method:'immutable-raw-original-normalizers-and-consensus',authorizationScope};
    const outcome=gate.admittedGroups?{protocol:PROTOCOL,code,day:data.day,capturedAt:now,historyDays:data.historyDays,status,
      providers,admittedBars:gate.admitted.flatMap(row=>row.evidence.map(evidence=>({...evidence,date:evidence.day,availableAt:now}))),
      observations:[],comparisons:gate.comparisons.map(({code,day,market,adjustment,status,independentSources,supportingSources,excludedSources})=>
        ({code,day,market,adjustment,status,independentSources,supportingSources,excludedSources})),replayOf:captureHash,review,
      admittedGroups:gate.admittedGroups,rejected:gate.rejected,...flags}:
      {protocol:REVIEW_PROTOCOL,code,day:data.day,captureHash,status,review,admittedGroups:0,rejected:gate.rejected,
        sources:providers.map(row=>({source:row.source,status:row.status,rawHash:row.rawHash||null})),...flags};
    if(!canWrite())return {ok:false,status:'read-only-instance',...flags};
    const saved=store.appendEvent(codeRoot(root,code,true),'diagnostic',outcome,{requestId,now});
    return {ok:true,status,reused:saved.reused,fingerprint:saved.hash,admittedGroups:gate.admittedGroups,
      rejectedRecords:gate.excludedRecords,availableAt:now,...flags};
  });
}

function readCenterHistory({root,codes,now=Date.now(),decisionAt=now}={}) {
  if(!timeOk(now)||!timeOk(decisionAt)||decisionAt>now||now>Date.now())throw Error('中心历史回放时点无效');
  archiveRoot(root);
  const existing = fs.existsSync(root) ? fs.readdirSync(root).filter(codeOk).sort() : [];
  const chosen = codes === undefined ? existing.slice(0,MAX_CODES) : [...new Set(codes.filter(codeOk))].slice(0,MAX_CODES);
  const retained = new Map(), frozen = new Map(), revisions = [], quarantined = [], calendars = [], sourceStatus = [], summaries = [], comparisons = new Map();
  let captures=0;const governanceEvents=[];
  for (const code of chosen) {
    const all=store.readEvents(codeRoot(root,code),{asOf:decisionAt});
    governanceEvents.push(...all.filter(event=>[PROTOCOL,REVIEW_PROTOCOL].includes(event.data?.protocol)));
    const events = all.filter(event=>event.data?.protocol===PROTOCOL);
    for (const event of events) {
      const data = checkedCapture(event);captures++;
      if (data.code !== code) throw Error('中心历史证券目录与回执不一致');
      const providers = data.providers;
      for (const provider of providers) {
        if (provider.calendar) calendars.push({...provider.calendar,
          knownAt:Math.max(provider.calendar.knownAt,data.capturedAt),originalReceiptAt:provider.calendar.originalReceiptAt??provider.calendar.knownAt});
        sourceStatus.push({code,day:data.day,source:provider.source,status:provider.status,receivedAt:provider.receivedAt ?? null,
          reason:provider.reason || null});
      }
      for (const row of data.admittedBars || []) {
        const key = [row.market,row.code,row.date,row.adjustment,row.source].join('/'), prior=retained.get(key);
        if (prior && fields.some(field=>prior[field] !== row[field])) {
          revisions.push({code:row.code,day:row.date,source:row.source,firstKnownAt:prior.knownAt,laterKnownAt:row.knownAt,
            reason:'later-provider-revision-keeps-first-frozen-value'});continue;
        }
        if (!prior) retained.set(key,{...row,availableAt:Math.max(row.availableAt??row.knownAt,data.capturedAt),
          archiveSequence:event.sequence,archiveHash:event.hash});
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
    acquisitionClock:'actual-receipt-no-historical-backdating',decisionAt,
    governance:projectGovernance(governanceEvents,{decisionAt,codes:chosen}),
    missing:!bars.length ? ['缺少通过独立来源一致性核对的真实后复权历史；查看逐源采集状态。'] : [],...flags},...flags};
}

/** GET and feedback POST must reconstruct exactly the same research inputs.
 * The older manual-diagnostic receipts remain visible with their original null
 * source clocks. They cannot replace admitted history or create a new freeze.
 */
function composeCenterResearchInputs(archive,root,{day,now=Date.now()}={}) {
  const engine=require('./intelligence-research'),extracted=engine.extractArchiveResearchInputs(archive,{now});
  const codes=[...new Set([...(archive?.checks||[]).slice(-100).reverse().map(row=>row.code),...(archive?.plans||[]).slice(-20).map(row=>row.code)])];
  const history=readCenterHistory({root,now,codes:codes.length?codes:undefined});
  let diagnostic;
  try{diagnostic=require('./intelligence-history').readCenterHistory(root,{day,now,
    maxBars:Math.min(12000,Math.max(0,20000-extracted.bars.length-history.bars.length))});}
  catch{diagnostic={bars:[],calendar:null,summary:{status:'invalid-history-store',adjustment:'hfq',receipts:0,rows:0,
    sources:[],lastReceivedAt:null,issues:[{reason:'private-history-integrity-or-permission-failed'}],
    missing:['手动诊断历史回执完整性或权限核验失败，该库未纳入研究'],canTrade:false}};}
  const marketCalendars={...history.marketCalendars};
  if(!marketCalendars.CN){
    const calendar=engine.extractArchiveCalendar(archive,{now})||diagnostic.calendar;
    if(calendar)marketCalendars.CN=calendar;
  }
  return {research:{bars:[...extracted.bars,...history.bars,...diagnostic.bars],marketCalendars,
    frozenObservations:history.frozenObservations,historyCoverage:history.coverage},historySupply:diagnostic.summary};
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
  const canWrite=()=>{try{return !replica&&(!deps.canWrite||deps.canWrite()===true);}catch{return false;}};
  const revoked=()=>({ok:false,status:'read-only-instance',code,day,...flags});
  if(!canWrite())return revoked();
  const clock=deps.clock || Date.now, startedAt=clock();
  if (!timeOk(startedAt) || day > cnDay(startedAt)) throw Error('中心历史采集时点无效');
  // BaoStock's completed daily research feed is checked after 16:00. A task
  // arriving at 15:15 records no fabricated same-day completeness.
  if (day === cnDay(startedAt) && startedAt < Date.parse(day+'T16:00:00+08:00'))
    return {ok:false,status:'waiting-provider-close',code,day,nextEligibleAt:Date.parse(day+'T16:00:00+08:00'),...flags};
  for (const source of ['eastmoney-public-history','baostock'])
    if (!allowedSource(source)) throw Error('中心历史来源未通过既有研究访问门禁');
  return withCaptureLock(root,code,async()=>{
  if(!canWrite())return revoked();
  const events=captureEvents(root,code,startedAt), sameDay=events.filter(event=>event.data.day===day);
  const complete=sameDay.find(event=>event.data.status==='admitted');
  if (complete) return {ok:true,status:'already-collected',code,day,reused:true,admittedGroups:complete.data.admittedGroups,...flags};
  const started=attemptEvents(root,code,startedAt).filter(event=>event.data.day===day);
  // Old captures predate the attempt journal. Count those too, without counting
  // a completed capture twice once it references its persisted start record.
  const previous=[...started,...sameDay.filter(event=>!event.data.attemptId)].sort((a,b)=>a.recordedAt-b.recordedAt),prior=previous.at(-1);
  if (previous.length >= 3 || prior && startedAt-prior.recordedAt < 15*60000)
    return {ok:false,status:'bounded-retry-wait',code,day,attempts:previous.length,
      nextEligibleAt:previous.length>=3 ? null : prior.recordedAt+15*60000,...flags};
  if(!canWrite())return revoked();
  const attempt=store.appendEvent(attemptRoot(root,code,true),'diagnostic',
    {protocol:ATTEMPT_PROTOCOL,code,day,startedAt,historyDays,...flags},
    {requestId:'hfq-start-'+code+'-'+startedAt,now:startedAt});
  const providers=[];
  for (const [source,fetcher] of [['eastmoney-public-history',deps.fetchEastmoney||fetchEastmoney],['baostock',deps.fetchBaoStock||fetchBaoStock]]) {
    if(!canWrite())return revoked();
    if(!allowedSource(source))return {ok:false,status:'source-access-blocked',source,code,day,...flags};
    try { const provider=await fetcher({code,day,historyDays},{clock});if(!canWrite())return revoked();providers.push(provider); }
    catch(error) { if(!canWrite())return revoked();providers.push({source,status:'source-failed',bars:[],calendar:null,receivedAt:clock(),
      reason:error.code==='MARKET_RESTRICTED' ? '供应商限流或拒绝访问，保持原退避门禁' : '供应商回执缺失或未通过身份、复权、时点、量价校验',...flags}); }
  }
  const capturedAt=clock();
  if (!timeOk(capturedAt) || capturedAt<startedAt) throw Error('中心历史采集时钟回退');
  const records=providers.flatMap(row=>row.bars||[]), marketCalendars=calendarUnion(providers.map(row=>row.calendar).filter(Boolean));
  const gate=require('./intelligence-research').auditCenterInputs(records,{purpose:'backtest',now:capturedAt,marketCalendars});
  const admittedBars=gate.admitted.flatMap(row=>row.evidence.map(evidence=>({...evidence,date:evidence.day,availableAt:capturedAt})));
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
  const data={protocol:PROTOCOL,code,day,capturedAt,historyDays,status,providers,admittedBars,observations,comparisons,attemptId:attempt.hash,
    admittedGroups:gate.admittedGroups,rejected:gate.rejected,...flags};
  if(!canWrite())return revoked();
  const event=store.appendEvent(codeRoot(root,code,true),'diagnostic',data,
    {requestId:'hfq-'+day.replaceAll('-','')+'-'+store.digest({providers,status}).slice(0,40),now:capturedAt});
  return {ok:true,status,code,day,reused:event.reused,admittedGroups:gate.admittedGroups,rejectedRecords:gate.excludedRecords,
    sources:providers.map(row=>({source:row.source,status:row.status,rows:row.bars.length,reason:row.reason||null})),
    fingerprint:event.hash,...flags};
  });
}

module.exports={PROTOCOL,ATTEMPT_PROTOCOL,REVIEW_PROTOCOL,requestUrl,allowedSource,normalizeEastmoney,normalizeBaoStock,fetchEastmoney,fetchBaoStock,
  collectCenterHistory,readCenterHistory,readCenterHistoryGovernance,previewCenterHistoryQuarantine,replayCenterHistoryQuarantine,readPendingCenterHistory,composeCenterResearchInputs};
