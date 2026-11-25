'use strict';
// Deterministic provider-shaped fixtures, never network or production data.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const H=require('../src/core/center-history');
const {auditCenterInputs,buildIntelligenceResearch}=require('../src/core/intelligence-research');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const journal=require('../src/core/research-workspace-store');
const day='2026-11-23',next='2026-11-24',code='600001';
const at=(d,clock='16:01:00')=>Date.parse(d+'T'+clock+'+08:00');
const days=['2026-11-20',day,next,'2026-11-25','2026-11-26'];
const directory=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-center-history-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
function emRaw(dates,{prices={}}={}){
  return Buffer.from(JSON.stringify({rc:0,data:{code,market:1,name:'fixture security',klines:dates.map(d=>{
    const p=prices[d]||10;return [d,p,p,p+.1,p-.1,1000,1000000,2,0,0,1].join(',');
  })}}));
}
function baoRaw(dates,receivedAt,{prices={},adjustflag='1',calendar=days}={}){
  const calendarRows=Array.from({length:(Date.parse('2026-11-26')-Date.parse('2026-01-01'))/86400000+1},(_,i)=>{
    const date=new Date(Date.parse('2026-01-01')+i*86400000).toISOString().slice(0,10);
    // An explicit complete fixture receipt, never a production holiday guess.
    return {calendar_date:date,is_trading_day:calendar.includes(date)?'1':'0'};
  });
  return Buffer.from(JSON.stringify({schemaVersion:1,source:'baostock',code,captureKind:'sdk-field-snapshot',
    startedAt:receivedAt-100,receivedAt,completedAt:receivedAt+50,
    request:{frequency:'d',adjustflag,start:'2026-01-01',end:dates.at(-1)},
    rows:dates.map(date=>{const p=prices[date]||10;return {date,code:'sh.'+code,open:String(p),high:String(p+.1),low:String(p-.1),
      close:String(p),volume:'100000',amount:'1000000',adjustflag,tradestatus:'1',turn:'1'};}),
    calendar:{source:'baostock:query_trade_dates',receivedAt:receivedAt+50,start:'2026-01-01',end:'2026-11-26',
      rows:calendarRows},canTrade:false,canNotify:false}));
}
function providers(dates,now,{emPrices={},baoPrices={}}={}){
  return {
    clock:()=>now+200,
    fetchEastmoney:async()=>H.normalizeEastmoney(emRaw(dates,{prices:emPrices}),{code,day:dates.at(-1),historyDays:160,receivedAt:now}),
    fetchBaoStock:async()=>H.normalizeBaoStock(baoRaw(dates,now+100,{prices:baoPrices}),{code,day:dates.at(-1),historyDays:160,receivedAt:now+200})
  };
}
function archive(d){
  const known=at(d,'15:30:00');return {scope:'live',bars:[],checks:[{id:'original-'+d,code,date:d,asOf:new Date(known).toISOString(),
    createdAt:new Date(known).toISOString(),factorObservations:{'TL-01':{factorCode:'TL-01',symbol:code,tradeDate:d,
      knownAt:known,source:'eastmoney-public-history',unit:'score',value:12,sampleSet:'real'}}}],plans:[],trades:[]};
}

test('HFQ adapters explicitly request the provider adjustment and retain actual receipts, raw bytes and units',()=>{
  const url=new URL(H.requestUrl(code,day,160));assert.equal(url.searchParams.get('fqt'),'2');
  const em=H.normalizeEastmoney(emRaw(['2026-11-20',day]),{code,day,historyDays:160,receivedAt:at(day)});
  const bao=H.normalizeBaoStock(baoRaw(['2026-11-20',day],at(day)+100),{code,day,historyDays:160,receivedAt:at(day)+200});
  assert.equal(em.bars[0].knownAt,at(day));assert.equal(em.bars[0].observedAt,at(day));
  assert.equal(em.bars[0].sourceTimestamp,null);assert.equal(em.bars[0].periodEndAt,at('2026-11-20','15:00:00'));
  assert.equal(em.bars[0].volume,100000);assert.equal(bao.bars[0].volume,100000);
  assert.equal(em.rawEvidence.hashBasis,'raw-response-bytes');assert.equal(bao.rawEvidence.hashBasis,'sdk-field-snapshot');
  assert.equal(bao.adjustmentEvidence.value,'1');assert.equal(bao.calendar.knownAt,at(day)+150);
  const report=auditCenterInputs([...em.bars,...bao.bars],{now:at(day)+200,marketCalendars:{CN:bao.calendar}});
  assert.equal(report.admittedGroups,2);assert.equal(report.admitted[0].consensusKnownAt,at(day)+100);
});

test('typed HFQ history cannot enter live execution, relabelling fails, and original 15-second unadjusted gates remain exact',()=>{
  const clock=at(day)+200;
  const em=H.normalizeEastmoney(emRaw([day]),{code,day,historyDays:160,receivedAt:at(day)});
  const bao=H.normalizeBaoStock(baoRaw([day],at(day)+100),{code,day,historyDays:160,receivedAt:clock});
  const historical=[...em.bars,...bao.bars];
  // Even a same-day receipt obtained less than a second ago is historical HFQ,
  // never a source quote clock or an unadjusted execution price.
  for(const [records,reason] of [[historical,'adjustment-mismatch'],
    [historical.map(row=>({...row,adjustment:'none'})),'invalid-historical-receipt-evidence']]){
    const report=auditCenterInputs(records,{purpose:'liveExecution',now:clock});
    assert.equal(report.admittedGroups,0);assert.equal(report.expectedAdjustment,'none');
    assert.deepEqual(report.rejected.map(row=>row.reason),[reason,reason]);
    assert.equal(report.canTrade,false);assert.equal(report.changesOriginalGates,false);
  }
  // Independent legacy quote fixtures retain their original price and clocks.
  const live=['eastmoney','tencent'].map(source=>({code,date:day,market:'CN',source,adjustment:'none',
    knownAt:clock,observedAt:clock-15000,currency:'CNY',volumeUnit:'shares',amountUnit:'CNY',
    open:10,high:10.1,low:9.9,close:10,volume:100000,amount:1000000,suspended:false,sampleSet:'real'}));
  const fresh=auditCenterInputs(live,{purpose:'liveExecution',now:clock});
  assert.equal(fresh.admittedGroups,1);assert.equal(fresh.rejected.length,0);assert.equal(fresh.canTrade,false);
  for(const now of [clock+1,clock+86400000]){
    const stale=auditCenterInputs(live,{purpose:'liveExecution',now});
    assert.equal(stale.admittedGroups,0);
    assert.deepEqual(stale.rejected.map(row=>row.reason),['stale-live-evidence','stale-live-evidence']);
    assert.equal(stale.canTrade,false);
  }
});

test('wrong securities, adjustment claims, unordered days, unknown amount and future receipts fail closed',()=>{
  const wrong=JSON.parse(emRaw([day]));wrong.data.code='600002';
  assert.throws(()=>H.normalizeEastmoney(Buffer.from(JSON.stringify(wrong)),{code,day,historyDays:160,receivedAt:at(day)}),/身份/);
  assert.throws(()=>H.normalizeBaoStock(baoRaw([day],at(day),{adjustflag:'3'}),{code,day,historyDays:160,receivedAt:at(day)+200}),/原始证据/);
  assert.throws(()=>H.normalizeEastmoney(emRaw([day,'2026-11-20']),{code,day,historyDays:160,receivedAt:at(day)}),/排序/);
  const missing=JSON.parse(emRaw([day]));missing.data.klines[0]=missing.data.klines[0].replace(',1000000,',',-,');
  assert.throws(()=>H.normalizeEastmoney(Buffer.from(JSON.stringify(missing)),{code,day,historyDays:160,receivedAt:at(day)}),/OHLCV/);
  const normalized=H.normalizeEastmoney(emRaw([day]),{code,day,historyDays:160,receivedAt:at(day)}).bars;
  const forged={...normalized[0],periodEndAt:at(day,'16:00:00')};
  assert.equal(auditCenterInputs([forged],{now:at(day)+200}).rejected[0].reason,'invalid-historical-receipt-evidence');
  assert.equal(auditCenterInputs(normalized,{now:at(day)-1}).rejected[0].reason,'future-or-backdated-time');
});

test('the provider calendar must include every queried natural date so missing days cannot skip a t+1 label',()=>{
  for(const index of [0,200,-1]){
    const receipt=JSON.parse(baoRaw([day],at(day)));
    receipt.calendar.rows.splice(index,1);
    assert.throws(()=>H.normalizeBaoStock(Buffer.from(JSON.stringify(receipt)),
      {code,day,historyDays:160,receivedAt:at(day)+200}),/日历/);
  }
});

test('the existing BaoStock access switch can still revoke a registered research route before any request',async t=>{
  const root=path.join(directory(t),'untouched'),catalog=require('../config/data-source-catalog.json'),
    row=catalog.sources.find(row=>row.id==='baostock'),before=row.access;
  try{
    row.access='registered-only';assert.equal(H.allowedSource('baostock'),false);
    await assert.rejects(H.collectCenterHistory({root,code,day},providers([day],at(day))),/访问门禁/);
    assert.equal(fs.existsSync(root),false);
  }finally{row.access=before;}
});

test('the independent archive persists both sources, retains first values and exposes later revisions without overwriting',async t=>{
  const root=directory(t),original=archive(day),before=JSON.stringify(original);
  const first=await H.collectCenterHistory({root,code,day,archive:original},providers(['2026-11-20',day],at(day)));
  assert.equal(first.status,'admitted');assert.equal(first.admittedGroups,2);assert.equal(JSON.stringify(original),before);
  const once=H.readCenterHistory({root,now:at(day)+201});assert.equal(once.bars.length,4);
  assert.equal(new Set(once.bars.filter(row=>row.date===day).map(row=>row.source)).size,2);
  assert.equal(once.frozenObservations[0].originCheckId,'original-'+day);
  assert.equal(once.frozenObservations[0].signalAt,at(day)+200);
  const changed={[day]:10.03,[next]:10.1};
  await H.collectCenterHistory({root,code,day:next},providers([day,next],at(next),{emPrices:changed,baoPrices:changed}));
  const read=H.readCenterHistory({root,now:at(next)+201});
  assert.equal(read.bars.find(row=>row.date===day).close,10);assert.equal(read.coverage.revisionConflicts,2);
  assert.equal(read.bars.find(row=>row.date===day&&row.source==='baostock').knownAt,at(day)+100);
  assert.equal(fs.statSync(path.join(root,code)).mode&0o777,0o700);
  assert.equal(fs.statSync(path.join(root,code,'000001.json')).mode&0o777,0o600);
});

test('a later provider capture never certifies an old signal; a new same-day freeze can mature on the actual next day',async t=>{
  const root=directory(t),original=archive(day);
  await H.collectCenterHistory({root,code,day,archive:original},providers([day],at(day)));
  await H.collectCenterHistory({root,code,day:next},providers([day,next],at(next),{emPrices:{[next]:10.1},baoPrices:{[next]:10.1}}));
  const history=H.readCenterHistory({root,now:at(next)+201});
  const report=buildIntelligenceResearch({day:next,now:at(next)+201,archive:original,bars:history.bars,marketCalendars:history.marketCalendars,
    frozenObservations:history.frozenObservations,historyCoverage:history.coverage});
  assert.equal(report.factors.alignedSamples,1);assert.equal(report.factors.rejectionReasons['calendar-known-after-signal'],1);
  assert.equal(report.historyIntake.admittedRows,4);assert.equal(report.walkforward.folds.length,0);
  const historical=archive('2026-11-20');
  const stale=buildIntelligenceResearch({day:next,now:at(next)+201,archive:historical,bars:history.bars,marketCalendars:history.marketCalendars});
  assert.equal(stale.factors.alignedSamples,0);
});

test('persisted signals remain pending after their stock leaves the current pool and finish only on an admitted next-day label',async t=>{
  const root=directory(t);
  await H.collectCenterHistory({root,code,day,archive:archive(day)},providers([day],at(day)));
  const same=H.readPendingCenterHistory({root,day,now:at(day)+201});
  assert.deepEqual(same.codes,[]);assert.equal(same.coverage.waitingForNextClose,1);
  const pending=H.readPendingCenterHistory({root,day:next,now:at(next)});
  assert.deepEqual(pending.codes,[code]);assert.equal(pending.pending[0].nextTradingDay,next);
  assert.equal(pending.pending[0].reason,'missing-admitted-next-day-hfq');
  assert.equal(pending.coverage.currentPoolRequired,false);
  await H.collectCenterHistory({root,code,day:next},providers([day,next],at(next)));
  const complete=H.readPendingCenterHistory({root,day:next,now:at(next)+201});
  assert.deepEqual(complete.codes,[]);
});

test('pending history never repairs an old signal with a later receipt but can freeze a current-day check',async t=>{
  const root=directory(t);
  const current=H.readPendingCenterHistory({root,archive:archive(day),day,now:at(day)});
  assert.deepEqual(current.codes,[code]);assert.equal(current.pending[0].reason,'today-check-awaiting-hfq-freeze');
  const old=H.readPendingCenterHistory({root,archive:archive(day),day:next,now:at(next)});
  assert.deepEqual(old.codes,[]);assert.equal(old.coverage.excludedSignals,1);
  await H.collectCenterHistory({root,code,day:next,archive:archive(day)},providers([day,next],at(next)));
  const still=H.readPendingCenterHistory({root,archive:archive(day),day:next,now:at(next)+201});
  assert.deepEqual(still.codes,[]);assert.equal(still.coverage.excludedSignals,1);
});

test('pending history scans a bounded rotating page and reports omitted codes without depending on current selection',t=>{
  const root=directory(t),checks=Array.from({length:45},(_,i)=>{
    const code=String(600000+i);return JSON.parse(JSON.stringify(archive(day).checks[0]).replaceAll('600001',code));
  }),state={scope:'live',checks};
  const first=H.readPendingCenterHistory({root,archive:state,day,now:at(day)});
  assert.equal(first.codes.length,30);assert.equal(first.coverage.inspectedCodes,40);
  assert.equal(first.coverage.nextCursor,40);assert.equal(first.coverage.truncated,true);
  const second=H.readPendingCenterHistory({root,archive:state,day,now:at(day),cursor:first.coverage.nextCursor});
  assert.equal(second.coverage.inspectedCodes,40);assert.equal(second.coverage.nextCursor,35);
  assert.equal(second.coverage.availableCodes,45);
  assert.ok(second.codes.includes('600044'));
  assert.throws(()=>H.readPendingCenterHistory({root,day,now:at(day),cursor:-1}),/游标/);
});

test('source conflicts remain quarantined with raw evidence and bounded persisted retry state',async t=>{
  const root=directory(t),conflict={baoPrices:{[day]:12}};
  const first=await H.collectCenterHistory({root,code,day},providers([day],at(day),conflict));
  assert.equal(first.status,'quarantined');assert.equal(first.admittedGroups,0);
  const file=JSON.parse(fs.readFileSync(path.join(root,code,'000001.json'),'utf8'));
  assert.equal(file.data.providers.length,2);assert.ok(file.data.providers.every(p=>p.rawEvidence.data));
  const read=H.readCenterHistory({root,now:at(day)+201});assert.equal(read.bars.length,0);
  const report=buildIntelligenceResearch({day,now:at(day)+201,bars:read.bars,historyCoverage:read.coverage});
  assert.equal(report.quality.components.find(row=>row.id==='consistency').value,0,'quarantine does not disappear from the Q denominator');
  assert.equal(report.feedback.status,'candidates-pending-validation');
  assert.equal(report.feedback.qualityCandidates[0].type,'history-intake-quality-review');
  let calls=0;
  const early=await H.collectCenterHistory({root,code,day},{clock:()=>at(day)+60000,fetchEastmoney:async()=>{calls++;}});
  assert.equal(early.status,'bounded-retry-wait');assert.equal(calls,0);
  for(const minutes of [16,32])await H.collectCenterHistory({root,code,day},providers([day],at(day)+minutes*60000,conflict));
  const final=await H.collectCenterHistory({root,code,day},{clock:()=>at(day)+60*60000});
  assert.equal(final.status,'bounded-retry-wait');assert.equal(final.attempts,3);assert.equal(final.nextEligibleAt,null);
});

test('complete same-day intake, replicas and provider closing time do not repeat physical requests',async t=>{
  const root=directory(t);
  const wait=await H.collectCenterHistory({root,code,day},{clock:()=>at(day,'15:15:00')});
  assert.equal(wait.status,'waiting-provider-close');assert.equal(fs.readdirSync(root).length,0);
  assert.equal((await H.collectCenterHistory({root,code,day,replica:true})).status,'replica-read-only');
  await H.collectCenterHistory({root,code,day},providers([day],at(day)));
  const result=await H.collectCenterHistory({root,code,day},{clock:()=>at(day)+60*60000});
  assert.equal(result.status,'already-collected');assert.equal(result.reused,true);
});

test('missing dependencies and failed sources never create synthetic history or calendar',async t=>{
  const root=directory(t);
  const result=await H.collectCenterHistory({root,code,day},{clock:()=>at(day),
    fetchEastmoney:async()=>{throw Error('upstream unavailable');},
    fetchBaoStock:async()=>({source:'baostock',status:'missing-dependency',bars:[],calendar:null,receivedAt:at(day)})});
  assert.equal(result.status,'quarantined');assert.equal(result.sources[1].status,'missing-dependency');
  const history=H.readCenterHistory({root,now:at(day)+1});
  assert.deepEqual(history.marketCalendars,{});assert.equal(history.bars.length,0);assert.equal(history.coverage.sourceStatus.length,2);
});

test('a process lock covers the physical collection so simultaneous callers cannot bypass the daily budget',async t=>{
  const root=directory(t),deps=providers([day],at(day));let release,started;
  const began=new Promise(resolve=>{started=resolve;}),original=deps.fetchEastmoney;
  deps.fetchEastmoney=async()=>{started();await new Promise(resolve=>{release=resolve;});return original();};
  const first=H.collectCenterHistory({root,code,day},deps);await began;
  const second=await H.collectCenterHistory({root,code,day},providers([day],at(day)));
  assert.equal(second.status,'collection-in-progress');release();
  assert.equal((await first).status,'admitted');
  assert.equal(fs.readdirSync(path.join(root,code)).filter(name=>name.endsWith('.json')).length,1);
});

test('an interrupted collection consumes a durable attempt and revocation after one source prevents the second source and capture commit',async t=>{
  const root=directory(t);let writable=true,emCalls=0,baoCalls=0;
  for(const minutes of [0,16,32]){
    writable=true;const deps=providers([day],at(day)+minutes*60000),fetch=deps.fetchEastmoney;
    deps.canWrite=()=>writable;
    deps.fetchEastmoney=async()=>{emCalls++;const value=await fetch();writable=false;return value;};
    deps.fetchBaoStock=async()=>{baoCalls++;assert.fail('revocation must stop the later supplier');};
    const result=await H.collectCenterHistory({root,code,day},deps);
    assert.equal(result.status,'read-only-instance');
  }
  const starts=journal.readEvents(path.join(root,'attempts',code),{asOf:at(day)+60*60000});
  assert.equal(starts.length,3);assert.ok(starts.every(row=>row.data.protocol===H.ATTEMPT_PROTOCOL));
  assert.equal(fs.existsSync(path.join(root,code)),false);
  assert.equal(emCalls,3);assert.equal(baoCalls,0);
  writable=true;
  const restarted=await H.collectCenterHistory({root,code,day},{clock:()=>at(day)+60*60000,canWrite:()=>writable,
    fetchEastmoney:()=>assert.fail('restarting must not reset persisted failed attempts')});
  assert.equal(restarted.status,'bounded-retry-wait');assert.equal(restarted.attempts,3);
});

test('the actual collection worker requires authorization and rechecks it before creating files or calling a provider',async t=>{
  const root=directory(t),historyRoot=path.join(directory(t),'history'),payload={action:'intelligence-history-collect',root,historyRoot,code,day};
  const denied=await runWorkspaceJob(payload);
  assert.equal(denied.ok,false);assert.equal(denied.httpStatus,403);assert.equal(fs.existsSync(historyRoot),false);
  let checks=0;
  const revoked=await runWorkspaceJob(payload,{authorize:()=>++checks===1});
  assert.equal(revoked.ok,true);assert.equal(revoked.result.status,'read-only-instance');assert.ok(checks>=2);
  assert.equal(fs.existsSync(historyRoot),false);
});

test('hash corruption and symlink archives fail closed instead of silently returning empty research',async t=>{
  const root=directory(t);await H.collectCenterHistory({root,code,day},providers([day],at(day)));
  const file=path.join(root,code,'000001.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));
  data.data.admittedBars[0].close=88;fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>H.readCenterHistory({root,now:at(day)+201}),/完整性/);
  const link=path.join(directory(t),'link');fs.symlinkSync(root,link);
  assert.throws(()=>H.readCenterHistory({root:link,now:at(day)+201}),/符号链接/);
});

test('private research worker reads independent HFQ history without writing the original research archive',async t=>{
  const root=directory(t),historyRoot=directory(t);
  const initial=await runWorkspaceJob({action:'shortline',root,book:'main',replica:false});assert.equal(initial.ok,true);
  await H.collectCenterHistory({root:historyRoot,code,day,archive:archive(day)},providers([day],at(day)));
  // Existing empty archives still display intake coverage; use their own books
  // and histories, never a browser-supplied research file or provider URL.
  const result=await runWorkspaceJob({action:'intelligence-research',root,historyRoot,replica:false,day,now:Date.now(),quotes:[]});
  assert.equal(result.ok,true);assert.equal(result.result.historyIntake.protocol,H.PROTOCOL);
  assert.equal(result.result.historyIntake.admittedRows,2);
  assert.equal(result.result.originalGatesChanged,false);
  const pending=await runWorkspaceJob({action:'intelligence-history-pending',root,historyRoot,replica:true,day:next,now:at(next),cursor:0});
  assert.equal(pending.ok,true);assert.deepEqual(pending.codes,[code]);
  assert.equal(pending.coverage.inspectedCodes,1);
});
