'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const root=process.env.V6_COHERENT_PAPER_TEST_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8'),serverRequire=require('node:module').createRequire(path.join(root,'server.js'));
const {createPaperApplicationService}=serverRequire('./src/core/paper-application-service');
const now=Date.parse('2026-11-06T10:00:00+08:00'),old=now-86400000;
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const wire=(patch={})=>({code:'600000',name:'公开源样本',price:10,preClose:10,volume:100000,quoteSource:'tencent',quoteAt:now-1000,receivedAt:now-500,quoteMode:'public-live-unverified',canTrade:true,...patch});
function section(begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function harness(t,{stocks=[wire({quoteAt:old,receivedAt:old+500,volume:1,preClose:20,suspended:true,tradable:false})],holdings=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-same-row-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'pool.json'),app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>d==='2026-11-06'}});
 app.adoptLegacy({initial:holdings?11000:10000,cash:10000,realized:0,enabled:true,positions:holdings?{'600000':{code:'600000',name:'持仓样本',shares:100,buyTs:old,buyPrice:10,basis:1000}}:{},trades:[]});
 const notices=[],skips=[],failures=[];
 const context={S:{lastPx:new Map(),stocks,stocksAt:now,candidatePool:[],trendPool:[],ztCodes:new Set()},PAPER:{pool:app.legacy()},PAPER_CFG:{pool:{name:'fixture',initial:10000,maxPos:1}},_paperAuthority:{pool:app},_paperAuthorityRevision:{pool:app.read().revision},PAPER_FILE:path.join(dir,'paper.json'),Date:Clock,Map,require:serverRequire,console:{error(){}},
  isReplica:()=>false,isContinuousTrading:()=>true,limitPctOfCode:()=>.1,paperFeeAmount:(_key,side,amount)=>side==='sell'?Math.round((5+amount*.0005)*100)/100:5,paperT1Locked:()=>false,paperLotOf:()=>100,paperEquity:()=>10000,A:{isLimitUp:()=>false},skipAdd:k=>skips.push(k),numNeutral:()=>0,dataCapOf:()=>100,pushPaperDigest:m=>notices.push(m),atomicWrite:(p,s)=>{fs.writeFileSync(p,s);return true;},_diskFail:m=>{failures.push(m);return false;}};
 context.refreshPaperAuthority=force=>{if(force){context.PAPER.pool=app.legacy();context._paperAuthorityRevision.pool=app.read().revision;}};
 vm.createContext(context);
 vm.runInContext([section('function paperAuthorityQuotes(){','refreshPaperAuthority();'),section("function savePaper(action=",'// ---------------- 模拟盘对账'),section('function ingestPx(rows)','function paperEquity(key, pm)'),section('function paperBuy(key, cands, pm, reasonOf)','// ---------------- A股 T+1'),section('function paperSell(key, code, price, reason)','// 收益联动')].join('\n'),context);
 const buy=()=>context.paperBuy('pool',[wire({price:99})],new Map([['600000',99]]),()=> 'same row');
 return {c:context,app,file,notices,skips,failures,buy};
}
test('ingest preserves a bounded independent raw execution row without fabricating field clocks',t=>{
 const x=harness(t),row=wire({unrelated:{payload:'x'.repeat(10000)}});x.c.ingestPx([row]);
 const cached=x.c.S.lastPx.get(row.code);assert.ok(cached.wireQuote);assert.ok(JSON.stringify(cached.wireQuote).length<2000);
 assert.equal(cached.wireQuote.unrelated,undefined);assert.equal(cached.wireQuote.canTrade,true);assert.equal(cached.wireQuote.canNotify,undefined);
 row.volume=1;row.preClose=30;row.suspended=true;assert.equal(cached.wireQuote.volume,100000);assert.equal(cached.wireQuote.preClose,10);assert.equal(cached.wireQuote.suspended,undefined);
 const q=x.c.paperAuthorityQuotes()[row.code];for(const input of [q.inputProvenance.volume,q.inputProvenance.limits.preClose,q.inputProvenance.status.suspended]){
  assert.equal(input.origin,'S.lastPx.wireQuote');assert.equal(input.quoteAt,null);assert.equal(input.receivedAt,null);assert.equal(input.rowQuoteAt,now-1000);
 }
 assert.equal(q.inputProvenance.status.suspended.defaulted,true);assert.equal(q.suspended,false);assert.equal(q.tradable,true);
 x.c.ingestPx([wire({name:'x'.repeat(241)})]);assert.equal(x.c.S.lastPx.get(row.code).wireQuote,null,'oversized selected fields cannot be retained as an execution row');
});
test('full cached row capacity and limit/status inputs are independent of stale stock-list changes through actual buy and save',t=>{
 for(const volume of [1,100000000]){
  const x=harness(t);x.c.S.stocks[0].volume=volume;x.c.ingestPx([wire()]);x.buy();const book=x.app.read(),proof=book.account.events[0]?.fillEvidence;
  assert.equal(book.account.events.length,1);assert.equal(book.account.cash,995);assert.equal(book.account.positions['600000'].quantity,900);
  assert.equal(proof.volume,10000000);assert.equal(proof.upperLimit,11);assert.equal(proof.suspended,false);assert.equal(proof.tradable,true);
  assert.equal(proof.inputProvenance.price.origin,'S.lastPx.wireQuote');assert.equal(proof.inputProvenance.volume.source,'tencent');assert.equal(x.notices.length,1);
  assert.equal(x.c.PAPER.pool.cash,book.account.cash);assert.equal(x.failures.length,0);
 }
});
test('price-only legacy cache marks holdings but cannot authorize automatic buy from stale stock execution fields',t=>{
 const x=harness(t),before=fs.readFileSync(x.file);x.c.S.lastPx.set('600000',{p:10,t:now,quoteAt:now-1000,quoteSource:'tencent'});
 assert.equal(x.c.paperPrices().get('600000'),10);assert.equal(x.c.paperPxFresh('600000'),10);assert.equal(x.c.paperAuthorityQuotes()['600000'],undefined);
 x.buy();assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.deepEqual(Object.keys(x.c.PAPER.pool.positions),[]);assert.equal(x.c.PAPER.pool.trades.length,0);assert.equal(x.notices.length,0);assert.deepEqual(x.skips,['buyStalePrice']);
});
test('incomplete fresh cache falls back to a complete fresh stock row as a whole',t=>{
 for(const patch of [{volume:undefined},{preClose:undefined},{volume:0},{preClose:Infinity},{receivedAt:now+1},{receivedAt:now-2000},{receivedAt:0}]){
  const stock=wire({price:9.8,volume:100000,quoteSource:'eastmoney',quoteAt:now-2000,receivedAt:now-1000}),x=harness(t,{stocks:[stock]});x.c.ingestPx([wire(patch)]);
  const q=x.c.paperAuthorityQuotes()['600000'];assert.equal(q.price,9.8);assert.equal(q.quoteSource,'eastmoney');assert.equal(q.quoteAt,stock.quoteAt);assert.equal(q.inputProvenance.volume.origin,'S.stocks');
  x.buy();assert.equal(x.app.read().account.events[0].price,9.8);assert.equal(x.app.read().account.events[0].fillEvidence.volume,10000000);
 }
});
test('missing execution fields reject automatic buy while complete cached holdings outside the stock list remain executable',t=>{
 for(const patch of [{volume:undefined},{preClose:undefined},{volume:0},{preClose:0}]){
  const x=harness(t),before=fs.readFileSync(x.file);x.c.ingestPx([wire(patch)]);x.buy();assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.notices.length,0);
 }
 const x=harness(t,{stocks:[]});x.c.ingestPx([wire()]);x.buy();assert.equal(x.app.read().account.events.length,1);assert.equal(x.app.read().account.cash,995);
});
test('saveLegacy rejects missing execution quote atomically and savePaper restores pre-mutated legacy financial state',t=>{
 const x=harness(t),before=fs.readFileSync(x.file),legacy=x.app.legacy(),trade={t:now,side:'买入',code:'600000',price:10,shares:100,amount:1000,fee:5};
 const proposed={...legacy,cash:8995,positions:{'600000':{code:'600000',shares:100,buyTs:now,buyPrice:10,basis:1005}},trades:[trade]};
 assert.throws(()=>x.app.saveLegacy(proposed,x.app.read().revision,{quotes:{}}),/自动成交行情缺失/);assert.deepEqual(fs.readFileSync(x.file),before);
 x.c.PAPER.pool=proposed;assert.equal(x.c.savePaper('sync','pool'),false);assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.c.PAPER.pool.trades.length,0);assert.deepEqual(Object.keys(x.c.PAPER.pool.positions),[]);assert.equal(x.notices.length,0);
});
test('authority write failure rolls real paperBuy mutations back and does not send a notice',t=>{
 const x=harness(t),before=fs.readFileSync(x.file);x.c.ingestPx([wire({volume:100})]);x.buy();
 assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.c.PAPER.pool.trades.length,0);assert.deepEqual(Object.keys(x.c.PAPER.pool.positions),[]);assert.equal(x.notices.length,0);assert.equal(x.failures.length,1);
});

test('sell uses the complete row price even when a distinct price-only mark falls inside legacy price tolerance',t=>{
 const x=harness(t,{stocks:[wire()],holdings:true});x.c.S.lastPx.set('600000',{p:10.005,t:now,quoteAt:now-500,quoteSource:'tencent'});
 assert.equal(x.c.paperPxFresh('600000'),10.005);x.c.paperSell('pool','600000',10.005,'test sell');
 const book=x.app.read(),proof=book.account.events[0].fillEvidence;assert.equal(book.account.events[0].price,10);assert.equal(proof.quotePrice,10);assert.equal(proof.inputProvenance.price.origin,'S.stocks');
 assert.equal(book.account.cash,10994.5);assert.equal(x.notices.length,1);
});
test('sell with only a price mark leaves holdings intact and old pre-mutated sell state is rolled back on missing quote',t=>{
 const x=harness(t,{holdings:true}),before=fs.readFileSync(x.file);x.c.S.lastPx.set('600000',{p:10,t:now,quoteAt:now-1000,quoteSource:'tencent'});
 x.c.paperSell('pool','600000',10,'price only');assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.c.PAPER.pool.positions['600000'].shares,100);assert.equal(x.notices.length,0);
 const oldStyle={...x.app.legacy(),cash:10994.5,realized:-5.5,positions:{},trades:[{t:now,side:'卖出',code:'600000',price:10,shares:100,amount:1000,fee:5.5,basis:1000,pnl:-5.5}]};
 x.c.PAPER.pool=oldStyle;assert.equal(x.c.savePaper('sync','pool'),false);assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.c.PAPER.pool.realized,0);assert.equal(x.c.PAPER.pool.positions['600000'].shares,100);assert.equal(x.c.PAPER.pool.trades.length,0);assert.equal(x.notices.length,0);
});
