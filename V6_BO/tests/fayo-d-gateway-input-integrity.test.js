'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fetchItickStockQuote}=require('../src/core/itick-stock-quote');
const {validateSnapshot,createParallelMarket,readParallelMarket}=require('../src/core/parallel-market');
const NOW=Date.parse('2026-11-10T10:02:00+08:00');
const ids=['ifind','choice','sina'],sources=ids.map(id=>({id,url:`https://${id}.example.invalid/quotes`}));
const itickData=(fields={})=>({code:0,data:{s:'600519',ld:10,p:9,t:NOW-1000,ts:0,...fields}});
const itick=(fetchImpl,token='fixture-only',code='600519')=>fetchItickStockQuote({code,now:NOW,token,fetchImpl});
const snapshot=(id='ifind')=>({schemaVersion:1,provider:id,observedAt:NOW,quotes:[{exchange:'SH',code:'600519',currency:'CNY',adjustment:'unadjusted',volumeUnit:'share',status:'normal',timestamp:NOW-1000,price:10,previousClose:9,volume:1000}]});
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});

test('iTick rejects a disguised redirect before reading the response body',async()=>{
 for(const extra of [{redirected:true},{url:'https://other.example.invalid/quote'},{type:'opaqueredirect'}]){
  let reads=0,calls=0;
  const r=await itick(async()=>{calls++;return {ok:true,status:200,...extra,text:async()=>{reads++;return JSON.stringify(itickData());}};});
  assert.equal(r.status,'unavailable');assert.equal(r.quote,null);assert.equal(reads,0);assert.equal(calls,1);
 }
});
test('iTick accepts only a complete HTTP 200, not partial or contradictory success',async()=>{
 for(const status of [201,204,206,302,429,undefined]){
  let reads=0;const r=await itick(async()=>({ok:true,status,text:async()=>{reads++;return JSON.stringify(itickData());}}));
  assert.equal(r.status,'unavailable');assert.equal(reads,0);
 }
 const r=await itick(async()=>response(itickData()));
 assert.equal(r.status,'fresh-unverified');assert.equal(r.quote.quoteAt,NOW-1000);assert.equal(r.canTrade,false);
});
test('iTick documented string symbol cannot be supplied as a number or a coercible array',async()=>{
 for(const s of [600519,['600519'],{code:'600519'},'600519 ']){
  const r=await itick(async()=>response(itickData({s})));assert.equal(r.status,'unavailable');assert.equal(r.quote,null);
 }
 const valid=await itick(async()=>response(itickData({s:'000001'})),'fixture-only','000001');
 assert.equal(valid.status,'fresh-unverified');assert.equal(valid.quote.code,'000001');assert.equal(valid.quote.exchange,'SZ');
});
test('iTick invalid header credentials fail before transport and are not echoed',async()=>{
 let calls=0;for(const token of ['a\u0000b','a\tb','a\u007fb','a\u0085b',' a','a ']){
  await assert.rejects(()=>itick(async()=>{calls++;return response(itickData());},token),/凭据格式无效/);
 }
 assert.equal(calls,0);const r=await itick(async()=>{calls++;return response(itickData());},'');
 assert.equal(r.status,'unconfigured');assert.equal(calls,0);
});
test('gateway snapshot validation rejects invalid evaluation, receipt and quote clocks',()=>{
 for(const now of [NaN,Infinity,null,String(NOW),NOW+.5,0,-1])assert.throws(()=>validateSnapshot(snapshot(),'ifind',now));
 for(const key of ['observedAt','timestamp']){
  for(const at of [NOW-.5,0,-1,NaN,Infinity]){
   const s=snapshot();if(key==='observedAt')s.observedAt=at;else s.quotes[0].timestamp=at;
   assert.throws(()=>validateSnapshot(s,'ifind',NOW));
  }
 }
 const s=snapshot();s.quotes[0].timestamp=NOW-15000;assert.equal(validateSnapshot(s,'ifind',NOW).quotes[0].timestamp,NOW-15000);
 assert.throws(()=>validateSnapshot(s,'ifind',NOW+1));
});
test('gateway codes must preserve the declared six-digit string rather than coerce objects',()=>{
 for(const code of [600519,['600519'],{toString:()=> '600519'}]){const s=snapshot();s.quotes[0].code=code;assert.throws(()=>validateSnapshot(s,'ifind',NOW));}
 const s=snapshot();s.quotes[0].code='000001';s.quotes[0].exchange='SZ';assert.equal(validateSnapshot(s,'ifind',NOW).quotes[0].code,'000001');
});
test('saved gateway evidence must have existed when the report was generated',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-d-gateway-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'report.json'),report={schemaVersion:1,mode:'parallel-authorized-gateways',generatedAt:NOW,canTrade:false,verifiedLive:false,sources:ids.map(id=>({id,status:'ok',snapshot:snapshot(id)}))};
 const write=()=>fs.writeFileSync(file,JSON.stringify(report));write();assert.equal(readParallelMarket(file,NOW).status,'observed-unverified');
 report.sources[0].snapshot.observedAt=NOW+1000;report.sources[0].snapshot.quotes[0].timestamp=NOW+1000;write();
 assert.equal(readParallelMarket(file,NOW+1000).status,'invalid-or-stale');
 report.sources[0].snapshot=snapshot();report.generatedAt=NOW-.5;write();assert.equal(readParallelMarket(file,NOW).status,'invalid-or-stale');
});
test('gateway rejects hidden redirects and non-200 responses without replacing healthy peers',async()=>{
 for(const extra of [{redirected:true},{url:'https://other.example.invalid/quote'},{status:206},{status:201},{status:undefined}]){
  let bodyReads=0,calls=0;
  const market=createParallelMarket({sources,clock:()=>NOW,fetchImpl:async url=>{
   calls++;const id=ids.find(i=>url.includes(i));if(id!=='ifind')return response(snapshot(id));
   return {ok:true,status:200,headers:{get:()=> 'application/json'},...extra,get body(){bodyReads++;return response(snapshot(id)).body;}};
  }});
  const r=await market.sync();assert.equal(r.sources[0].status,'unavailable');assert.equal(bodyReads,0);assert.equal(calls,3);
  assert.ok(r.sources.slice(1).every(x=>x.status==='ok'));assert.equal(r.analysis[0].status,'insufficient');assert.equal(r.canTrade,false);
 }
});
test('gateway invalid initial and final clocks cannot create a valid publication',async()=>{
 let calls=0;const a=createParallelMarket({sources,clock:()=>NaN,fetchImpl:async()=>{calls++;return response(snapshot());}});
 await assert.rejects(()=>a.sync(),/时钟/);assert.equal(calls,0);
 let n=0;const b=createParallelMarket({sources,clock:()=>++n<=4?NOW:NOW-1,fetchImpl:async url=>response(snapshot(ids.find(i=>url.includes(i))))});
 await assert.rejects(()=>b.sync(),/时钟/);
});
