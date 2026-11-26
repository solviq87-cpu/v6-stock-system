'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntimeAcceptance,buildUnifiedTaskStatus,marketSlot,observeOriginalAccountReconciliation}=require('../src/core/runtime-acceptance');
const sha='a'.repeat(40),days=['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-30'];
const at=(day,hour,minute)=>Date.parse(day+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00');
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=at(days[0],9,30),sourceSha=sha,enabled=true,mode='live',quotes=null,calls=0;
 const {createPaperApplicationService}=require('../src/core/paper-application-service');
 const ledgerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-runtime-ledgers-'));t.after(()=>fs.rmSync(ledgerRoot,{recursive:true,force:true}));
 const books=Object.fromEntries(['pool','pre'].map(id=>[id,createPaperApplicationService({file:path.join(ledgerRoot,id+'.json'),clock:()=>now})]));
 for(const book of Object.values(books))book.initialize(100000);
 const state={setNow:n=>now=n,setSha:s=>sourceSha=s,setEnabled:v=>enabled=v,setMode:v=>mode=v,setQuotes:v=>quotes=v,calls:()=>calls};
 const collect=async()=>({mode,market:{expectedSymbols:2,attempts:1,successes:1,quotes:quotes||[
   {code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now},{code:'000001',source:'provider',price:20,quoteAt:now-15000,receivedAt:now}]},
   risk:{observed:2,queued:2,delivered:1,resolved:1,falsePositives:0,falseNegatives:0,deliveryDelayMs:200},
   execution:{intents:3,submittedOrders:2,confirmedFills:0,paperFills:1,reconciled:true,recoveryVerified:true,reconciliationReceipt:observeOriginalAccountReconciliation({now,clock:()=>now,readBook:id=>books[id].read()}).reconciliationReceipt},
   strategy:{matureSamples:50,netReturnPct:-1,maxDrawdownPct:3,calibrationError:.1},
   clients:{desktopVersion:'v1',mobileVersion:'v1',apiVersion:'v1',permissionsConsistent:true,featuresConsistent:true}});
 const ops=createRuntimeAcceptance({root,canWrite:()=>enabled,collect,clock:()=>now,env:{NODE_ENV:'production'},
   calendar:()=>({status:'available',tradeDates:days,metadata:{source:'test-explicit-calendar',runtimeEligible:true,sha256:'b'.repeat(64),from:days[0],to:days.at(-1)}}),
   release:async()=>{calls++;return {verifiedInstalled:true,sourceSha};},criteria:{minimumMatureSamples:20,maximumDrawdownPct:10,maximumCalibrationError:.2},...options});
 return {root,ops,...state};
}
async function fullDay(f,day){for(const [h,start,end]of [[9,30,60],[10,0,60],[11,0,30],[13,0,60],[14,0,60]])
 for(let m=start;m<end;m+=5){f.setNow(at(day,h,m));const r=await f.ops.tick();assert.equal(r.recorded,true);}}
test('one real tick is a partial day and repeated calls cannot manufacture time or slots',async t=>{
 const f=fixture(t);assert.equal((await f.ops.tick()).recorded,true);assert.equal((await f.ops.tick()).recorded,false);
 f.setNow(at(days[0],16,0));const r=await f.ops.report();assert.equal(r.observedTradingDays,1);assert.equal(r.completeObservationDays,0);
 assert.equal(r.days[0].status,'observed-partial');assert.equal(r.stages[0].passed,false);assert.equal(r.days[0].latest.risk.queued,2);
 assert.equal(r.days[0].latest.risk.delivered,1);assert.equal(r.days[0].latest.execution.confirmedFills,0);assert.equal(r.days[0].latest.execution.paperFills,1);
});
test('five actual session windows reach review eligibility without claiming acceptance or profitability',async t=>{
 const f=fixture(t);for(const day of days.slice(0,5))await fullDay(f,day);f.setNow(at(days[4],16,0));
 const r=await f.ops.report();assert.equal(r.completeObservationDays,5);assert.equal(r.elapsedTradingDays,5);
 assert.equal(r.stages[0].status,'ready-for-independent-review');assert.equal(r.stages[0].passed,false);
 assert.equal(r.stages[1].windowReached,false);assert.equal(r.longTermAccepted,false);assert.equal(r.days[0].latest.strategy.netReturnPct,-1);
});
test('synthetic, replay and smoke collections never start the live-day counter',async t=>{
 for(const mode of ['isolated','replay']){const f=fixture(t);f.setMode(mode);await f.ops.tick();f.setNow(at(days[4],16,0));const r=await f.ops.report();assert.equal(r.observedTradingDays,0);assert.equal(r.elapsedTradingDays,0);assert.equal(r.completeObservationDays,0);assert.equal(r.isolatedOrUnverifiedDays.length,1);}
 const f=fixture(t,{env:{NODE_ENV:'production',V6_ISOLATED_BOOT_SMOKE:'1'}});await f.ops.tick();assert.equal((await f.ops.report()).observedTradingDays,0);
});
test('freshness uses original quote time; receivedAt and extra client fields cannot backfill a day',async t=>{
 const f=fixture(t);f.setQuotes([{code:'600001',source:'provider',price:10,quoteAt:at(days[0],8,30),receivedAt:at(days[0],9,30)}]);
 const r=await f.ops.tick({day:'2026-10-01',synthetic:false,observedAt:1});assert.equal(r.liveEligible,false);
 const report=await f.ops.report();assert.equal(report.observedTradingDays,0);assert.equal(report.excludedDayEvidence[0].day,days[0]);
 assert.equal(report.excludedDayEvidence[0].latest.market.staleQuotes,1);
});
test('current timestamps do not authenticate simulated, imported or reception-time-missing observations',async t=>{
 for(const extra of [{simulated:true},{imported:true},{fixture:true},{quoteMode:'historical-replay'},{canTrade:false},{receivedAt:undefined}]){
  const f=fixture(t);f.setQuotes([{code:'600001',source:'provider',price:10,quoteAt:at(days[0],9,30)-1000,receivedAt:at(days[0],9,30),...extra}]);
  const r=await f.ops.tick();assert.equal(r.liveEligible,false);assert.equal((await f.ops.report()).observedTradingDays,0);
 }
});
test('missing, zero, nonfinite and negative prices cannot authenticate otherwise fresh quotes',async t=>{
 for(const price of [undefined,null,0,NaN,Infinity,-1,'10']){
  const f=fixture(t);f.setQuotes([{code:'600001',source:'provider',price,quoteAt:at(days[0],9,30)-1000,receivedAt:at(days[0],9,30)}]);
  const result=await f.ops.tick(),report=await f.ops.report();assert.equal(result.liveEligible,false);assert.equal(report.observedTradingDays,0);
  const market=report.excludedDayEvidence[0].latest.market;assert.equal(market.invalidPrice,1);assert.equal(market.freshQuotes,0);
  assert.equal(market.quoteEvidence.samples[0].reason,'invalid-price');
 }
});
test('research-only or unqualified calendars preserve excluded records but cannot count real days',async t=>{
 for(const runtimeEligible of [false,undefined]){
  const f=fixture(t,{calendar:()=>({status:'available',tradeDates:days,metadata:{source:'research-calendar',runtimeEligible,sourceAuthenticated:false}})});
  const result=await f.ops.tick();assert.equal(result.recorded,true);assert.equal(result.liveEligible,false);assert.ok(result.exclusions.includes('calendar-not-runtime-eligible'));
  f.setNow(at(days[4],16,0));const report=await f.ops.report();assert.equal(report.observedTradingDays,0);assert.equal(report.elapsedTradingDays,0);
  assert.equal(report.calendar.status,'research-only');assert.equal(report.calendar.runtimeEligible,false);assert.equal(report.calendar.sourceAuthenticated,false);
  assert.ok(report.stages.every(stage=>stage.blockers.includes('calendar-not-runtime-eligible')));assert.equal(report.excludedDayEvidence.length,1);
 }
 const authorized=fixture(t,{calendar:()=>({isOpen:day=>days.includes(day),metadata:{source:'configured-authority-calendar',from:days[0],to:days.at(-1),runtimeEligible:true,verifiedExternal:false}})});
 assert.equal((await authorized.ops.tick()).liveEligible,true);assert.equal((await authorized.ops.report()).calendar.sourceAuthenticated,false);
});
test('bounded quote audit preserves original times and hashes whitelisted inputs without recording secrets',async t=>{
 const f=fixture(t),now=at(days[0],9,30),quotes=Array.from({length:10001},(_,i)=>({code:String(100000+i),source:'provider-'+i,
  price:10+i/100,quoteAt:now-5000,receivedAt:now-2000,token:'DO_NOT_RETAIN',extra:{privateKey:'DO_NOT_RETAIN'}}));
 f.setQuotes(quotes);assert.equal((await f.ops.tick()).recorded,true);
 const file=path.join(f.root,days[0]+'.jsonl'),raw=fs.readFileSync(file,'utf8'),row=JSON.parse(raw),audit=row.metrics.market.quoteEvidence;
 assert.ok(Buffer.byteLength(raw)<=16384);assert.doesNotMatch(raw,/DO_NOT_RETAIN|token|privateKey/);
 assert.equal(audit.samples.length,10);assert.equal(audit.sampled,true);assert.equal(audit.sampleTruncated,true);
 assert.equal(audit.samples[0].quoteAt,now-5000);assert.equal(audit.samples[0].receivedAt,now-2000);assert.notEqual(audit.samples[0].quoteAt,row.observedAt);
 assert.equal(audit.samples[0].price,10);assert.equal(audit.samples[0].reason,'fresh-original-quote');assert.equal(audit.samples[0].eligibleFresh,true);
 assert.equal(audit.totalSeen,10001);assert.equal(audit.processedInputs,10000);assert.equal(audit.maxInputs,10000);assert.equal(audit.truncated,true);
 assert.equal(audit.digestScope,'whitelisted-processed-prefix');assert.match(audit.inputDigest,/^[a-f0-9]{64}$/);assert.equal(row.metrics.market.sources.length,32);
 f.setNow(now+60000);quotes[12].price+=1;f.setQuotes(quotes);await f.ops.tick();
 const later=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).at(-1).metrics.market.quoteEvidence;
 assert.notEqual(later.inputDigest,audit.inputDigest,'a nonsampled input still contributes to the digest');
 assert.equal(later.samples[0].quoteAt,now-5000);assert.equal(later.samples[0].reason,'stale-original-time');
});
test('legacy live booleans without calendar eligibility and quote evidence remain preserved but excluded',async t=>{
 const f=fixture(t);await f.ops.tick();const file=path.join(f.root,days[0]+'.jsonl');
 const {fingerprint,...body}=JSON.parse(fs.readFileSync(file,'utf8'));
 delete body.calendar.runtimeEligible;delete body.metrics.market.quoteEvidence;
 const legacy={...body,fingerprint:require('node:crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex')};
 const raw=JSON.stringify(legacy)+'\n';fs.writeFileSync(file,raw);f.setNow(at(days[0],16,0));
 const report=await f.ops.report();assert.equal(report.observedTradingDays,0);assert.equal(report.completeObservationDays,0);
 assert.ok(report.excludedDayEvidence[0].exclusionReasons.includes('legacy-observation-evidence-not-revalidated'));
 assert.equal(fs.readFileSync(file,'utf8'),raw);
});
test('missed trading days and code upgrades stay in the fixed review window',async t=>{
 const f=fixture(t);await fullDay(f,days[0]);f.setSha('c'.repeat(40));await fullDay(f,days[4]);f.setNow(at(days[4],16,0));
 const r=await f.ops.report();assert.equal(r.elapsedTradingDays,5);assert.deepEqual(r.missingTradingDays,days.slice(1,4));
 assert.equal(r.stages[0].status,'evidence-or-remediation-required');assert.ok(r.stages[0].blockers.includes('multiple-versions-require-comparability-review'));
 assert.equal(r.versionSegments.length,2);
});
test('revoked writes, unknown calendar and old code do not get accepted as observations',async t=>{
 const f=fixture(t);f.setEnabled(false);assert.equal((await f.ops.tick()).reason,'replica-or-write-disabled');assert.deepEqual(fs.readdirSync(f.root),[]);
 const g=fixture(t,{calendar:()=>({status:'unavailable'})});assert.equal((await g.ops.tick()).reason,'calendar-unavailable');
 const h=fixture(t,{release:()=>({verifiedInstalled:false,sourceSha:sha})});assert.equal((await h.ops.tick()).liveEligible,false);
});
test('corruption, truncated writes and backwards clocks fail closed and preserve bytes',async t=>{
 const f=fixture(t);await f.ops.tick();const file=path.join(f.root,days[0]+'.jsonl'),original=fs.readFileSync(file);
 f.setNow(at(days[0],9,29));assert.equal((await f.ops.tick()).reason,'outside-observation-session');
 f.setNow(at(days[0],9,30));assert.equal((await f.ops.tick()).reason,'acceptance-clock-regressed');
 fs.appendFileSync(file,'{"incomplete":');const corrupted=fs.readFileSync(file);
 await assert.rejects(()=>f.ops.report(),/incomplete-write/);assert.deepEqual(fs.readFileSync(file),corrupted);
 fs.writeFileSync(file,original.toString().replace('"queued":2','"queued":200'));
 await assert.rejects(()=>f.ops.report(),/integrity/);
});
test('release hash work is cached for five minutes and metrics do not store arbitrary secrets',async t=>{
 const f=fixture(t);await f.ops.tick();f.setNow(at(days[0],9,31));await f.ops.tick();assert.equal(f.calls(),1);
 f.setNow(at(days[0],9,35));await f.ops.tick();assert.equal(f.calls(),2);
 const content=fs.readFileSync(path.join(f.root,days[0]+'.jsonl'),'utf8');assert.doesNotMatch(content,/\/workspace|Authorization|token|password/);
});
test('calendar closes lunch and afternoon boundaries; data before known scope cannot form a session',()=>{
 assert.equal(marketSlot(at(days[0],9,29)),null);assert.equal(marketSlot(at(days[0],9,30)),0);assert.equal(marketSlot(at(days[0],11,30)),null);
 assert.equal(marketSlot(at(days[0],13,0)),24);assert.equal(marketSlot(at(days[0],14,59)),47);assert.equal(marketSlot(at(days[0],15,0)),null);
});
test('all 78 tasks keep six independent evidence axes and use trusted task inventory names',()=>{
 const rows=buildUnifiedTaskStatus([{id:77,sourceSha:sha,code:{status:'implemented',evidence:['V6_BO/src/core/release-provenance.js']},
   deployed:{status:'deployed',evidence:[]},validation:{status:'passed',evidence:['https://github.com/solviq87-cpu/v6-stock-system/actions/runs/123?token=secret']}}]);
 assert.equal(rows.length,78);assert.equal(rows[0].title,'统一风险工作台');assert.equal(rows[76].code.status,'implemented');
 assert.equal(rows[76].deployed.status,'unknown');assert.equal(rows[76].validation.status,'unknown');assert.equal(rows[77].observation.status,'unknown');
});
test('existing-group PR references can be retained without inventing their task contents or completion',()=>{
 // This tests reference ingestion, not whether this historical PR implements
 // task 1. Task assignment and completion require separately verified evidence.
 const reference='https://github.com/solviq87-cpu/v6-stock-system/pull/219';
 const row=buildUnifiedTaskStatus([{id:1,title:'unverified declaration',code:{evidence:[reference,
  'V6_BO/../../private.json','https://github.com/solviq87-cpu/v6-stock-system/pull/not-a-pr',
  'https://github.com/solviq87-cpu/v6-stock-system/pull/219?token=secret']}}])[0];
 assert.equal(row.title,'统一风险工作台');assert.equal(row.sourceSha,null);assert.deepEqual(row.code.evidence,[reference]);
 for(const axis of ['code','interface','realData','validation','deployed','observation'])assert.equal(row[axis].status,'unknown');
});


test('failed actual installed collection fixes the original review window without earning a complete live day',async t=>{
 let failing=true;
 const f=fixture(t,{liveCollector:true,collect:async({now})=>{
  if(failing)throw Error('source unreachable');
  return {mode:'live',market:{expectedSymbols:1,attempts:1,successes:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now}]}};
 }});
 const failure=await f.ops.tick();assert.equal(failure.recorded,true);assert.equal(failure.liveEligible,false);
 failing=false;
 for(const day of days.slice(1))await fullDay(f,day);
 f.setNow(at(days.at(-1),16,0));
 const report=await f.ops.report();
 assert.equal(report.observedTradingDays,5);assert.equal(report.elapsedTradingDays,6);
 assert.equal(report.stages[0].from,days[0]);assert.equal(report.stages[0].to,days[4]);
 assert.equal(report.stages[0].completeObservationDays,4);assert.equal(report.stages[0].passed,false);
 assert.ok(report.stages[0].blockers.includes('collector-failure'));assert.ok(report.stages[0].blockers.includes('incomplete-observation-day'));
 const excluded=report.days.find(x=>x.day===days[0]);assert.equal(excluded.liveSamples,0);assert.equal(excluded.attemptSamples,1);
});
test('a failed isolated collector never starts the real trading-day window',async t=>{
 const f=fixture(t,{liveCollector:true,env:{NODE_ENV:'production',V6_ISOLATED_BOOT_SMOKE:'1'},collect:async()=>{throw Error('fixture failure');}});
 const receipt=await f.ops.tick();assert.equal(receipt.liveEligible,false);
 f.setNow(at(days[4],16,0));const report=await f.ops.report();
 assert.equal(report.observedTradingDays,0);assert.equal(report.elapsedTradingDays,0);assert.equal(report.excludedDayEvidence[0].attemptSamples,0);
});


test('explicit source conflicts and contradictory duplicate quotes cannot earn fresh runtime coverage',async t=>{
 for(const flags of [{sourceConflict:true},{conflict:true},{evidenceStatus:'conflict'},{quoteStatus:'conflict'}]){
  const f=fixture(t),now=at(days[0],9,30);
  f.setQuotes([{code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now,...flags}]);
  const receipt=await f.ops.tick();assert.equal(receipt.recorded,true);assert.equal(receipt.liveEligible,false);
  f.setNow(at(days[0],16,0));const report=await f.ops.report(),d=report.days[0];
  assert.equal(d.liveSamples,0);assert.equal(d.attemptSamples,1);
  assert.equal(d.latest.market.freshQuotes,0);assert.equal(d.latest.market.conflictingSymbols,1);
  assert.equal(d.latest.market.quoteEvidence.samples[0].reason,'source-conflict');
  assert.ok(d.failures.includes('quote-source-conflict'));
 }
 const f=fixture(t),now=at(days[0],9,30),q={code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now};
 f.setQuotes([q,{...q,price:11},{...q,code:'000001'}]);
 const receipt=await f.ops.tick();assert.equal(receipt.recorded,true);
 f.setNow(at(days[0],16,0));const report=await f.ops.report(),d=report.days[0];
 assert.equal(d.latest.market.observedSymbols,2);assert.equal(d.latest.market.freshQuotes,1);
 assert.equal(d.latest.market.conflictingSymbols,1);assert.equal(d.latest.market.duplicateInputs,1);
 assert.equal(d.latest.market.freshCoverage,.5);assert.ok(d.failures.includes('quote-source-conflict'));
 assert.equal(d.latest.market.quoteEvidence.samples[0].reason,'duplicate-quote-conflict');
 const g=fixture(t);g.setQuotes([q,{...q},{...q,code:'000001'}]);await g.ops.tick();
 const same=(await g.ops.report()).days[0].latest.market;assert.equal(same.freshQuotes,2);assert.equal(same.conflictingSymbols,0);assert.equal(same.duplicateInputs,1);
});

test('later failed qualified attempt is preserved in the same day instead of averaging only successes',async t=>{
 let failing=false;const f=fixture(t,{liveCollector:true,collect:async({now})=>{
  if(failing)throw Error('source unavailable');
  return {mode:'live',market:{expectedSymbols:1,attempts:1,successes:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now}]},execution:{reconciled:true}};
 }});
 await f.ops.tick();failing=true;f.setNow(at(days[0],9,31));await f.ops.tick();
 f.setNow(at(days[0],16,0));const d=(await f.ops.report()).days[0];
 assert.equal(d.attemptSamples,2);assert.equal(d.liveSamples,1);
 assert.equal(d.latest.market.freshQuotes,0);assert.equal(d.latestLive.market.freshQuotes,1);
 assert.equal(d.minimumFreshCoverage,null);assert.ok(d.unknown.includes('marketCoverage'));
 assert.ok(d.unknown.includes('collectionSuccess'));assert.ok(d.failures.includes('collector-failure'));
});

// A known invalid population may be an attempted observation but not a live slot.
test('78 a simulated duplicate or separate row cannot enter the live-day denominator',async t=>{
 const now=at(days[0],9,30),a={code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now};
 const simulated={...a,simulated:true},separate={...simulated,code:'000001'};
 for(const rows of [[a,simulated],[simulated,a],[a,separate],[separate,a]]){
  const f=fixture(t);f.setQuotes(rows);const receipt=await f.ops.tick();
  assert.equal(receipt.liveEligible,false);assert.ok(receipt.exclusions.includes('non-live-quote-input'));
  const r=await f.ops.report();assert.equal(r.elapsedTradingDays,0);assert.equal(r.observedTradingDays,0);
  assert.equal(r.excludedDayEvidence[0].latest.market.nonLiveQuotes,1);
 }
});
test('78 conflicting, truncated, malformed or over-denominator inputs cannot count as complete live slots',async t=>{
 const now=at(days[0],9,30),a={code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now};
 for(const [reason,quotes,expectedSymbols] of [
  ['quote-source-conflict',[a,{...a,price:11},{...a,code:'000001'}],2],
  ['invalid-quote-identity',[a,{...a,code:'invalid'}],2],
  ['quote-population-mismatch',[a,{...a,code:'000001',quoteAt:now-16000}],1],
  ['quote-input-limit-exceeded',Array.from({length:10001},(_,i)=>({...a,code:String(100000+i)})),10000]
 ]){
  const f=fixture(t,{collect:async()=>({mode:'live',market:{expectedSymbols,quotes}})});
  const receipt=await f.ops.tick();assert.equal(receipt.liveEligible,false,reason);assert.ok(receipt.exclusions.includes(reason));
  const report=await f.ops.report(),d=report.days[0];assert.equal(d.liveSamples,0);assert.equal(d.attemptSamples,1);assert.ok(d.failures.includes(reason));
  if(reason==='quote-population-mismatch'||reason==='quote-input-limit-exceeded')assert.equal(d.latest.market.freshCoverage,null);
 }
});

test('78 isolated same-day failures and criteria do not pollute genuine acceptance evidence',async t=>{
 const f=fixture(t);await f.ops.tick();
 let now=at(days[0],9,31),failing=true;
 const isolated=createRuntimeAcceptance({root:f.root,canWrite:()=>true,clock:()=>now,liveCollector:true,
  env:{NODE_ENV:'production',V6_ISOLATED_BOOT_SMOKE:'1'},
  calendar:()=>({status:'available',tradeDates:days,metadata:{source:'test-explicit-calendar',runtimeEligible:true,sha256:'b'.repeat(64),from:days[0],to:days.at(-1)}}),
  release:()=>({verifiedInstalled:true,sourceSha:'c'.repeat(40)}),criteria:{minimumMatureSamples:99},
  collect:async()=>{if(failing)throw Error('isolated failure');return {mode:'replay',market:{expectedSymbols:1,quotes:[{code:'600001',source:'provider',price:0,quoteAt:now+1000,receivedAt:now}]}};}});
 assert.equal((await isolated.tick()).recorded,true);
 failing=false;now=at(days[0],9,32);assert.equal((await isolated.tick()).recorded,true);
 f.setNow(at(days[0],16,0));const d=(await f.ops.report()).days[0];
 assert.equal(d.samples,3);assert.equal(d.attemptSamples,1);assert.equal(d.liveSamples,1);assert.equal(d.criteriaHashes.length,1);
 for(const reason of ['collector-failure','future-original-quote-time','invalid-original-quote-price','version-or-criteria-changed-within-day'])assert.ok(!d.failures.includes(reason),reason);
 for(const reason of ['collector-failure','future-original-quote-time','invalid-original-quote-price','isolated-replay-or-unidentified-run'])assert.ok(d.exclusionReasons.includes(reason),reason);
 assert.equal(d.latest.risk.queued,2);
});
test('78 isolated positive snapshots are diagnostic only, never business acceptance evidence',async t=>{
 const f=fixture(t);f.setMode('replay');await f.ops.tick();
 const report=await f.ops.report(),d=report.excludedDayEvidence[0];
 assert.equal(d.latest.risk.delivered,1);assert.equal(d.attemptSamples,0);assert.deepEqual(d.criteriaHashes,[]);
 for(const axis of ['riskEffectiveness','notificationDelivery','recoveryEvidence','strategyOutcomes','modelCalibration','dualClientParity'])assert.ok(d.unknown.includes(axis),axis);
});
test('78 late positive snapshots cannot establish timely business acceptance evidence',async t=>{
 let now=at(days[0],9,30);const f=fixture(t,{clock:()=>now,collect:async({now:observedAt})=>{
  now+=16000;
  return {mode:'live',market:{expectedSymbols:1,attempts:1,successes:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:observedAt-1000,receivedAt:observedAt}]},
   risk:{falsePositives:0,falseNegatives:0,delivered:1,deliveryDelayMs:200},execution:{recoveryVerified:true},
   strategy:{matureSamples:50,netReturnPct:1,maxDrawdownPct:3,calibrationError:.1},
   clients:{desktopVersion:'v1',mobileVersion:'v1',apiVersion:'v1',permissionsConsistent:true,featuresConsistent:true}};
 }});
 const receipt=await f.ops.tick();assert.equal(receipt.recorded,true);assert.equal(receipt.liveEligible,false);
 now=at(days[0],16,0);const d=(await f.ops.report()).days[0];
 assert.equal(d.attemptSamples,1);assert.equal(d.liveSamples,0);assert.equal(d.latest.risk.delivered,1);
 assert.ok(d.failures.includes('collection-window-exceeded'));
 for(const axis of ['riskEffectiveness','notificationDelivery','recoveryEvidence','strategyOutcomes','modelCalibration','dualClientParity'])assert.ok(d.unknown.includes(axis),axis);
});
test('78 contradictory historical eligibility cannot earn live coverage',async t=>{
 const f=fixture(t);await f.ops.tick();
 const file=path.join(f.root,days[0]+'.jsonl'),{fingerprint,...body}=JSON.parse(fs.readFileSync(file,'utf8'));
 body.exclusions=['collection-window-exceeded'];body.attemptEligible=true;
 const raw=JSON.stringify({...body,fingerprint:require('node:crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex')})+'\n';
 fs.writeFileSync(file,raw);f.setNow(at(days[0],16,0));
 const report=await f.ops.report();assert.equal(report.observedTradingDays,0);assert.equal(report.days[0].attemptSamples,1);
 assert.ok(report.days[0].exclusionReasons.includes('legacy-observation-evidence-not-revalidated'));
 assert.equal(fs.readFileSync(file,'utf8'),raw);
});
