'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createOpenFixture}=require('./helpers/v6-studio-fixture');

test('native plan and score routes retain editor and same-origin controls; HTTP price injection cannot change either ledger', {timeout:45000},async t=>{
  const f=await createOpenFixture({count:1});t.after(()=>f.close());
  const endpoint='/api/paper/execution-score?date=2026-11-16';
  const initial=await f.request('/api/paper');assert.equal(initial.body.ok,true);
  assert.equal(initial.body.paper.pool.executionPolicy.allocationPct,19.6);
  const file=path.join(f.tmp,'data/order-accounts/pool.json'),before=fs.readFileSync(file);
  for(const token of ['',f.viewerToken]){
    assert.notEqual((await f.request(endpoint,'GET',null,token)).body?.ok,true);
    assert.notEqual((await f.request('/api/paper','POST',{action:'preparePlan',account:'pool',code:'600000',day:'2026-11-16',decisionId:'a'.repeat(64)},token)).body?.ok,true);
    assert.notEqual((await f.request('/api/paper','POST',{action:'executePlan',account:'pool',planId:'plan-00000000-0000-4000-8000-000000000001'},token)).body?.ok,true);
  }
  const read=await f.request(endpoint);assert.equal(read.status,200,JSON.stringify(read.body));
  assert.match(read.headers['cache-control'],/no-store/);assert.equal(read.body.paper.pool.score,null);assert.equal(read.body.paper.pool.status,'待收盘');
  assert.notEqual((await f.request('/api/paper/execution-score?date=2026-11-15')).body?.ok,true);
  const input={action:'preparePlan',account:'pool',code:'600000',day:'2026-11-16',decisionId:'a'.repeat(64),price:1};
  const rejected=await f.request('/api/paper','POST',input);assert.equal(rejected.body.ok,false);assert.match(rejected.body.error,/只接受股票/);
  const cross=await new Promise((resolve,reject)=>{
    const body=JSON.stringify(input),req=http.request({hostname:'127.0.0.1',port:f.port,path:'/api/paper',method:'POST',headers:{
      Authorization:'Bearer '+f.token,Origin:'https://not-the-app.invalid','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      res.resume();res.once('end',()=>resolve(res.statusCode));
    });req.once('error',reject);req.end(body);
  });assert.equal(cross,403);
  assert.deepEqual(fs.readFileSync(file),before);
  assert.equal(fs.existsSync(path.join(f.tmp,'data/shortline-research/research.json')),false,'read-only score does not create a research record');
});

test('HTTP preparation binds the current server decision, and confirmed retries reuse one original durable fill', {timeout:45000},async t=>{
  const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const entry='function handle(req, res, u, body) {',projection="sharedMarketRead('state',includePrivate)";
  assert.equal(source.split(entry).length,2);assert.equal(source.split(projection).length,2);
  // Seed only this disposable copy's upstream facts. The actual decision center,
  // native plan routes, workspace lock and original account gates stay intact.
  const seeded=source.replace(entry,entry+`
    if(!S.paperPlanHttpSeeded){
      S.paperPlanHttpSeeded=true;
      const day='2026-11-16',at=Date.now();
      const row={code:'600000',name:'隔离链路验证',price:10.4,pct:4,preClose:10,open:10.3,high:10.6,low:10.2,
        volume:1000000,amount:10400000,score:88,paths:['横盘放量'],pathWhy:{横盘放量:'原策略已有量价条件'},
        poolDay:day,sector:'芯片',quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,canNotify:true,
        quoteAt:at-1000,receivedAt:at-500};
      S.stocks=[row];S.stocksAt=at-500;S.candidatePool=[row];ingestPx([row]);
      const rows=Array.from({length:30},(_,i)=>({date:new Date(Date.parse(day)-(29-i)*86400000).toISOString().slice(0,10),
        open:10.2,high:11,low:10,close:10.2,volume:100000,amount:1020000}));
      klineSet(row.code,{rows,src:'tencent',adjust:'qfq',receivedAt:at-2000});
    }
  `).replace(projection,`({...sharedMarketRead('state',includePrivate),
    marketDistribution:{kind:'market-distribution-intraday',source:'打板客',scope:'沪深京 A 股',day:'2026-11-16',
      quoteAt:Date.now()-30000,knownAt:Date.now()-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
    dabanke:{day:'2026-11-16',knownAt:Date.now()-20000,ecology:[{label:'当日封板',success:70,total:90}]}})`);
  const f=await createOpenFixture({count:1,serverSource:seeded});t.after(()=>f.close());
  fs.copyFileSync(path.join(root,'config/intelligence-center.json'),path.join(f.tmp,'config/intelligence-center.json'));
  const decision=await f.request('/api/decision-center');assert.equal(decision.body.ok,true);
  assert.equal(decision.body.cards.length,1,JSON.stringify(decision.body.reasons));
  const card=decision.body.cards[0],file=path.join(f.tmp,'data/order-accounts/pool.json'),before=fs.readFileSync(file);
  const body={action:'preparePlan',account:'pool',code:card.code,day:card.day,decisionId:card.decisionId};
  const prepared=await f.request('/api/paper','POST',body);assert.equal(prepared.body.ok,true,JSON.stringify(prepared.body));
  const plan=prepared.body.plan;assert.equal(plan.entryMin,card.plan.buyLow);assert.equal(plan.entryMax,card.plan.buyHigh);
  assert.equal(plan.decisionAuthority,'fayo-decision-center');assert.equal(plan.decisionId,card.decisionId);
  assert.equal(plan.decisionEvidence.quoteBasis.quoteAt,card.quoteBasis.quoteAt);
  assert.deepEqual(fs.readFileSync(file),before,'preparation cannot purchase a position');
  const reuse=await f.request('/api/paper','POST',body);assert.equal(reuse.body.reused,true);assert.equal(reuse.body.plan.id,plan.id);
  const execute={action:'executePlan',account:'pool',planId:plan.id};
  const first=await f.request('/api/paper','POST',execute);assert.equal(first.body.status,'executed',JSON.stringify(first.body));
  assert.equal(first.body.price,card.plan.buyHigh);assert.ok(first.body.shares>=100);assert.ok(first.body.eventId);
  const committed=fs.readFileSync(file),book=JSON.parse(committed);assert.equal(book.account.events.length,1);
  const retry=await f.request('/api/paper','POST',execute);assert.equal(retry.body.status,'already-executed',JSON.stringify(retry.body));
  assert.equal(retry.body.eventId,first.body.eventId);assert.deepEqual(fs.readFileSync(file),committed);
});
