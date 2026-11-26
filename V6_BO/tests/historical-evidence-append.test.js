'use strict';
// Provider-shaped fixtures remain isolated; these cases exercise the existing
// importer and append-only history, without live requests or account writes.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {assertAppend}=require('../src/core/paper-session');
const {validateDataset}=require('../src/core/historical-validation');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const evidence=require('../src/core/market-data-evidence');
const symbol='600001';
const date=i=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
function fee(extra={}){return {version:'fee-v1',source:'isolated-fee-provider',knownAt:'2024-12-31T00:00:00Z',
 effectiveFrom:date(0),feeBps:1,minFee:0,sellTaxBps:5,...extra};}
function master(extra={}){return {source:'isolated-security-provider',knownAt:'2024-12-31T00:00:00Z',
 availableAt:'2024-12-31T01:00:00Z',dataVersion:'security-v1',listedOn:'2000-01-01',delistedOn:null,
 board:'main',isST:false,suspended:false,limitPct:10,priceBasis:'unadjusted',corporateActionStatus:'none',
 actionIds:[],feeVersion:'fee-v1',evidenceHash:'a'.repeat(64),...extra};}
function history(count=40){return {source:'imported',provider:'isolated-history-provider',datasetId:'isolated-pit-history',
 asOf:date(count-1),requirePointInTime:true,priceBasis:'unadjusted',feeSchedules:[fee()],
 stocks:[{code:symbol,market:'main',bars:Array.from({length:count},(_,i)=>({date:date(i),open:10,high:10.2,
  low:9.8,close:10,volume:100000,amount:1000000,suspended:false,isST:false,limitPct:10}))}],
 universeHistory:[{symbol,from:date(0),through:date(count-1),eligible:true,sector:'industry-a',
  source:'isolated-membership-provider',knownAt:'2024-12-31T00:00:00Z',securityMaster:master()}]};}
function dividend(extra={}){return {eventId:'dividend-01',actionId:'action-01',sourceRecordId:'source-01',symbol,
 kind:'cash-dividend',source:'imported',provider:'isolated-settlement-provider',effectiveDate:date(20),
 publishedAt:'2024-12-30T00:00:00Z',cashDelta:100,basisDelta:0,shareDelta:0,
 expectedQuantity:100,expectedCostBasis:1000,...extra};}
function withDividend(data){data.settlements=[dividend()];Object.assign(data.universeHistory[0].securityMaster,
 {corporateActionStatus:'recorded',actionIds:['dividend-01']});return data;}

test('append freezes already observed membership, classification and original security evidence',()=>{
 const original=history();
 for(const mutate of [d=>{d.universeHistory[0].eligible=false;},d=>{d.universeHistory[0].sector='industry-b';},
  d=>{d.universeHistory[0].securityMaster.evidenceHash='b'.repeat(64);},
  d=>{d.universeHistory[0].securityMaster.dataVersion='retrospective-revision';},
  d=>{d.universeHistory[0].securityMaster.delistedOn='2025-12-31';}]){
  const next=history(42);mutate(next);assert.equal(validateDataset(next).historicalCoverage.complete,true);
  assert.throws(()=>assertAppend(original,next),/历史证券|历史股票池/);
 }
 for(const mutate of [d=>{d.universeHistory[0].securityMaster.isST=true;},
  d=>{d.universeHistory[0].securityMaster.suspended=true;},
  d=>{d.universeHistory=[];}]){
  const next=history(42);mutate(next);assert.throws(()=>assertAppend(original,next),/历史证券|历史股票池/);
 }
});

test('append freezes historical fee amounts, fee evidence and settlement amounts even when candles match',()=>{
 for(const mutate of [d=>{d.feeSchedules[0].feeBps=2;},d=>{d.feeSchedules[0].knownAt='2024-12-30T00:00:00Z';},
  d=>{d.feeSchedules[0].source='changed-fee-provider';}]){
  const next=history(42);mutate(next);assert.equal(validateDataset(next).historicalCoverage.complete,true);
  assert.throws(()=>assertAppend(history(),next),/历史费用/);
 }
 const original=withDividend(history()),next=withDividend(history(42));next.settlements[0].cashDelta=200;
 assert.equal(validateDataset(next).historicalCoverage.complete,true);
 assert.throws(()=>assertAppend(original,next),/历史公司行为|历史权益结算/);
});

test('removing earlier coverage or adding an old settlement cannot turn missing evidence into frozen history',()=>{
 const original=history(),next=history(42);next.universeHistory[0].from=date(1);
 assert.throws(()=>assertAppend(original,next),/历史证券|历史股票池/);
 const laterDividend=withDividend(history(42));
 assert.throws(()=>assertAppend(original,laterDividend),/历史证券|历史股票池|历史公司行为|历史权益结算/);
 const legacy=history();delete legacy.universeHistory;delete legacy.requirePointInTime;
 assert.throws(()=>assertAppend(legacy,history(42)),/历史证券|历史股票池/);
});

test('same historical meaning permits extended intervals, split intervals and reordered object keys',()=>{
 const original=history(),next=history(42);
 assert.equal(assertAppend(original,next),true,'extending the same dated state is normal collection growth');
 const row=structuredClone(next.universeHistory[0]);
 next.universeHistory=[{...row,from:date(20)},{...row,through:date(19)}];
 next.feeSchedules=[Object.fromEntries(Object.entries(next.feeSchedules[0]).reverse())];
 next.universeHistory[0].securityMaster=Object.fromEntries(Object.entries(row.securityMaster).reverse());
 assert.equal(validateDataset(next).historicalCoverage.complete,true);
 assert.equal(assertAppend(original,next),true,'interval bounds and object order are not changed facts');
});

test('new dated ST status, fee schedules and corporate actions remain appendable after the frozen cutoff',()=>{
 const original=history(),next=history(42),knownAt='2025-02-09T08:00:00Z';
 next.universeHistory[0].through=date(39);
 next.universeHistory.push({...structuredClone(next.universeHistory[0]),from:date(40),through:date(41),knownAt,
  securityMaster:master({knownAt,availableAt:'2025-02-09T08:01:00Z',dataVersion:'security-v2',isST:true,
   limitPct:5,feeVersion:'fee-v2',corporateActionStatus:'recorded',actionIds:['dividend-02']})});
 for(const bar of next.stocks[0].bars.slice(40)){bar.isST=true;bar.limitPct=5;}
 next.feeSchedules.push(fee({version:'fee-v2',knownAt,effectiveFrom:date(40),feeBps:2}));
 next.settlements=[dividend({eventId:'dividend-02',actionId:'action-02',sourceRecordId:'source-02',
  effectiveDate:date(40),publishedAt:'2025-02-09T07:00:00Z'})];
 assert.equal(validateDataset(next).historicalCoverage.complete,true);
 assert.equal(assertAppend(original,next),true);
});

test('actual importer quarantines a historical fee revision and reviewed replay cannot overwrite the frozen output',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-frozen-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let value=history(),now=Date.parse('2026-11-23T16:01:00+08:00'),requests=0;
 const outputFile=path.join(root,'history.json'),center=createMarketDataCenter({url:'https://data.example.org/history',
  outputFile,provider:value.provider,datasetId:value.datasetId,clock:()=>now,fetchImpl:async()=>{
   requests++;const raw=Buffer.from(JSON.stringify(value));return {ok:true,status:200,
    headers:{get:key=>key==='content-type'?'application/json':String(raw.length)},body:Readable.from([raw])};}});
 assert.equal((await center.sync()).updated,true);const frozen=fs.readFileSync(outputFile),firstAt=now;
 value=history(42);value.feeSchedules[0].feeBps=2;now+=1000;const raw=Buffer.from(JSON.stringify(value));
 const blocked=await center.sync();assert.equal(blocked.updated,false);assert.match(blocked.error,/历史费用/);
 assert.equal(blocked.evidence.status,'quarantined');assert.deepEqual(fs.readFileSync(outputFile),frozen);
 const receipt=evidence.readReceipts(outputFile+'.evidence').at(-1);
 assert.deepEqual(evidence.readRaw(outputFile+'.evidence',receipt.data.rawEvidence),raw);
 now+=1000;const replay=await center.replay({quarantineId:blocked.evidence.id,reviewerId:'isolated-reviewer',
  reason:'复核原始字节不能改写过去已经冻结的费率',requestId:'historical-fee-review-01'});
 assert.equal(replay.updated,false);assert.match(replay.error,/历史费用/);assert.equal(requests,2);
 assert.deepEqual(fs.readFileSync(outputFile),frozen);
 assert.equal(center.asOf(now).data.feeSchedules[0].feeBps,1);
 value=history(42);now+=1000;assert.equal((await center.sync()).updated,true);
 assert.equal(center.asOf(firstAt).data.stocks[0].bars.length,40);
 assert.equal(center.asOf(now).data.stocks[0].bars.length,42);
 assert.equal(center.governance().unresolvedQuarantine,1);
});

function evidenceFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-market-integrity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.parse('2026-11-23T16:01:00+08:00'),data=history(),provider=data.provider,datasetId=data.datasetId;
 const append=(value,at,extra={})=>evidence.appendReceipt({root,raw:Buffer.from(JSON.stringify(value)),provider,datasetId,
  receivedAt:at,status:'admitted',details:validateDataset(value),...extra});
 return {root,now,data,provider,datasetId,append};
}
test('repeated raw hashes cannot hide a contradictory byte length or forged version chain in a correctly hashed journal',t=>{
 const store=require('../src/core/research-workspace-store');
 for(const mode of ['length','version','first-known','scope','replay']){
  const f=evidenceFixture(t),first=f.append(f.data,f.now),data=structuredClone(first.data);data.availableAt=f.now+1000;data.receivedAt=f.now+1000;
  if(mode==='length')data.rawEvidence.byteLength++;
  if(mode==='version')data.version=9;
  if(mode==='first-known')data.firstKnownAt=f.now+1000;
  if(mode==='scope')data.scope.datasetId='other-series';
  if(mode==='replay'){data.replayOf=first.hash;data.review={reviewedAt:data.availableAt,method:'immutable-raw-original-import-gates',reviewerId:'operator',reason:'incorrect admitted receipt reference'};}
  store.appendEvent(path.join(f.root,'events'),'diagnostic',data,{requestId:'bad-market-'+mode,now:data.availableAt});
  assert.throws(()=>evidence.readReceipts(f.root,{verifyRaw:true}),/长度|完整性|回放/);
  assert.throws(()=>evidence.readMarketDataAsOf({root:f.root,provider:f.provider,datasetId:f.datasetId,decisionAt:data.availableAt}),/长度|完整性|回放/);
  assert.equal(evidence.readMarketDataAsOf({root:f.root,provider:f.provider,datasetId:f.datasetId,decisionAt:f.now}).data.stocks[0].bars.length,40);
 }
});
test('exact receipt retries after another version remain idempotent; same request ID cannot change evidence',t=>{
 const f=evidenceFixture(t),first=f.append(f.data,f.now,{requestId:'market-stable-first'});
 const next=f.append(history(42),f.now+1000,{requestId:'market-stable-second'});
 const old=f.append(f.data,f.now,{requestId:'market-stable-first'});
 assert.equal(old.reused,true);assert.equal(old.hash,first.hash);assert.equal(old.data.version,1);assert.equal(next.data.version,2);
 assert.throws(()=>f.append(history(42),f.now,{requestId:'market-stable-first'}),/请求ID/);
 assert.equal(evidence.readReceipts(f.root,{verifyRaw:true}).length,2);
 const r=evidence.readMarketDataAsOf({root:f.root,provider:f.provider,datasetId:f.datasetId,decisionAt:f.now+1000});
 assert.equal(r.version,2);assert.equal(r.data.stocks[0].bars.length,42);
});
test('historical reads verify earlier visible blobs without importing or validating later raw versions',t=>{
 const f=evidenceFixture(t),first=f.append(f.data,f.now),next=f.append(history(42),f.now+1000);
 const read=decisionAt=>evidence.readMarketDataAsOf({root:f.root,provider:f.provider,datasetId:f.datasetId,decisionAt});
 const firstPath=path.join(f.root,'blobs',first.data.dataVersion+'.bin'),nextPath=path.join(f.root,'blobs',next.data.dataVersion+'.bin');
 const initial=fs.readFileSync(firstPath),later=fs.readFileSync(nextPath);
 fs.writeFileSync(nextPath,Buffer.alloc(later.length,65));
 assert.equal(read(f.now).data.stocks[0].bars.length,40);
 assert.throws(()=>read(f.now+1000),/哈希/);
 fs.writeFileSync(nextPath,later);fs.writeFileSync(firstPath,Buffer.alloc(initial.length,65));
 assert.throws(()=>read(f.now+1000),/哈希/);
 assert.throws(()=>f.append(history(43),f.now+2000),/哈希/);
 assert.deepEqual(fs.readFileSync(nextPath),later);
});
test('raw read rejects same-length replacement, growth, short-read and I/O failures and closes the opened descriptor',t=>{
 const read=fs.readSync,close=fs.closeSync;
 for(const mode of ['replace','grow','short','error']){
  const f=evidenceFixture(t),receipt=f.append(f.data,f.now),reference=receipt.data.rawEvidence,
   file=path.join(f.root,'blobs',reference.sha256+'.bin'),initial=fs.readFileSync(file),st=fs.statSync(file,{bigint:true});
  let injected=false,affected=null,closed=false;
  const reader=t.mock.method(fs,'readSync',(fd,...args)=>{
   if(!injected&&fs.fstatSync(fd,{bigint:true}).ino===st.ino){
    injected=true;affected=fd;
    if(mode==='short')return 0;
    if(mode==='error')throw Object.assign(Error('fixture EIO'),{code:'EIO'});
    const n=read.call(fs,fd,...args);
    if(mode==='grow')fs.appendFileSync(file,'extra');
    else{fs.writeFileSync(file+'.replacement',initial,{mode:0o600});fs.renameSync(file+'.replacement',file);}
    return n;
   }
   return read.call(fs,fd,...args);
  });
  const closer=t.mock.method(fs,'closeSync',fd=>{if(fd===affected)closed=true;return close.call(fs,fd);});
  try{assert.throws(()=>evidence.readRaw(f.root,reference),/变化|EIO/);assert.equal(injected,true,mode);assert.equal(closed,true,mode);}
  finally{reader.mock.restore();closer.mock.restore();}
 }
});
