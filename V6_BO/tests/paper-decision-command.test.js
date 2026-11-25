'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),http=require('node:http');
const {paperDecisionPolicy,submitPaperDecision}=require('../src/core/paper-decision-command');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createOpenFixture}=require('./helpers/v6-studio-fixture');
const day='2026-11-06',now=Date.parse(day+'T10:00:00+08:00');
const cfg={name:'隔离跟单盘',initial:10000,maxPos:5,sl:-.03,tp:.08,expireDays:4};
const atr={atrMultiplier:2,atrStopMaxPct:-10};
const wire=(patch={})=>({code:'600000',name:'隔离样本',price:10,preClose:10,volume:100000,
  quoteSource:'tencent',quoteAt:now-1000,receivedAt:now-500,quoteMode:'public-live-unverified',
  canTrade:true,score:80,paths:['温和连阳'],...patch});
const command=(patch={})=>({action:'submitDecision',account:'pool',code:'600000',day,entryMin:9.9,entryMax:10.1,
  policy:paperDecisionPolicy(cfg,atr),...patch});

function fixture(patches={}){
  const x={revision:1,book:{enabled:true,cash:10000,positions:{},trades:[]},calls:[],skips:{}};
  x.context={now:()=>now,isReplica:()=>false,isContinuousTrading:()=>true,policy:()=>paperDecisionPolicy(cfg,atr),
    candidates:()=>[wire()],newsBlocked:()=>false,
    readAccount:()=>({account:structuredClone(x.book),revision:x.revision}),
    executionQuotes:()=>({'600000':{symbol:'600000',tradeDate:day,price:10,quoteAt:now-1000,receivedAt:now-500}}),
    skipCounts:()=>({...x.skips}),skipLabel:key=>key==='buyNoCash'?'现金不足一手':key,
    execute:(key,candidate,reason)=>{
      x.calls.push({key,candidate,reason});x.revision++;
      x.book.positions[candidate.code]={shares:100};x.book.cash=8995;
      x.book.trades.unshift({code:candidate.code,side:'买入',t:now,price:10,shares:100,amount:1000,fee:5,
        eventId:'committed-fixture-event',orderId:'committed-fixture-order',reason,fillEvidence:{quoteAt:now-1000}});
    },...patches};
  return x;
}

test('read-only policy describes actual equal allocation, base/ATR stop and T+1 without claiming custom orders',()=>{
  const policy=paperDecisionPolicy(cfg,atr);
  assert.equal(policy.positionPct,19.6);assert.equal(policy.stopPct,3);assert.equal(policy.maxStopPct,10);
  assert.equal(policy.targetPct,8);assert.equal(policy.customConditions,false);assert.equal(policy.executor,'paperBuy');
  assert.match(policy.stopMode,/atr.*peak.*t1/);assert.match(policy.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(policy.fingerprint,paperDecisionPolicy({...cfg},atr).fingerprint);
  assert.notEqual(policy.fingerprint,paperDecisionPolicy({...cfg,maxPos:8},atr).fingerprint);
  for(const patch of [{maxPos:0},{sl:0},{tp:null},{expireDays:NaN}])assert.equal(paperDecisionPolicy({...cfg,...patch},atr),null);
  assert.equal(paperDecisionPolicy(cfg),null);
});

test('only a bounded pool command with exact current policy is accepted; arbitrary fill inputs are rejected',async()=>{
  const patches=[{account:'pre'},{account:undefined},{code:600000},{code:'../etc'},{day:'2026-02-30'},
    {entryMin:0},{entryMin:'9.9'},{entryMax:NaN},{entryMax:Infinity},{entryMax:9},{entryMax:10000001},
    {policy:null},{price:10},{score:100},{shares:500},{stop:9},{positionPct:1},{stopPct:1},{target:12},
    {quote:wire()},{candidate:wire()},{token:{}},{action:'buy'}];
  for(const patch of patches){const x=fixture(),result=await submitPaperDecision(command(patch),x.context);
    assert.equal(result.reasonCode,'INVALID_DECISION',JSON.stringify(patch));assert.equal(x.calls.length,0);}
  for(const policy of [{...command().policy,positionPct:10},{...command().policy,stopPct:1},
    {...command().policy,fingerprint:'a'.repeat(64)},{...command().policy,extra:true}]){
    const x=fixture(),result=await submitPaperDecision(command({policy}),x.context);
    assert.equal(result.reasonCode,'POLICY_CHANGED');assert.equal(x.calls.length,0);
  }
});

test('replica, changed day, closed session and missing policy cannot call the existing executor',async()=>{
  for(const [patches,reason]of [[{isReplica:()=>true},'REPLICA_READ_ONLY'],
    [{now:()=>now+86400000},'WRONG_TRADING_DAY'],[{isContinuousTrading:()=>false},'OUTSIDE_CONTINUOUS_SESSION'],
    [{policy:()=>null},'POLICY_UNAVAILABLE'],[{now:()=>NaN},'CLOCK_UNAVAILABLE']]){
    const x=fixture(patches),result=await submitPaperDecision(command(),x.context);
    assert.equal(result.reasonCode,reason);assert.equal(result.queued,false);assert.equal(x.calls.length,0);
  }
});

test('server-selected evidence is required and blocked, undated, research or negative-news candidates cannot be used',async()=>{
  for(const rows of [[],[wire(),wire()]]){
    const x=fixture({candidates:()=>rows});assert.equal((await submitPaperDecision(command(),x.context)).reasonCode,'CANDIDATE_NOT_CURRENT');assert.equal(x.calls.length,0);
  }
  for(const patch of [{blocked:true},{name:'*ST隔离'},{cap:'空仓'},{currentSourceConfirmed:false},
    {selectionEvidenceStatus:'incomplete'},{quoteAt:now-86400000},{tradeDate:'2026-11-05'},
    {quoteAt:null},{paths:[]},{canTrade:false},{readOnlyBackup:true},{quoteMode:'research-observation'},
    {quoteSource:'synthetic-source'},{halt:true},{researchOnly:true},{historicalClose:true}]){
    const x=fixture({candidates:()=>[wire(patch)]}),result=await submitPaperDecision(command(),x.context);
    assert.equal(result.reasonCode,'CANDIDATE_BLOCKED',JSON.stringify(patch));assert.equal(x.calls.length,0);
  }
  const x=fixture({newsBlocked:()=>true});assert.equal((await submitPaperDecision(command(),x.context)).reasonCode,'CANDIDATE_BLOCKED');assert.equal(x.calls.length,0);
});

test('disabled and duplicate authoritative accounts never buy twice, including after a new process reads the same book',async()=>{
  const paused=fixture();paused.book.enabled=false;
  assert.equal((await submitPaperDecision(command(),paused.context)).reasonCode,'ACCOUNT_PAUSED');assert.equal(paused.calls.length,0);
  const x=fixture(),first=await submitPaperDecision(command(),x.context);
  assert.equal(first.filled,true);assert.equal(first.receipt.eventId,'committed-fixture-event');assert.equal(first.receipt.quoteAt,now-1000);
  assert.equal(first.policy.positionPct,19.6);assert.equal(first.queued,false);
  const after=structuredClone(x.book),second=await submitPaperDecision(command(),x.context);
  assert.equal(second.reasonCode,'DUPLICATE_DECISION');assert.equal(x.calls.length,1);assert.deepEqual(x.book,after);
  const restarted=fixture();restarted.book=after;restarted.revision=x.revision;
  assert.equal((await submitPaperDecision(command(),restarted.context)).reasonCode,'DUPLICATE_DECISION');assert.equal(restarted.calls.length,0);
  const alreadySold=fixture();alreadySold.book.trades=[{code:'600000',side:'买入',tradeDate:day,t:null}];
  assert.equal((await submitPaperDecision(command(),alreadySold.context)).reasonCode,'DUPLICATE_DECISION');
});

test('entry range checks only the original complete execution quote and enforces the source clock boundary',async()=>{
  const q=fixture().context.executionQuotes()['600000'];
  for(const patch of [{symbol:'600001'},{tradeDate:'2026-11-05'},{quoteAt:now-15001},{quoteAt:now+1},
    {quoteAt:null},{receivedAt:null},{receivedAt:now+1},{receivedAt:now-1001},{price:Infinity},
    {suspended:true},{tradable:false}]){
    const x=fixture({executionQuotes:()=>({'600000':{...q,...patch}})});
    assert.equal((await submitPaperDecision(command(),x.context)).reasonCode,'EXECUTION_QUOTE_UNAVAILABLE',JSON.stringify(patch));assert.equal(x.calls.length,0);
  }
  for(const price of [9.89,10.11]){
    const x=fixture({executionQuotes:()=>({'600000':{...q,price}})});
    assert.equal((await submitPaperDecision(command(),x.context)).reasonCode,'OUTSIDE_ENTRY_RANGE');assert.equal(x.calls.length,0);
  }
  for(const quoteAt of [now-15000,now]){
    const x=fixture({executionQuotes:()=>({'600000':{...q,quoteAt,receivedAt:now}})});
    assert.equal((await submitPaperDecision(command(),x.context)).filled,true);
  }
});

test('no fill, commit rollback and unknown readback are never reported as a successful buy',async()=>{
  const skipped=fixture();skipped.context.execute=()=>{skipped.skips.buyNoCash=1;};
  const denied=await submitPaperDecision(command(),skipped.context);assert.equal(denied.filled,false);assert.match(denied.error,/现金不足一手/);
  const rollback=fixture();rollback.context.execute=()=>{};
  assert.equal((await submitPaperDecision(command(),rollback.context)).reasonCode,'EXECUTION_NOT_FILLED');
  const failed=fixture({execute:()=>{throw Error('private failure');}});
  const failResult=await submitPaperDecision(command(),failed.context);assert.equal(failResult.filled,false);assert.doesNotMatch(JSON.stringify(failResult),/private failure/);
  const unknown=fixture();let reads=0;unknown.context.readAccount=()=>{if(++reads>1)throw Error('private path');return {account:unknown.book,revision:1};};
  const result=await submitPaperDecision(command(),unknown.context);assert.equal(result.status,'receipt-unavailable');assert.equal(result.filled,null);assert.doesNotMatch(JSON.stringify(result),/private path/);
  const missingAuthority=fixture({readAccount:()=>{throw Error('not readable');}});
  assert.equal((await submitPaperDecision(command(),missingAuthority.context)).reasonCode,'AUTHORITY_UNAVAILABLE');assert.equal(missingAuthority.calls.length,0);
});

test('a matching committed event is required; a later notification exception does not erase a real fill',async()=>{
  const unrelated=fixture(),execute=unrelated.context.execute;
  unrelated.context.execute=(key,candidate,reason)=>execute(key,candidate,'another action');
  assert.equal((await submitPaperDecision(command(),unrelated.context)).filled,false);
  const afterCommit=fixture(),commit=afterCommit.context.execute;
  afterCommit.context.execute=(...args)=>{commit(...args);throw Error('notification failed after commit');};
  assert.equal((await submitPaperDecision(command(),afterCommit.context)).filled,true);
});

const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const serverRequire=require('node:module').createRequire(require.resolve('../server.js'));
const section=(begin,end)=>{const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}

function realExecutor(t,{volume=100000}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-decision-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'pool.json'),app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>d===day}});
  app.adoptLegacy({initial:10000,cash:10000,realized:0,enabled:true,positions:{},trades:[]});
  const notices=[],skips={},failures=[];
  const c={S:{lastPx:new Map(),stocks:[wire({volume})],candidatePool:[wire({volume})],ztCodes:new Set()},
    PAPER:{pool:app.legacy()},PAPER_CFG:{pool:{...cfg}},_paperAuthority:{pool:app},_paperAuthorityRevision:{pool:app.read().revision},
    PAPER_FILE:path.join(dir,'paper.json'),Date:Clock,Map,require:serverRequire,console:{error(){}},
    isReplica:()=>false,isContinuousTrading:()=>true,limitPctOfCode:()=>.1,paperFeeAmount:()=>5,
    paperLotOf:()=>100,paperEquity:()=>10000,A:{isLimitUp:()=>false},skipAdd:key=>{skips[key]=(skips[key]||0)+1;},
    numNeutral:()=>0,dataCapOf:()=>100,pushPaperDigest:message=>notices.push(message),
    atomicWrite:(file,contents)=>{fs.writeFileSync(file,contents);return true;},_diskFail:message=>{failures.push(message);return false;}};
  c.refreshPaperAuthority=()=>{c.PAPER.pool=app.legacy();c._paperAuthorityRevision.pool=app.read().revision;};
  vm.createContext(c);
  vm.runInContext([section('function paperAuthorityQuotes(){','refreshPaperAuthority();'),
    section("function savePaper(action=",'// ---------------- 模拟盘对账'),
    section('function paperBuy(key, cands, pm, reasonOf)','// ---------------- A股 T+1')].join('\n'),c);
  const x=fixture({candidates:()=>c.S.candidatePool,executionQuotes:()=>c.paperAuthorityQuotes(),
    readAccount:()=>{c.refreshPaperAuthority();return {account:c.PAPER.pool,revision:c._paperAuthorityRevision.pool};},
    execute:(key,candidate,reason)=>c.paperBuy(key,[candidate],new Map(),()=>reason),skipCounts:()=>({...skips})});
  return {...x,c,app,file,notices,failures};
}

test('actual paperBuy and authority commit preserve original allocation, fees and durable duplicate protection',async t=>{
  const x=realExecutor(t),result=await submitPaperDecision(command(),x.context),book=x.app.read();
  assert.equal(result.filled,true,JSON.stringify(result));assert.equal(book.account.events.length,1);
  assert.equal(result.receipt.shares,100,'equity / 5 * 0.98 and the existing whole-lot rule determine shares');
  assert.equal(result.receipt.price,10);assert.equal(result.receipt.fee,5);assert.equal(book.account.cash,8995);
  assert.equal(result.receipt.eventId,book.account.events[0].eventId);assert.equal(x.notices.length,1);
  const bytes=fs.readFileSync(x.file),again=await submitPaperDecision(command(),x.context);
  assert.equal(again.reasonCode,'DUPLICATE_DECISION');assert.deepEqual(fs.readFileSync(x.file),bytes);assert.equal(x.notices.length,1);
});

test('actual original authority liquidity rejection rolls back cash and cannot produce a claimed fill or notification',async t=>{
  const x=realExecutor(t,{volume:1}),before=fs.readFileSync(x.file);
  const result=await submitPaperDecision(command(),x.context);
  assert.equal(result.filled,false);assert.equal(result.reasonCode,'EXECUTION_NOT_FILLED');assert.deepEqual(fs.readFileSync(x.file),before);
  assert.equal(x.c.PAPER.pool.cash,10000);assert.equal(x.notices.length,0);assert.equal(x.failures.length,1);
});

test('real HTTP command keeps existing edit authentication, same-origin checks and both authoritative books unchanged', {timeout:45000},async t=>{
  const f=await createOpenFixture({count:0});t.after(()=>f.close());
  const initial=await f.request('/api/paper');assert.equal(initial.body.ok,true);assert.equal(initial.body.paper.pool.policy.positionPct,19.6);
  const payload=command({day:'2026-11-16',policy:initial.body.paper.pool.policy});
  const files=['pool','pre'].map(key=>path.join(f.tmp,'data','order-accounts',key+'.json'));
  const before=files.map(file=>fs.readFileSync(file));
  for(const token of ['',f.viewerToken]){
    const denied=await f.request('/api/paper','POST',payload,token);
    assert.notEqual(denied.body.ok,true);assert.equal(denied.body.receipt,undefined);
  }
  const denied=await f.request('/api/paper','POST',payload);
  assert.equal(denied.body.reasonCode,'CANDIDATE_NOT_CURRENT');assert.equal(denied.body.filled,false);assert.equal(denied.body.queued,false);
  assert.equal((await f.request('/api/paper','POST',{...payload,price:1})).body.reasonCode,'INVALID_DECISION');
  assert.equal((await f.request('/api/paper','POST',{...payload,unused:'x'.repeat(8300)})).body.filled,false);
  const crossOrigin=await new Promise((resolve,reject)=>{
    const raw=JSON.stringify(payload),req=http.request({hostname:'127.0.0.1',port:f.port,path:'/api/paper',method:'POST',
      headers:{Authorization:'Bearer '+f.token,Origin:'https://untrusted.invalid','Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end(raw);
  });
  assert.equal(crossOrigin,403);
  files.forEach((file,i)=>assert.deepEqual(fs.readFileSync(file),before[i]));
});

test('real HTTP replica only exposes the account policy and refuses the command before execution', {timeout:45000},async t=>{
  // Change configuration only in the disposable fixture; the real role gate is
  // left untouched. No production instance, credentials or account is used.
  const anchor="const PAPER_FILE = path.join(__dirname, 'paper.json');";
  const f=await createOpenFixture({count:0,serverSource:source.replace(anchor,"S.config.pushRole='replica';\n"+anchor)});t.after(()=>f.close());
  const snapshot=await f.request('/api/paper'),status=await f.request('/api/lock/status');
  assert.equal(status.body.pushRole,'replica');assert.equal(snapshot.body.paper.pool.policy.positionPct,19.6);
  const result=await f.request('/api/paper','POST',command({day:'2026-11-16',policy:snapshot.body.paper.pool.policy}));
  assert.equal(result.body.reasonCode,'REPLICA_READ_ONLY');assert.equal(result.body.filled,false);assert.equal(result.body.queued,false);
  for(const key of ['pool','pre'])assert.equal(fs.existsSync(path.join(f.tmp,'data','order-accounts',key+'.json')),false);
});

test('real HTTP submits through the original executor once and returns the same durable event to both clients', {timeout:45000},async t=>{
  const anchor='let _quantPicksCache = { ts: 0, data: null, busy: false };';
  // Original provider-shaped rows live only in this network-isolated server
  // copy. The executable, account service and every production gate are real.
  const state=`\nS.candidatePool=[{code:'600000',name:'隔离 HTTP 样本',price:10,preClose:10,volume:100000,pct:0,
    quoteAt:Date.now()-1000,receivedAt:Date.now()-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,
    score:80,paths:['温和连阳'],selectionEvidenceStatus:'sufficient'}];S.stocks=S.candidatePool;S.stocksAt=Date.now();\n`;
  const f=await createOpenFixture({count:0,serverSource:source.replace(anchor,anchor+state)});t.after(()=>f.close());
  const snapshot=await f.request('/api/paper'),payload=command({day:'2026-11-16',policy:snapshot.body.paper.pool.policy});
  const replies=await Promise.all([f.request('/api/paper','POST',payload),f.request('/api/paper','POST',payload)]);
  const filled=replies.find(reply=>reply.body.filled===true),duplicate=replies.find(reply=>reply.body.reasonCode==='DUPLICATE_DECISION');
  assert.ok(filled,JSON.stringify(replies.map(reply=>reply.body)));assert.ok(duplicate);
  const after=await f.request('/api/paper'),ledger=await f.request('/api/paper/ledger');
  assert.equal(after.body.paper.pool.tradesTotal,1);assert.equal(after.body.paper.pool.cash,80995);
  assert.equal(after.body.paper.pre.tradesTotal,0);assert.equal(after.body.paper.pre.cash,500000);
  assert.equal(filled.body.receipt.shares,1900);assert.equal(filled.body.receipt.price,10);
  assert.equal(filled.body.receipt.eventId,after.body.paper.pool.trades[0].eventId);
  assert.equal(filled.body.receipt.eventId,ledger.body.paper.pool.events[0].eventId);
  assert.equal(filled.body.queued,false);assert.equal(duplicate.body.filled,false);
  const persisted=JSON.parse(fs.readFileSync(path.join(f.tmp,'data','order-accounts','pool.json'),'utf8'));
  assert.equal(persisted.account.events.length,1);assert.equal(persisted.account.events[0].eventId,filled.body.receipt.eventId);
});
