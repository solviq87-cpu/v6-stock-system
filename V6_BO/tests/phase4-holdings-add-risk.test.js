'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const createHoldings=require('../holdings');
const now=Date.parse('2026-11-26T10:00:00+08:00');
const code='600000',other='600001';
const rows=Array.from({length:10},()=>({close:9,high:10.2}));
function quote(id=code,patch={}){
 return {code:id,name:id,price:10.2,pct:2,quoteSource:'tencent',quoteAt:now,receivedAt:now,
  canTrade:true,canNotify:true,tradable:true,suspended:false,
  mainInflow:1000000,mainPct:2,fundsSource:'tencent',fundsMethod:'vendor-order-size-estimate',
  fundsUnit:'CNY',fundsSourceTimestamp:now,fundsRetrievedAt:now,...patch};
}
function fixture({capital=100000,cost=10,shares=1000,otherHolding=false,quotes,newsStatus='available',bad=false}={}){
 const items=[{code,name:code,cost,shares,tags:[]}];
 if(otherHolding)items.push({code:other,name:other,cost:10,shares:9000,tags:[]});
 const data={capital,items,stopPct:-8,reducePct:-4,takePct:15,maxPosPct:90};
 let writes=0,pushes=0;
 const io={readFileSync(file){return String(file).endsWith('holdings.json')?JSON.stringify(data):'{}';},writeFileSync(){writes++},renameSync(){writes++},existsSync:()=>false};
 const news={evidenceStatus:newsStatus,goodAll:[],badAll:[],goodCodes:new Set(),badCodes:new Set(bad?[code]:[])};
 const S={stocks:[],klines:new Map(items.map(x=>[x.code,{rows}]))};
 const api=createHoldings({fs:io,path,dir:'/synthetic-holding-only',S,nowDate:()=>new Date(now),
  newsContext:()=>news,em:{fetchBatchSnapshot:async()=>quotes||[quote()],fetchThsActiveBatch:async()=>new Map()},
  sseSend(){},sseSendEdit(){},pushAll(){pushes++}});
 return {api,run:(posPct,patch={},bars=rows)=>api.verdict(code,quote(code,patch),bars,{positionPct:posPct}),
  counts:()=>({writes,pushes})};
}
const add=x=>x.acts.find(a=>a.type==='加仓');
test('manual holding add advice requires known positive portfolio headroom',()=>{
 const f=fixture();
 for(const x of [null,undefined,NaN,-1,'30',90,90.01,100])assert.equal(add(f.run(x)),undefined,String(x));
 assert.equal(add(fixture({capital:0}).run(30)),undefined);
 const a=add(f.run(89.9));assert.ok(a);assert.ok(a.researchMaxAddPct>0&&a.researchMaxAddPct<=.1);
 assert.equal(a.researchOnly,true);assert.equal(a.canTrade,false);assert.match(a.why,/不代表实际可用现金或交易许可/);
 assert.deepEqual(f.counts(),{writes:0,pushes:0});
});
test('add advice requires current original quote and independent funds timing and units',()=>{
 const f=fixture();
 for(const patch of [{quoteAt:now-15001},{canNotify:false},{pct:'2'},{fundsSourceTimestamp:null},{fundsSourceTimestamp:now-15001},
  {fundsUnit:'lots'},{fundsSourceConflict:true},{fundsSource:'simulated'},{fundsRetrievedAt:now+1}]){
  assert.equal(add(f.run(30,patch)),undefined,JSON.stringify(patch));
 }
 assert.ok(add(f.run(30,{quoteAt:now-15000,fundsSourceTimestamp:now-15000})));
 assert.deepEqual(f.counts(),{writes:0,pushes:0});
});
test('exit advice and unresolved news cannot coexist with a positive add recommendation',()=>{
 const f=fixture({cost:8}),v=f.run(30);
 assert.ok(v.acts.some(a=>a.type==='止盈'));assert.equal(add(v),undefined);
 const drawdown=fixture().run(30,{},rows.map(x=>({...x,high:11})));
 assert.ok(drawdown.acts.some(a=>a.type==='回撤止盈'));assert.equal(add(drawdown),undefined);
 for(const x of [fixture({newsStatus:'unknown'}),fixture({bad:true})])assert.equal(add(x.run(30)),undefined);
});
test('missing, stale and read-only holdings never create portfolio headroom for another stock',async()=>{
 for(const second of [null,quote(other,{quoteAt:now-15001}),quote(other,{canTrade:false})]){
  const f=fixture({otherHolding:true,quotes:second?[quote(),second]:[quote()]});
  const r=await f.api.compute(true);
  assert.equal(r.summary.positionPct,null);assert.equal(add(r.items.find(x=>x.code===code)),undefined);
  assert.deepEqual(f.counts(),{writes:0,pushes:0});
 }
});
test('unrounded portfolio weight cannot be rounded down into room; valid portfolio remains observable',async()=>{
 const f=fixture({capital:100000,shares:8824,quotes:[quote()]});
 const r=await f.api.compute(true);
 assert.equal(r.summary.positionPct,90);assert.equal(add(r.items[0]),undefined);
 const g=fixture(),ok=await g.api.compute(true);
 assert.equal(ok.summary.positionPct,10.2);assert.ok(add(ok.items[0]));
 assert.ok(add(ok.items[0]).researchMaxAddPct<=3.4);
 assert.deepEqual(g.counts(),{writes:0,pushes:0});
});
test('bad five-day closes cannot become a bullish moving-average condition',()=>{
 const f=fixture();
 for(const value of [null,'9',0,-1,Infinity]){
  const bars=rows.map(x=>({...x}));bars[9].close=value;
  const v=f.run(30,{},bars);assert.equal(v.ma5,null);assert.equal(add(v),undefined);
 }
});
