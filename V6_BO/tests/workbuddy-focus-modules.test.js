'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../V6_WEB/workbuddy/index.html'),'utf8');
const source=html.split('/* V6_FOCUS_MODULES_START */')[1]?.split('/* V6_FOCUS_MODULES_END */')[0];
assert.ok(source,'Actual inline focus module must be present');
const at=x=>Date.parse('2026-11-13T'+x+'+08:00');
const iso=x=>new Date(x).toISOString();
const days=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'];
function harness(){
 const context={Date,Number,Object,Array,Map,Set,String,Math,JSON,console};
 context.window=context;context.fetch=()=>{throw Error('Unexpected wire');};
 vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,context,{timeout:1000});return context;
}
function fixture({now=at('10:00:00'),kind='morning',open=true}={}){
 const q={symbol:'600001',name:'研究样本',price:11,previousClose:10,source:'tencent-public',providerTime:iso(now-5000),receivedAt:iso(now-4000),providerDateKnown:true,isStale:false,isST:false,suspended:false};
 const rows=days.slice(0,4).map(date=>({date,open:10,high:11,low:9,close:11,volume:100}));
 const meta={rows,source:'tencent-unadjusted-daily',adjustment:'none',historyGap:false,completedRowCount:4,completedThroughDate:'2026-11-12',lastBarComplete:true};
 const history={source:'declared-daily-limit-records',tradingDates:days,rows:days.slice(0,4).map((date,i)=>({date,isLimitUp:i===3,knownAt:date+'T15:30:00+08:00'}))};
 const data={limitHistory:history};
 const snapshot={stocks:[q],strategyData:{bySymbol:{[q.symbol]:data}},strategyBars:{[q.symbol]:meta}};
 const options={now,marketSession:{date:'2026-11-13',kind,open,calendarSupported:true,latestClosedDate:'2026-11-12'},checkStock:()=>({status:'eligible'})};
 return {q,rows,meta,history,data,snapshot,options};
}
const moduleOf=(result,id)=>result.modules.find(m=>m.id===id);
const calc=(context,f)=>context.V6FocusModules.compute({},f.snapshot,f.options);
function auctionFixture(settings={}){
 const f=fixture({now:at('09:21:05'),kind:'auction',...settings});
 f.data.auction={tradeDate:'2026-11-13',source:'declared-auction-feed',previousClose:10,snapshots:[
  {symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:20:00')),receivedAt:iso(at('09:20:01')),indicativePrice:10.2,indicativeMatchedVolume:1000},
  {symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:21:00')),receivedAt:iso(at('09:21:01')),indicativePrice:10.2,indicativeMatchedVolume:1200}
 ]};return f;
}

test('focus compute and renderer expose four independent real-data modules without side effects',()=>{
 const h=harness(),f=fixture(),before=JSON.stringify(f.snapshot),r=calc(h,f);
 assert.equal(r.modules.length,4);assert.equal(JSON.stringify(f.snapshot),before);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 const markup=h.V6FocusModules.render({},f.snapshot,f.options);
 for(const id of ['auction-strength','one-to-two','two-to-three','intraday-strength'])assert.match(markup,new RegExp('data-module-id="'+id+'"'));
 for(const title of ['竞价强势票','一进二','二进三','盘中强势票'])assert.ok(markup.includes(title));
 assert.match(markup,/href="#scanner" data-focus-module-group="opening"/);assert.doesNotMatch(markup,/data-action="battle-group"/);
});
test('one-to-two uses explicit consecutive closed-day limit records, not current incomplete bar',()=>{
 const h=harness(),f=fixture();f.rows.push({date:'2026-11-13',open:11,high:12.1,low:11,close:12.1,volume:200});f.meta.lastBarComplete=false;
 const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,1);assert.equal(m.currentCount,1);assert.equal(m.observations[0].date,'2026-11-12');assert.equal(m.observations[0].sourceTime,'2026-11-12');assert.equal(moduleOf(calc(h,f),'two-to-three').matched,0);
});
test('two-to-three requires exactly two closed limit days and preceding nonlimit',()=>{
 const h=harness(),f=fixture();f.history.rows[2].isLimitUp=true;
 assert.equal(moduleOf(calc(h,f),'two-to-three').matched,1);assert.equal(moduleOf(calc(h,f),'one-to-two').matched,0);
 f.history.rows[1].isLimitUp=true;assert.equal(moduleOf(calc(h,f),'two-to-three').matched,0);
});
test('price change and matching OHLC alone cannot invent a true daily-limit history',()=>{
 const h=harness(),f=fixture();delete f.data.limitHistory;f.q.change=10;f.q.limitUpPrice=11;f.q.priceLimitKnown=true;
 const r=calc(h,f);assert.equal(moduleOf(r,'one-to-two').matched,0);assert.equal(moduleOf(r,'two-to-three').matched,0);assert.equal(moduleOf(r,'one-to-two').pending,1);
});
for(const [label,change] of [
 ['adjusted history',f=>{f.meta.adjustment='qfq';}],
 ['unknown completed count',f=>{f.meta.completedRowCount=null;}],
 ['history gap',f=>{f.meta.historyGap=true;}],
 ['inconsistent closed date',f=>{f.meta.completedThroughDate='2026-11-11';}],
 ['missing prior daily flag',f=>{f.history.rows=f.history.rows.filter(r=>r.date!=='2026-11-11');}],
 ['duplicate limit date',f=>{f.history.rows.push({...f.history.rows[0]});}],
 ['future-known limit record',f=>{f.history.rows[3].knownAt='2026-11-14T15:00:00+08:00';}],
 ['historical no-limit exception',f=>{f.history.rows[3].ipoNoLimit=true;}],
 ['corporate action exception',f=>{f.history.rows[3].corporateAction=true;}],
 ['missing calendar date',f=>{f.history.tradingDates=days.filter(d=>d!=='2026-11-11');}],
 ['current unclosed day presented complete',f=>{f.rows.push({date:'2026-11-13',open:11,high:12.1,low:11,close:12.1,volume:200});f.meta.completedRowCount=5;f.meta.completedThroughDate='2026-11-13';}]
])test('ladder keeps '+label+' pending',()=>{const h=harness(),f=fixture();change(f);const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,0);assert.equal(m.pending,1);});
test('session calendar can verify weekend gaps without claiming a missing weekday is consecutive',()=>{
 const h=harness(),f=fixture();delete f.history.tradingDates;
 const closedDates=['2026-11-06','2026-11-09','2026-11-10','2026-11-12'];
 f.rows.forEach((r,i)=>r.date=closedDates[i]);f.history.rows.forEach((r,i)=>{r.date=closedDates[i];r.knownAt=r.date+'T15:30:00+08:00';});
 f.options.sessionAt=ms=>{const d=new Date(ms+288e5);return {open:![0,6].includes(d.getUTCDay()),calendarSupported:true};};
 assert.equal(moduleOf(calc(h,f),'one-to-two').matched,0);
 f.rows[2].date='2026-11-11';f.history.rows[2].date='2026-11-11';f.history.rows[2].knownAt='2026-11-11T15:30:00+08:00';
 assert.equal(moduleOf(calc(h,f),'one-to-two').matched,0); // The 10th is now missing.
 f.rows[1].date='2026-11-10';f.history.rows[1].date='2026-11-10';f.history.rows[1].knownAt='2026-11-10T15:30:00+08:00';
 assert.equal(moduleOf(calc(h,f),'one-to-two').matched,1);
});
test('old closed date and stale quote remain dated historical observations during an open session',()=>{
 const h=harness(),f=fixture();f.options.marketSession.latestClosedDate='2026-11-13';f.q.providerTime='2026-11-12T15:00:00+08:00';
 const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,1);assert.equal(m.currentCount,0);assert.equal(m.observations[0].sourceTime,'2026-11-12');
 assert.match(h.V6FocusModules.render({},f.snapshot,f.options),/历史 \/ 过期观察/);
});
for(const kind of ['lunch','after-close','closed','calendar-unknown'])test(kind+' never promotes a cached ladder to a current observation',()=>{
 const h=harness(),f=fixture({kind,open:false});const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,1);assert.equal(m.currentCount,0);
 assert.match(h.V6FocusModules.render({},f.snapshot,f.options),/休市 · 缓存观察/);
});
test('auction hold requires two original independent noncancel snapshots',()=>{
 const h=harness(),f=auctionFixture(),m=moduleOf(calc(h,f),'auction-strength');assert.equal(m.matched,1);assert.equal(m.currentCount,1);assert.equal(m.observations[0].sourceTime,f.data.auction.snapshots[1].quoteAt);assert.match(m.observations[0].evidence[0].value,/非实际成交量/);
 f.data.auction.snapshots[1].quoteAt=f.data.auction.snapshots[0].quoteAt;assert.equal(moduleOf(calc(h,f),'auction-strength').matched,0);
});
test('auction final confirmation requires actual executed amount and independent daily amount base',()=>{
 const h=harness(),f=auctionFixture({now:at('09:25:05'),kind:'auction-break',open:false});
 f.data.auction.snapshots=[{symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:25:00')),receivedAt:iso(at('09:25:01')),indicativePrice:10.2,indicativeMatchedVolume:1200,executed:true,executedAmount:4e6}];f.data.auction.dailyAverageAmount20=1e8;
 let m=moduleOf(calc(h,f),'auction-strength');assert.equal(m.matched,1);assert.equal(m.currentCount,0);assert.match(m.observations[0].rules[0],/实际量价/);
 delete f.data.auction.snapshots[0].executed;assert.equal(moduleOf(calc(h,f),'auction-strength').matched,0);
});
test('auction first-board sector rule accepts only explicitly verified previous first board',()=>{
 const h=harness(),f=auctionFixture({now:at('09:25:05'),kind:'auction-break',open:false});
 f.data.auction.snapshots=[{symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:25:00')),receivedAt:iso(at('09:25:01')),indicativePrice:10.4,indicativeMatchedVolume:1200,executed:true,executedAmount:6e6}];f.data.auction.previousFirstBoardVerified=true;f.data.auction.sectorRank=3;
 assert.equal(moduleOf(calc(h,f),'auction-strength').matched,1);delete f.data.auction.previousFirstBoardVerified;assert.equal(moduleOf(calc(h,f),'auction-strength').matched,0);
});
for(const [label,change] of [
 ['ordinary market quote',f=>{delete f.data.auction;}],
 ['future source tick',f=>{f.data.auction.snapshots[1].quoteAt=iso(at('09:22:00'));}],
 ['wrong symbol',f=>{f.data.auction.snapshots[1].symbol='600002';}],
 ['source mismatch',f=>{f.data.auction.snapshots[1].source='other-feed';}],
 ['receive-before-source',f=>{f.data.auction.snapshots[1].receivedAt=iso(at('09:20:59'));}],
 ['falling virtual match volume',f=>{f.data.auction.snapshots[1].indicativeMatchedVolume=900;}]
])test('auction rejects '+label,()=>{const h=harness(),f=auctionFixture();change(f);assert.equal(moduleOf(calc(h,f),'auction-strength').matched,0);});
test('auction early indicative spike then fade blocks a later bullish-looking hold',()=>{
 const h=harness(),f=auctionFixture();f.data.auction.snapshots.unshift({symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:19:00')),receivedAt:iso(at('09:19:01')),indicativePrice:10.8,indicativeMatchedVolume:800});f.data.auction.snapshots[1].indicativePrice=10.06;f.data.auction.snapshots[2].indicativePrice=10.06;
 assert.equal(moduleOf(calc(h,f),'auction-strength').excluded,1);
});
test('original standard intraday volume ratio rule retains its upstream clock',()=>{
 const h=harness(),f=fixture();Object.assign(f.q,{volumeRatio:3.5,standardVolumeRatio:true,volumeRatioSource:'declared-standard-normalized',volumeRatioProviderTime:f.q.providerTime});
 const m=moduleOf(calc(h,f),'intraday-strength');assert.equal(m.matched,1);assert.equal(m.currentCount,1);assert.match(m.observations[0].rules[0],/b41/);assert.equal(m.observations[0].sourceTime,f.q.providerTime);
});
test('normal daily volume ratio cannot masquerade as normalized standard volume ratio',()=>{
 const h=harness(),f=fixture();f.q.volumeRatio=10;f.q.dayVolumeRatio=10;
 assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
test('original momentum thresholds form a separately labelled observation',()=>{
 const h=harness(),f=fixture({now:at('14:00:00'),kind:'afternoon'});Object.assign(f.q,{historyGap:false,historyAsOfDate:'2026-11-13',momentum:6,dayVolumeRatio:1.2});
 const m=moduleOf(calc(h,f),'intraday-strength');assert.equal(m.matched,1);assert.equal(m.currentCount,1);assert.match(m.observations[0].rules[0],/原量价动量/);assert.match(m.observations[0].evidence[1].value,/非标准/);
 f.q.dayVolumeRatio=1.19;assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
test('coherent original b41 evidence can be displayed, while old signals cannot borrow a newer quote time',()=>{
 const h=harness(),f=fixture();f.options.battleResult={status:'ready',signals:[{symbol:'600001',strategyId:'b41',sourceTime:f.q.providerTime,signalDate:'2026-11-13',source:'declared-volume-feed',evidence:[{label:'真实标准量比',value:4},{label:'源端时间',value:f.q.providerTime}]}]};
 assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,1);
 f.options.battleResult.signals[0].sourceTime=iso(at('09:55:00'));assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
test('old intraday evidence stays historical and outside b41 opening window cannot fabricate a new b41 match',()=>{
 const h=harness(),f=fixture();Object.assign(f.q,{historyGap:false,historyAsOfDate:'2026-11-13',momentum:10,dayVolumeRatio:2});f.options.now+=20000;
 const m=moduleOf(calc(h,f),'intraday-strength');assert.equal(m.matched,1);assert.equal(m.currentCount,0);
 delete f.q.momentum;Object.assign(f.q,{volumeRatio:5,standardVolumeRatio:true,volumeRatioSource:'declared-standard-normalized',volumeRatioProviderTime:iso(at('10:01:00')),providerTime:iso(at('10:01:00')),receivedAt:iso(at('10:01:01'))});f.options.now=at('10:01:05');assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
for(const [label,change] of [
 ['future quote',f=>{f.q.providerTime=iso(f.options.now+1000);}],
 ['unknown original quote date',f=>{f.q.providerDateKnown=false;}],
 ['missing receive clock',f=>{delete f.q.receivedAt;}],
 ['past history date',f=>{f.q.historyAsOfDate='2026-11-12';}],
 ['history gap',f=>{f.q.historyGap=true;}]
])test('intraday does not refresh '+label+' into current evidence',()=>{
 const h=harness(),f=fixture();Object.assign(f.q,{historyGap:false,historyAsOfDate:'2026-11-13',momentum:10,dayVolumeRatio:2});change(f);assert.equal(moduleOf(calc(h,f),'intraday-strength').currentCount,0);assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
test('all modules honor original common stock filter and never bypass ST or missing policy evidence',()=>{
 const h=harness(),f=fixture();f.q.isST=true;let r=calc(h,f);assert.ok(r.modules.every(m=>m.excluded===1&&m.matched===0));f.q.isST=false;delete f.options.checkStock;r=calc(h,f);assert.ok(r.modules.every(m=>m.pending===1&&m.matched===0));
});
test('missing or unknown session calendar cannot turn a cached observation into current',()=>{
 const h=harness(),f=fixture();delete f.options.marketSession;const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,0);assert.equal(m.pending,1);assert.equal(m.currentCount,0);
});
test('render escapes untrusted names and source labels while preserving stock navigation',()=>{
 const h=harness(),f=fixture();f.q.name='<img src=x onerror=alert(1)>';f.history.source='<script>bad()</script>';
 const markup=h.V6FocusModules.render({},f.snapshot,f.options);assert.match(markup,/data-focus="600001"/);assert.ok(!markup.includes('<img'));assert.ok(!markup.includes('<script>'));assert.match(markup,/&lt;img/);
});
test('invalid evaluation clock is rejected instead of inventing dates',()=>{
 const h=harness(),f=fixture();f.options.now=NaN;assert.throws(()=>calc(h,f),/时点无效/);f.options.now=Number.MAX_SAFE_INTEGER;assert.throws(()=>calc(h,f),/时点无效/);
});
test('original common filter receives one batch classification rather than N full-snapshot rehashes',()=>{
 const h=harness(),f=fixture();delete f.options.checkStock;let batches=0,calls=0;
 f.snapshot.stocks.push({...f.q,symbol:'600002'});
 h.V6Policy={classifyMany(symbols,snapshot){batches++;assert.equal(snapshot,f.snapshot);return new Map(symbols.map(symbol=>[symbol,{symbol,industry:{known:true}}]));}};
 h.V6Battle={checkStock(q,state,snapshot,options){calls++;assert.equal(options.classification.symbol,q.symbol);return {status:'eligible'};}};
 calc(h,f);assert.equal(batches,1);assert.equal(calls,2);
});
test('old standalone normalized ratio cannot borrow a later ordinary quote clock',()=>{
 const h=harness(),f=fixture();Object.assign(f.q,{volumeRatio:4,standardVolumeRatio:true,volumeRatioSource:'declared-volume-feed',volumeRatioProviderTime:iso(at('09:45:00'))});
 assert.equal(moduleOf(calc(h,f),'intraday-strength').matched,0);
});
test('exact 0.5 and 3 percent auction gaps respect stated numeric boundaries',()=>{
 const h=harness(),f=auctionFixture({now:at('09:25:05'),kind:'auction-break',open:false});
 f.data.auction.snapshots=[{symbol:'600001',source:'declared-auction-feed',quoteAt:iso(at('09:25:00')),receivedAt:iso(at('09:25:01')),indicativePrice:10.05,indicativeMatchedVolume:1200,executed:true,executedAmount:4e6}];f.data.auction.dailyAverageAmount20=1e8;
 assert.equal(moduleOf(calc(h,f),'auction-strength').matched,1);
 f.data.auction.snapshots[0].indicativePrice=10.3;assert.equal(moduleOf(calc(h,f),'auction-strength').matched,1);
});
test('versioned common-filter memo never extends the original 15 second quote freshness',()=>{
 const h=harness(),f=fixture();delete f.options.checkStock;f.snapshot.marketDataVersion=1;let filters=0,batches=0;
 h.V6Policy={classificationVersion:0,classifyMany(symbols){batches++;return new Map(symbols.map(symbol=>[symbol,{symbol}]));}};
 h.V6Battle={checkStock(){filters++;return {status:'eligible'};}};
 const state={revision:1};Object.assign(f.q,{historyGap:false,historyAsOfDate:'2026-11-13',momentum:10,dayVolumeRatio:2});
 const run=()=>h.V6FocusModules.compute(state,f.snapshot,f.options);
 assert.equal(moduleOf(run(),'intraday-strength').currentCount,1);f.options.now+=20000;assert.equal(moduleOf(run(),'intraday-strength').currentCount,0);assert.equal(filters,1);assert.equal(batches,1);
 f.snapshot.marketDataVersion++;f.q.providerTime=iso(f.options.now-5000);f.q.receivedAt=iso(f.options.now-4000);assert.equal(moduleOf(run(),'intraday-strength').currentCount,1);assert.equal(filters,2);
 state.selectionPolicy={excludeBanks:true};run();assert.equal(filters,3);
});
test('calendar unknown rejects future bars rather than labelling them cached history',()=>{
 const h=harness(),f=fixture();delete f.options.marketSession.latestClosedDate;f.rows[3].date='2026-11-16';f.meta.completedThroughDate='2026-11-16';f.history.rows[3].date='2026-11-16';f.history.rows[3].knownAt='2026-11-16T15:30:00+08:00';
 const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,0);assert.equal(m.pending,1);
});
test('evidence-local trading dates cannot hide an open day in the authoritative schedule',()=>{
 const h=harness(),f=fixture();f.rows.splice(2,1);f.meta.completedRowCount=3;f.history.rows.splice(2,1);f.history.tradingDates=['2026-11-09','2026-11-10','2026-11-12'];let calendarCalls=0;
 h.V6Market={sessionAt(ms){calendarCalls++;const d=new Date(ms+288e5);return {open:![0,6].includes(d.getUTCDay()),calendarSupported:true};}};
 const m=moduleOf(calc(h,f),'one-to-two');assert.equal(m.matched,0);assert.equal(m.pending,1);assert.ok(calendarCalls>0);
});
test('standalone and reused standard ratio evidence retain a separate declared ratio source',()=>{
 const h=harness(),f=fixture();Object.assign(f.q,{volumeRatio:4,standardVolumeRatio:true,volumeRatioSource:'declared-volume-source',volumeRatioProviderTime:f.q.providerTime});
 let row=moduleOf(calc(h,f),'intraday-strength').observations[0];assert.equal(row.evidence.find(e=>e.label==='标准量比来源').value,'declared-volume-source');assert.equal(row.evidence.find(e=>e.label==='报价来源').value,'tencent-public');
 delete f.q.volumeRatio;f.options.battleResult={status:'ready',signals:[{symbol:'600001',strategyId:'b41',sourceTime:f.q.providerTime,signalDate:'2026-11-13',source:'declared-original-signal-source',evidence:[{label:'真实标准量比',value:4},{label:'源端时间',value:f.q.providerTime}]}]};
 row=moduleOf(calc(h,f),'intraday-strength').observations[0];assert.equal(row.evidence.find(e=>e.label==='标准量比来源').value,'declared-original-signal-source');
});
