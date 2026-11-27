'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildDecisionCenter}=require('../src/core/decision-center');
const model=import('../src/core/decision-model.mjs');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00');
const stock=(symbol='600001',patch={})=>({code:symbol,name:'公开报价候选',price:10,pct:2,score:85,
 quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,
 poolDay:day,volume:100000,amount:1000000,paths:['横盘放量','MACD水上金叉'],pathWhy:{横盘放量:'成交量达到现有阈值'},
 sector:'芯片',levels:{ma5:9.8,stop:9.7,t1:11,r1:11.05},...patch});
const state=(rows=[stock()])=>({trading:true,marketClock:{day,trading:true},closeSession:null,pool:rows,poolDay:day,
 decisionAccountEvidence:{source:'PAPER.pool / PAPER_CFG.pool',sourceAt:now-500,kind:'server-account-snapshot'},
 decisionLevels:Object.fromEntries(rows.map(row=>[row.code,{levels:row.levels,source:'原腾讯日 K',sourceAt:now-30000,
  throughDay:day,asOf:now,quoteAt:row.quoteAt,adjustment:'qfq'}])),
 marketDistribution:{kind:'market-distribution-intraday',source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',
  day,quoteAt:now-30000,knownAt:now-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
 dabanke:{day,knownAt:now-20000,ecology:[{label:'当日封板',success:70,total:90}]},
 paper:{pool:{enabled:true,equity:100000,cash:100000,positions:[],executionPolicy:{maxPositions:5,allocationPct:19.6}}}});
function currentState(){
 const s=state([stock('600001',{quoteAt:now-600000,receivedAt:now-599000,price:9.9,amount:999999})]);
 s.decisionQuotes=[{code:'600001',name:'同股实时原行',price:10,preClose:9.8,volume:123456,quoteAt:now-1000,receivedAt:now-500,
  quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,canNotify:true}];
 s.decisionLevels={'600001':{code:'600001',levels:{ma5:9.8,stop:9.7,t1:11,r1:11.05},source:'原腾讯日 K',sourceAt:now-30000,
  throughDay:day,asOf:now,quoteAt:now-1000}};
 return s;
}

function latest(s,at=now-300){
 const q={...s.decisionQuotes[0],quoteAt:at,receivedAt:now};
 s.decisionLevels['600001'].quoteAt=at;return q;
}
const cases=[
 ['clean independent quote keeps original score and clock',s=>{},true],
 ['current sourceConflict',s=>{s.decisionQuotes[0].sourceConflict=true;},false],
 ['current quoteSourceConflict',s=>{s.decisionQuotes[0].quoteSourceConflict=true;},false],
 ['current conflict boolean',s=>{s.decisionQuotes[0].conflict=true;},false],
 ['current evidenceStatus conflict',s=>{s.decisionQuotes[0].evidenceStatus='conflict';},false],
 ['current provider alias contradicts source',s=>{s.decisionQuotes[0].quoteProvider='eastmoney';},false],
 ['current generic price source contradicts source',s=>{s.decisionQuotes[0].source='eastmoney';},false],
 ['distinct generic funds stream is not a price conflict',s=>{s.decisionQuotes[0].source='eastmoney';s.decisionQuotes[0].fundsSource='eastmoney';},true],
 ['secondary mode contradicts preferred live mode',s=>{s.decisionQuotes[0].mode='simulation';},false],
 ['explicit historical close flag',s=>{s.decisionQuotes[0].historicalClose=true;},false],
 ['current original halt veto',s=>{s.decisionQuotes[0].halt=true;},false],
 ['strategy source conflict cannot be washed away by refreshing price',s=>{s.pool[0].sourceConflict=true;},false],
 ['strategy secondary mode cannot be washed away',s=>{s.pool[0].mode='research-only';},false],
 ['same time differing price in either order A',s=>{s.decisionQuotes.push({...s.decisionQuotes[0],price:10.1});},false],
 ['same time differing price in either order B',s=>{s.decisionQuotes.unshift({...s.decisionQuotes[0],price:10.1});},false],
 ['same price differing permission',s=>{s.decisionQuotes.unshift({...s.decisionQuotes[0],canTrade:false});},false],
 ['same price differing source',s=>{s.decisionQuotes.push({...s.decisionQuotes[0],quoteSource:'eastmoney'});},false],
 ['identical original retransmission with a newer receipt',s=>{s.decisionQuotes.push({...s.decisionQuotes[0],receivedAt:now});},true],
 ['same time retry cannot hide invalid receivedAt',s=>{s.decisionQuotes.unshift({...s.decisionQuotes[0],receivedAt:null});},false],
 ['newer bad batch cannot revive old good price',s=>{s.decisionQuotes.unshift({...latest(s),sourceConflict:true});},false],
 ['newer good original can supersede an earlier bad quote',s=>{const q=latest(s);s.decisionQuotes[0].sourceConflict=true;s.decisionQuotes.unshift(q);},true],
 ['future original is not silently filtered before selecting an older one',s=>{s.decisionQuotes.unshift({...s.decisionQuotes[0],quoteAt:now+1,receivedAt:now+1});},false],
 ['unknown original clock in current quote group',s=>{s.decisionQuotes.unshift({...s.decisionQuotes[0],quoteAt:null});},false],
 ['alternate quote clock mismatch',s=>{s.decisionQuotes[0].quoteTimestamp=now-2000;},false]
];

for(const [name,alter,allowed] of cases)test('original decision quote lineage: '+name,async()=>{
 const s=currentState();alter(s);const before=JSON.stringify(s),out=await buildDecisionCenter(s,{now});
 assert.equal(out.cards.length,allowed?1:0,JSON.stringify(out.reasons));
 if(allowed){
  assert.equal(out.cards[0].score,s.pool[0].score);
  assert.equal(out.cards[0].strategyAt,s.pool[0].quoteAt);
  assert.equal(out.cards[0].quoteAt,Math.max(...s.decisionQuotes.map(q=>q.quoteAt)));
  assert.equal(out.conclusions['600001'].label,'可关注');
 }else assert.equal(out.conclusions['600001'].label,'回避');
 assert.equal(JSON.stringify(s),before);
});
test('direct decision board cannot bypass explicit source conflicts or a second forbidden mode',async()=>{
 const {decisionQuoteGate,buildDecisionBoard}=await model;
 for(const patch of [{sourceConflict:true},{quoteSourceConflict:true},{conflict:true},{evidenceStatus:'conflict'},
  {quoteStatus:'conflicting'},{quoteFreshness:'conflict'},{retracted:true},{mode:'research-only'},{quoteTimestamp:now-1001}]){
  const s=state([stock('600001',patch)]);
  assert.equal(decisionQuoteGate(s.pool[0],{day,now,poolDay:day}).ok,false,JSON.stringify(patch));
  assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 }
});
