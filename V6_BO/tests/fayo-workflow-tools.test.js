'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/workflow-tools.js');
const target='2026-11-25',now=Date.parse(target+'T16:00:00+08:00');
const calendar=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23','2026-11-24',target];
function market(extra={}){
 return {marketClock:{trading:false,day:target},closeSession:{day:target},snapshotFieldDays:{candidatePool:target},
  pool:[{code:'600001',name:'甲',sector:'芯片',score:90},{code:'600002',name:'乙',industry:'半导体',score:95},{code:'600003',name:'丙',sector:'银行',score:99}],...extra};
}
function observation(code='600001',daily=100){
 return {ok:true,result:{asOf:now-1000,stock:{symbol:code},calendar:{status:'available'},analysis:{tradeDates:calendar},
  marketContext:{tradeDate:target,funds:{stock:{symbol:code,source:'eastmoney',unit:'CNY',fundsMethod:'vendor-order-size-estimate',retrievedAt:now-2000,sourceTimestamp:null,
   records:calendar.map(tradeDate=>({tradeDate,mainNetInflow:daily}))}}}}};
}
function record(){
 const entry=Date.parse('2026-11-24T10:05:00+08:00'),exit=Date.parse(target+'T10:10:00+08:00');
 const plan={id:'p1',code:'600001',strategy:'原策略',frozenAt:'2026-11-24T01:00:00.000Z',intendedDate:'2026-11-24',entryMax:10.5,maxPosition:10,stop:9};
 const trade={id:'paper-one',source:'V6 模拟成交',sourceFingerprint:'a'.repeat(64),code:'600001',name:'甲',date:'2026-11-24',exitDate:target,
  entryTime:'2026-11-24T10:05',exitTime:target+'T10:10',entryPrice:10,exitPrice:11,shares:100,costBasis:1005,pnlAmount:90,position:8,planId:'p1',
  createdAt:new Date(now-1000).toISOString(),strategies:['原策略'],disciplineFacts:[{rule:'违反止损',status:'符合',evidence:'归档记录：止损未触发。'}],
  paperSettlement:{accountId:'pool',symbol:'600001',tradeDate:target,exitEventId:'sell-one',exitOrderId:'sell-order',exitTimestamp:exit,exitQuantity:100,exitPrice:11,
   costBasisCents:100500,realizedCents:9000,entryFills:[{eventId:'buy-one',orderId:'buy-order',time:entry,price:10,quantity:100}]}};
 return {scope:'live',book:{id:'main'},plans:[plan],trades:[trade]};
}
function todayAccount(price=10){
 const {createFillEvidence}=require('../src/core/paper-fill-evidence');
 const t=Date.parse(target+'T10:05:00+08:00');
 const fillEvidence=createFillEvidence({timestamp:t-1000,quoteAt:t-1000,receivedAt:t-500,
  quoteSource:'tencent',mode:'public-live-unverified',price,volumeUnit:'shares',volume:10000,
  upperLimit:12,lowerLimit:8,suspended:false,tradable:true},
 {executionAt:t,executionKind:'automatic-paper',symbol:'600001',tradeDate:target,price});
 return {audit:{ok:true},tradesShown:1,tradesTotal:1,trades:[{t,tradeDate:target,timeQuality:'known',side:'买入',code:'600001',name:'甲',
  price,shares:100,amount:price*100,fee:5,eventId:'today-buy',orderId:'today-order',fillEvidence}],positions:[{code:'600001',shares:100}]};
}
function todayPlans(){
 const archive=record();archive.trades=[];
 archive.plans[0]={...archive.plans[0],frozenAt:target+'T01:00:00Z',intendedDate:target};return archive;
}
test('supported commands preserve exact window, limit and theme; other semantics are not guessed',async()=>{
 const {parseStockCommand}=await api;
 assert.deepEqual(parseStockCommand('近5日主力净流入前5的芯片股'),{ok:true,kind:'flow',window:5,count:5,theme:'芯片',text:'近5日主力净流入前5的芯片股'});
 assert.equal(parseStockCommand('今日主力净流入前3').window,1);
 assert.equal(parseStockCommand('精选评分前3的芯片股').kind,'score');
 for(const text of ['近7日主力净流入前5的芯片股','近5日主力净流入前99','净利润前5','明日涨停股','主力净流入','评分前0','评分前3且换手率小于2','x'.repeat(121)])assert.equal(parseStockCommand(text).ok,false,text);
});
test('command pool deduplicates whole rows and isolates dates, synthetic samples and private pools',async()=>{
 const {commandCandidates}=await api;
 const state=market({pool:[{code:'600001',name:'旧行',poolDay:'2026-11-24'},{code:'600002',name:'新行',poolDay:target,score:null},{code:'600003',name:'教学',sampleSet:'test'}],
  dashboard:{snapshotDay:target,rows:[{code:'600002',name:'同日另一来源',score:99},{code:'600004',name:'未来',quoteAt:now+1}]},
  yierAsOf:target,yierList:[{code:'600005',name:'私有'}]});
 const before=JSON.stringify(state),publicPool=commandCandidates(state,'view',now);
 assert.deepEqual(publicPool.rows.map(r=>r.code),['600002']);assert.equal(publicPool.rows[0].score,null);
 assert.deepEqual(commandCandidates(state,'edit',now).rows.map(r=>r.code),['600002','600005']);assert.equal(JSON.stringify(state),before);
});
test('five-day flow uses explicit trading calendar and amounts, never today or row score',async()=>{
 const {evaluateStockCommand}=await api;
 const first=observation(),second=observation('600002',150);
 first.result.marketContext.funds.stock.records.at(-1).mainNetInflow=10000;
 const result=evaluateStockCommand('近5日主力净流入前2的芯片股',{state:market(),role:'edit',now,observations:{'600001':first,'600002':second}});
 assert.equal(result.status,'ready');assert.deepEqual(result.items.map(r=>r.code),['600001','600002']);
 assert.equal(result.items[0].commandValue,10400);assert.equal(result.items[1].commandValue,750);
 assert.deepEqual(result.items[0].commandEvidence.dates,calendar.slice(-5));assert.match(result.items[0].commandReason,/2026-11-19 至 2026-11-25/);
});
test('missing day or amount produces partial coverage, zero remains a measured non-inflow',async()=>{
 const {evaluateStockCommand}=await api;
 const missing=observation('600001'),zero=observation('600002',0);missing.result.marketContext.funds.stock.records.at(-3).mainNetInflow=null;
 const result=evaluateStockCommand('近5日主力净流入前5的芯片股',{state:market(),now,role:'edit',observations:{'600001':missing,'600002':zero}});
 assert.equal(result.items.length,0);assert.equal(result.known,1);assert.equal(result.missing.length,1);assert.equal(result.missing[0].code,'600001');assert.match(result.reason,/不能据此认定/);
 missing.result.marketContext.funds.stock.records.splice(-3,1);
 assert.equal(evaluateStockCommand('近5日主力净流入前5的芯片股',{state:market(),now,observations:{'600001':missing}}).items.length,0);
});
test('fund evidence rejects symbol, date, duplicate, unit, future-time and calendar mismatches',async()=>{
 const {archivedFlowWindow}=await api;
 const mutations=[r=>r.stock.symbol='600009',r=>r.marketContext.tradeDate='2026-11-24',r=>r.marketContext.funds.stock.unit='万元',
  r=>r.asOf=now+1,r=>r.marketContext.funds.stock.retrievedAt=now+1,r=>r.marketContext.funds.stock.sourceTimestamp=now,
  r=>r.marketContext.funds.stock.records.push({...r.marketContext.funds.stock.records.at(-1)}),r=>r.analysis.tradeDates=[],
  r=>r.analysis.tradeDates=[...calendar].reverse(),r=>r.calendar.status='unavailable',r=>r.marketContext.funds.stock.records.at(-1).mainNetInflow='100'];
 for(const change of mutations){const value=observation();change(value.result);assert.equal(archivedFlowWindow(value,'600001',target,5,now).ok,false);}
});
test('current flow requires its own dated provenance and cannot borrow quote or reception timestamps',async()=>{
 const {evaluateStockCommand}=await api;
 const row={code:'600001',name:'甲',sector:'芯片',mainInflow:200,quoteAt:now-1000,fundsRetrievedAt:now-1000,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY'};
 const run=value=>evaluateStockCommand('今日主力净流入前5',{state:market({pool:[value]}),now});
 assert.equal(run(row).items.length,0);
 assert.equal(run({...row,fundsTradeDate:target}).items.length,1);
 assert.equal(run({...row,fundsTradeDate:'2026-11-24'}).items.length,0);
 assert.equal(run({...row,fundsTradeDate:target,fundsRetrievedAt:now+1}).items.length,0);
 assert.equal(run({...row,fundsSourceTimestamp:now-2000}).items.length,1);
});
test('score commands preserve missing scores and label their limited universe',async()=>{
 const {evaluateStockCommand}=await api;
 const state=market();state.pool[0].score=null;
 const result=evaluateStockCommand('精选评分前3的芯片股',{state,now});
 assert.deepEqual(result.items.map(r=>r.code),['600002']);assert.equal(result.missing[0].code,'600001');assert.equal(result.scope,'当前同日候选池');
 assert.equal(evaluateStockCommand('近5日主力净流入前5的芯片股',{state,now}).items.length,0);
});
test('execution score waits for close and excludes demo, named books and failed ledger audit',async()=>{
 const {executionScore}=await api;
 const base=record();
 assert.equal(executionScore(base,{day:target,now:Date.parse(target+'T14:59:59+08:00')}).status,'pending');
 assert.equal(executionScore({...base,scope:'demo'},{day:target,now}).score,null);
 assert.equal(executionScore({...base,book:{id:'book-1234567890abcdef'}},{day:target,now}).score,null);
 assert.equal(executionScore(base,{day:target,now,account:{audit:{ok:false}}}).score,null);
 assert.equal(executionScore(base,{day:target,now,accountKey:'pre'}).trades,0);
});
test('complete execution compares frozen limits and facts, independent of profit direction',async()=>{
 const {executionScore}=await api,base=record();
 assert.equal(executionScore(base,{day:target,now}).score,100);
 base.trades[0].pnlAmount=-90;base.trades[0].paperSettlement.realizedCents=-9000;
 assert.equal(executionScore(base,{day:target,now}).score,100);
 base.trades[0].paperSettlement.entryFills[0].price=11;
 base.trades[0].disciplineFacts[0]={rule:'违反止损',status:'触发',evidence:'触发止损且存在可成交窗口仍持有。'};
 const result=executionScore(base,{day:target,now});assert.equal(result.score,33);assert.equal(result.failed,2);
});
test('real imported paper records with absent plans or stop evidence never get a fabricated grade',async()=>{
 const {executionScore}=await api,base=record();
 base.trades[0].planId=null;base.trades[0].position=null;base.trades[0].disciplineFacts=[{rule:'违反止损',status:'资料不足',evidence:'缺少事前计划'}];
 const inferred=executionScore(base,{day:target,now});assert.equal(inferred.score,null);assert.equal(inferred.passed,1);assert.equal(inferred.unknown,2);
 base.plans=[];assert.equal(executionScore(base,{day:target,now}).unknown,3);
 base.plans=record().plans.map(p=>({...p,frozenAt:'2026-11-24T08:00:00Z'}));
 assert.equal(executionScore(base,{day:target,now}).score,null);assert.equal(executionScore(base,{day:target,now}).passed,0);
});
test('ambiguous plans, wrong strategy, retrospective plans and duplicate exits cannot inflate execution',async()=>{
 const {executionScore}=await api;
 const ambiguous=record();ambiguous.trades[0].planId=null;ambiguous.plans.push({...ambiguous.plans[0],id:'p2'});
 assert.equal(executionScore(ambiguous,{day:target,now}).passed,0);
 const wrong=record();wrong.trades[0].strategies=['另一策略'];assert.equal(executionScore(wrong,{day:target,now}).score,67);
 const duplicate=record();duplicate.trades.push(structuredClone(duplicate.trades[0]));assert.equal(executionScore(duplicate,{day:target,now}).trades,1);
 duplicate.trades[1].position=1;assert.equal(executionScore(duplicate,{day:target,now}).score,null);
 const retrospective=record();retrospective.plans[0].frozenAt='2026-11-24T03:00:00Z';assert.equal(executionScore(retrospective,{day:target,now}).score,null);
});
test('unverified or future settlement fields stay unknown and the archive stays unchanged',async()=>{
 const {executionScore}=await api;
 const mutations=[t=>t.paperSettlement.exitTimestamp=now+1,t=>t.paperSettlement.symbol='600009',t=>t.paperSettlement.costBasisCents++,
  t=>t.paperSettlement.entryFills[0].time=now,t=>t.createdAt=new Date(now+1).toISOString(),t=>t.sourceFingerprint='',t=>t.paperSettlement.entryFills=[]];
 for(const change of mutations){const value=record();change(value.trades[0]);const before=JSON.stringify(value),result=executionScore(value,{day:target,now});assert.equal(result.score,null);assert.equal(JSON.stringify(value),before);}
 const testOnly=record();testOnly.trades[0].sampleSet='test';assert.equal(executionScore(testOnly,{day:target,now}).trades,0);
});
test('a reconciled current-day buy checks its frozen price condition before the position is closed',async()=>{
 const {executionScore}=await api,archive=todayPlans(),account=todayAccount(),before=JSON.stringify({archive,account});
 const result=executionScore(archive,{day:target,now,account});
 assert.equal(result.buyTrades,1);assert.equal(result.settledTrades,0);assert.equal(result.score,null);assert.equal(result.status,'partial');
 assert.equal(result.passed,1);assert.equal(result.unknown,2);assert.equal(result.checks.find(c=>c.rule==='买价条件').status,'pass');
 assert.match(result.checks[0].evidence,/未记录计划或战法关联/);assert.match(result.checks.find(c=>c.rule==='止损执行').evidence,/待证/);
 assert.equal(JSON.stringify({archive,account}),before);
 account.positions[0].pnl=999999;account.totalPnl=999999;
 assert.equal(executionScore(archive,{day:target,now,account}).passed,1,'valuation gains cannot supply a missing discipline fact');
 const expensive=executionScore(archive,{day:target,now,account:todayAccount(11)});
 assert.equal(expensive.failed,1);assert.equal(expensive.score,null);
});
test('today buys do not attach a future, retrospective or ambiguous plan and clicks cannot stand in for fills',async()=>{
 const {executionScore}=await api,account=todayAccount();
 for(const change of [a=>a.plans=[],a=>a.plans.push({...a.plans[0],id:'p2'}),a=>a.plans[0].frozenAt=target+'T03:00:00Z',
  a=>a.plans[0].intendedDate='2026-11-24',a=>a.plans[0].code='600002']){
  const archive=todayPlans();change(archive);const result=executionScore(archive,{day:target,now,account});
  assert.equal(result.buyTrades,1);assert.equal(result.passed,0);assert.equal(result.unknown,3);assert.equal(result.score,null);
 }
 const noFill={...account,trades:[],tradesShown:0,tradesTotal:0,draft:{code:'600001',status:'prefilled'}};
 assert.equal(executionScore(todayPlans(),{day:target,now,account:noFill}).trades,0);
});
test('current buys need successful reconciliation and matching original fill clocks, identity and amounts',async()=>{
 const {executionScore}=await api,archive=todayPlans();
 const changes=[a=>a.audit.ok=undefined,a=>a.audit.ok=false,a=>a.trades[0].fillEvidence.symbol='600002',
  a=>a.trades[0].fillEvidence.mode='simulated',a=>a.trades[0].fillEvidence.quoteAt=a.trades[0].t-180001,
  a=>a.trades[0].fillEvidence.receivedAt=a.trades[0].t+1,a=>a.trades[0].fillEvidence.fingerprint='',
  a=>a.trades[0].t=now+1,a=>a.trades[0].t=Number.MAX_SAFE_INTEGER,a=>a.trades[0].timeQuality='date-only',
  a=>a.trades[0].orderId=null,a=>a.trades[0].amount++,a=>a.trades[0].tradeDate='2026-11-24'];
 for(const change of changes){const account=todayAccount();change(account);const result=executionScore(archive,{day:target,now,account});
  assert.equal(result.buyTrades,0);assert.equal(result.score,null);}
});
test('truncated current statements and conflicting duplicates preserve a partial execution view',async()=>{
 const {executionScore}=await api,archive=todayPlans(),account=todayAccount();account.tradesTotal=40;
 const limited=executionScore(archive,{day:target,now,account});assert.equal(limited.buyTrades,1);assert.equal(limited.score,null);assert.match(limited.reason,/最近 1 \/ 40/);
 account.trades.push(structuredClone(account.trades[0]));account.tradesShown=2;account.tradesTotal=2;
 assert.equal(executionScore(archive,{day:target,now,account}).buyTrades,1);
 account.trades[1].name='冲突记录';const conflict=executionScore(archive,{day:target,now,account});
 assert.equal(conflict.buyTrades,1);assert.equal(conflict.unknown,3);assert.equal(conflict.score,null);
});
test('private reminder is based only on true server readiness and never reveals a webhook',async()=>{
 const {privateReminderStatus}=await api;
 assert.equal(privateReminderStatus({},'edit').label,'未配置');
 assert.equal(privateReminderStatus({feishuSecReady:'true',webhook:'secret'},'edit').label,'未配置');
 assert.equal(privateReminderStatus({feishuSecReady:true},'view').label,'需要编辑者权限');
 assert.deepEqual(privateReminderStatus({feishuSecReady:true},'edit'),{label:'已配置',ready:true});
});

class El{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.dataset={};this.attributes={};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 setAttribute(name,value){this.attributes[name]=value;}
}
function dom(){global.Node=El;global.document={createElement:tag=>new El(tag),createTextNode:textContent=>Object.assign(new El('text'),{textContent})};}
const content=node=>[node?.textContent||'',...listChildren(node).map(content)].join(' ');
const listChildren=node=>Array.isArray(node?.children)?node.children:[];
const find=(node,predicate)=>predicate(node)?node:listChildren(node).map(child=>find(child,predicate)).find(Boolean);
function context(state=market(),role='edit'){
 const controller=new AbortController(),listeners=[],calls=[];
 return {state,role,signal:controller.signal,controller,listeners,calls,navigate(){},selectStock(){},
  onState:callback=>listeners.push(callback),api:async(url,options)=>{calls.push({url,options});return {ok:true,result:null};}};
}
test('rendering command or reminder makes no requests or writes; viewer never requests private execution',async()=>{
 dom();const {renderStockCommand,renderPrivateReminder,renderExecutionScore}=await api,ctx=context(market(),'view');
 renderStockCommand(ctx);renderPrivateReminder(ctx);const score=renderExecutionScore(ctx);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ctx.calls.length,0);assert.match(content(score),/编辑者权限/);ctx.controller.abort();
});
test('command submission reads bounded archives serially and never runs capture, notifications or writes',async t=>{
 dom();t.mock.method(Date,'now',()=>now);const {renderStockCommand}=await api,ctx=context(),view=renderStockCommand(ctx);
 let active=0,max=0;
 ctx.api=async(url,options)=>{ctx.calls.push({url,options});active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return observation(new URL('https://local'+url).searchParams.get('symbol'));};
 find(view,n=>n.tag==='input').value='近5日主力净流入前5的芯片股';
 await find(view,n=>n.tag==='form').listeners.submit({preventDefault(){}});
 assert.equal(max,1);assert.equal(ctx.calls.length,2);assert.ok(ctx.calls.every(c=>c.url.startsWith('/api/research/stock-observations?')&&!c.options.method));
 assert.match(content(view),/甲/);assert.match(content(view),/乙/);assert.doesNotMatch(content(view),/null/);ctx.controller.abort();
});
test('switching date during command read cancels old results while preserving typed query',async t=>{
 dom();t.mock.method(Date,'now',()=>now);const {renderStockCommand}=await api,ctx=context(),view=renderStockCommand(ctx);
 let release;ctx.api=()=>new Promise(resolve=>{release=resolve;});const input=find(view,n=>n.tag==='input');input.value='近5日主力净流入前5的芯片股';
 const work=find(view,n=>n.tag==='form').listeners.submit({preventDefault(){}});
 ctx.state={...market(),closeSession:{day:'2026-11-24'}};for(const listener of ctx.listeners)listener();
 release(observation());await work;assert.match(content(view),/交易日已切换/);assert.doesNotMatch(content(view),/10400|最高成交/);assert.equal(input.value,'近5日主力净流入前5的芯片股');ctx.controller.abort();
});
test('execution UI requests only the formal research book after close',async t=>{
 dom();t.mock.method(Date,'now',()=>now);const {renderExecutionScore}=await api,ctx=context();
 ctx.api=async(url,options)=>{ctx.calls.push({url,options});return {ok:true,state:record()};};
 const view=renderExecutionScore(ctx,{accountKey:'pool'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ctx.calls.length,1);assert.equal(ctx.calls[0].url,'/api/research/shortline');assert.deepEqual(ctx.calls[0].options.headers,{'X-V6-Research-Book':'main'});
 assert.equal(ctx.calls[0].options.method,undefined);assert.match(content(view),/100 \/ 100/);ctx.controller.abort();
});
test('a replaced execution panel unsubscribes and ignores its outstanding archive response',async t=>{
 dom();t.mock.method(Date,'now',()=>now);const {renderExecutionScore}=await api,ctx=context(),handlers=new Set();
 ctx.onState=callback=>{handlers.add(callback);return ()=>handlers.delete(callback);};
 let release;ctx.api=(url,options)=>{ctx.calls.push({url,options});return new Promise(resolve=>{release=resolve;});};
 const view=renderExecutionScore(ctx,{accountKey:'pool',account:todayAccount()});view.isConnected=true;
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ctx.calls.length,1);assert.equal(handlers.size,1);
 const before=content(view);view.isConnected=false;for(const callback of handlers)callback();
 assert.equal(handlers.size,0);release({ok:true,state:todayPlans()});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(content(view),before);assert.equal(ctx.calls.length,1);ctx.controller.abort();
});
