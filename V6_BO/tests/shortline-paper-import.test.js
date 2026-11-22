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
  return {dir,file,state,service,fill,run:(time='2026-11-13T15:00:00+08:00')=>importSettledPaperTrades(state,{accountDir:dir,now:Date.parse(time)})};
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
