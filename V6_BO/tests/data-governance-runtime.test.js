'use strict';
// Local provider-shaped fixtures exercise the original runtime. No requests,
// production archives, account changes, messages or external data assertions.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{execFileSync}=require('node:child_process');
const H=require('../src/core/center-history'),journal=require('../src/core/research-workspace-store');
const {auditCenterInputs}=require('../src/core/intelligence-research');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const M=require('../src/core/market-data-evidence');
const {validateDataset,runValidatedBacktest}=require('../src/core/historical-validation');
const {universeObservation}=require('../src/core/historical-universe');
const {tradingFees}=require('../src/core/trading-fees');
const reviewCLI=require('../scripts/review-data-quarantine');
const code='600001',day='2026-11-23',next='2026-11-24';
const at=(d,time='16:01:00')=>Date.parse(d+'T'+time+'+08:00');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-data-governance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function emRaw(dates,price=10){return Buffer.from(JSON.stringify({rc:0,data:{code,market:1,
 klines:dates.map(d=>[d,price,price,price+.1,price-.1,1000,1000000,2,0,0,1].join(','))}}));}
function baoRaw(dates,receivedAt,price=10){
 const start='2026-11-01',end='2026-11-26',trading=['2026-11-20',day,next,'2026-11-25','2026-11-26'];
 return Buffer.from(JSON.stringify({schemaVersion:1,source:'baostock',code,captureKind:'sdk-field-snapshot',
  startedAt:receivedAt-1,receivedAt,completedAt:receivedAt+50,request:{frequency:'d',adjustflag:'1',start,end:dates.at(-1)},
  rows:dates.map(date=>({date,code:'sh.'+code,open:String(price),high:String(price+.1),low:String(price-.1),close:String(price),
   volume:'100000',amount:'1000000',adjustflag:'1',tradestatus:'1',turn:'1'})),
  calendar:{source:'baostock:query_trade_dates',receivedAt:receivedAt+50,start,end,
   rows:Array.from({length:26},(_,i)=>{const date='2026-11-'+String(i+1).padStart(2,'0');return {calendar_date:date,is_trading_day:trading.includes(date)?'1':'0'};})}}));
}
function providers(dates,now,{emPrice=10,baoPrice=10,omitAmount=false}={}){
 return {clock:()=>now+200,
  fetchEastmoney:async()=>H.normalizeEastmoney(emRaw(dates,emPrice),{code,day:dates.at(-1),historyDays:160,receivedAt:now}),
  fetchBaoStock:async()=>{const provider=H.normalizeBaoStock(baoRaw(dates,now+100,baoPrice),{code,day:dates.at(-1),historyDays:160,receivedAt:now+200});
   return omitAmount?{...provider,bars:provider.bars.map(row=>({...row,amount:null}))}:provider;}};
}
function tree(root){return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>{
 const file=path.join(root,entry.name);return entry.isDirectory()?[entry.name,tree(file)]:[entry.name,sha(fs.readFileSync(file))];});}
test('raw normalization failures survive the original collector privately with explicit quarantine scope',async t=>{
 const root=directory(t),raw=Buffer.from('{bad-provider-json-private-evidence'),now=at(day);
 const failed=await H.fetchEastmoney({code,day,historyDays:160},{clock:()=>now,request:async()=>({raw})});
 assert.equal(failed.status,'quarantined');assert.equal(failed.rawHash,sha(raw));
 const deps=providers([day],now);deps.fetchEastmoney=async()=>failed;
 const saved=await H.collectCenterHistory({root,code,day},deps);
 assert.equal(saved.status,'quarantined');assert.equal(H.readCenterHistory({root,now:now+200}).bars.length,0);
 const original=journal.readEvents(path.join(root,code))[0];
 assert.equal(Buffer.from(original.data.providers[0].rawEvidence.data,'base64').toString(),raw.toString());
 const projection=H.readCenterHistoryGovernance({root,now:now+200});
 assert.equal(projection.quarantine.open,1);assert.equal(projection.quarantine.entries[0].scope.code,code);
 assert.equal(projection.quarantine.entries[0].rawEvidencePreserved,true);
 assert.equal(JSON.stringify(projection).includes('bad-provider-json'),false);assert.equal(projection.canTrade,false);
});
test('as-of replay is keyed to archive availability and later source revisions never replace first frozen values',async t=>{
 const root=directory(t),first=at(day),later=at(next);
 await H.collectCenterHistory({root,code,day},providers([day],first));
 const before=H.readCenterHistory({root,codes:[code],now:first+200,decisionAt:first+199});assert.equal(before.bars.length,0);
 const original=H.readCenterHistory({root,codes:[code],now:first+200});
 assert.ok(original.bars.every(row=>row.availableAt===first+200));
 await H.collectCenterHistory({root,code,day:next},providers([day,next],later,{emPrice:11,baoPrice:11}));
 const replay=H.readCenterHistory({root,codes:[code],now:later+200,decisionAt:first+200});
 assert.deepEqual(replay,original);
 const latest=H.readCenterHistory({root,codes:[code],now:later+200});
 assert.equal(latest.bars.find(row=>row.date===day).close,10);assert.equal(latest.coverage.revisionConflicts,2);
 assert.equal(latest.coverage.governance.revisionCount,2);
 for(const version of latest.coverage.governance.versions){
  assert.equal(version.originalAt,null);assert.equal(version.revisedAt,null);assert.equal(version.factorVersion,null);
  assert.equal(version.sourcePublicationVerified,false);assert.match(version.dataVersion,/^[a-f0-9]{64}$/);
 }
 assert.equal(latest.coverage.governance.completePointInTime,false);
});
test('availability is independently enforced by the original centre gate without relabeling source clocks',()=>{
 const now=at(day),a=H.normalizeEastmoney(emRaw([day]),{code,day,historyDays:160,receivedAt:now}),
  b=H.normalizeBaoStock(baoRaw([day],now+100),{code,day,historyDays:160,receivedAt:now+200});
 for(const availability of [now+1000,now-1,null]){
  const rows=[...a.bars,...b.bars].map(row=>({...row,availableAt:availability}));
  const result=auditCenterInputs(rows,{now:now+200,marketCalendars:{CN:b.calendar}});
  assert.equal(result.admittedGroups,0);assert.ok(result.rejected.every(row=>row.reason==='unavailable-or-backdated-admission'));
 }
 const result=auditCenterInputs([...a.bars,...b.bars].map(row=>({...row,availableAt:now+1000})),{now:now+1000,marketCalendars:{CN:b.calendar}});
 assert.equal(result.admitted[0].consensusKnownAt,now+1000);assert.equal(result.admitted[0].knownAt,now+100);
});
test('factor governance reads dictionary, semantic and definition versions from the original frozen panel and leaves missing evidence null',async t=>{
 const root=directory(t),now=at(day),signal=at(day,'15:30:00'),numeric=require('../public/nova/shortline/numeric-factors'),
  catalog=[{id:1,kind:'rule',name:'isolated-original-rule',factors:['原收盘价有效']}],
  panel=numeric.buildRulePanel({catalog,facts:new Map([['1:0',{pass:true,source:'eastmoney-public-history'}]]),code,day,
   cutoff:signal,dictionaryVersion:'frozen-dictionary-v1',inputs:[{role:'stock',code,date:day,source:'eastmoney-public-history',
    knownAt:signal,sourceTimestamp:signal-1000,sampleSet:'real'}]}),
  archive={scope:'live',catalog,dictionaryVersion:'frozen-dictionary-v1',checks:[{id:'original-panel-check',code,date:day,
   asOf:new Date(signal).toISOString(),createdAt:new Date(signal).toISOString(),method:'行情自动识别',recognition:{ruleObservations:panel}}],plans:[],trades:[]};
 await H.collectCenterHistory({root,code,day,archive},providers([day],now));
 const frozen=H.readCenterHistory({root,now:now+200}).frozenObservations[0],original=frozen.evidence['YZ-01'];
 assert.equal(original.dictionaryVersion,'frozen-dictionary-v1');
 archive.dictionaryVersion='today-dictionary-v2';catalog[0].factors.push('后来新增条件');
 const projection=H.readCenterHistoryGovernance({root,now:now+200}),snapshot=projection.factorSnapshots[0];
 assert.equal(snapshot.factorVersion,'frozen-dictionary-v1');assert.equal(snapshot.factorVersionCoverage,'observed-original-factor-versions');
 assert.equal(projection.factorSnapshotsWithoutVersion,0);
 assert.deepEqual(snapshot.factorVersions,[{factorId:'YZ-01',factorVersion:null,dictionaryVersion:original.dictionaryVersion,
  semanticVersion:original.semanticVersion,definitionFingerprint:original.definitionFingerprint}]);
 const laterSignal=at(next,'15:30:00'),legacy={scope:'live',checks:[{id:'legacy-factor-check',code,date:next,
  asOf:new Date(laterSignal).toISOString(),createdAt:new Date(laterSignal).toISOString(),factorObservations:{
   'TL-01':{factorCode:'TL-01',symbol:code,tradeDate:next,knownAt:laterSignal,source:'eastmoney-public-history',unit:'score',value:1,sampleSet:'real'}}}],plans:[],trades:[]};
 await H.collectCenterHistory({root,code,day:next,archive:legacy},providers([day,next],at(next)));
 const after=H.readCenterHistoryGovernance({root,now:at(next)+200});assert.equal(after.factorSnapshotsWithoutVersion,1);
 assert.equal(after.factorSnapshots[0].factorVersion,'frozen-dictionary-v1');
 assert.deepEqual(after.factorSnapshots[1].factorVersions,[{factorId:'TL-01',factorVersion:null,dictionaryVersion:null,semanticVersion:null,definitionFingerprint:null}]);
});
test('explicit reviewed replay re-normalizes immutable raw evidence, reruns original consensus, and cannot backdate a signal',async t=>{
 const root=directory(t),first=at(day),reviewAt=first+60000;
 // A legacy adapter omitted turnover while preserving a complete raw
 // receipt. Review can recover that field from bytes; it cannot invent it.
 const receipt=await H.collectCenterHistory({root,code,day},providers([day],first,{omitAmount:true}));
 assert.equal(receipt.status,'quarantined');const saved=fs.readFileSync(path.join(root,code,'000001.json'),'utf8'),before=tree(root);
 const preview=H.previewCenterHistoryQuarantine({root,code,captureHash:receipt.fingerprint,now:reviewAt});
 assert.equal(preview.admittedGroups,1);assert.equal(preview.writes,false);assert.deepEqual(tree(root),before);
 const args={root,code,captureHash:receipt.fingerprint,reviewerId:'isolated-operator',reason:'核查原始日历字段和独立来源一致性',requestId:'review-center-001'};
 const result=await H.replayCenterHistoryQuarantine(args,{clock:()=>reviewAt,canWrite:()=>true});
 assert.equal(result.status,'admitted');assert.equal(result.canTrade,false);
 assert.equal(fs.readFileSync(path.join(root,code,'000001.json'),'utf8'),saved);
 assert.equal(H.readCenterHistory({root,now:reviewAt,decisionAt:reviewAt-1}).bars.length,0);
 const replay=H.readCenterHistory({root,now:reviewAt});assert.equal(replay.bars.length,2);assert.equal(replay.frozenObservations.length,0);
 assert.ok(replay.bars.every(row=>row.availableAt===reviewAt));assert.ok(replay.bars.every(row=>row.knownAt<reviewAt));
 assert.equal(auditCenterInputs(replay.bars,{now:reviewAt-1,marketCalendars:replay.marketCalendars}).admittedGroups,0);
 assert.equal(replay.coverage.governance.quarantine.open,0);
 assert.equal((await H.replayCenterHistoryQuarantine(args,{clock:()=>reviewAt+1})).reused,true);
 await assert.rejects(H.replayCenterHistoryQuarantine({...args,reason:'不同复核理由不得重用同请求'}, {clock:()=>reviewAt+1}),/请求ID/);
});
test('reviewing a genuine source disagreement never overrides the original gates and revoked roles cannot append a review',async t=>{
 const root=directory(t),now=at(day),receipt=await H.collectCenterHistory({root,code,day},providers([day],now,{baoPrice:11}));
 const args={root,code,captureHash:receipt.fingerprint,reviewerId:'isolated-operator',reason:'复核两个独立来源原始价格差异',requestId:'review-center-002'};
 const before=tree(root);assert.equal((await H.replayCenterHistoryQuarantine(args,{clock:()=>now+500,canWrite:()=>false})).status,'read-only-instance');
 assert.deepEqual(tree(root),before);
 const replay=await H.replayCenterHistoryQuarantine(args,{clock:()=>now+1000});
 assert.equal(replay.status,'reviewed-still-quarantined');assert.equal(replay.admittedGroups,0);
 const history=H.readCenterHistory({root,now:now+1000});assert.equal(history.bars.length,0);assert.equal(history.coverage.governance.quarantine.open,1);
 assert.equal(history.coverage.governance.quarantine.reviewed,1);
 const catalog=require('../config/data-source-catalog.json'),source=catalog.sources.find(row=>row.id==='baostock'),access=source.access;
 try{source.access='registered-only';await assert.rejects(H.replayCenterHistoryQuarantine({...args,requestId:'review-center-003'},{clock:()=>now+2000}),/访问门禁/);}
 finally{source.access=access;}
});
test('the actual quarantine CLI defaults to a read-only original-gate preview, binds config/scope hashes, and rejects replicas',async t=>{
 const base=directory(t),root=path.join(base,'archive'),app=path.join(base,'isolated-app');fs.mkdirSync(app,{mode:0o700});
 const now=at(day),receipt=await H.collectCenterHistory({root,code,day},providers([day],now,{omitAmount:true})),before=tree(root);
 const cli=execFileSync(process.execPath,[path.join(__dirname,'../scripts/review-data-quarantine.js'),code,receipt.fingerprint],
  {env:{...process.env,V6_CENTER_HISTORY_DIR:root},encoding:'utf8'});
 assert.equal(JSON.parse(cli).applied,false);assert.deepEqual(tree(root),before);
 const configFile=path.join(app,'config.json');fs.writeFileSync(configFile,JSON.stringify({pushRole:'primary'}),{mode:0o600});
 const runtime={applicationRoot:app,env:{V6_CENTER_HISTORY_DIR:root},now:now+60000};
 const preview=await reviewCLI.main([code,receipt.fingerprint],runtime);
 const apply=[code,receipt.fingerprint,'--apply-reviewed-replay','--reviewer-id','isolated-operator',
  '--reason','核查原始日历字段和独立来源一致性','--request-id','cli-review-001',
  '--expected-scope-hash',preview.scopeHash,'--expected-config-hash',preview.authorization.instanceConfigHash];
 fs.writeFileSync(configFile,JSON.stringify({pushRole:'replica'}));
 await assert.rejects(reviewCLI.main(apply,runtime),/主实例|哈希/);assert.deepEqual(tree(root),before);
 fs.writeFileSync(configFile,JSON.stringify({pushRole:'primary'}));
 const result=await reviewCLI.main(apply,runtime);assert.equal(result.applied,true);assert.equal(result.authorization.accountAuthority,false);
 const saved=journal.readEvents(path.join(root,code)).at(-1);
 assert.equal(saved.data.review.authorizationScope.instanceConfigHash,preview.authorization.instanceConfigHash);
 assert.equal(saved.data.review.authorizationScope.archiveScopeHash,preview.scopeHash);
 assert.equal(saved.data.observations.length,0);assert.equal(saved.canNotify,false);
});

function imported(n=40){return {source:'imported',provider:'test-history-provider',datasetId:'test-history-001',asOf:'2025-03-01',
 stocks:[{code,market:'main',bars:Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.2,low:9.8,close:10,volume:100000,amount:1000000,suspended:false}))}]};}
const response=value=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));return {ok:true,status:200,
 headers:{get:key=>key==='content-type'?'application/json':String(raw.length)},body:Readable.from([raw])};};
function market(t,initial=imported(),extra={}){
 const root=directory(t),outputFile=path.join(root,'history.json');let value=initial,now=at(day),calls=0;
 const center=createMarketDataCenter({url:'https://data.example.org/history',outputFile,provider:initial.provider,datasetId:initial.datasetId,
  fetchImpl:async()=>{calls++;return response(value);},clock:()=>now,...extra});
 return {center,outputFile,root,evidenceRoot:outputFile+'.evidence',set:value2=>{value=value2;},time:t=>{now=t;},calls:()=>calls};
}
test('the original market importer persists exact raw bytes and historical as-of reads never substitute a later snapshot',async t=>{
 const fixture=market(t),raw=Buffer.from(JSON.stringify(imported(),null,2));fixture.set(raw);
 const first=await fixture.center.sync();assert.equal(first.updated,true);assert.equal(first.evidence.dataVersion,sha(raw));
 assert.equal(fixture.center.asOf(at(day)-1).status,'unavailable-at-decision');
 fixture.set(imported(42));fixture.time(at(day)+1000);assert.equal((await fixture.center.sync()).updated,true);
 assert.equal(fixture.center.asOf(at(day)).data.stocks[0].bars.length,40);assert.equal(fixture.center.asOf(at(day)+1000).data.stocks[0].bars.length,42);
 const receipts=M.readReceipts(fixture.evidenceRoot);assert.deepEqual(M.readRaw(fixture.evidenceRoot,receipts[0].data.rawEvidence),raw);
 assert.equal(receipts[0].data.originalAt,null);assert.equal(receipts[1].data.revisedAt,null);
 assert.equal(fs.statSync(path.join(fixture.evidenceRoot,'blobs',sha(raw)+'.bin')).mode&0o077,0);
 assert.equal(fixture.center.governance().completePointInTime,false);
 assert.equal(fixture.center.governance().historicalCoverage.status,'unknown');
});
test('malformed and rewritten data are quarantined durably while the last good runtime output remains byte-identical',async t=>{
 const fixture=market(t);assert.equal((await fixture.center.sync()).updated,true);const good=fs.readFileSync(fixture.outputFile);
 const malformed=Buffer.from('{sensitive-raw-private-fixture');fixture.set(malformed);fixture.time(at(day)+1000);
 const rejected=await fixture.center.sync();assert.equal(rejected.evidence.status,'quarantined');assert.match(rejected.error,/JSON解析/);
 const receipt=M.readReceipts(fixture.evidenceRoot).at(-1);assert.deepEqual(M.readRaw(fixture.evidenceRoot,receipt.data.rawEvidence),malformed);
 assert.equal(JSON.stringify(fixture.center.governance()).includes('sensitive-raw-private'),false);
 const changed=imported(42);changed.stocks[0].bars[0].close=10.1;fixture.set(changed);fixture.time(at(day)+2000);
 assert.match((await fixture.center.sync()).error,/历史/);assert.deepEqual(fs.readFileSync(fixture.outputFile),good);
 assert.equal(fixture.center.governance().quarantined,2);assert.equal(fixture.center.status().updates,1);
});
function independent(provider){const data=imported();data.provider=provider;data.observedAt=at(day);data.priceAdjustment={mode:'unadjusted',provider};
 data.volumeUnit='shares';data.amountUnit='CNY';data.amountBasis='actual-unadjusted-turnover';return data;}
test('market reviewed replay can only pass after the original independent-reference gate passes and performs no new request',async t=>{
 const root=directory(t),secondaryFile=path.join(root,'reference.json'),primary=independent('eastmoney-public-history'),other=independent('baostock');
 const wrong=structuredClone(other);wrong.stocks[0].bars[0].close=10.1;fs.writeFileSync(secondaryFile,JSON.stringify(wrong));
 const fixture=market(t,primary,{secondaryFile});const blocked=await fixture.center.sync();assert.equal(blocked.evidence.status,'quarantined');
 const quarantineId=blocked.evidence.id,args={quarantineId,reviewerId:'isolated-operator',reason:'核查独立对照档案和原来源量价一致性',requestId:'market-review-001'};
 fixture.time(at(day)+1000);const stillBlocked=await fixture.center.replay(args);assert.match(stillBlocked.error,/不一致/);
 assert.equal(fs.existsSync(fixture.outputFile),false);assert.equal(fixture.calls(),1);
 fs.writeFileSync(secondaryFile,JSON.stringify(other));fixture.time(at(day)+2000);
 const admitted=await fixture.center.replay({...args,requestId:'market-review-002'});assert.equal(admitted.updated,true);
 assert.equal(fixture.center.asOf(at(day)+1999).status,'unavailable-at-decision');assert.equal(fixture.center.asOf(at(day)+2000).availableAt,at(day)+2000);
 assert.equal(fixture.calls(),1);assert.equal(fixture.center.governance().canTrade,false);
 const saved=M.readReceipts(fixture.evidenceRoot).at(-1);assert.equal(saved.data.receivedAt,at(day));assert.equal(saved.data.review.reviewerId,'isolated-operator');
 assert.deepEqual(M.readRaw(fixture.evidenceRoot,saved.data.independentReference.rawEvidence),Buffer.from(JSON.stringify(other)));
 fs.writeFileSync(secondaryFile,JSON.stringify(wrong));assert.equal(fixture.center.asOf(at(day)+2000).status,'available-research-snapshot');
 assert.equal(fixture.center.governance().unresolvedQuarantine,0);
 const repeat=await fixture.center.replay({...args,requestId:'market-review-002'});assert.equal(repeat.reused,true);assert.equal(fixture.center.status().updates,1);
});
test('rebuilding an importer without the original independent-reference configuration cannot downgrade quarantined evidence',async t=>{
 const root=directory(t),secondaryFile=path.join(root,'reference.json'),primary=independent('eastmoney-public-history'),wrong=independent('baostock');
 wrong.stocks[0].bars[0].close=10.1;fs.writeFileSync(secondaryFile,JSON.stringify(wrong));
 const fixture=market(t,primary,{secondaryFile}),first=await fixture.center.sync();assert.equal(first.evidence.status,'quarantined');
 assert.equal(M.readReceipts(fixture.evidenceRoot)[0].data.gateRequirements.independentReferenceRequired,true);
 let calls=0;
 const downgraded=createMarketDataCenter({url:'https://data.example.org/history',outputFile:fixture.outputFile,
  provider:primary.provider,datasetId:primary.datasetId,clock:()=>at(day)+1000,
  fetchImpl:async()=>{calls++;return response(primary);}});
 const args={quarantineId:first.evidence.id,reviewerId:'isolated-operator',reason:'复核不得因删掉原独立对照配置而放行',requestId:'market-review-004'};
 const before=tree(fixture.evidenceRoot),replay=await downgraded.replay(args);
 assert.match(replay.error,/不得省略原双源门禁/);assert.equal(calls,0);assert.deepEqual(tree(fixture.evidenceRoot),before);
 assert.equal(fs.existsSync(fixture.outputFile),false);
 const automatic=await downgraded.sync();assert.match(automatic.error,/不得省略原双源门禁/);
 assert.equal(fs.existsSync(fixture.outputFile),false);assert.equal(M.readReceipts(fixture.evidenceRoot).at(-1).data.gateRequirements.independentReferenceRequired,true);
});
test('an explicit review cannot certify an unfinished original receipt just because the clock later passes market close',async t=>{
 const data=imported();data.asOf=day;data.stocks[0].bars.at(-1).date=day;
 const fixture=market(t,data);fixture.time(at(day,'14:00:00'));
 const rejected=await fixture.center.sync();assert.match(rejected.error,/15:10/);
 fixture.time(at(day));const result=await fixture.center.replay({quarantineId:rejected.evidence.id,reviewerId:'isolated-operator',
  reason:'收盘后重放仍须检查原回执的实际采集时刻',requestId:'market-review-003'});
 assert.match(result.error,/15:10/);assert.equal(fs.existsSync(fixture.outputFile),false);assert.equal(fixture.calls(),1);
});
test('evidence corruption and read-only roles block the actual importer and its historical replay',async t=>{
 let writable=true;const fixture=market(t,imported(),{canWrite:()=>writable});await fixture.center.sync();
 writable=false;const before=fixture.calls();assert.match((await fixture.center.sync()).error,/只读/);assert.equal(fixture.calls(),before);
 writable=true;const receipt=M.readReceipts(fixture.evidenceRoot)[0],blob=path.join(fixture.evidenceRoot,'blobs',receipt.data.rawEvidence.sha256+'.bin');
 fs.writeFileSync(blob,Buffer.alloc(receipt.data.rawEvidence.byteLength));
 assert.throws(()=>fixture.center.asOf(at(day)),/哈希/);assert.throws(()=>fixture.center.governance(),/哈希/);
 fixture.time(at(day)+1000);const good=fs.readFileSync(fixture.outputFile);const result=await fixture.center.sync();
 assert.ok(result.error);assert.deepEqual(fs.readFileSync(fixture.outputFile),good);
});
test('a valid append with a new raw hash cannot bypass corruption of any previously referenced raw evidence',async t=>{
 for(const corruptReference of [false,true]){
  const refRoot=directory(t),secondaryFile=path.join(refRoot,'reference.json'),primary=independent('eastmoney-public-history'),other=independent('baostock');
  fs.writeFileSync(secondaryFile,JSON.stringify(other));const fixture=market(t,primary,{secondaryFile});assert.equal((await fixture.center.sync()).updated,true);
  const receipt=M.readReceipts(fixture.evidenceRoot)[0],reference=corruptReference?receipt.data.independentReference.rawEvidence:receipt.data.rawEvidence,
   blob=path.join(fixture.evidenceRoot,'blobs',reference.sha256+'.bin'),saved=fs.readFileSync(fixture.outputFile),before=tree(path.join(fixture.evidenceRoot,'events'));
  fs.writeFileSync(blob,Buffer.alloc(reference.byteLength));
  const growing=structuredClone(primary),growingRef=structuredClone(other);growing.stocks=imported(42).stocks;growingRef.stocks=imported(42).stocks;
  fs.writeFileSync(secondaryFile,JSON.stringify(growingRef));fixture.set(growing);fixture.time(at(day)+1000);
  const result=await fixture.center.sync();assert.equal(result.updated,false);assert.match(result.error,/哈希|完整性/);
  assert.deepEqual(fs.readFileSync(fixture.outputFile),saved);assert.deepEqual(tree(path.join(fixture.evidenceRoot,'events')),before);
  assert.equal(fs.existsSync(path.join(fixture.evidenceRoot,'blobs',sha(Buffer.from(JSON.stringify(growing)))+'.bin')),false);
 }
});

function pitData(){
 const data=imported();data.requirePointInTime=true;data.priceBasis='unadjusted';
 data.feeSchedules=[{version:'fee-fixture-v1',source:'test-fee-source',knownAt:'2024-12-31T00:00:00Z',effectiveFrom:'2025-01-01',feeBps:1,minFee:0,sellTaxBps:5}];
 for(const bar of data.stocks[0].bars){bar.isST=false;bar.limitPct=10;}
 data.universeHistory=[{symbol:code,from:'2025-01-01',through:'2025-02-09',eligible:true,source:'test-membership-source',knownAt:'2024-12-31T00:00:00Z',
  securityMaster:{source:'test-security-source',knownAt:'2024-12-31T00:00:00Z',availableAt:'2024-12-31T01:00:00Z',dataVersion:'fixture-security-v1',
   listedOn:'2000-01-01',delistedOn:null,board:'main',isST:false,suspended:false,limitPct:10,priceBasis:'unadjusted',
   corporateActionStatus:'none',actionIds:[],feeVersion:'fee-fixture-v1',evidenceHash:'a'.repeat(64)}}];return data;
}
test('the original dataset and backtest gates reject required incomplete PIT coverage while legacy data remains explicitly unknown',()=>{
 assert.equal(validateDataset(imported()).historicalCoverage.status,'unknown');
 assert.throws(()=>runValidatedBacktest({...imported(),requirePointInTime:true}),/完整历史时点/);
 const data=pitData(),report=validateDataset(data);assert.equal(report.historicalCoverage.complete,true);assert.equal(report.verifiedExternal,false);
 assert.equal(runValidatedBacktest(data).releaseEligible,false);
 const gap=pitData();gap.universeHistory[0].through='2025-02-08';assert.throws(()=>validateDataset(gap),/完整日期覆盖/);
 const unknown=pitData();delete unknown.universeHistory[0].securityMaster.suspended;assert.throws(()=>validateDataset(unknown),/证券主数据/);
});
test('dated security status, listing/delisting, corporate actions, price basis and fee-date changes cannot silently enter historical execution',()=>{
 const variations=[
  [d=>{d.universeHistory[0].securityMaster.availableAt='2025-01-01T02:00:00Z';},/开盘前/],
  [d=>{d.universeHistory[0].securityMaster.isST=true;},/ST/],
  [d=>{d.universeHistory[0].securityMaster.listedOn='2025-01-10';},/上市前/],
  [d=>{d.universeHistory[0].securityMaster.delistedOn='2025-01-30';},/退市后/],
  [d=>{d.priceBasis='hfq';},/未复权/],
  [d=>{d.universeHistory[0].securityMaster.feeVersion='future-fee';},/费用版本/],
  [d=>{d.feeSchedules[0].knownAt='2025-01-01T02:00:00Z';},/费用版本/],
  [d=>{d.universeHistory[0].securityMaster.corporateActionStatus='recorded';d.universeHistory[0].securityMaster.actionIds=['missing-action'];},/公司行为/]
 ];
 for(const [mutate,pattern]of variations){const data=pitData();mutate(data);assert.throws(()=>validateDataset(data),pattern);}
 const st=pitData();st.universeHistory[0].securityMaster.isST=true;
 assert.equal(universeObservation(st.universeHistory,code,'2025-01-28').reason,'HISTORICAL_ST');
 const ledger=require('../src/strategy/research-v2-position-ledger-backtest').ledgerBacktest({stocks:st.stocks,universeHistory:st.universeHistory,
  start:27,end:33,selectCandidates:()=>[code]});assert.equal(ledger.orders.filter(row=>row.side==='buy'&&row.status==='filled').length,0);
 const later=pitData().feeSchedules;later[0].knownAt='2025-01-01T02:00:00Z';
 assert.throws(()=>tradingFees({side:'buy',quantity:100,price:10,tradeDate:'2025-01-01',schedules:later}),/尚未可知/);
 assert.throws(()=>tradingFees({side:'buy',quantity:100,price:10,tradeDate:'2025-01-01',policy:{...later[0],knownAt:'invalid'}}),/已知时点/);
});
