'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('../src/core/live-fourteen-evidence');
const MR=require('../myrules');
const date='2026-11-26',at=t=>Date.parse(date+'T'+t+'+08:00'),now=at('16:00:00'),code='600000';
const raw=patch=>({code,name:'合同样本',price:10,floatCap:5e9,amount:1e8,sealAmount:1e7,limitUpCount:1,breakCount:0,
 src:'em',tradeDate:date,sourceTradeDate:date,sourceDateStatus:'matched',receivedAt:at('15:20:00'),
 factEvidence:{kind:'provider-limit-up-pool-record',source:'em',tradeDate:date,observedAt:at('15:20:00')},...patch});
const project=r=>gate.projectStock({code,name:r.name,limitUpCount:0,fourteenRaw:r},date,now);
const rule=(stock,id)=>MR.evaluateOne({stock,rows:[]}).items.find(r=>r.i===id);
test('live candidate cannot convert missing original streak to a known exclusion pass',()=>{
 const missing=project(raw({limitUpCount:undefined,sealAmount:undefined}));
 assert.equal(missing.limitUpCount,null);assert.equal(missing.sealAmount,null);
 assert.equal(rule(missing,11).unknown,true);assert.equal(MR.evaluateOne({stock:missing,rows:[]}).pass,false);
 assert.equal(project(raw({limitUpCount:0})).limitUpCount,0);
 assert.equal(rule(project(raw({limitUpCount:4})),11).ok,false);
});
test('old, derived, wrong-stock or unsupported original streak is unknown',()=>{
 for(const r of [raw({sourceTradeDate:'2026-11-25'}),raw({src:'derive'}),raw({receivedAt:now+1}),raw({code:'600001'}),raw({factEvidence:null}),
   {code,price:10,quoteAt:at('14:00:00'),receivedAt:at('14:00:01'),quoteSource:'eastmoney',limitUpCount:0}]){
  assert.equal(project(r).limitUpCount,null);
 }
});
test('sector missing and wrong-day rows are not zero; partial positive group retains support',()=>{
 const make=(rows,groups,day,meta)=>gate.projectSector('银行',rows,groups,day,meta,date,now,2);
 assert.equal(make([],{},date,{}).ztCount,null);assert.equal(make([],{},date,{}).pct,null);
 assert.equal(make([{name:'银行',pct:4,retrievedAt:now}],{},date,{}).pct,null);
 const a=raw({sector:'银行'}),b=raw({sector:'银行',code:'600001'});
 assert.equal(make([],{银行:[a]},date,{}).ztCount,null);
 assert.equal(make([],{银行:[a,b]},date,{}).ztCount,2);
 assert.equal(make([],{银行:[a,b]},'20261125',{}).ztCount,null);
 const real={name:'银行',pct:0,tradeDate:date,sourceTimestamp:at('15:00:00'),retrievedAt:at('15:01:00')};
 assert.equal(make([real],{},date,{}).pct,0);
});
const auction=(patch={},extra={})=>({date:'20261126',phase:3,amtReliable:true,strong:[{code,auctionAmount:0,auctionPct:4,
 fourteenAuctionEvidence:{code,quoteAt:at('09:25:00'),receivedAt:at('09:25:02'),quoteSource:'eastmoney',amount:3e7,pct:4,...extra}}],...patch});
test('old, non-auction, unbound and missing original amount cannot support auction rules',()=>{
 for(const a of [auction({date:'20261125'}),auction({amtReliable:false}),auction({phase:2}),auction({}, {quoteAt:at('09:30:00')}),auction({}, {amount:undefined}),auction({}, {receivedAt:at('09:24:59')})])
  assert.equal(gate.projectAuction(a,code,date,now),null);
 assert.deepEqual(gate.projectAuction(auction(),code,date,now),{auctionAmount:3e7,auctionPct:4});
 assert.equal(gate.projectAuction(auction({}, {amount:0}),code,date,now).auctionAmount,0);
});
const rows=Array.from({length:60},(_,i)=>({date:i===59?date:'2026-11-25',close:10}));
const meta=(patch={})=>({targetDate:date,cacheLayer:'source',snapshot:{receivedAt:at('15:20:00')},...patch});
test('postclose Kline rejects lagging, failed or unfinalized data without changing intraday contract',()=>{
 assert.equal(gate.usableKline(rows,meta(),date,now),true);
 assert.equal(gate.usableKline(rows,meta({snapshot:{receivedAt:at('14:59:00')}}),date,now),false);
 assert.equal(gate.usableKline(rows,meta({cacheLayer:'held-after-source-failure'}),date,now),false);
 assert.equal(gate.usableKline(rows.slice(0,59),meta(),date,now),false);
 assert.equal(gate.usableKline(rows.map((r,i)=>i===59?{...r,complete:false}:r),meta(),date,now),false);
 assert.equal(gate.usableKline(rows,meta({snapshot:{receivedAt:at('14:00:00')}}),date,at('14:01:00')),true);
});
test('auction ticks must belong to the same stock and original trading date',()=>{
 const t={code,tradeDate:date,receivedAt:at('09:26:00')};
 assert.equal(gate.projectTicks(t,code,date,now),t);
 assert.equal(gate.projectTicks({...t,tradeDate:'2026-11-25'},code,date,now),null);
 assert.equal(gate.projectTicks({...t,code:'600001'},code,date,now),null);
});
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
function body(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
test('real server projection preserves legacy next-plan fields while using raw evidence in fourteen scan',async()=>{
 const S={ztPool:[raw({limitUpCount:undefined})],stocks:[],bigMoney:{items:[]},trendPool:[],sectors:[],ztBySector:{},ztDay:date,auction:auction(),myrules:{date:'2026-11-25',count:9}};
 let captured=null,marks=[];
 const DateFixture=class extends Date{static now(){return now;}};
 const deps={S,A:{isJunkName:()=>false,calcProfitRatio:()=>null},capTooSmall:()=>false,buzhangItems:()=>[],latestTradeDate:()=>date,NP:{localDate:()=>date},
  em:{pool:(items,fn)=>Promise.all(items.map(fn))},marketReady:()=>true,emptyWhyOf:()=>'',staleMark:(k,v)=>marks.push(v),
  klineRows:async()=>rows,_klineReadMeta:new Map([[code,meta()]]),sectorOfStock:()=>'银行',
  auctionTicksFor:async()=>null,lhbMapCached:async()=>new Map(),MYRULES:{DEFAULTS:MR.DEFAULTS,scan:list=>{captured=list;return MR.scan(list);}},
  Date:DateFixture,console:{log(){},error(){}},require:id=>{assert.equal(id,'./src/core/live-fourteen-evidence');return gate;}};
 const f=new Function(...Object.keys(deps),body('function nextPlanUniverse() {','\nasync function computeNextPlan')+'\n'+body('async function computeMyRules(limitN) {','\n// 竞价分时缓存（按日）')+'\nreturn {nextPlanUniverse,computeMyRules};')(...Object.values(deps));
 assert.equal(f.nextPlanUniverse()[0].limitUpCount,0);
 await f.computeMyRules(120);
 assert.equal(captured[0].stock.limitUpCount,null);assert.equal(captured[0].sector.ztCount,null);assert.equal(S.myrules.count,0);
 assert.equal(S.myrules.date,date);assert.equal(S.myrules.canTrade,false);
 const previous=S.myrules;
 deps._klineReadMeta.set(code,meta({cacheLayer:'held-after-source-failure'}));
 await f.computeMyRules(120);assert.equal(S.myrules,previous);assert.equal(marks.at(-1),'held');
});
