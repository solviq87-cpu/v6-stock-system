'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {importSettledPaperTrades}=require('../src/research/shortline-paper-import');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shortline-paper-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'pool.json'),state={trades:[],plans:[],explanations:[]};
  let now=Date.parse('2026-11-04T10:00:00+08:00');
  const service=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
  function fill(id,side,price,quantity,time,strategyId){
    now=Date.parse(time+'+08:00');
    const tradeDate=aShareCalendarDate(now),symbol='600000',quote={symbol,timestamp:now,source:'simulated',tradeDate,
      suspended:false,tradable:true,price,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5};
    service.submit({orderId:id,side,quantity,symbol,limitPrice:price,tradeDate,...(strategyId?{strategyId}:{})});
    return service.fill(id,id+'-fill',quote);
  }
  return {dir,file,state,service,fill,setTime:value=>{now=value;},run:(time='2026-11-13T15:00:00+08:00')=>importSettledPaperTrades(state,{accountDir:dir,now:Date.parse(time)})};
}
test('对账本已结算的分批成交重建FIFO含费成本；回流幂等且源文件保持原字节',t=>{
  const x=setup(t);
  x.service.initialize(100000);
  const manual={id:'manual',source:'人工样本',name:'保留'};x.state.trades.push(manual);
  x.fill('b1','buy',10,200,'2026-11-04T10:00:00','trend-v1');
  x.fill('b2','buy',11,100,'2026-11-04T10:15:00','trend-v1');
  assert.equal(x.run().imported,0);
  x.fill('s1','sell',12,100,'2026-11-05T10:05:00');
  const book=x.fill('s2','sell',13,200,'2026-11-06T11:05:00');
  const before=fs.readFileSync(x.file),names=fs.readdirSync(x.dir);
  const r=x.run();
  assert.equal(r.imported,2);assert.equal(r.skipped,0);assert.deepEqual(r.exitDays,['2026-11-05','2026-11-06']);
  assert.deepEqual(x.state.trades[0],manual);
  const samples=x.state.trades.slice(1);
  assert.equal(samples[0].entryTime,'2026-11-04T10:00');assert.equal(samples[1].exitTime,'2026-11-06T11:05');
  assert.equal(samples[1].paperSettlement.entryFills.length,2);
  assert.equal(samples[1].strategy,'trend-v1');assert.equal(samples[1].shares,200);
  for(const [i,sample] of samples.entries()){
    const sell=book.account.events[i+2];
    assert.equal(sample.costBasis,sell.costBasis);assert.equal(sample.pnlAmount,sell.realizedPnl);
    assert.equal(sample.pnl,Math.round(sell.realizedPnl/sell.costBasis*10000)/100);
    assert.equal(sample.source,'V6 模拟成交');assert.equal(sample.snapshotVerified,false);
    assert.equal(sample.planId,null);assert.equal(sample.position,null);assert.equal(sample.violations.length,0);
    assert.ok(sample.disciplineFacts.every(x=>x.status==='资料不足'));
    assert.ok(sample.createdAt>'2026-11-07');
  }
  const archive=structuredClone(x.state.trades);
  const replay=x.run();
  assert.equal(replay.imported,0);assert.equal(replay.existing,2);
  assert.deepEqual(replay.exitDays,[]);assert.deepEqual(x.state.trades,archive);
  assert.deepEqual(fs.readFileSync(x.file),before);assert.deepEqual(fs.readdirSync(x.dir),names);
});
test('迁移前持仓无可核验买入事件，卖出不自动认定；后续可核验批次可回流',t=>{
  const x=setup(t);
  x.service.adoptLegacy({cash:100000,positions:{'600000':{shares:100,buyPrice:10,buyTs:Date.parse('2026-11-03T10:00:00+08:00'),basis:1005}},trades:[],realized:0});
  x.fill('s0','sell',11,100,'2026-11-04T10:00:00');
  x.fill('b1','buy',11,100,'2026-11-05T10:00:00');
  x.fill('s1','sell',12,100,'2026-11-06T11:00:00');
  const r=x.run();assert.equal(r.skipped,1);assert.equal(r.imported,1);
  assert.equal(x.state.trades[0].paperSettlement.exitEventId,'s1-fill');
});
test('未来执行、缺精确成交时间及净成本无法对齐的样本不回流',t=>{
  const x=setup(t);x.service.initialize(100000);
  x.fill('b1','buy',10,100,'2026-11-04T10:00:00');
  x.fill('s1','sell',11,100,'2026-11-05T11:00:00');
  assert.equal(x.run('2026-11-05T10:59:59+08:00').imported,0);
  // Model an older date-only snapshot already accepted by the native service.
  const source=JSON.parse(fs.readFileSync(x.file));
  const rewrite=book=>{
    book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});
    delete book.fingerprint;book.fingerprint=hash(book);fs.writeFileSync(x.file,JSON.stringify(book));
  };
  const changed=structuredClone(source);
  changed.account.events.at(-1).costBasis+=1;
  rewrite(changed);assert.equal(x.run().skipped,1);assert.equal(x.state.trades.length,0);
  const old=structuredClone(source);
  delete old.fillEvidenceVersion;delete old.legacyFillEvidenceCount;
  const reducer=require('../src/core/paper-order-state-machine').reducePaperOrderEvents;
  for(const e of old.account.events){delete e.timestamp;delete e.fillEvidence;}
  for(const r of Object.values(old.orders)){
    for(const e of r.events){delete e.timestamp;delete e.fillEvidence;}
    r.state=reducer(r.order,r.events);
  }
  rewrite(old);assert.equal(x.run().imported,0);assert.equal(x.state.trades.length,0);
});
test('账户缺失、指纹损坏、非模拟账本和符号链接均不会写回或泄露账户',t=>{
  const x=setup(t);const dir=path.join(x.dir,'missing');
  assert.equal(importSettledPaperTrades(x.state,{accountDir:dir}).missing,2);
  assert.equal(fs.existsSync(dir),false);
  x.service.initialize(100000);const book=JSON.parse(fs.readFileSync(x.file));
  book.account.cash=-100;fs.writeFileSync(x.file,JSON.stringify(book));
  const before=fs.readFileSync(x.file);fs.symlinkSync(x.file,path.join(x.dir,'pre.json'));
  const report=x.run();assert.equal(report.imported,0);assert.equal(report.issues.length,2);
  assert.deepEqual(fs.readFileSync(x.file),before);
  fs.unlinkSync(path.join(x.dir,'pre.json'));fs.unlinkSync(x.file);
  x.service.initialize(100000);
  const wrong=JSON.parse(fs.readFileSync(x.file));wrong.paperOnly=false;delete wrong.fingerprint;
  wrong.fingerprint=hash(wrong);fs.writeFileSync(x.file,JSON.stringify(wrong));
  assert.equal(x.run().issues.length,1);
});
test('授权行情同步自动归集已结算模拟样本、生成离场日复盘并跨重读去重',async t=>{
  const x=setup(t);x.service.initialize(100000);
  x.fill('entry','buy',10,100,'2026-11-04T10:00:00');
  x.fill('exit','sell',12,100,'2026-11-05T11:00:00');
  const old=process.env.V6_ORDER_ACCOUNTS_DIR;
  process.env.V6_ORDER_ACCOUNTS_DIR=x.dir;
  t.after(()=>{if(old===undefined)delete process.env.V6_ORDER_ACCOUNTS_DIR;else process.env.V6_ORDER_ACCOUNTS_DIR=old;});
  const {shortlineJob}=await import('../src/research/shortline/store.mjs');
  const root=path.join(x.dir,'research');
  const day='2026-11-06',stock={code:'600000',name:'集成样本'};
  const snapshot={...stock,stock,day,latestClosed:false,latestClosedDay:day,
    observedAt:day+' 16:00',observedAtMs:Date.parse(day+'T16:00:00+08:00'),bars:[],market:[],evidence:[],missing:['缺少收盘行情']};
  const first=await shortlineJob({root,input:{action:'v6:sync',revision:0,payload:{code:stock.code}},snapshot});
  assert.equal(first.result.settlements.imported,1);assert.equal(first.state.trades.length,1);
  assert.ok(first.state.notes.some(n=>n.date==='2026-11-05'));
  const read=await shortlineJob({root});
  assert.deepEqual(read.state.trades,first.state.trades);
  const second=await shortlineJob({root,input:{action:'v6:sync',revision:read.state.revision,payload:{code:stock.code}},snapshot});
  assert.equal(second.result.settlements.existing,1);assert.deepEqual(second.state.trades,first.state.trades);
});

test('主实例的账本轮询在无候选、未打开网页时也会生成模拟样本和离场日复盘',async t=>{
  const x=setup(t),root=path.join(x.dir,'research'),manual=path.join(x.dir,'absent-manual');
  const {syncManualLedger,shortlineJob}=await import('../src/research/shortline/store.mjs');
  x.service.initialize(100000);
  x.fill('round-b','buy',10,100,'2026-11-04T10:00:00','trend-v1');
  x.fill('round-s','sell',11,100,'2026-11-05T10:05:00');
  const first=await syncManualLedger(root,manual,x.dir);
  assert.equal(first.imported,1);assert.equal(first.revision,1);
  const second=await syncManualLedger(root,manual,x.dir);
  assert.equal(second.changed,false);assert.equal(second.revision,1);
  const saved=await shortlineJob({root});assert.equal(saved.state.trades.length,1);
  assert.ok(saved.state.notes.some(n=>n.date==='2026-11-05'));
});

function automaticPlan(x,{index=1,at=Date.parse('2026-11-04T10:00:15+08:00')}={}){
 const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
 const day=aShareCalendarDate(at),card={authority:'fayo-decision-center',decisionId:String(index).repeat(64),code:'600000',day,
  calculatedAt:at-6000,strategyAt:at-30000,quoteBasis:{source:'tencent',quoteAt:at-7000,receivedAt:at-6500,price:10},
  strategyBasis:{day,score:88},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
 return bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-'+String(index).padStart(12,'0'),sampleSet:'real',
  frozenAt:new Date(at-5000).toISOString(),factors:['YZ-08'],labels:{cycle:'回暖'},...decisionPlanPayload(card)},card);
}
function nativeBuy(x,plan,at=Date.parse('2026-11-04T10:00:15+08:00')){
 x.setTime(at);const current=x.service.legacy(),old=current.positions['600000'];
 const shares=(old?.shares||0)+100,basis=(old?.basis||0)+1005;
 const trade={t:at,side:'买入',code:'600000',name:'已冻结计划',price:10,shares:100,amount:1000,fee:5,pnl:null,reason:'作战台计划['+plan.id+'] 600000 · 原账户风控'};
 const next={...current,cash:current.cash-1005,positions:{...current.positions,'600000':{code:'600000',name:'已冻结计划',shares,basis,buyPrice:10,buyTs:at,lastPrice:10,peak:0,reason:trade.reason}},trades:[trade,...current.trades]};
 const quote={symbol:'600000',price:10,quoteAt:at,timestamp:at,receivedAt:at,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',
  tradeDate:aShareCalendarDate(at),volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true};
 return x.service.saveLegacy(next,x.service.read().revision,{quotes:{'600000':quote}});
}
function roundTrip(x,plan){
 x.service.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
 nativeBuy(x,plan);x.fill('exit-linked','sell',11,100,'2026-11-05T11:00:00');
}
test('决策模拟平仓通过原买入事件关联事前冻结计划，保留精确时点和实际因子，不修改账本',t=>{
 const x=setup(t),plan=automaticPlan(x);x.state.plans.push(plan);roundTrip(x,plan);
 const before=fs.readFileSync(x.file);assert.equal(x.run().imported,1);
 const row=x.state.trades[0];assert.equal(row.planId,plan.id);assert.equal(row.planVerified,true);assert.equal(row.snapshotVerified,true);
 assert.deepEqual(row.factors,['YZ-08']);assert.equal(row.frozenLabels.cycle,'回暖');assert.equal(row.planStatus,'已冻结');
 assert.equal(row.entryTimestamp,Date.parse('2026-11-04T10:00:15+08:00'));assert.ok(Date.parse(plan.frozenAt)>Date.parse(row.entryTime+':00+08:00'));
 assert.ok(Date.parse(plan.frozenAt)<row.entryTimestamp);assert.equal(row.exitTimestamp,Date.parse('2026-11-05T11:00:00+08:00'));
 assert.equal(row.decisionLink.entryEventIds[0],row.paperSettlement.entryFills[0].eventId);assert.equal(row.disciplineFacts[0].status,'符合');
 assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.run().existing,1);
});
test('未来冻结、改股改价或不唯一计划不关联；禁止凭股票和日期猜计划',t=>{
 for(const change of [p=>({...p,frozenAt:'2026-11-04T10:00:16+08:00'}),p=>({...p,code:'600001'}),p=>({...p,entryMax:20}),p=>null]){
  const x=setup(t),plan=automaticPlan(x);roundTrip(x,plan);const invalid=change(plan);if(invalid)x.state.plans.push(invalid);
  assert.equal(x.run().imported,1);assert.equal(x.state.trades[0].planId,null);assert.equal(x.state.trades[0].snapshotVerified,false);
 }
 const x=setup(t),plan=automaticPlan(x);roundTrip(x,plan);x.state.plans.push(plan,structuredClone(plan));x.run();assert.equal(x.state.trades[0].planId,null);
});
test('同股多计划合并卖出不套用单一计划，已导入衍生记录可安全补关联且重读幂等',t=>{
 const x=setup(t),a=automaticPlan(x),b=automaticPlan(x,{index:2,at:Date.parse('2026-11-04T10:01:15+08:00')});
 x.service.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
 x.state.plans.push(a,b);nativeBuy(x,a);nativeBuy(x,b,Date.parse('2026-11-04T10:01:15+08:00'));
 x.fill('mixed-exit','sell',11,200,'2026-11-05T11:00:00');x.run();assert.equal(x.state.trades[0].planId,null);
 const y=setup(t),p=automaticPlan(y);roundTrip(y,p);y.run('2026-11-06T15:00:00+08:00');
 const initial=structuredClone(y.state.trades[0]),ledger=fs.readFileSync(y.file);y.state.plans.push(p);
 const repair=y.run('2026-11-09T15:00:00+08:00');assert.equal(repair.imported,0);assert.equal(repair.updated,1);
 const linked=y.state.trades[0];assert.equal(linked.id,initial.id);assert.equal(linked.sourceFingerprint,initial.sourceFingerprint);
 assert.equal(linked.firstCollectedAt,initial.createdAt);assert.ok(linked.createdAt>initial.createdAt);assert.equal(linked.planId,p.id);
 assert.equal(y.run().existing,1);assert.deepEqual(fs.readFileSync(y.file),ledger);
});

test('native plan adapter, persistent account, T+1 settlement and repeated learning review share the original evidence',t=>{
 const x=setup(t),at=Date.parse('2026-11-04T10:00:15+08:00'),plan=automaticPlan(x,{at}),day=aShareCalendarDate(at),code='600000';
 const {executeDecisionPlan}=require('../src/core/paper-decision-plan');
 x.service.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
 x.setTime(at);x.state.plans.push(plan);
 const quote={symbol:code,price:10,quoteAt:at-1000,timestamp:at-1000,receivedAt:at-500,quoteSource:'tencent',provider:'tencent',
  mode:'public-live-unverified',tradeDate:day,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true,canTrade:true};
 let calls=0;
 const input={input:{action:'executePlan',account:'pool',planId:plan.id},plan,now:at,day,replica:false,continuous:true,
  candidate:{code},eligiblePick:()=>true,systemPickDay:()=>day,poolDay:day,newsBlocked:false,account:x.service.legacy(),
  policy:{maxPos:5},equity:100000,quote,authoritative:plan.decisionEvidence,readBook:()=>x.service.read(),
  buy(row,reason){calls++;assert.equal(row.code,code);assert.equal(reason,'作战台计划['+plan.id+'] '+code+' · 原账户风控');nativeBuy(x,plan,at);}};
 const opened=fs.readFileSync(x.file);
 assert.throws(()=>executeDecisionPlan({...input,quote:{...quote,symbol:'600001'}}),/只读、来源冲突或时点不一致/);
 assert.equal(calls,0);assert.deepEqual(fs.readFileSync(x.file),opened);
 const executed=executeDecisionPlan(input);assert.equal(executed.status,'executed');assert.equal(calls,1);
 const bought=fs.readFileSync(x.file),retry=executeDecisionPlan(input);assert.equal(retry.status,'already-executed');
 assert.equal(retry.eventId,executed.eventId);assert.equal(calls,1);assert.deepEqual(fs.readFileSync(x.file),bought);
 x.fill('integrated-exit','sell',11,100,'2026-11-05T11:00:00');
 const settled=fs.readFileSync(x.file),book=x.service.read();
 assert.equal(x.run().imported,1);const original=structuredClone(x.state.trades[0]);
 assert.equal(original.planId,plan.id);assert.equal(original.snapshotVerified,true);
 assert.equal(original.decisionLink.entryEventIds[0],executed.eventId);
 assert.equal(original.pnlAmount,book.account.events.at(-1).realizedPnl);
 // Model a previously accepted but no longer eligible saved research projection.
 // The original durable account bytes are never rewritten by this importer.
 plan.decisionEvidence.quoteBasis.mode='historical-replay';
 assert.equal(x.run().updated,1);const row=x.state.trades[0];assert.equal(row.snapshotVerified,false);
 assert.equal(row.planId,null);assert.deepEqual(row.factors,[]);assert.equal(row.pnlAmount,original.pnlAmount);
 assert.deepEqual(row.planEvidenceReview.priorProjection,original);assert.equal(x.run().existing,1);
 assert.deepEqual(fs.readFileSync(x.file),settled);
});


test('integrated learning consumes the verified settlement, excludes quarantine and never backdates restored evidence',async t=>{
 const x=setup(t),plan=automaticPlan(x);
 x.state.plans.push(plan);roundTrip(x,plan);
 const {readLearningRows,predict}=await import('../public/nova/shortline/learning.mjs');
 const first='2026-11-13T15:00:00+08:00',review='2026-11-14T15:00:00+08:00',restored='2026-11-15T15:00:00+08:00';
 const when=s=>Date.parse(s),ledger=fs.readFileSync(x.file);
 const training=s=>readLearningRows(x.state,when(s)).filter(r=>r.learningOutcomeBasis==='recorded-settlement');
 const experience=s=>predict(x.state,{asOf:when(s)}).experience.cohorts.find(c=>c.basis==='recorded-settlement');
 assert.equal(x.run(first).imported,1);
 const original=structuredClone(x.state.trades[0]);
 assert.equal(training(first).length,1);
 assert.equal(experience(first).n,1);
 assert.ok(training(first)[0].factors.includes('YZ-08'));
 plan.decisionEvidence.quoteBasis.mode='historical-replay';
 assert.equal(x.run(review).updated,1);
 assert.equal(training(review).length,0);assert.equal(experience(review).n,0);
 assert.equal(x.state.trades[0].pnlAmount,original.pnlAmount);
 assert.equal(x.state.trades[0].sourceFingerprint,original.sourceFingerprint);
 assert.deepEqual(x.state.trades[0].planEvidenceReview.priorProjection,original);
 assert.equal(x.run(review).existing,1);
 delete plan.decisionEvidence.quoteBasis.mode;
 assert.equal(x.run(restored).updated,1);
 assert.equal(training(review).length,0);
 assert.equal(training(restored).length,1);
 assert.equal(experience(restored).n,1);
 assert.equal(training(restored)[0].labelKnownAt,'2026-11-15T15:00');
 assert.equal(x.state.trades[0].firstCollectedAt,original.createdAt);
 assert.equal(x.state.trades[0].sourceFingerprint,original.sourceFingerprint);
 assert.equal(x.run(restored).existing,1);
 assert.deepEqual(fs.readFileSync(x.file),ledger);
});
