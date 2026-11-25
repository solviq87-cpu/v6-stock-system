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
