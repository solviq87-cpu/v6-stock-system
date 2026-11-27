'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../src/core/decision-model.mjs');
const day='2026-11-25',at=clock=>Date.parse(day+'T'+clock+'+08:00');
const now=at('10:00:00');
const stock=(t)=>({code:'600001',name:'公开报价候选',price:10,pct:2,score:85,
 quoteAt:t-1000,receivedAt:t-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,
 poolDay:day,volume:100000,amount:1000000,paths:['横盘放量'],
 levels:{ma5:9.8,stop:9.7,t1:11}});
const state=(t=now)=>({trading:true,marketClock:{day,trading:true},poolDay:day,pool:[stock(t)],
 marketDistribution:{kind:'market-distribution-intraday',source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',
  day,quoteAt:t-30000,knownAt:t-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
 dabanke:{day,knownAt:t-20000,mode:'盘中',market:{quoteAt:t-30000},ecology:[{label:'当日封板',success:70,total:90}]},
 paper:{pool:{enabled:true,equity:100000,cash:100000,positions:[],executionPolicy:{maxPositions:5,allocationPct:19.6}}}});

const cases=[
 ['original acceptable plan',r=>{},true],
 ['exact unrounded ratio two',r=>{r.levels.t1=10.6},true],
 ['rounded original rr cannot pass a sub-threshold ratio',r=>{r.levels.t1=10.59;r.levels.rr=2},false],
 ['a tempting low MA5 cannot substitute for the worst entry',r=>{r.levels.t1=10.4;r.levels.rr=10},false],
 ['high conviction or high score cannot compensate for low remaining upside',r=>{r.score=100;r.paths=['横盘放量','趋势突破','多因子'];r.levels.t1=10.2},false],
 ['a move toward the same target triggers a new chase-risk veto',r=>{r.price=10.5},false],
 ['a smaller entry can qualify without moving the frozen stop or target',r=>{r.price=9.9},true],
 ['missing original target remains blocked',r=>{r.levels.t1=null;r.levels.rr=10},false],
 ['inverted target cannot produce a risk ratio',r=>{r.levels.t1=9.9},false],
 ['an arbitrary high cached rr never overrides current arithmetic',r=>{r.levels.t1=10.3;r.levels.rr=99},false],
 ['exact retry with unchanged valid plan remains allowed',r=>{r.levels.rr=0},true]
];
for(const [name,change,allowed] of cases)test('decision chase risk: '+name,async()=>{
 const {buildDecisionBoard,decisionPlan,stockConclusion}=await model,s=state(),r=s.pool[0];change(r);
 const before=JSON.stringify(s),p=decisionPlan(r,s.paper.pool),out=buildDecisionBoard(s,{now});
 assert.equal(out.cards.length,allowed?1:0);
 assert.equal(p.buyHigh,r.price);assert.equal(p.stop,r.levels.stop);assert.equal(p.target,r.levels.t1);
 assert.equal(p.positionPct,19.6);assert.equal(p.riskReward.canTrade,false);
 if(p.riskReward.status==='insufficient-gross-reward'){
  assert.equal(stockConclusion(r,{day,now}).label,'回避');
  assert.match(out.reasons.join(''),/低于原1:2纪律/);
 }
 if(allowed)assert.equal(out.cards[0].plan.riskReward.status,'meets-gross-discipline');
 assert.equal(JSON.stringify(s),before);
});
test('a high score or greater resonance does not override the new chase veto; the lower-scored eligible row survives',async()=>{
 const {buildDecisionBoard}=await model,s=state(),bad=s.pool[0];bad.score=100;bad.levels.t1=10.2;
 const good=stock(now);good.code='600002';good.score=65;s.pool.push(good);
 s.yierAsOf=day;s.yierList=[bad];s.lianbanAsOf=day;s.lianbanList=[bad];
 const out=buildDecisionBoard(s,{now});assert.equal(out.cards.length,1);assert.equal(out.cards[0].code,good.code);
 assert.equal(out.blockedCounts[Object.keys(out.blockedCounts).find(k=>k.includes('低于原1:2纪律'))],1);
});
test('risk ratio and theoretical boundary are scenario arithmetic, not a loss cap or probability',async()=>{
 const {decisionPlan}=await model,s=state(),p=decisionPlan(s.pool[0],s.paper.pool),risk=p.riskReward;
 assert.ok(Math.abs(risk.ratio-10/3)<1e-10);assert.equal(risk.riskPct,3);assert.equal(risk.rewardPct,10);
 assert.ok(Math.abs(risk.maxEntryAtMinimumRatio-(11+2*9.7)/3)<1e-10);
 assert.equal(risk.canTrade,false);assert.equal(risk.costBasis,'gross-before-fees-slippage-and-T+1-gap-risk');
});

test('real computeLevels and decision board agree for original negative and corrected positive HTTP/browser OHLCV fixtures',async()=>{
 const {computeLevels}=require('../analysis'),{buildDecisionBoard}=await model;
 for(const [price,offset,scale] of [[10.4,0,1],[11.4,1,1],[12.4,2,1],[1000,0,1000/10.4]]){
  for(const allowed of [false,true]){
   const s=state(),r=s.pool[0];r.price=price;
   const todayHigh=allowed?price:(10.6+offset)*scale;
   const bars=Array.from({length:30},(_,i)=>({date:new Date(Date.parse(day)-(29-i)*86400000).toISOString().slice(0,10),
     open:(10.2+offset)*scale,close:(10.2+offset)*scale,low:(10+offset)*scale,
     high:i===29?todayHigh:((allowed?11.6:11)+offset)*scale,volume:100000}));
   r.levels=computeLevels(bars,r.price,todayHigh,(10.2+offset)*scale);
   const out=buildDecisionBoard(s,{now}),ratio=(r.levels.t1-r.price)/(r.price-r.levels.stop);
   assert.equal(ratio>=2,allowed,JSON.stringify({price,ratio,levels:r.levels}));
   assert.equal(out.cards.length,allowed?1:0,JSON.stringify(out.reasons));
   if(!allowed)assert.match(out.reasons.join(''),/低于原1:2纪律/);
  }
 }
});
