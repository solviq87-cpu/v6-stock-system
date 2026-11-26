'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayStrategyPortfolios}=require('../src/core/strategy-portfolio-lab');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const stock=code=>({code,market:'main',bars:dates.map(date=>({date,open:10,close:10,high:10,low:10,volume:100000}))});
const history=()=>({source:'fixture',asOf:dates.at(-1),stocks:[stock('600000'),stock('600001')]});
const sig=(system,symbol,day,version='v1',verdict='pass')=>({system,symbol,date:dates[day],observedThrough:dates[day],verdict,provenance:'isolated/native/'+version,evaluatorVersion:version});
const cfg={initialCash:10000,maxPositions:2,allocationPct:.5,feeBps:0,slippageBps:0,sellTaxBps:0,minCommission:0,maxDrawdownPct:4};
function replay(h,signals,options={}){return replayStrategyPortfolios(h,signals,{config:{...cfg,...options}});}
test('opening sale loss does not overwrite the previous-close risk observation',()=>{
 const h=history();
 h.stocks[0].bars[33]={...h.stocks[0].bars[33],open:9.1,low:9.1,high:10,close:10};
 const p=replay(h,[sig('fourteen','600000',31),sig('fourteen','600001',32)]).systems.fourteen;
 assert.equal(p.equity[1].equity,10000);
 assert.equal(p.fills.find(f=>f.side==='buy'&&f.symbol==='600001')?.qty,500);
 assert.ok(p.orders.every(o=>!(o.date===dates[33]&&o.side==='buy'&&o.status==='blocked')));
 assert.equal(p.equity.find(e=>e.date===dates[33]).equity,9550);
 assert.equal(p.metrics.halted,true,'the actual closing loss still triggers the original circuit breaker');
});
test('opening sale profit cannot inflate a budget declared as previous-close allocation',()=>{
 const h=history();
 h.stocks[0].bars[33]={...h.stocks[0].bars[33],open:10.8,high:10.8,close:10};
 const p=replay(h,[sig('bazi','600000',31),sig('bazi','600001',32)],{lotSize:1}).systems.bazi;
 assert.equal(p.fills.find(f=>f.side==='buy'&&f.symbol==='600001').qty,500);
 assert.equal(p.equity.find(e=>e.date===dates[33]).equity,10400);
});
test('four accounts keep the original entry evaluator version through realized exits',()=>{
 const h=history(),signals=['fourteen','bazi','gpt','python'].flatMap(system=>[sig(system,'600000',31,'v1'),sig(system,'600001',34,'v2')]);
 h.stocks[0].bars[33]={...h.stocks[0].bars[33],open:10.2,high:10.2};
 const before=JSON.stringify({h,signals}),p=replay(h,signals);
 for(const name of ['fourteen','bazi','gpt','python']){
  const s=p.systems[name],v=s.versionAttribution;
  assert.equal(v.status,'mixed-version');assert.equal(v.separateCapitalByVersion,false);
  assert.equal(v.unattributedFills,0);assert.equal(v.versions.length,2);
  assert.equal(s.fills[0].signalRef.evaluatorVersion,'v1');
  assert.deepEqual(s.fills[0].signalRef,s.fills[1].signalRef);
  assert.equal(s.fills[2].signalRef.evaluatorVersion,'v2');
  assert.deepEqual(s.fills[2].signalRef,s.fills[3].signalRef);
  assert.equal(v.versions[0].closedTrades,1);assert.equal(v.versions[0].realizedPnl,100);
  assert.equal(v.versions[1].closedTrades,1);assert.equal(v.versions[1].realizedPnl,0);
  assert.equal(s.metrics.realizedPnl,100);
 }
 assert.equal(JSON.stringify({h,signals}),before);
});
test('blocked passing signals and no-evidence systems never invent version performance',()=>{
 const h=history();h.stocks[0].bars[32].volume=0;
 const p=replay(h,[sig('gpt','600000',31,'__proto__'),sig('python','600000',31,'unknown','unknown')]);
 const v=p.systems.gpt.versionAttribution;
 assert.equal(v.status,'single-version');assert.equal(v.versions[0].evaluatorVersion,'__proto__');
 assert.equal(v.versions[0].passSignalsConsidered,1);assert.equal(v.versions[0].closedTrades,0);assert.equal(v.versions[0].winRatePct,null);
 assert.equal(p.systems.python.versionAttribution.status,'not-evaluated');
 assert.deepEqual(p.systems.python.versionAttribution.versions,[]);
});
test('invalid evaluator identity and adjusted execution price declarations fail closed',()=>{
 for(const v of [123,{},'  ','v\n1','x'.repeat(257)])assert.throws(()=>replay(history(),[sig('fourteen','600000',31,v)]),/来源|策略无效/);
 for(const mutate of [h=>h.priceBasis='hfq',h=>h.stocks[0].priceBasis='qfq',h=>h.stocks[0].bars[1].priceAdjustment={mode:'unknown'}]){
  const h=history();mutate(h);assert.throws(()=>replay(h,[]),/未复权/);
 }
});
