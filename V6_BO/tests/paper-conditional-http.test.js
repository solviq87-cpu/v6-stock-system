'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createFixture}=require('./helpers/v6-studio-fixture');
const day='2026-11-16',start=Date.parse(day+'T14:00:00+08:00');

async function fixture(t,{price=10.4,chaseRisk=false}={}){
  const root=path.resolve(__dirname,'..'),clockDir=fs.mkdtempSync(path.join(os.tmpdir(),'condition-http-clock-')),clockFile=path.join(clockDir,'clock');
  fs.writeFileSync(clockFile,String(start));
  const original=fs.readFileSync(path.join(root,'server.js'),'utf8'),entry='function handle(req, res, u, body) {',projection="sharedMarketRead('state',includePrivate)";
  assert.equal(original.split(entry).length,2);assert.equal(original.split(projection).length,2);
  const source=original.replace(entry,entry+`
    if(!S.conditionHttpSeeded){
      S.conditionHttpSeeded=true;const at=Date.now();
      const scale=${price}/10.4,priorHigh=${chaseRisk?11:11.6}*scale;
      const row={code:'600000',name:'条件链路隔离样本',price:${price},pct:4,preClose:10*scale,open:10.3*scale,high:${chaseRisk?10.6:10.4}*scale,low:10.2*scale,
        volume:1000000,amount:10400000*scale,score:88,paths:['横盘放量'],pathWhy:{横盘放量:'原策略量价条件'},poolDay:'${day}',
        sector:'芯片',quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,canNotify:true,quoteAt:at-1000,receivedAt:at-500};
      S.stocks=[row];S.stocksAt=at-500;S.candidatePool=[row];ingestPx([row]);
      const rows=Array.from({length:30},(_,i)=>({date:new Date(Date.parse('${day}')-(29-i)*86400000).toISOString().slice(0,10),
        open:10.2*scale,high:i===29?row.high:priorHigh,low:10*scale,close:10.2*scale,volume:100000,amount:1020000*scale}));
      klineSet(row.code,{rows,src:'tencent',adjust:'qfq',receivedAt:at-2000});
    }
  `).replace(projection,`({...sharedMarketRead('state',includePrivate),
    marketDistribution:{kind:'market-distribution-intraday',source:'打板客',scope:'沪深京 A 股',day:'${day}',
      quoteAt:Date.now()-30000,knownAt:Date.now()-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
    dabanke:{day:'${day}',knownAt:Date.now()-20000,ecology:[{label:'当日封板',success:70,total:90}]}})`)
  .replace("  if (p === '/api/state') {",`
  // Test driver exists only in this disposable source copy, never production.
  if(p==='/__fixture/conditional-tick'){
    if(!requireEditor(res,req.__tok,req))return;
    return runPaperConditionalOrders().then(result=>json(res,{ok:true,result},req)).catch(error=>json(res,{ok:false,error:error.message},req));
  }
  if(p==='/__fixture/quote'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;const input=JSON.parse(body),at=Date.now(),age=input.ageMs??1000;
    const row={...S.stocks[0],price:input.price,quoteAt:at-age,receivedAt:at-Math.min(age,500)};
    S.stocks=[row];ingestPx([row]);return json(res,{ok:true},req);
  }
  if(p==='/__fixture/candidate'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;const input=JSON.parse(body);
    if(input.action==='rebatch')S.candidatePool=S.candidatePool.map(row=>({...row,conditionInputs:[{producer:'isolated-test-driver',evaluatedAt:Date.now()-100}]}));
    else if(input.action==='clear')S.candidatePool=[];
    else return json(res,{ok:false},req);
    return json(res,{ok:true},req);
  }
  if(p==='/__fixture/native-fill-other'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    const at=Date.now(),source=S.stocks[0],others=Array.from({length:5},(_,index)=>({...source,code:String(600001+index),
      name:'隔离原账户持仓'+index,price:10,pct:0,preClose:10,high:10,low:10,quoteAt:at-100,receivedAt:at-50}));
    S.stocks=[source,...others];ingestPx(others);paperBuy('pool',others,paperPrices(),()=> '隔离原买入链路持仓');
    return json(res,{ok:true,positions:Object.keys(PAPER.pool.positions).length,events:_paperAuthority.pool.read().account.events.length},req);
  }
  if(p==='/__fixture/native-sell'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    paperSell('pool','600000',paperPxFresh('600000'),'隔离原卖出链路核验');
    return json(res,{ok:true,positions:Object.keys(PAPER.pool.positions).length,events:_paperAuthority.pool.read().account.events.length},req);
  }
  if(p==='/__fixture/native-rebuy'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    paperBuy('pool',[S.stocks[0]],paperPrices(),()=> '隔离同股新轮次');
    return json(res,{ok:true,positions:Object.keys(PAPER.pool.positions).length,events:_paperAuthority.pool.read().account.events.length},req);
  }
  if (p === '/api/state') {`);
  let f;
  try{f=await createFixture({count:1,serverSource:source,clockFile});}
  catch(error){fs.rmSync(clockDir,{recursive:true,force:true});throw error;}
  t.after(async()=>{await f.close();fs.rmSync(clockDir,{recursive:true,force:true});});
  fs.copyFileSync(path.join(root,'config/intelligence-center.json'),path.join(f.tmp,'config/intelligence-center.json'));
  return {...f,clockFile,book:path.join(f.tmp,'data/order-accounts/pool.json'),
    queueFile:path.join(f.tmp,'data/paper-conditional-orders/conditional-orders.json')};
}
async function prepare(f){
  const decision=await f.request('/api/decision-center');assert.equal(decision.body.ok,true);
  assert.equal(decision.body.cards.length,1,JSON.stringify(decision.body));const card=decision.body.cards[0];
  assert.equal(card.plan.riskReward.status,'meets-gross-discipline');assert.ok(card.plan.riskReward.ratio>=2);
  const prepared=await f.request('/api/paper','POST',{action:'preparePlan',account:'pool',code:card.code,day:card.day,decisionId:card.decisionId});
  assert.equal(prepared.body.ok,true,JSON.stringify(prepared.body));return prepared.body.plan;
}
const queue=(f,planId,requestId='http-conditional-001',token=f.token)=>f.request('/api/paper','POST',{action:'queuePlan',account:'pool',planId,requestId},token);
// The condition must see a new provider observation after the frozen plan.
// Keep the initial pre-freeze quote in the fixture to exercise the rejection.
async function refreshAfterFreeze(f,plan,price=10.4){
  const now=Math.max(Number(fs.readFileSync(f.clockFile,'utf8')),Date.parse(plan.frozenAt)+2000);
  fs.writeFileSync(f.clockFile,String(now));
  const updated=await f.request('/__fixture/quote','POST',{price});assert.equal(updated.body.ok,true);
}

test('real HTTP queue is private, read-only until explicitly created, and the background adapter commits once through the original ledger',{timeout:45000},async t=>{
  const f=await fixture(t),before=fs.readFileSync(f.book);
  assert.equal((await f.request('/api/paper/conditional-orders')).body.orders.length,0);
  assert.equal(fs.existsSync(f.queueFile),false);
  for(const token of ['',f.viewerToken]){
    assert.notEqual((await f.request('/api/paper/conditional-orders','GET',null,token)).body?.ok,true);
    assert.notEqual((await queue(f,'plan-00000000-0000-4000-8000-000000000001','denied-request',token)).body?.ok,true);
  }
  assert.equal(fs.existsSync(f.queueFile),false);
  const plan=await prepare(f);
  const bad=await f.request('/api/paper','POST',{action:'queuePlan',account:'pool',planId:plan.id,requestId:'bad-price-001',price:1});
  assert.equal(bad.body.ok,false);assert.equal(fs.existsSync(f.queueFile),false);
  const created=await queue(f,plan.id);assert.equal(created.body.ok,true,JSON.stringify(created.body));
  assert.equal(created.body.order.status,'pending');assert.equal(Object.hasOwn(created.body.order,'authorization'),false);
  assert.deepEqual(fs.readFileSync(f.book),before,'queue creation never reserves cash or writes a fill');
  assert.equal(fs.readFileSync(f.queueFile,'utf8').includes(f.token),false,'no reusable bearer credential on disk');
  fs.writeFileSync(f.clockFile,String(start+1000));
  const retry=await queue(f,plan.id);assert.equal(retry.body.ok,true,JSON.stringify(retry.body));assert.equal(retry.body.order.id,created.body.order.id);
  const preFreeze=await f.request('/__fixture/conditional-tick');assert.equal(preFreeze.body.ok,true);
  assert.equal(preFreeze.body.result.orders[0].status,'pending');assert.match(preFreeze.body.result.orders[0].lastReason,/完整报价/);
  assert.deepEqual(fs.readFileSync(f.book),before,'a fresh but pre-freeze price cannot trigger an order');
  await refreshAfterFreeze(f,plan);
  const tick=await f.request('/__fixture/conditional-tick');assert.equal(tick.body.ok,true,JSON.stringify(tick.body));
  assert.equal(tick.body.result.orders[0].status,'executed',JSON.stringify(tick.body.result));
  const committed=fs.readFileSync(f.book);assert.equal(JSON.parse(committed).account.events.length,1);
  await f.request('/__fixture/conditional-tick');await queue(f,plan.id);assert.deepEqual(fs.readFileSync(f.book),committed);
  const score=await f.request('/api/paper/execution-score?date='+day);assert.equal(score.body.ok,true);
  assert.equal(score.body.paper.pool.rows[0].planId,plan.id);
});

test('outside-range and stale prices keep a durable intent waiting; cancellation cannot later fill',{timeout:45000},async t=>{
  const f=await fixture(t),plan=await prepare(f),before=fs.readFileSync(f.book);
  const created=await queue(f,plan.id);assert.equal(created.body.ok,true,JSON.stringify(created.body));
  await refreshAfterFreeze(f,plan,10.8);
  const outside=await f.request('/__fixture/conditional-tick');assert.equal(outside.body.result.orders[0].status,'pending');
  assert.match(outside.body.result.orders[0].lastReason,/买入区间/);assert.deepEqual(fs.readFileSync(f.book),before);
  fs.writeFileSync(f.clockFile,String(start+30000));
  await f.request('/__fixture/quote','POST',{price:10.4,ageMs:20000});
  const stale=await f.request('/__fixture/conditional-tick');assert.equal(stale.body.result.orders[0].status,'pending');
  assert.match(stale.body.result.orders[0].lastReason,/15秒|报价/);
  const current=(await f.request('/api/paper/conditional-orders')).body;
  const cancelled=await f.request('/api/paper','POST',{action:'cancelConditionalOrder',account:'pool',orderId:created.body.order.id,expectedRevision:current.revision});
  assert.equal(cancelled.body.ok,true,JSON.stringify(cancelled.body));assert.equal(cancelled.body.order.status,'cancelled');
  await f.request('/__fixture/quote','POST',{price:10.4});await f.request('/__fixture/conditional-tick');
  assert.deepEqual(fs.readFileSync(f.book),before);
});

test('revoking the device through the original HTTP API stops its queued intent before any original buy',{timeout:45000},async t=>{
  const f=await fixture(t),plan=await prepare(f),before=fs.readFileSync(f.book);
  assert.equal((await queue(f,plan.id)).body.ok,true);
  const devices=await f.request('/api/lock/devices'),originalDevice=devices.body.items.find(row=>row.role==='edit');
  assert.ok(originalDevice);
  const other=await f.request('/api/lock/unlock','POST',{role:'edit',password:f.password,fp:'conditional-second-device',name:'condition-controller'},'');
  assert.equal(other.body.ok,true);const token=other.body.token;
  const revoked=await f.request('/api/lock/revoke','POST',{id:originalDevice.id},token);assert.equal(revoked.body.ok,true);
  const tick=await f.request('/__fixture/conditional-tick','GET',null,token);assert.equal(tick.body.ok,true,JSON.stringify(tick.body));
  assert.equal(tick.body.result.orders[0].status,'unauthorized');assert.deepEqual(fs.readFileSync(f.book),before);
  assert.notEqual((await f.request('/api/paper/conditional-orders')).body?.ok,true);
});

test('a changed strategy batch or removed candidate cannot execute an older frozen plan through the HTTP background path',{timeout:45000},async t=>{
  const f=await fixture(t),plan=await prepare(f),before=fs.readFileSync(f.book);
  assert.equal((await queue(f,plan.id)).body.ok,true);
  await refreshAfterFreeze(f,plan);
  assert.equal((await f.request('/__fixture/candidate','POST',{action:'rebatch'})).body.ok,true);
  const changed=await f.request('/__fixture/conditional-tick');assert.equal(changed.body.ok,true,JSON.stringify(changed.body));
  assert.equal(changed.body.result.orders[0].status,'pending');assert.match(changed.body.result.orders[0].lastReason,/策略批次/);
  assert.deepEqual(fs.readFileSync(f.book),before);
  await f.request('/__fixture/candidate','POST',{action:'clear'});
  const removed=await f.request('/__fixture/conditional-tick');assert.equal(removed.body.ok,true,JSON.stringify(removed.body));
  assert.equal(removed.body.result.orders[0].status,'pending');assert.match(removed.body.result.orders[0].lastReason,/后端权威候选/);
  assert.deepEqual(fs.readFileSync(f.book),before);
});

test('original full-position and minimum-lot budget gates reject queued execution without extra ledger events',{timeout:45000},async t=>{
  const f=await fixture(t),plan=await prepare(f);assert.equal((await queue(f,plan.id)).body.ok,true);
  await refreshAfterFreeze(f,plan);
  const filled=await f.request('/__fixture/native-fill-other','POST',{});assert.equal(filled.body.ok,true,JSON.stringify(filled.body));
  assert.equal(filled.body.positions,5);assert.equal(filled.body.events,5);
  const fullBook=fs.readFileSync(f.book),blocked=await f.request('/__fixture/conditional-tick');
  assert.equal(blocked.body.ok,true,JSON.stringify(blocked.body));assert.equal(blocked.body.result.orders[0].status,'pending');
  assert.match(blocked.body.result.orders[0].lastReason,/门禁|仓位|持仓|后端权威/);assert.deepEqual(fs.readFileSync(f.book),fullBook);
  const costly=await fixture(t,{price:1000}),costlyPlan=await prepare(costly),before=fs.readFileSync(costly.book);
  assert.equal((await queue(costly,costlyPlan.id)).body.ok,true);
  await refreshAfterFreeze(costly,costlyPlan,1000);
  const denied=await costly.request('/__fixture/conditional-tick');assert.equal(denied.body.ok,true,JSON.stringify(denied.body));
  assert.equal(denied.body.result.orders[0].status,'pending');assert.match(denied.body.result.orders[0].lastReason,/原模拟门禁未产生持久成交/);
  assert.deepEqual(fs.readFileSync(costly.book),before);
  const state=await costly.request('/api/state');assert.ok(state.body.skipStat?.buyNoCash||JSON.stringify(state.body.skipStat).includes('buyNoCash'));
});

test('original T+1 sale ends monitoring and a later same-stock round trip cannot inherit the earlier plan',{timeout:45000},async t=>{
  const f=await fixture(t),plan=await prepare(f);assert.equal((await queue(f,plan.id)).body.ok,true);
  await refreshAfterFreeze(f,plan);
  const entry=await f.request('/__fixture/conditional-tick');assert.equal(entry.body.result.orders[0].status,'executed');
  assert.equal(entry.body.result.orders[0].monitoringActive,true);
  const sameDay=await f.request('/__fixture/native-sell','POST',{});assert.equal(sameDay.body.events,1,'original T+1 remains enforced');
  fs.writeFileSync(f.clockFile,String(Date.parse('2026-11-17T10:00:00+08:00')));
  // The original HTTP session expires overnight. Re-authenticate normally on a
  // separate controller; the original device-bound order remains independently authorized.
  const login=await f.request('/api/lock/unlock','POST',{role:'edit',password:f.password,fp:'conditional-nextday-controller',name:'next-day-controller'},'');
  assert.equal(login.body.ok,true);const nextToken=login.body.token;
  await f.request('/__fixture/quote','POST',{price:10.4},nextToken);
  const sold=await f.request('/__fixture/native-sell','POST',{},nextToken);assert.equal(sold.body.ok,true,JSON.stringify(sold.body));
  assert.equal(sold.body.events,2);assert.equal(sold.body.positions,0);
  const stopped=await f.request('/__fixture/conditional-tick','GET',null,nextToken);assert.equal(stopped.body.ok,true,JSON.stringify(stopped.body));
  assert.equal(stopped.body.result.orders[0].monitoringActive,false);
  const observations=stopped.body.result.orders[0].observations;
  fs.writeFileSync(f.clockFile,String(Date.parse('2026-11-17T10:00:01+08:00')));await f.request('/__fixture/quote','POST',{price:10.4},nextToken);
  const rebuy=await f.request('/__fixture/native-rebuy','POST',{},nextToken);assert.equal(rebuy.body.positions,1);assert.equal(rebuy.body.events,3);
  const original=fs.readFileSync(f.book),again=await f.request('/__fixture/conditional-tick','GET',null,nextToken);
  assert.equal(again.body.result.orders[0].monitoringActive,false);assert.deepEqual(again.body.result.orders[0].observations,observations);
  assert.deepEqual(fs.readFileSync(f.book),original);
});

// Keep the actual low-upside OHLCV negative case that previously failed the
// browser fixture. The real HTTP decision endpoint must withhold the card.
test('real decision endpoint withholds a low reward-risk plan without writing an account or intent',{timeout:45000},async t=>{
 const f=await fixture(t,{chaseRisk:true}),before=fs.readFileSync(f.book);
 const decision=await f.request('/api/decision-center');
 assert.equal(decision.body.ok,true);
 assert.equal(decision.body.cards.length,0);
 assert.match(decision.body.reasons.join(''),/低于原1:2纪律/);
 assert.equal(decision.body.conclusions['600000'].label,'回避');
 assert.equal(decision.body.conclusions['600000'].riskReward.status,'insufficient-gross-reward');
 assert.deepEqual(fs.readFileSync(f.book),before);
 assert.equal(fs.existsSync(f.queueFile),false);
});
