'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parsePage,toStock,fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const now=Date.parse('2026-11-27T10:00:00+08:00');
const row=(code='600001',patch={})=>({f12:code,f13:1,f3:1.2,f124:now/1000,...patch});
const page=(items=[row()],total=items.length,patch={})=>({ok:true,status:200,json:async()=>({rc:0,data:{total,diff:items}}),...patch});
const governor=()=>({run:async(target,work)=>work(),checkResponse(){}});
const read=(fetchImpl,extra={})=>fetchEastmoneySnapshot({now,clock:()=>now,pageSize:1,maxPages:2,fetchImpl,requestGovernor:governor(),...extra});
async function rejectedResponse(patch,pattern){
 let calls=0,bodyReads=0;
 await assert.rejects(read(async()=>{calls++;return page([row()],1,{json:async()=>{bodyReads++;return {rc:0,data:{total:1,diff:[row()]}};},...patch});}),pattern);
 assert.equal(calls,1);assert.equal(bodyReads,0,'reject before reading untrusted response body');
}
test('01 source request explicitly forbids automatic redirects',async()=>{
 let options;await read(async(url,opts)=>{options=opts;return page();});
 assert.equal(options.redirect,'manual');
});
test('02 HTTP redirect cannot be accepted as a successful page',()=>rejectedResponse({status:302},/重定向/));
test('03 redirected success cannot masquerade as a direct supplier response',()=>rejectedResponse({redirected:true},/重定向/));
test('04 final URL mismatch cannot impersonate the requested page',()=>rejectedResponse({url:'https://example.invalid/other'},/重定向/));
test('05 opaque redirect must not enter JSON parsing',()=>rejectedResponse({type:'opaqueredirect'},/重定向/));
test('06 partial content cannot be accepted as a complete page',()=>rejectedResponse({status:206},/HTTP 206/));
test('07 nonnumeric HTTP status must not be accepted by coercion',()=>rejectedResponse({status:'200'},/HTTP 200/));
test('08 truthy nonboolean success flag cannot authorize a response',()=>rejectedResponse({ok:'true'},/HTTP 200/));
test('09 explicit application error cannot supply a seemingly usable payload',()=>{
 for(const rc of [1,-1,null,'0'])assert.throws(()=>parsePage({rc,data:{total:1,diff:[row()]}}),/响应/);
});
test('10 unsafe integer universe size is not a valid denominator',()=>{
 assert.throws(()=>parsePage({data:{total:Number.MAX_SAFE_INTEGER+1,diff:[row()]}}),/响应/);
});
test('11 sparse page array cannot fabricate returned row count',()=>{
 const diff=[row(),row('600002')];delete diff[1];assert.throws(()=>parsePage({data:{total:2,diff}}),/响应/);
});
test('12 impossible total must stop after the first page instead of consuming extra calls',async()=>{
 let calls=0;await assert.rejects(read(async()=>page([row(String(600000+(++calls)))],3)),/未完整抓取/);
 assert.equal(calls,1);
});
test('13 numeric security code cannot be coerced into a provider identity',()=>{
 assert.equal(toStock(row(600001)),null);
});
test('14 boolean, array and noncanonical market IDs cannot be coerced into valid exchanges',()=>{
 for(const f13 of [true,false,[],[1],[0],'01','1.0',' 1 '])assert.equal(toStock(row('600001',{f13})),null);
});
test('15 an invalid row preceding its valid duplicate still makes pagination ambiguous',async()=>{
 for(const pageSize of [1,2]){
  const rows=[row('600001',{f3:'-'}),row('600001')];let calls=0;
  await assert.rejects(read(async()=>page(rows.slice(calls*pageSize,(++calls)*pageSize),2),{pageSize}),/股票代码重复/);
 }
});
test('16 a valid row followed by its invalid duplicate still makes pagination ambiguous',async()=>{
 for(const pageSize of [1,2]){
  const rows=[row('600001'),row('600001',{f13:null})];let calls=0;
  await assert.rejects(read(async()=>page(rows.slice(calls*pageSize,(++calls)*pageSize),2),{pageSize}),/股票代码重复/);
 }
});
test('control: direct 403/429 still pass original governor without a body read',async()=>{
 for(const status of [403,429]){let calls=0,checked=0;const g={run:async(target,work)=>work(),checkResponse(target,s){assert.equal(s,status);checked++;throw Error('restricted');}};
  await assert.rejects(read(async()=>{calls++;return page([row()],1,{ok:false,status,json:async()=>{throw Error('must not read body');}});},{requestGovernor:g}),/restricted/);assert.equal(calls,1);assert.equal(checked,1);
 }
});
test('control: legitimate numeric/string market IDs and missing optional fields are preserved',()=>{
 for(const f13 of [0,1,'0','1']){const stock=toStock(row('600001',{f13,f3:0,f6:null,f124:undefined}));assert.equal(stock.code,'600001');assert.equal(stock.pctChange,0);assert.equal(stock.vendorQuoteAt,null);assert.equal(Object.hasOwn(stock,'amount'),false);}
});
test('control: one unique invalid row is omitted, never substituted or counted as returned evidence',async()=>{
 const r=await read(async()=>page([row('600001',{f3:'-'}),row('600002')],2),{pageSize:2});
 assert.equal(r.universeSize,2);assert.equal(r.stocks.length,1);assert.equal(r.stocks[0].code,'600002');assert.equal(r.stocks[0].vendorQuoteAt,now);assert.equal(r.verifiedLive,false);
});
test('control: legacy injected success fixture and missing application status remain compatible',async()=>{
 const r=await read(async()=>({ok:true,json:async()=>({data:{total:1,diff:[row()]}})}));assert.equal(r.pages,1);assert.equal(r.stocks.length,1);
});
