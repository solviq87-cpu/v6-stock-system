'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=process.env.V6_BACKEND_POOL_BASELINE_REF;
const read=file=>baseline?execFileSync('git',['show',baseline+':V6_BO/'+file],{cwd:path.dirname(root),encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(path.join(root,file),'utf8');
const server=read('server.js'),emSource=read('em.js');
const now=Date.parse('2026-11-16T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const quiet={log(){},warn(){},error(){}};
function fn(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return source.slice(source.slice(start-6,start)==='async '?start-6:start,source.indexOf('\n}',start)+2);}
const snapshot=require('../src/core/recommendation-evidence-review').reviewQuoteSnapshotFields;
function auction(fetch,day='2026-11-16',state={}){
 const calls=[],c=vm.createContext({S:state,NP:{localDate:()=>day},Date:Clock,em:{fetchAuctionTicks:async(...args)=>{calls.push(args);return fetch(...args);}}});
 vm.runInContext(fn(server,'auctionTicksFor'),c);return {c,calls,scan:c.auctionTicksFor};
}
const ticks=date=>({tradeDate:date,preClose:10,bars:[{t:'09:25',price:10,quoteAt:Date.parse(date+'T09:25:00+08:00')}]});
test('auction cache never stamps Friday supplier data as Monday and retains old good evidence',async()=>{
 const state={auctionTicks:{'600000':{date:'2026-11-13',ok:true,data:ticks('2026-11-13'),failAt:0}}};
 const a=auction(()=>ticks('2026-11-13'),'2026-11-16',state);
 assert.equal(await a.scan('600000'),null);assert.equal(state.auctionTicks['600000'].data.tradeDate,'2026-11-13');assert.equal(state.auctionTicks['600000'].date,'2026-11-13');
 assert.equal(a.calls[0][1],'2026-11-16');assert.equal(await a.scan('600000'),null);assert.equal(a.calls.length,1);
 assert.equal((await a.scan('600000','2026-11-13')).tradeDate,'2026-11-13');
});
test('auction cache requires supplier date and supports explicit compact target dates',async()=>{
 const a=auction(()=>ticks('2026-11-13'),'2026-11-15');assert.equal((await a.scan('600000','20261113')).tradeDate,'2026-11-13');
 assert.equal(a.calls[0][1],'2026-11-13');
 const missing=auction(()=>({preClose:10,bars:[]}));assert.equal(await missing.scan('600000'),null);
 const invalid=auction(()=>ticks('2026-02-30'));assert.equal(await invalid.scan('600000','2026-02-30'),null);assert.equal(invalid.calls.length,0);
});
function scanner(stocks,extra={}){
 const ctx=vm.createContext({Date:Clock,S:{stocks,candidatePool:[]},A:{isJunkName:()=>false,limitUpProbability:()=>0.5},
  reviewSnapshotFields:snapshot,sectorOfStock:()=>'',sectorHeat:()=>null,numGapRaw:()=>5,
  scoreSmoothOf:(_code,score)=>({score,rawScore:score,trend:'flat',trendText:''}),calibratedProb:x=>x,
  numNeutral:(_field,x)=>x??0,klineRows:async()=>[],console:quiet,...extra});
 const start=server.indexOf('const INTRADAY_STRONG_CACHE_MS'),end=server.indexOf('// ── 洗盘趋势扫描',start);
 const fundsStart=server.indexOf('function fundsNumber('),fundsEnd=server.indexOf('function fundsWindowSum(',fundsStart);
 vm.runInContext(server.slice(fundsStart,fundsEnd)+server.slice(start,end),ctx);return {c:ctx,scan:ctx.intradayStrongScan};
}
const stock=(code='000001',patch={})=>({code,name:'样本',price:10,pct:4,speed:.5,turnover:5,amount:3e8,floatCap:1e10,
 quoteAt:now-86400000*3,quoteSource:'tencent',receivedAt:now-1000,...patch});
test('intraday cache isolates board and display max without changing selection scores',async()=>{
 const a=scanner([stock(),stock('000002'),stock('300001')]);
 const one=await a.scan({board:'main',max:1}),two=await a.scan({board:'main',max:2}),gem=await a.scan({board:'gem',max:2});
 assert.equal(one.count,1);assert.equal(two.count,2);assert.equal(gem.count,1);assert.equal(gem.items[0].code,'300001');
 assert.equal(two.items[0].rawScore,32);assert.equal(await a.scan({board:'main',max:1}),one);
});
test('intraday API rows preserve the exact stock quote rather than candidate metadata',async()=>{
 const original=stock();const a=scanner([original]);a.c.S.candidatePool=[{...stock(),quoteAt:now,quoteSource:'eastmoney',receivedAt:now}];
 const r=await a.scan();assert.equal(r.status,'ready');const row=r.items[0];
 for(const key of ['quoteAt','quoteSource','receivedAt'])assert.equal(row[key],original[key]);
 original.quoteAt=now;assert.notEqual(row.quoteAt,original.quoteAt);
});
test('intraday distinguishes genuinely empty results, unavailable market and calculation errors',async()=>{
 assert.equal((await scanner([stock('000001',{pct:1})]).scan()).status,'empty');
 assert.equal((await scanner([]).scan()).status,'unavailable');
 assert.equal((await scanner([stock()],{sectorOfStock(){throw Error('fixture');}}).scan()).status,'error');
});
test('intraday computing result is per requested view and does not masquerade as no matches',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const a=scanner([stock()],{klineRows:()=>pending});
 const running=a.scan({board:'main',max:1});await Promise.resolve();const busy=await a.scan({board:'main',max:1});assert.equal(busy.status,'computing');assert.equal(busy.board,'main');
 const other=await a.scan({board:'gem',max:1});assert.equal(other.status,'empty');finish([]);await running;
});
function pool(payload,ths=[]){const c=vm.createContext({Date:Clock,EMX:'https://push2ex.eastmoney.com',get:async()=>payload,curlGet:async()=>payload,fetchZTPoolThs:async()=>ths,_srcWarn(){},require:require('node:module').createRequire(path.join(root,'em.js'))});vm.runInContext(fn(emSource,'fetchZTPool'),c);return c.fetchZTPool;}
const emWire=qdate=>({data:{qdate,pool:[{c:'600000',n:'样本',p:11000,zdp:10}]}});
test('EM pool preserves matching supplier qdate and never invents price quoteAt',async()=>{
 const [r]=await pool(emWire(20261113))('20261113');assert.equal(r.tradeDate,'2026-11-13');assert.equal(r.sourceTradeDate,'2026-11-13');assert.equal(r.quoteAt,undefined);assert.equal(r.receivedAt,now);
});
test('EM missing or mismatched qdate cannot enter the requested dated pool',async()=>{
 for(const date of [20261112,undefined,'20260230'])assert.equal((await pool(emWire(date))('20261113')).length,0);
});
test('THS fallback without upstream session stays unknown and cannot claim a dated fact',async()=>{
 const [r]=await pool(null,[{code:'600000',src:'ths'}])('20261113');assert.ok(r);assert.equal(r.tradeDate,null);assert.equal(r.sourceDateStatus,'unknown');assert.equal(r.factEvidence,undefined);
});
function admission(rows,{prior=[{code:'600001',tradeDate:'2026-11-12'}],stocks=[],derived=[],cls={status:'unavailable',items:[],complete:false}}={}){
 const start=server.indexOf('async function refreshSectorsZT()'),firstEnd=server.indexOf('  // ⛔ 跌停家数权威源',start);
 const deriveStart=server.indexOf('  // kc 轮：东财/同花顺涨停池接口盘后',firstEnd),commitEnd=server.indexOf('    S.ztDay = _ztDay;',deriveStart)+'    S.ztDay = _ztDay;'.length;
 const code=server.slice(start,firstEnd)+server.slice(deriveStart,commitEnd)+'\n}\nreturn {zt};\n}';
 const state={ztPool:prior,ztDay:'20261112',stocks};
 const ctx=vm.createContext({Date:Clock,S:state,_dataDayOk:true,dataTradeDay:async()=> '2026-11-13',console:quiet,
 require:name=>name==='./src/core/cls-limit-up-pool'?{fetchClsLimitPool:async()=>cls}:require('node:module').createRequire(path.join(root,'server.js'))(name),
 em:{fetchSectorFlow:async()=>[],fetchZTPool:async()=>rows},reviewSnapshotFields:snapshot,
 marketReady:()=>true,deriveLimitUpMissed:()=>derived,enrichMissedStreak:async()=>{},enrichZTPoolMeta:async()=>{},A:{ztDroppedOf:()=>[],countsInZtTally:()=>true,isJunkName:()=>false}});
 vm.runInContext(code,ctx);return {state,run:ctx.refreshSectorsZT};
}
test('accepted limit pool map reaches committed rows with source-bound fact/research evidence',async()=>{
 const a=admission([{code:'600000',src:'em',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',receivedAt:now-1000}]);await a.run();
 const row=a.state.ztPool[0];assert.equal(row.factEvidence.tradeDate,'2026-11-13');assert.equal(row.researchEvidence.receivedAt,now-1000);assert.equal(a.state.ztDay,'20261113');
});
test('wrong or unknown source day retains previous valid pool even with undated reconstruction candidates',async()=>{
 for(const patch of [{tradeDate:'2026-11-12'},{tradeDate:null},{tradeDate:'2026-11-13',src:'ths'}]){
 const a=admission([{code:'600000',src:'em',...patch}],{stocks:[stock()],derived:[{code:'600002',src:'derive'}]});const previous=a.state.ztPool;await a.run();assert.equal(a.state.ztPool,previous);assert.equal(a.state.ztDay,'20261112');assert.equal(a.state.ztPoolFetchOk,false);
 }
});

test('auction failure TTL preserves historical data and retries after fifteen minutes',async()=>{
 let instant=now,calls=0;class RetryClock extends Date{static now(){return instant;}}
 const state={auctionTicks:{'600000':{date:'2026-11-13',ok:true,data:ticks('2026-11-13'),failAt:0}}};
 const c=vm.createContext({S:state,NP:{localDate:()=> '2026-11-16'},Date:RetryClock,
  em:{fetchAuctionTicks:async()=>{calls++;if(calls===1)throw Error('fixture');return ticks('2026-11-16');}}});
 vm.runInContext(fn(server,'auctionTicksFor'),c);
 assert.equal(await c.auctionTicksFor('600000'),null);assert.equal(state.auctionTicks['600000'].data.tradeDate,'2026-11-13');
 assert.equal(await c.auctionTicksFor('600000'),null);assert.equal(calls,1);
 instant+=16*60000;assert.equal((await c.auctionTicksFor('600000')).tradeDate,'2026-11-16');assert.equal(calls,2);assert.equal(state.auctionTicks['600000'].failAt,0);
});
test('cold-start unavailable pools cannot gain a requested date from undated stock lists',async()=>{
 const a=admission([],{prior:[],stocks:[stock('600002',{quoteAt:null})],derived:[{code:'600002',src:'derive',price:10}]});
 const previous=a.state.ztPool;await a.run();assert.equal(a.state.ztPool,previous);assert.equal(a.state.ztDay,'20261112');assert.equal(a.state.ztPoolFetchOk,false);
});
test('cold-start reconstruction preserves actual stock evidence without granting provider-pool facts',async()=>{
 const original=stock('600002',{quoteAt:Date.parse('2026-11-13T15:00:00+08:00')}),derived={code:'600002',src:'derive',price:10};
 const a=admission([],{prior:[],stocks:[original],derived:[derived]});await a.run();const row=a.state.ztPool[0];
 assert.ok(row,'only a supplier-dated close may reconstruct a missing provider pool');
 assert.equal(row.tradeDate,'2026-11-13');assert.equal(row.quoteAt,original.quoteAt);assert.equal(row.receivedAt,original.receivedAt);assert.equal(row.quoteSource,original.quoteSource);assert.equal(row.factEvidence,undefined);
});

test('actual refresh admits CLS only to readonly review, leaving the original strategy pool unchanged',async()=>{
 const rows=Array.from({length:37},(_,i)=>({code:String(600000+i),name:'样本',src:'em',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',receivedAt:now}));
 rows.poolMeta={totalCount:37,receivedAt:now};
 const cls={status:'available',complete:true,tradeDate:'2026-11-13',totalCount:38,fetchedCount:38,uniqueCount:38,
  items:Array.from({length:38},(_,i)=>({code:String(600000+i),name:i===37?'*ST样本':'样本',src:'cls',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',quoteAt:null,
   reason:'源原因',reasonTradeDate:'2026-11-13',reasonSource:'cls',reasonDateStatus:'matched',sectorTags:['板块甲','板块乙']}))};
 const a=admission(rows,{cls});await a.run();assert.equal(a.state.ztPool.length,37);assert.equal(a.state.ztReviewPool.length,38);assert.equal(a.state.ztReviewPool[37].reason,'源原因');assert.equal(a.state.ztPool[0].reason,undefined);
});
