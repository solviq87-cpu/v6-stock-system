'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const contract=require('../src/core/quote-observation-view');
const server=fs.readFileSync(require.resolve('../server'),'utf8');
const em=fs.readFileSync(require.resolve('../em'),'utf8');
const now=Date.parse('2026-11-13T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const quote=(patch={})=>({code:'000001',price:9,pct:-10,quoteSource:'eastmoney',quoteAt:now-1000,
 receivedAt:now,quoteMode:'public-live-unverified',canTrade:true,canNotify:true,...patch});
function fn(source,name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,name);
 const end=source.indexOf('\n}',start);
 return source.slice(source.slice(Math.max(0,start-6),start)==='async '?start-6:start,end+2);
}
function run(source,names,extra={}){
 const c=vm.createContext({Date:Clock,console:{log(){},error(){},warn(){}},
  require:name=>{assert.equal(name,'./src/core/quote-observation-view');return contract;},...extra});
 vm.runInContext(names.map(name=>fn(source,name)).join('\n'),c);return c;
}

test('use eligibility requires the original row, actual reception and explicit use permissions',()=>{
 const original=quote(),before=structuredClone(original),q=contract.quoteUseEligibility(original,now);
 assert.equal(q.canTrade,true);assert.equal(q.canNotify,true);assert.equal(q.verifiedLive,false);
 assert.equal(q.receivedAt,now);assert.equal(q.tradeDate,'2026-11-13');assert.equal(q.source,'eastmoney');
 assert.deepEqual(original,before);
 assert.equal(contract.quoteObservationView(original,now).canTrade,false,'a display projection grants no permissions');
 assert.equal(contract.quoteUseEligibility({...original,canTrade:undefined,canNotify:undefined},now).canNotify,false);
 assert.equal(contract.quoteUseEligibility({...original,canTrade:undefined,canNotify:true},now).canNotify,true,'frozen pool notification evidence need not grant execution');
 for(const patch of [{quoteAt:now-15001},{quoteAt:now+1},{quoteAt:null},{quoteAt:now,receivedAt:now-1},
  {receivedAt:null},{receivedAt:now+1},{quoteSource:''},{price:0},{quoteMode:'simulated-market'},
  {quoteMode:'research-observation'},{quoteMode:'historical-bars'},{quoteSource:'simulated-market'},
  {simulated:true},{readOnlyBackup:true},{suspended:true},{canTrade:false},{canNotify:false}]){
  const r=contract.quoteUseEligibility(quote(patch),now);assert.equal(r.canNotify,false,JSON.stringify(patch));
  if(patch.canNotify!==false)assert.equal(r.canTrade,false,JSON.stringify(patch));
 }
 const midnight=Date.parse('2026-11-14T00:00:01+08:00');
 assert.equal(contract.quoteUseEligibility(quote({quoteAt:midnight-2000,receivedAt:midnight}),midnight).canNotify,false);
});

test('funds preserve a genuine zero and never borrow a price timestamp',()=>{
 const r=contract.fundsObservationView({...quote(),mainInflow:0,fundsSource:'eastmoney',fundsUnit:'CNY',fundsRetrievedAt:now},now);
 assert.equal(r.value,0);assert.equal(r.unit,'CNY');assert.equal(r.quoteAt,null);
 assert.equal(r.receivedAt,now);assert.equal(r.freshness,'unknown');assert.equal(r.canNotify,false);
 assert.equal(r.missingReason,'missing-original-funds-time');
 assert.equal(contract.fundsObservationView({mainInflow:null},now).value,null);
 assert.doesNotThrow(()=>contract.fundsObservationView({mainInflow:0,source:'eastmoney',sourceTimestamp:Number.MAX_SAFE_INTEGER},now));
});

test('full-A EM uses its own f124 while price time never becomes funds time',()=>{
 const c=run(em,['normalizeStock','observedFlowNumber','batchQuoteAtPublication']);
 const input={f12:'000001',f14:'fixture',f2:9,f62:0,f184:0,f124:(now-1000)/1000};
 const q=c.normalizeStock(input);
 assert.equal(q.quoteAt,now-1000);assert.equal(q.receivedAt,now);assert.equal(q.quoteSource,'eastmoney');
 assert.equal(q.canNotify,true);assert.equal(q.mainInflow,0);assert.equal(q.fundsSourceTimestamp,null);
 for(const at of [undefined,null,'-',Number.MAX_SAFE_INTEGER]){
  const r=c.normalizeStock({...input,f124:at});assert.equal(r.quoteAt,null);assert.equal(r.canNotify,false);
 }
 for(const at of [now-16000,now+1000])assert.equal(c.normalizeStock({...input,f124:at/1000}).canNotify,false);
 assert.match(em,/fields=f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18,f20,f21,f22,f26,f62,f184,f124/);
});

test('Sina full-A cannot guess the original date from HH:MM or the local clock',async()=>{
 let calls=0;
 const c=run(em,['fetchAllStocksSina'],{txGet:async()=>Buffer.from(JSON.stringify(calls++?[]:[{
  code:'000001',name:'fixture',trade:'9',amount:'100',ticktime:'10:00:00'}])),delay:async()=>{}});
 const [q]=await c.fetchAllStocksSina();
 assert.equal(q.price,9);assert.equal(q.quoteSource,'sina');assert.equal(q.receivedAt,now);
 assert.equal(q.quoteAt,null);assert.equal(q.tradeDate,null);assert.equal(q.canTrade,false);assert.equal(q.canNotify,false);
});

test('index collection retains Tencent original time, including old and unknown observations',async()=>{
 const wire=at=>{const f=Array(40).fill('0');f[3]='3000';f[30]=at;f[32]='1';return `v_1.000001="${f.join('~')}";`;};
 for(const [original,at] of [['20261113100000',now],['20261112150000',Date.parse('2026-11-12T15:00:00+08:00')],['',null]]){
  const c=run(em,['fetchIdxRt','batchQuoteAtPublication'],{Buffer,TextDecoder,
   require:name=>{assert.equal(name,'./src/core/public-market');return require('../src/core/public-market');},
   https:{get(_url,_opts,cb){const req=new EventEmitter();queueMicrotask(()=>{const res=new EventEmitter();cb(res);res.emit('data',Buffer.from(wire(original)));res.emit('end');});return req;}}});
  const [r]=await c.fetchIdxRt();assert.equal(r.quoteAt,at);assert.equal(r.receivedAt,now);
  assert.equal(r.price,3000);assert.equal(r.quoteSource,'tencent-index');assert.equal(r.canNotify,false);
 }
});

test('index mood text cannot upgrade a new receipt of an old or unknown quote into live',()=>{
 const c=run(server,['idxRtLine'],{S:{idxRt:{at:now,items:[]}}});
 for(const patch of [{quoteAt:now-16000},{quoteAt:null},{receivedAt:now+1},{quoteAt:now+1}]){
  c.S.idxRt.items=[{...quote(patch),name:'上证'}];assert.equal(c.idxRtLine(),null,JSON.stringify(patch));
 }
 c.S.idxRt.items=[{...quote(),name:'上证'}];
 assert.match(c.idxRtLine(),/原时点09:59:59/);assert.match(c.idxRtLine(),/未认证/);assert.doesNotMatch(c.idxRtLine(),/实时/);
});

test('Kline metadata describes dated history and independent cache state without a 15-second expiry',()=>{
 const rows=[{date:'2026-11-12',close:9}],snapshot={src:'tx',adjust:'qfq',receivedAt:now-86400000};
 const r=contract.klineObservation(snapshot,rows,{targetDate:'2026-11-12',cacheLayer:'disk',cacheAt:now-1000,now});
 assert.equal(r.freshness,'dated-bars');assert.equal(r.receivedAt,now-86400000);assert.equal(r.quoteAt,null);
 assert.equal(r.tradeDate,'2026-11-12');assert.equal(r.cacheLayer,'disk');assert.equal(r.priceBasis,'qfq');assert.equal(r.canTrade,false);
 const late=contract.klineObservation(snapshot,rows,{targetDate:'2026-11-13',cacheLayer:'held-after-source-failure',now});
 assert.equal(late.freshness,'source-lagging');assert.equal(late.missingReason,'source-behind-target');
 assert.equal(contract.klineObservation({},rows,{now}).receivedAt,null,'old cache does not invent reception time');
 assert.equal(contract.klineObservation(snapshot,[{date:'2026-02-30'}],{now}).freshness,'unknown');
 assert.equal(contract.klineObservation(snapshot,[{date:'2026-11-14'}],{now}).freshness,'future');
});

test('actual Kline read reports memory, disk, fresh source and held-source-failure paths',async()=>{
 const bar=date=>[{date,close:9}],old={src:'tx',adjust:'qfq',receivedAt:now-86400000,rows:bar('2026-11-12')};
 const fresh={src:'em',adjust:'qfq',receivedAt:now,rows:bar('2026-11-13')};
 const c=run(server,['klineRows'],{S:{klines:new Map()},_klineAt:new Map(),_klineFreshGate:new Map(),_klineReadMeta:new Map(),
  latestTradeDate:()=> '2026-11-13',klineLastDate:rows=>rows?.at(-1)?.date||'',isMarketOpenNow:()=>false,
  KLINE_INTRADAY_TTL:1000,KLINE_CACHE:'/fixture',path,fs:{readFileSync(){throw Error('no disk');},writeFileSync(){}},
  em:{fetchKline:async()=>fresh},_klineWriteErr(){},klineSet(code,k){c.S.klines.set(code,k);c._klineAt.set(code,now);}});
 c.S.klines.set('000001',fresh);c._klineAt.set('000001',now);
 assert.equal((await c.klineRows('000001')).at(-1).date,'2026-11-13');assert.equal(c._klineReadMeta.get('000001').cacheLayer,'memory');
 c.S.klines.clear();c.fs.readFileSync=()=>JSON.stringify(fresh);c.fs.statSync=()=>({mtimeMs:now});
 await c.klineRows('000001');assert.equal(c._klineReadMeta.get('000001').cacheLayer,'disk');
 c.S.klines.clear();c.fs.readFileSync=()=>{throw Error('no disk');};
 await c.klineRows('000001');assert.equal(c._klineReadMeta.get('000001').cacheLayer,'source');
 c.S.klines.set('000001',old);c._klineAt.set('000001',now-86400000);c.em.fetchKline=async()=>{throw Error('fixture failure');};
 assert.equal((await c.klineRows('000001')).at(-1).date,'2026-11-12');
 assert.equal(c._klineReadMeta.get('000001').cacheLayer,'held-after-source-failure');
 assert.equal(c._klineReadMeta.get('000001').snapshot.receivedAt,old.receivedAt);
 assert.equal(c._klineReadMeta.get('000001').cacheAt,now-86400000);
 assert.equal(c._klineReadMeta.get('000001').lastAttemptAt,now,'failed retry time is separate from cache write time');
});

test('valuation follows the selected same-row price and labels carried/cost fallbacks',()=>{
 const state={lastPx:new Map(),stocks:[quote()],trendPool:[],candidatePool:[quote({price:8,quoteAt:now-86400000})]};
 const stale=contract.valuationObservation(state,'000001',8,{},true,now);
 assert.equal(stale.quoteAt,now-86400000);assert.equal(stale.quoteStatus,'stale');assert.equal(stale.canTrade,false);
 const unknown=contract.valuationObservation(state,'000001',7,{},true,now);
 assert.equal(unknown.valuationKind,'unattributed-mark');assert.equal(unknown.quoteAt,null);
 state.lastPx.set('000001',{p:9,t:now,quoteAt:now-1000,quoteSource:'tencent'});
 assert.equal(contract.valuationObservation(state,'000001',9,{},true,now).receivedAt,null,'cache t is not original reception');
 const carried=contract.valuationObservation(state,'000001',7,{lastPrice:7},false,now);
 assert.equal(carried.valuationKind,'carried-mark');assert.equal(carried.quoteAt,null);
 const cost=contract.valuationObservation(state,'000001',10,{buyPrice:10},false,now);
 assert.equal(cost.valuationKind,'cost-basis');assert.equal(cost.canNotify,false);
});

test('paper snapshot exposes per-position quality and cannot manufacture a buy timestamp',()=>{
 const pp={code:'000001',buyPrice:10,lastPrice:8,shares:100,buyDate:'2026-11-12',buyTs:null,buyTimeQuality:'date-only'};
 const c=run(server,['paperSnap'],{PAPER_CFG:{pool:{name:'fixture',initial:10000}},
  PAPER:{pool:{enabled:false,cash:9000,realized:0,positions:{'000001':pp},trades:[]}},
  S:{stocks:[quote({price:8,quoteAt:null})],lastPx:new Map(),news:{badCodes:new Set()}},
  paperEquity:()=>9800,tradeDaysSince:()=>1,paperAudit:()=>({ok:true}),isReplica:()=>false,quoteBasis:()=>null});
 const row=c.paperSnap('pool',new Map([['000001',8]])).positions[0];
 assert.equal(row.lastPrice,8);assert.equal(row.valuationQuote.quoteStatus,'unknown');assert.equal(row.valuationQuote.canTrade,false);
 assert.equal(row.natDays,null);assert.equal(row.buyTs,null);assert.equal(row.buyDate,'2026-11-12');assert.equal(row.days,1);
});

test('paper position UI distinguishes cost, carried, old and unknown marks in readable text',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../public/assets/app.js'),'utf8'),els={};
 const c=run(app,['renderPaper'],{document:{getElementById:id=>els[id]||(els[id]={})},esc:value=>String(value)});
 const position={code:'000001',name:'fixture',buyPrice:10,lastPrice:8,pnl:-200,pnlPct:-20,shares:100,days:null};
 for(const [quality,label] of [[{valuationKind:'cost-basis'},'按成本估值'],[{valuationKind:'carried-mark'},'沿用上次价'],
  [{valuationKind:'observed-price',quoteStatus:'stale',quoteSource:'eastmoney'},'原报价较旧'],
  [null,'估值来源或时点未知']]){
  c.renderPaper('Pool',{initial:10000,equity:9800,totalPnl:-200,totalPct:-2,realized:0,cash:9000,marketValue:800,
   positions:[{...position,valuationQuote:quality}],trades:[]},false);
  assert.ok(els.ppPoolPos.innerHTML.includes(label));assert.ok(els.ppPoolPos.innerHTML.includes('日期未知'));
  assert.ok(!els.ppPoolPos.innerHTML.includes('null交易日'));
 }
});

test('ingest keeps actual receivedAt/mode separately from local ingestion time',()=>{
 const c=run(server,['ingestPx'],{S:{lastPx:new Map()}}),row=quote({receivedAt:now-500});
 c.ingestPx([row]);const cached=c.S.lastPx.get(row.code);
 assert.equal(cached.receivedAt,now-500);assert.equal(cached.t,now);assert.equal(cached.mode,'public-live-unverified');
 c.ingestPx([quote({receivedAt:undefined})]);assert.equal(c.S.lastPx.get(row.code).receivedAt,null);
});

test('automatic paper authority rejects observation/simulated sources, including through its price cache',()=>{
 const c=run(server,['ingestPx','paperAuthorityQuotes'],{S:{lastPx:new Map(),stocks:[]},limitPctOfCode:()=>.1,
  require:name=>name==='./src/core/quote-observation-view'?contract:require('../src/core/a-share-calendar')});
 for(const patch of [{quoteMode:'research-observation'},{quoteMode:'simulated-market'},
  {quoteMode:'historical-bars'},{quoteSource:'simulated'},{simulated:true},{readOnlyBackup:true},
  {tradable:false},{suspended:true},{canTrade:false}]){
  c.S.lastPx.clear();c.S.stocks=[quote({volume:100,preClose:10,...patch})];c.ingestPx(c.S.stocks);
  assert.equal(Object.keys(c.paperAuthorityQuotes()).length,0,JSON.stringify(patch));
 }
 c.S.lastPx.clear();c.S.stocks=[quote({volume:100,preClose:10,receivedAt:undefined,canTrade:undefined})];
 assert.equal(c.paperAuthorityQuotes()['000001'].quoteAt,now-1000,'legacy source-timed authority contract remains supported without invented receipt');
});

test('imported, fixture, mock and synthetic evidence cannot enter automatic authority or reminders',()=>{
 const c=run(server,['ingestPx','paperAuthorityQuotes'],{S:{lastPx:new Map(),stocks:[]},limitPctOfCode:()=>.1,
  require:name=>name==='./src/core/quote-observation-view'?contract:require('../src/core/a-share-calendar')});
 const cases=[{quoteMode:'imported'},{quoteMode:'fixture'},{quoteMode:'mock-market'},{quoteMode:'backtest'},
  {quoteMode:'synthetic-market'},{quoteSource:'imported'},{quoteSource:'import'},{quoteSource:'fixture-feed'},
  {quoteSource:'mock:quote'},{quoteSource:'test'},{quoteSource:'synthetic-feed'},
  {imported:true},{fixture:true},{mock:true},{synthetic:true},{mode:'imported',quoteMode:undefined}];
 const outcomes=cases.map(patch=>{
  const row=quote({volume:100,preClose:10,...patch});c.S.lastPx.clear();c.S.stocks=[row];c.ingestPx([row]);
  const snapshot={price:row.price,...contract.quoteSnapshotFields(row)};
  return {authority:Object.keys(c.paperAuthorityQuotes()).length,notify:contract.quoteUseEligibility(row,now).canNotify,
   copiedNotify:contract.quoteUseEligibility(snapshot,now).canNotify};
 });
 assert.deepEqual(outcomes,cases.map(()=>({authority:0,notify:false,copiedNotify:false})));
 for(const quoteSource of ['eastmoney','tencent','eastmoney-latest']){
  const row=quote({quoteSource,volume:100,preClose:10});c.S.lastPx.clear();c.S.stocks=[row];c.ingestPx([row]);
  assert.equal(c.paperAuthorityQuotes()['000001'].price,9);assert.equal(contract.quoteUseEligibility(row,now).canNotify,true);
 }
});

function holdingFixture(t,{batch=[],stocks=[],ths=new Map()}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-quote-consumer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'holdings.json'),JSON.stringify({capital:100000,items:[{code:'000001',name:'fixture',cost:10,shares:100}]}));
 fs.writeFileSync(path.join(dir,'.holdings_push.json'),JSON.stringify({rep:{},once:[]}));
 const messages=[];
 const api=require('../holdings')({fs,path,dir,S:{stocks,klines:new Map(),news:{badCodes:new Set(),goodCodes:new Set()}},
  em:{fetchBatchSnapshot:async()=>batch,fetchThsActiveBatch:async()=>ths,fetchKline:async()=>({rows:[]})},
  pushAll:(...args)=>messages.push(args),sseSend(){},sseSendEdit(){},nowDate:()=>new Date(now),dataWindow:()=>true});
 return {api,messages};
}
test('old full-A holding fallback remains valued and observed without trading advice or notifications',async t=>{
 const {api,messages}=holdingFixture(t,{stocks:[quote({price:8,quoteAt:now-86400000})]});
 const row=(await api.compute(true)).items[0];
 assert.equal(row.price,8);assert.equal(row.floatPct,-20);assert.equal(row.valuationOnly,true);
 assert.equal(row.mainIn,null);assert.equal(row.mainPct,null);assert.equal(row.fundsQuality.value,null);
 assert.equal(row.acts[0].type,'观察');assert.ok(row.observedActs.some(a=>a.type==='止损'));
 assert.equal((await api.checkNow()).fired,0);await api.watch();assert.equal(messages.length,0);
});
test('THS fallback never claims its local retrieval is the original price time',async t=>{
 const {api,messages}=holdingFixture(t,{ths:new Map([['000001',{price:8,netAmt:0,activePct:0,retrievedAt:now}]])});
 const row=(await api.compute(true)).items[0];
 assert.equal(row.price,8);assert.equal(row.quoteQuality.quoteAt,null);assert.equal(row.quoteQuality.receivedAt,now);
 assert.equal(row.quoteQuality.canNotify,false);assert.equal((await api.checkNow()).fired,0);assert.equal(messages.length,0);
});
test('a fresh same-row allowed holding quote preserves the established risk action and mock notification',async t=>{
 const {api,messages}=holdingFixture(t,{batch:[quote({price:8,mainInflow:0,mainPct:0})]});
 const row=(await api.compute(true)).items[0];assert.equal(row.valuationOnly,false);
 assert.equal(row.mainIn,0);assert.equal(row.mainPct,0);assert.equal(row.fundsQuality.value,0);
 assert.equal(row.fundsQuality.quoteAt,null,'price original time is not funds original time');
 assert.ok(row.acts.some(a=>a.type==='止损'&&a.canNotify));
 assert.ok((await api.checkNow()).fired>0);assert.equal(messages.length,1);
});
