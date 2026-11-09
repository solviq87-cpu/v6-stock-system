'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchEastmoneySnapshot,fetchEastmoneyBreadth,toStock}=
 require('../src/core/eastmoney-market-snapshot');
const {auditSnapshotQuoteTimes}=require('../src/core/market-snapshot-quote-time');
const clock=Date.parse('2026-11-09T16:15:20+08:00');
const seconds=t=>Math.floor(Date.parse(t)/1000);
const quote1=seconds('2026-11-09T16:11:40+08:00'),
 quote2=seconds('2026-11-09T16:11:52+08:00');
function row(code,time,extra={}){
 return {f12:code,f13:code.startsWith('6')?1:0,
  f14:code==='600001'?'浦发银行':'示例股票',
  f3:1.28,f2:13.42,f5:10000,f6:120000,
  f8:1.71,f20:3000000000,f62:-350000,f184:-2.23,
  f124:time,...extra};
}
const response=(items)=>({ok:true,json:async()=>({
 data:{total:items.length,diff:items}
})});
test('clist fetch explicitly requests the complete bounded per-stock quote fields',async()=>{
 let endpoint;
 const items=[row('600001',quote1),row('000001',quote2)];
 const snapshot=await fetchEastmoneySnapshot({
  now:clock,clock:()=>clock,pageSize:2,maxPages:1,
  fetchImpl:async url=>{endpoint=url;return response(items);}
 });
 const fields=new Set(new URL(endpoint).searchParams.get('fields').split(','));
 for(const field of ['f12','f13','f14','f2','f3','f5','f6',
  'f8','f20','f62','f184','f124'])
  assert.equal(fields.has(field),true,field);
 assert.equal(snapshot.source,'eastmoney-clist-unverified-live');
 assert.equal(snapshot.verifiedLive,false);
 assert.equal(snapshot.sourceCoverage.volumeUnit,'provider-lots-not-shares');
 assert.equal(snapshot.sourceCoverage.vendorTimeCertified,false);
 assert.equal(snapshot.sourceCoverage.present,2);
 assert.equal(snapshot.sourceCoverage.missing,0);
 assert.equal(snapshot.sourceCoverage.minVendorQuoteAt,quote1*1000);
 assert.equal(snapshot.sourceCoverage.maxVendorQuoteAt,quote2*1000);
 assert.equal(snapshot.stocks[0].vendorQuoteAt,quote1*1000);
 assert.equal(snapshot.stocks[1].vendorQuoteAt,quote2*1000);
 assert.equal(snapshot.stocks[0].name,'浦发银行');
 assert.equal(snapshot.stocks[0].latestPrice,13.42);
 assert.equal(snapshot.stocks[0].volumeLots,10000);
 assert.equal(snapshot.stocks[0].amount,120000);
 assert.equal(snapshot.stocks[0].turnoverPct,1.71);
 assert.equal(snapshot.stocks[0].totalMarketValue,3000000000);
 assert.equal(snapshot.stocks[0].mainNetInflow,-350000);
 assert.equal(snapshot.stocks[0].mainNetInflowPct,-2.23);
 assert.notEqual(snapshot.stocks[0].vendorQuoteAt,snapshot.stocks[1].vendorQuoteAt);
 assert.equal(Date.parse(snapshot.retrievedAt),clock);
 const audit=auditSnapshotQuoteTimes(snapshot,{asOf:clock});
 assert.equal(audit.recentSourceTimeCount,0,
  '4 minute old provider timestamps cannot be misrepresented as live');
 assert.equal(audit.counts['stale-source-time'],2);
 assert.equal(audit.canTrade,false);
});
test('supplier quote dates are per-row, never inferred from request day or batch observation time',async()=>{
 const older=seconds('2026-11-06T14:59:40+08:00');
 const items=[row('600001',quote1),row('000001',older)];
 const snapshot=await fetchEastmoneySnapshot({now:clock,clock:()=>clock,
  pageSize:2,maxPages:1,fetchImpl:async()=>response(items)});
 assert.deepEqual(snapshot.sourceCoverage.supplierQuoteDates,
  ['2026-11-06','2026-11-09']);
 assert.equal(snapshot.stocks[0].vendorQuoteAt,quote1*1000);
 assert.equal(snapshot.stocks[1].vendorQuoteAt,older*1000);
 const audit=auditSnapshotQuoteTimes(snapshot,{asOf:clock});
 assert.equal(audit.counts['historical-snapshot'],1);
 assert.equal(audit.counts['stale-source-time'],1);
});
test('placeholder fields are unknown, never fabricated zero or inferred from a newer provider',()=>{
 const a=toStock(row('600001',null,{
  f2:'-',f5:null,f6:'-',f8:'',f20:undefined,f62:'N/A',
  f184:false,f14:'<script>',f124:undefined}));
 assert.equal(a.vendorQuoteAt,null);
 for(const field of ['name','latestPrice','volumeLots','amount','turnoverPct',
  'totalMarketValue','mainNetInflow','mainNetInflowPct'])
  assert.equal(Object.hasOwn(a,field),false,field);
 const b=toStock(row('600001',quote1,{
  f2:'15.60',f5:'3500',f6:'120000',f8:'2.25',
  f20:'3000000000',f62:'-25000',f184:'-3.25'}));
 assert.equal(b.latestPrice,15.6);
 assert.equal(b.volumeLots,3500);
 assert.equal(b.mainNetInflow,-25000);
 assert.equal(b.mainNetInflowPct,-3.25);
 assert.equal(toStock(row('600001',quote1,{f3:null})),null);
 assert.equal(toStock(row('600001',quote1,{f3:'-'})),null);
});
test('the market breadth engine preserves previous amount semantics and never treats quote coverage as exchange-certified',async()=>{
 const result=await fetchEastmoneyBreadth({
  now:clock,clock:()=>clock,pageSize:2,maxPages:1,
  fetchImpl:async()=>response([
   row('600001',quote1,{f3:2,f6:15000}),
   row('000001',undefined,{f3:-3,f6:'-',f5:null})
  ])
 });
 assert.equal(result.breadth.usable,true);
 assert.equal(result.breadth.up,1);
 assert.equal(result.breadth.down,1);
 assert.equal(result.breadth.observedAmount,15000);
 assert.equal(result.snapshotMetadata.verifiedLive,false);
 assert.equal(result.snapshotMetadata.source,'eastmoney-clist-unverified-live');
});
