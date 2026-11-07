'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {createTradingCalendar}=require('../src/core/trading-calendar');
const {createSmsGateway}=require('../src/server/sms-otp');
const {createMarketFailover}=require('../src/core/market-failover');
const {ledgerBacktest}=require('../src/strategy/research-v2-position-ledger-backtest');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
const {reconcileAccount}=require('../src/core/account-reconciliation');
const {performanceStatistics}=require('../src/core/performance-statistics');
function history(n=65){return {source:'fixture',asOf:'2026-04-30',stocks:[{symbol:'000001',market:'main',volumeUnit:'shares',bars:Array.from({length:n},(_,i)=>{const p=10+i*.03;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.2,low:p-.2,close:p+.05,volume:100000,amount:1000000};})}]};}
function calendar(){return {schemaVersion:1,exchange:'SSE',source:'explicit-test-fixture-not-official',from:'2026-01-01',to:'2026-01-03',sessions:[{date:'2026-01-01',open:false},{date:'2026-01-02',open:true},{date:'2026-01-03',open:false}]};}
test('calendar fails on unknown coverage, omitted dates, closed sessions and duplicate dates',()=>{
 const c=createTradingCalendar(calendar());assert.equal(c.isOpen('2026-01-02'),true);assert.equal(c.metadata.verifiedExternal,false);
 assert.throws(()=>c.isOpen('2026-01-04'));assert.throws(()=>c.assertDates(['2026-01-01']));
 const x=calendar();x.sessions.pop();assert.throws(()=>createTradingCalendar(x));
 const y=calendar();y.sessions.push(y.sessions[0]);assert.throws(()=>createTradingCalendar(y));
});
test('SMS adapter passes idempotency and expiry, never certifies delivery or returns provider secrets',async()=>{
 let request;const gateway=createSmsGateway({url:'https://sms.example.org/send',token:'test-secret',template:'reset',fetchImpl:async(u,r)=>{request=r;return {ok:true};}});
 const r=await gateway.send({phone:'13800000000',code:'123456',expiresIn:120,requestId:'a'.repeat(40)});
 assert.equal(r.status,'accepted');assert.equal(r.delivered,false);assert.equal(JSON.parse(request.body).parameters.expiresIn,120);
 assert.equal(request.headers['Idempotency-Key'],'a'.repeat(40));assert.equal(request.redirect,'error');
 const bad=createSmsGateway({url:'https://sms.example.org/send',token:'test',template:'reset',fetchImpl:async()=>{throw Error('secret=123');}});
 await assert.rejects(bad.send({phone:'13800000000',code:'123456',expiresIn:120,requestId:'a'.repeat(40)}),e=>!e.message.includes('123'));
 await assert.rejects(gateway.send({phone:'13800000000',code:'123456',expiresIn:301,requestId:'a'.repeat(40)}));
 assert.throws(()=>createSmsGateway({url:'http://sms.example.org',token:'x',template:'x'}));
});
test('multi-source retry falls back with provenance isolation then labels stale cache',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-fallback-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let down=false,calls=0;const fixture={...history(),source:'imported',provider:'backup-provider',datasetId:'dataset-001'};
 const center=createMarketFailover({directory:dir,retries:1,sources:[{id:'primary',url:'https://primary.example.org/data',provider:'primary-provider',datasetId:'dataset-001'},{id:'backup',url:'https://backup.example.org/data',provider:'backup-provider',datasetId:'dataset-001'}],fetchImpl:async url=>{calls++;if(down||url.includes('primary'))throw Error('offline');return {ok:true,headers:{get:()=>null},body:Readable.from([Buffer.from(JSON.stringify(fixture))])};}});
 const result=await center.sync();assert.equal(result.mode,'fallback');assert.equal(result.provider,'backup-provider');assert.equal(calls,3);assert.equal(fs.existsSync(path.join(dir,'primary.json')),false);
 down=true;const cached=await center.sync();assert.equal(cached.mode,'cached-degraded');assert.equal(cached.stale,true);assert.equal(cached.canTrade,false);
});
test('liquidity caps use previous-day volume, support partial exits and reconcile cash',()=>{
 const stocks=history().stocks;const opts={stocks,start:27,end:40,topN:1,selectCandidates:()=>['000001'],maxParticipationPct:0.1};
 const r=ledgerBacktest(opts);assert.ok(r.orders.some(o=>o.status==='filled'));assert.ok(r.orders.filter(o=>o.status==='filled').every(o=>o.shares<=100));assert.equal(reconcileAccount(r).balanced,true);
 const changed=structuredClone(stocks);changed[0].bars[64].volume=1e12;assert.deepEqual(ledgerBacktest({...opts,stocks:changed}).orders,r.orders);
 const unknown=structuredClone(stocks);delete unknown[0].volumeUnit;assert.equal(ledgerBacktest({...opts,stocks:unknown}).orders.filter(o=>o.status==='filled').length,0);
 const partial=history().stocks;partial[0].bars[29].volume=1000;
 const p=ledgerBacktest({...opts,stocks:partial,maxParticipationPct:10,holdDays:1});assert.ok(p.trades.some(t=>t.shares===100));assert.equal(reconcileAccount(p).balanced,true);
});
test('research v2 applies prior-close drawdown and daily loss without altering disabled behavior',()=>{
 const stocks=history().stocks;for(let i=29;i<stocks[0].bars.length;i++)Object.assign(stocks[0].bars[i],{open:8,high:8.2,low:7.9,close:8});
 const opts={stocks,start:27,end:40,topN:1,holdDays:20,selectCandidates:()=>['000001']};
 assert.ok(ledgerBacktest({...opts,maxDrawdownPausePct:5,maxDailyLossPausePct:5}).metrics.riskPauseDays>0);
 assert.deepEqual(ledgerBacktest(opts).orders,ledgerBacktest({...opts,maxDrawdownPausePct:null,maxDailyLossPausePct:null}).orders);
});
test('performance recomputes known equity and Wilson interval; zero volatility has no Sharpe',()=>{
 const r=performanceStatistics([{value:110},{value:99}],{initialCash:100,trades:[{netPnl:10},{netPnl:-11}]});
 assert.ok(Math.abs(r.returnPct+1)<1e-9);assert.ok(Math.abs(r.maxDrawdownPct-10)<1e-9);assert.equal(r.winRatePct,50);assert.ok(r.winRate95Pct[0]<50&&r.winRate95Pct[1]>50);assert.equal(r.annualizedReturnPct,null);
 assert.equal(performanceStatistics([{value:100},{value:100}],{initialCash:100}).sharpe,null);
});
test('complete workbench links native strategies, backtest, paper and independent cash reconciliation',()=>{
 const r=runCompleteWorkbench({history:history()});assert.equal(r.reconciliation.paper.balanced,true);assert.equal(r.reconciliation.backtest.balanced,true);assert.deepEqual(Object.keys(r.strategies.coverage),['fourteen','bazi','gpt','python']);assert.equal(r.verifiedLive,false);assert.equal(r.strategies.coverage.python.evaluated,0);
 const tampered=structuredClone(r.paper);tampered.cashFlows[0].balance++;assert.throws(()=>reconcileAccount(tampered));
});
test('complete worker terminates on timeout and allows subsequent requests',async()=>{
 const {runResearchJob}=require('../src/server/research-job');const slow=await runResearchJob({history:history()},{timeoutMs:1});assert.equal(slow.ok,false);
 const r=await runResearchJob({history:history()});assert.equal(r.ok,true,r.error);
});
test('explicit corporate cash and share entitlements preserve assets and reconcile, unsupported events fail closed',()=>{
 const stocks=history().stocks;
 const action={type:'cash-and-shares',source:'test-fixture-only',publishedAt:'2026-01-28T00:00:00+08:00',netCashPerShare:0.1,shareMultiplier:2,referenceClose:5,cashDate:stocks[0].bars[29].date,sharesAvailableDate:stocks[0].bars[29].date};
 stocks[0].bars[29].corporateAction=action;
 for(let i=29;i<stocks[0].bars.length;i++)for(const field of ['open','high','low','close'])stocks[0].bars[i][field]/=2;
 const r=ledgerBacktest({stocks,start:27,end:35,topN:1,holdDays:20,selectCandidates:()=>['000001']});
 const distribution=r.cashFlows.find(x=>x.kind==='corporate-action');assert.ok(distribution.amount>0);assert.equal(reconcileAccount(r).balanced,true);assert.ok(r.openPositions[0].shares>100);
 const bad=structuredClone(stocks);bad[0].bars[29].corporateAction.publishedAt='2099-01-01T00:00:00Z';assert.throws(()=>ledgerBacktest({stocks:bad,start:27,end:35}));
});
test('paper fills do not use a later intraday limit unlock to authorize an opening fill',()=>{
 const {replayPaperAccount}=require('../src/core/paper-replay');const d=history();d.source='simulated';
 const pack=require('../strategies/a-share-strategy-pack.json');
 for(const bar of d.stocks[0].bars)bar.factors={...Object.fromEntries(pack.strategies.flatMap(s=>s.rules.map(r=>[r.field,90]))),riskScore:0,amount:1e8};
 for(let i=31;i<65;i++){const bar=d.stocks[0].bars[i];bar.upperLimit=bar.open;}
 const r=replayPaperAccount(d);assert.equal(r.orders.filter(x=>x.status==='filled').length,0);assert.ok(r.orders.some(x=>x.status==='blocked'));
});
