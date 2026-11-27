'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../src/core/market-data-evidence'),store=require('../src/core/research-workspace-store');
const {validateImport}=require('../src/core/market-data-center');
const now=Date.parse('2025-02-10T16:00:00+08:00'),captured=Date.parse('2025-02-10T15:11:00+08:00');
const provider='eastmoney-public-history',datasetId='test-historical-dataset';
function data(p=provider,at=captured){return {source:'imported',provider:p,datasetId,asOf:'2025-02-10',observedAt:at,factorVersion:'factor-v1',
 priceAdjustment:{mode:'unadjusted',provider:p},volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
 stocks:[{symbol:'600000',bars:Array.from({length:41},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000,amount:10000,suspended:false}))}]};}
const bytes=d=>Buffer.from(JSON.stringify(d));
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-d13-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function append(root,d=data(),extra={}){return E.appendReceipt({root,raw:bytes(d),provider,datasetId,receivedAt:now,status:'admitted',
 details:validateImport(d,{provider:d.provider,datasetId:d.datasetId,now}),sourceObservedAt:d.observedAt,factorVersion:d.factorVersion,...extra});}
function ref(d,extra={}){return {referenceRaw:bytes(d),referenceMetadata:{provider:d.provider,datasetId:d.datasetId,observedAt:d.observedAt,...extra},independentReferenceRequired:true};}
function read(root,decisionAt=now){return E.readMarketDataAsOf({root,provider,datasetId,decisionAt});}
test('valid single-source receipt and exact retry preserve research-only flags',t=>{const root=fixture(t),d=data(),r=append(root,d);assert.equal(append(root,d).hash,r.hash);assert.equal(read(root).data.provider,provider);assert.equal(read(root).canTrade,false);});
test('admission cannot attach an alien raw dataset',t=>{const root=fixture(t);assert.throws(()=>append(root,data(),{raw:bytes(data('baostock'))}),/来源/);assert.equal(E.readReceipts(root).length,0);});
test('admission binds observedAt to actual raw bytes',t=>{const root=fixture(t);assert.throws(()=>append(root,data(),{sourceObservedAt:captured+1}),/时点/);});
test('admission binds factor version to actual raw bytes',t=>{const root=fixture(t);assert.throws(()=>append(root,data(),{factorVersion:'other-factor'}),/版本/);});
test('admission rejects forged date range and stock count',t=>{const root=fixture(t),d=data(),details=validateImport(d,{provider,datasetId,now});assert.throws(()=>append(root,d,{details:{...details,stocks:9}}),/范围/);assert.throws(()=>append(root,d,{details:{...details,firstDate:'2024-01-01'}}),/范围/);});
test('admission rejects invented complete point-in-time coverage',t=>{const root=fixture(t),d=data(),details=validateImport(d,{provider,datasetId,now});assert.throws(()=>append(root,d,{details:{...details,historicalCoverage:{status:'complete',complete:true,verifiedExternal:true}}}),/覆盖/);});
test('independent metadata must describe the archived reference',t=>{const root=fixture(t);assert.throws(()=>append(root,data(),ref(data('baostock'),{datasetId:'wrong-dataset'})),/独立来源/);});
test('reference numerical conflict cannot be written as admitted',t=>{const root=fixture(t),d=data('baostock');d.stocks[0].bars[0].close=10.9;assert.throws(()=>append(root,data(),ref(d)),/一致性/);});
test('reference collected before same-day finality cannot be admitted by later archival',t=>{const root=fixture(t),d=data('baostock',Date.parse('2025-02-10T15:09:00+08:00'));assert.throws(()=>append(root,data(),ref(d)),/15:10/);});
test('valid independent reference remains research-only',t=>{const root=fixture(t),r=append(root,data(),ref(data('baostock')));assert.ok(r.data.independentReference);assert.equal(read(root).canTrade,false);});
test('replay reason cannot evade original reviewer validation',t=>{const root=fixture(t),q=append(root,data(),{status:'quarantined',reason:'fixture isolation'});assert.throws(()=>append(root,data(),{availableAt:now+1,replayOf:q.hash,review:{reviewedAt:now+1,method:'immutable-raw-original-import-gates',reviewerId:'operator',reason:'x'},requestId:'review-d13-short'}),/复核/);});
test('valid reviewed quarantine can be admitted without changing original receivedAt',t=>{const root=fixture(t),q=append(root,data(),{status:'quarantined',reason:'fixture isolation'});const r=append(root,data(),{availableAt:now+1,replayOf:q.hash,review:{reviewedAt:now+1,method:'immutable-raw-original-import-gates',reviewerId:'operator',reason:'verified original evidence'},requestId:'review-d13-valid'});assert.equal(r.data.receivedAt,now);assert.equal(read(root).status,'unavailable-at-decision');assert.equal(read(root,now+1).status,'available-research-snapshot');});
function forged(root,mutate){const r=append(root),d=JSON.parse(JSON.stringify(r.data));d.availableAt=now+1000;mutate(d);store.appendEvent(path.join(root,'events'),'diagnostic',d,{requestId:'forged-d13-01',now:d.availableAt});}
test('historical replay rechecks scope rather than trusting valid journal hashes',t=>{const root=fixture(t);forged(root,d=>{d.scope.stocks=99;});assert.equal(read(root).data.stocks.length,1);assert.throws(()=>read(root,now+1000),/范围/);});
test('governance cannot count latest forged scope as valid',t=>{const root=fixture(t);forged(root,d=>{d.scope.lastDate='2024-01-01';});assert.throws(()=>E.readMarketDataEvidence({root,provider,datasetId,asOf:now+1000}),/范围/);});
test('governance recomputes latest coverage without upgrading archived legacy claims',t=>{const root=fixture(t);forged(root,d=>{d.historicalCoverage={status:'complete',complete:true,verifiedExternal:true};});const r=E.readMarketDataEvidence({root,provider,datasetId,asOf:now+1000});assert.notEqual(r.historicalCoverage.complete,true);assert.equal(r.completePointInTime,false);});
