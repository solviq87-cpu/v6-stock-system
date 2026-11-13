'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const f=require('../src/core/public-stock-financials');
const receivedAt=Date.parse('2026-11-13T08:00:00Z');
function row(date='2026-09-30'){return {SECURITY_CODE:'600000',SECUCODE:'600000.SH',CURRENCY:'CNY',REPORT_DATE:date,NOTICE_DATE:'2026-10-31',UPDATE_DATE:'2026-10-31',ROEJQ:12,ZCFZL:40,PARENTNETPROFITTZ:20,TOTALOPERATEREVETZ:10};}
const bytes=rows=>JSON.stringify({success:true,result:{data:rows}});
const parse=(rows,options={})=>f.parseFinancials(bytes(rows),{symbol:'600000',kind:'period',receivedAt,...options});
test('financial raw bytes preserve real zero and null, identity, report period and revision receipt',()=>{
 const d=parse([{...row(),ROEJQ:0,ZCFZL:null}]);assert.equal(d.records[0].values.ROEJQ,0);assert.equal(d.records[0].values.ZCFZL,null);assert.equal(d.canTrade,false);
 const features=f.financialFeatures({symbol:'600000',source:d.source,datasets:{period:d}},{code:'600000',asOf:receivedAt});assert.equal(features.roePct.value,0);assert.equal(features.roePct.availableAt,receivedAt);assert.equal(features.debtAssetsPct,undefined);
 assert.deepEqual(f.financialFeatures({symbol:'600000',source:d.source,datasets:{period:d}},{code:'600000',asOf:receivedAt-1}),{});
});
test('financial parser rejects wrong stock, date, currency, future revisions, duplicates and object-only responses',()=>{
 for(const edit of [{SECURITY_CODE:'000001'},{SECUCODE:'600000.SZ'},{CURRENCY:'USD'},{REPORT_DATE:'2026-02-30'},{NOTICE_DATE:'2026-11-14'},{UPDATE_DATE:'2026-11-14'},{UPDATE_DATE:'2026-10-01'}])assert.throws(()=>parse([{...row(),...edit}]));
 assert.throws(()=>parse([row(),row()]));assert.throws(()=>f.parseFinancials({success:true},{symbol:'600000',kind:'period',receivedAt}));
});
test('single quarter percentages require matching period provenance and never use cumulative growth',()=>{
 const period=parse([row('2025-09-30'),row('2026-06-30'),row()]);const rows=[{...row('2026-06-30'),PARENTNETPROFITTZ:5},{...row(),PARENTNETPROFITTZ:9}].map(({CURRENCY,NOTICE_DATE,UPDATE_DATE,...r})=>r);
 assert.throws(()=>parse(rows,{kind:'quarter'}));const quarter=parse(rows,{kind:'quarter',period});
 const data={symbol:'600000',source:'eastmoney-financials',datasets:{period,quarter}};const features=f.financialFeatures(data,{code:'600000',asOf:receivedAt});
 assert.equal(features.earningsGrowthPct.value,9);assert.equal(features.earningsGrowthAccelerationPct.value,4);assert.equal(features.roePriorYearPct.reportDate,'2025-09-30');assert.match(features.earningsGrowthPct.evidenceId,new RegExp(period.rawHash));assert.equal(features.operatingCashToProfit,undefined);
 quarter.periodRawHash='0'.repeat(64);assert.equal(f.financialFeatures(data,{code:'600000',asOf:receivedAt}).earningsGrowthPct,undefined);
});
test('malformed, unsorted, simulated and retracted financial evidence fail closed',()=>{
 const period=parse([row()]),data={symbol:'600000',source:'eastmoney-financials',datasets:{period}};
 for(const change of [{records:[null]},{records:[{reportDate:'2026-09-30'}]},{simulated:true},{retracted:true},{receivedAt:receivedAt+1}])assert.deepEqual(f.financialFeatures({...data,datasets:{period:{...period,...change}}},{code:'600000',asOf:receivedAt}),{});
 assert.deepEqual(f.financialFeatures({...data,simulated:true},{code:'600000',asOf:receivedAt}),{});
});
test('financial transport prohibits arbitrary endpoints and unsupported securities before egress',async()=>{
 for(const target of ['https://example.org/?filter=x',f.targetFor('600000','period')+'&extra=1'])await assert.rejects(()=>f.requestFinancialBytes(target));
 for(const symbol of ['600000.SH','920001','abc','600000&x=1'])assert.throws(()=>f.targetFor(symbol,'period'));
});
test('collector preserves two raw receipts, isolates a bad dataset and stops on supplier restriction',async()=>{
 let calls=0;const requestJson=async()=>({status:200,raw:bytes([row()])});const result=await f.fetchPublicStockFinancials({symbol:'600000'},{requestJson,now:()=>receivedAt});assert.equal(result.rawEvidence.length,2);assert.equal(result.datasets.quarter.periodRawHash,result.datasets.period.rawHash);assert.equal(result.errors.length,0);
 const bad=await f.fetchPublicStockFinancials({symbol:'600000'},{requestJson:async()=>({status:200,raw:'{}'}),now:()=>receivedAt});assert.equal(bad.rawEvidence.length,2);assert.equal(Object.keys(bad.datasets).length,0);
 const restricted=await f.fetchPublicStockFinancials({symbol:'600000'},{requestJson:async()=>{calls++;throw Object.assign(Error('limited'),{code:'MARKET_RESTRICTED',status:429});},now:()=>receivedAt});assert.equal(calls,1);assert.equal(restricted.errors[0].code,'MARKET_RESTRICTED');
});
