'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=process.env.V6_LEDGER_TEST_ROOT||path.resolve(__dirname,'..');
const {createPaperApplicationService}=require(path.join(root,'src/core/paper-application-service'));
const {projectPaperAccount}=require(path.join(root,'src/core/paper-unified-view'));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const initialTime=Date.parse('2026-11-05T10:00:00+08:00');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'pool.json');let now=initialTime;
 const make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:day=>day==='2026-11-05'},maxParticipationPct:1});
 const app=make();app.adoptLegacy({initial:100000,cash:100000,realized:0,enabled:true,positions:{},trades:[]});
 const order={orderId:'research-order',symbol:'600000',side:'buy',quantity:100,limitPrice:11,tradeDate:'2026-11-05'};
 const quote=()=>({symbol:'600000',tradeDate:'2026-11-05',timestamp:now-30000,quoteAt:now-30000,receivedAt:now-1000,
  source:'simulated',quoteSource:'fixture-provider',suspended:false,tradable:true,volumeUnit:'shares',volume:10000,price:10,lowerLimit:9,upperLimit:11});
 const view=()=>projectPaperAccount(app.legacy(),{accountId:'pool',initialCash:100000});
 return {app,make,file,order,quote,view,advance:n=>{now+=n;}};
}
function rewrite(file,book){
 book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});
 delete book.fingerprint;book.fingerprint=hash(book);fs.writeFileSync(file,JSON.stringify(book));
}
function manual(x){x.app.submit(x.order);const q=x.quote();return {q,book:x.app.fill(x.order.orderId,'fill-one',q)};}

test('manual fill persists original provider, mode and separate quote/receive/execution clocks across restart',t=>{
 const x=setup(t),{book,q}=manual(x),a=book.account.events[0],o=book.orders[x.order.orderId].events[0];
 assert.equal(a.fillEvidence.schemaVersion,1);
 assert.equal(a.fillEvidence.executionAt,initialTime);
 assert.equal(a.fillEvidence.quoteAt,initialTime-30000);
 assert.equal(a.fillEvidence.receivedAt,initialTime-1000);
 assert.equal(a.fillEvidence.provider,'fixture-provider');assert.equal(a.fillEvidence.mode,'simulated');
 assert.equal(a.fillEvidence.quotePrice,10);assert.equal(a.fillEvidence.volume,10000);
 assert.equal(a.fillEvidence.canTrade,false);assert.equal(a.fillEvidence.verifiedLive,false);
 assert.deepEqual(a.fillEvidence,o.fillEvidence);
 q.quoteAt=initialTime;q.source='imported';
 assert.deepEqual(x.make().read().account.events[0].fillEvidence,a.fillEvidence);
 assert.equal(x.app.legacy().trades[0].t,initialTime);
 assert.equal(x.app.legacy().positions['600000'].buyTs,initialTime);
});

test('new fills retain known order references and mode in the unified read-only view',t=>{
 const x=setup(t);manual(x);const view=x.view(),event=view.events[0];
 assert.equal(event.orderId,x.order.orderId);assert.equal(event.source,'paper-order-account');
 assert.equal(event.t,initialTime);assert.equal(event.quoteAt,initialTime-30000);
 assert.equal(event.mode,'simulated');assert.equal(event.provider,'fixture-provider');
 assert.equal(event.timeQuality,'known');assert.equal(view.linkedFillCount,1);
 assert.equal(view.canSubmitOrders,false);assert.equal(view.canCancelOrders,false);
 assert.equal(view.historicalOrdersAvailable,false,'a linked new fill must not invent missing old order histories');
 const input=x.app.legacy(),copy=projectPaperAccount(input,{accountId:'pool',initialCash:100000});
 copy.events[0].fillEvidence.provider='changed-view';
 assert.equal(input.trades[0].fillEvidence.provider,'fixture-provider','projection metadata must not alias input evidence');
});

test('automatic legacy fills preserve the exact execution time and public quote inputs without certification',t=>{
 const x=setup(t),book=x.app.read(),legacy=x.app.legacy();
 const trade={t:initialTime,side:'买入',code:'600000',price:10,shares:100,amount:1000,fee:5,pnl:null,reason:'fixture automatic'};
 const q={...x.quote(),source:undefined,mode:'public-live-unverified',timestamp:initialTime-1000,quoteAt:initialTime-1000,receivedAt:initialTime-500};
 const updated=x.app.saveLegacy({...legacy,cash:98995,positions:{'600000':{code:'600000',shares:100,buyTs:initialTime,buyPrice:10,basis:1005}},trades:[trade]},book.revision,{quotes:{'600000':q}});
 const event=updated.account.events[0];
 assert.equal(event.fillEvidence.executionKind,'automatic-paper');assert.equal(event.fillEvidence.executionAt,initialTime);
 assert.equal(event.fillEvidence.provider,'fixture-provider');assert.equal(event.fillEvidence.mode,'public-live-unverified');
 assert.equal(event.fillEvidence.quoteAt,q.timestamp);assert.equal(event.fillEvidence.canTrade,false);
 assert.equal(x.make().legacy().trades[0].t,initialTime);assert.equal(x.view().events[0].orderId,event.orderId);
});

test('a retry never advances execution time or duplicates cash, fees or proof after restart',t=>{
 const x=setup(t),{book,q}=manual(x),raw=fs.readFileSync(x.file);x.advance(90000);
 const retry=x.make().fill(x.order.orderId,'fill-one',q);
 assert.equal(retry.revision,book.revision);assert.equal(retry.account.events.length,1);
 assert.equal(retry.account.cash,98995);assert.equal(retry.account.events[0].fillEvidence.executionAt,initialTime);
 assert.deepEqual(fs.readFileSync(x.file),raw);
 assert.throws(()=>x.app.fill(x.order.orderId,'fill-one',{...q,quoteSource:'different'}),/冲突/);
 assert.deepEqual(fs.readFileSync(x.file),raw);
 x.app.submit({...x.order,orderId:'different-order'});const secondRaw=fs.readFileSync(x.file);
 assert.throws(()=>x.app.fill('different-order','fill-one',q),/冲突/,'event IDs remain unique across orders');
 assert.deepEqual(fs.readFileSync(x.file),secondRaw);
});

test('old snapshots and old request hashes stay readable and idempotent without invented missing evidence',t=>{
 const x=setup(t),{book,q}=manual(x),a=book.account.events[0],o=book.orders[x.order.orderId].events[0];
 delete a.fillEvidence;delete a.timestamp;delete o.fillEvidence;delete o.timestamp;
 delete book.fillEvidenceVersion;delete book.legacyFillEvidenceCount;
 book.account.eventHashes[a.eventId]=hash({orderId:o.orderId,fill:o,tradeDate:o.date});
 rewrite(x.file,book);const raw=fs.readFileSync(x.file);
 assert.equal(x.make().read().account.events[0].fillEvidence,undefined);
 const legacy=x.make().legacy(),trade=legacy.trades[0];
 assert.equal(trade.t,null);assert.equal(trade.tradeDate,'2026-11-05');assert.equal(trade.timeQuality,'date-only');
 assert.equal(legacy.positions['600000'].buyTs,null);assert.equal(legacy.positions['600000'].buyDate,'2026-11-05');
 const view=x.view();assert.equal(view.events[0].t,null);assert.equal(view.events[0].quoteAt,null);
 assert.equal(view.events[0].mode,'unknown');assert.equal(view.events[0].orderId,x.order.orderId);
 assert.equal(x.make().fill(x.order.orderId,'fill-one',q).revision,book.revision);
 assert.deepEqual(fs.readFileSync(x.file),raw,'retry must not silently backfill original evidence');
 x.advance(60000);x.app.submit({...x.order,orderId:'new-format-order'});
 x.app.fill('new-format-order','new-format-fill',{...x.quote(),volume:20000});
 const mixed=x.make().read();assert.equal(mixed.fillEvidenceVersion,1);assert.equal(mixed.legacyFillEvidenceCount,1);
 assert.equal(mixed.account.events[0].fillEvidence,undefined);assert.equal(mixed.account.events[1].fillEvidence.schemaVersion,1);
 assert.equal(x.make().legacy().trades[1].t,null,'new-format adoption does not rewrite an old unknown clock');
});

test('provider labels retain original Unicode text while receive time remains unknown when absent',t=>{
 const x=setup(t);x.app.submit(x.order);
 const quote={...x.quote(),source:'imported',quoteSource:'研究样例：一号'};delete quote.receivedAt;
 const event=x.app.fill(x.order.orderId,'imported-evidence',quote).account.events[0];
 assert.equal(event.fillEvidence.provider,'研究样例：一号');assert.equal(event.fillEvidence.mode,'imported');
 assert.equal(event.fillEvidence.receivedAt,null);assert.equal(x.make().read().account.events[0].fillEvidence.receivedAt,null);
});

test('automatic raw-trade replay reuses its original event without duplicating a fee or evidence',t=>{
 const x=setup(t),legacy=x.app.legacy();
 const trade={t:initialTime,side:'买入',code:'600000',price:10,shares:100,amount:1000,fee:5,pnl:null,reason:'automatic replay'};
 const input={...legacy,cash:98995,positions:{'600000':{code:'600000',shares:100,buyTs:initialTime,buyPrice:10,basis:1005}},trades:[trade]};
 const q={...x.quote(),timestamp:initialTime-1000,quoteAt:initialTime-1000,receivedAt:null};
 const first=x.app.saveLegacy(input,x.app.read().revision,{quotes:{'600000':q}});x.advance(200000);
 const retry=x.make().saveLegacy(input,first.revision,{quotes:{}});
 assert.equal(retry.account.cash,first.account.cash);assert.equal(retry.account.events.length,1);
 assert.deepEqual(retry.account.events[0].fillEvidence,first.account.events[0].fillEvidence);
});

test('nested evidence and order/account proof mismatch are rejected even when outer hashes are recomputed',t=>{
 const x=setup(t),{book}=manual(x),original=JSON.stringify(book);
 book.account.events[0].fillEvidence.provider='changed';rewrite(x.file,book);
 assert.throws(()=>x.make().read(),/证据/);
 const stripped=JSON.parse(original);
 delete stripped.account.events[0].fillEvidence;delete stripped.account.events[0].timestamp;
 delete stripped.orders[x.order.orderId].events[0].fillEvidence;delete stripped.orders[x.order.orderId].events[0].timestamp;
 rewrite(x.file,stripped);assert.throws(()=>x.make().read(),/证据/,'a new-format event cannot silently downgrade to unknown old history');
 const next=JSON.parse(original),e=next.account.events[0].fillEvidence;
 e.provider='changed';delete e.fingerprint;e.fingerprint=hash(e);rewrite(x.file,next);
 assert.throws(()=>x.make().read(),/证据/);
});

test('conflicting, future or borrowed source clocks fail atomically instead of generating audit proof',t=>{
 for(const patch of [{quoteAt:initialTime},{receivedAt:initialTime+1},{quoteSource:'a',provider:'b'},
  {source:'simulated',mode:'public-live-unverified'}]){
  const x=setup(t);x.app.submit(x.order);const raw=fs.readFileSync(x.file);
  assert.throws(()=>x.app.fill(x.order.orderId,'bad-evidence',{...x.quote(),...patch}),/证据|时点|来源/);
  assert.deepEqual(fs.readFileSync(x.file),raw);
 }
});

test('old dated legacy rows keep known timestamps and do not acquire fabricated order or quote evidence',()=>{
 const legacy={cash:98995,realized:0,positions:{},trades:[{t:initialTime,side:'买入',code:'600000',shares:100,price:10,amount:1000,fee:5,pnl:null}]};
 const first=projectPaperAccount(legacy,{accountId:'pool',initialCash:100000});
 assert.equal(first.events[0].t,initialTime);assert.equal(first.events[0].orderId,null);
 assert.equal(first.events[0].source,'legacy-paper');assert.equal(first.events[0].quoteAt,null);
 assert.equal(first.events[0].mode,'unknown');
 assert.deepEqual(first.events,projectPaperAccount(legacy,{accountId:'pool',initialCash:100000}).events);
});

test('real paper renderer shows date-only and simulated input instead of epoch or invented opening time',()=>{
 const source=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
 const from=source.indexOf('function renderPaper('),to=source.indexOf('// ═══ hj 轮：',from);
 assert.ok(from>=0&&to>from);
 const elements=new Map(),ctx={document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:''});return elements.get(id);}},esc:s=>String(s).replaceAll('<','&lt;')};
 vm.createContext(ctx);vm.runInContext(source.slice(from,to),ctx);
 ctx.renderPaper('Pool',{cash:100000,initial:100000,equity:100000,totalPnl:0,totalPct:0,realized:0,marketValue:0,enabled:false,positions:[],trades:[
  {t:null,tradeDate:'2026-11-05',timeQuality:'date-only',side:'买入',code:'600000',name:'fixture',shares:100,price:10},
  {t:initialTime,side:'买入',code:'600000',name:'fixture',shares:100,price:10,fillEvidence:{mode:'simulated'}}]},false);
 const html=elements.get('ppPoolTrades').innerHTML;
 assert.match(html,/2026-11-05（时刻未知）/);assert.match(html,/模拟输入/);
 assert.doesNotMatch(html,/1970|Invalid Date|09:30/);
});

test('date-only positions remain T+1 locked without synthesizing a buy timestamp',()=>{
 const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const from=source.indexOf('function paperT1Locked('),to=source.indexOf('// 从某个时刻',from);
 const ctx={todayStr:()=> '20261105',dayKeyOf:()=>assert.fail('known date must not borrow a timestamp')};
 vm.createContext(ctx);vm.runInContext(source.slice(from,to),ctx);
 assert.equal(ctx.paperT1Locked({buyDate:'2026-11-05',buyTs:null}),true);
 assert.equal(ctx.paperT1Locked({buyDate:'2026-11-04',buyTs:null}),false);
});

test('automatic expiry uses an explicit buy date without claiming a known execution clock',()=>{
 const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const from=source.indexOf('function paperCheck(key, pm)'),to=source.indexOf('function paperCheckAll(',from);
 const position={code:'600000',name:'fixture',buyPrice:10,buyDate:'2026-11-04',buyTs:null,shares:100,peak:0},sells=[];
 const ctx={PAPER_CFG:{pool:{tp:.1,sl:-.03,expireDays:5}},PAPER:{pool:{enabled:true,positions:{'600000':position}}},
  paperPxFresh:()=>10.05,tradeDaysSince:ts=>{assert.equal(ts,Date.parse('2026-11-04T12:00:00+08:00'));return 7;},
  paperT1Locked:()=>false,isLimitDownPrice:()=>false,effStopOf:()=>-.03,linkedStop:()=>-.03,
  paperSell:(...args)=>sells.push(args),paperTouch:()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(from,to),ctx);ctx.paperCheck('pool',new Map());
 assert.equal(sells.length,1);assert.match(sells[0][3],/买入日期2026-11-04，具体时刻未知/);
 assert.doesNotMatch(sells[0][3],/自然日已过|1970/);assert.equal(position.buyTs,null);
});
