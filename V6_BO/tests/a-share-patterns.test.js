'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {detectPatterns,attachRps,buildPatternPools}=require('../src/strategy/a-share-patterns');
const {scanUniverse}=require('../src/strategy/universe-scanner');

function makeBars(n=35){
 const bars=[];
 for(let i=0;i<n;i++){
  bars.push({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
   open:10,high:10.2,low:9.8,close:10,volume:1000000,amount:120000000});
 }
 return bars;
}
function bar(o,c,lo,hi,v=1000000){
 return {open:o,close:c,low:lo,high:hi,volume:v,amount:200000000};
}
function ids(r){return r.matched.map(x=>x.id);}
test('three red soldiers detected with actual increasing candles',()=>{
 const bars=makeBars();
 bars.splice(-3,3,
  {...bars.at(-3),...bar(9.8,10.1,9.7,10.15)},
  {...bars.at(-2),...bar(9.95,10.3,9.8,10.35)},
  {...bars.at(-1),...bar(10.1,10.5,9.9,10.55)});
 const r=detectPatterns({symbol:'600001',bars});
 assert.equal(r.usable,true);
 assert.ok(ids(r).includes('red_three_soldiers'));
 assert.ok(r.positiveCount>=1);
 assert.equal(r.confluencePoints,Math.min(100,r.positiveCount*5));
});
test('three black crows are independent bearish alerts, not bullish bonuses',()=>{
 const bars=makeBars();
 bars.splice(-3,3,
  {...bars.at(-3),...bar(10.2,9.9,9.85,10.25)},
  {...bars.at(-2),...bar(10,9.7,9.65,10.05)},
  {...bars.at(-1),...bar(9.8,9.5,9.45,9.85)});
 const r=detectPatterns({bars});
 assert.ok(ids(r).includes('three_black_crows'));
 assert.equal(r.positiveCount,0);
 assert.ok(r.riskCount>=1);
 assert.equal(r.confluencePoints,0);
});
test('one complete strategy is enough; multiple independent strategies boost research confluence only',()=>{
 const bars=makeBars(60);
 bars[bars.length-2]={...bars.at(-2),...bar(10,9.8,9.7,10.1)};
 bars[bars.length-1]={...bars.at(-1),...bar(9.7,12,9.6,12.1,2000000)};
 const r=detectPatterns({bars});
 assert.ok(ids(r).includes('bullish_engulfing'));
 assert.ok(ids(r).includes('breakout20_liquid'));
 assert.ok(ids(r).includes('momentum20_above_ma50'));
 assert.ok(r.positiveCount>=3);
 assert.equal(r.confluencePoints,Math.min(100,r.positiveCount*5));
 assert.ok(!('finalScore' in r),'research bonus must not rewrite legacy finalScore');
});
test('bad K-line data cannot create pattern signals',()=>{
 const bars=makeBars();bars.at(-1).high=1;
 const r=detectPatterns({bars});
 assert.equal(r.usable,false);assert.equal(r.matched.length,0);
});
test('RPS must be cross-sectional, date-aligned, and have at least ten eligible stocks',()=>{
 const stocks=Array.from({length:10},(_,i)=>{
  const bars=makeBars(121);
  bars.at(-1).close=10+i*.8;
  bars.at(-1).high=Math.max(10.2,bars.at(-1).close+.1);
  bars.at(-1).open=10;
  return {symbol:String(600000+i),bars};
 });
 const items=stocks.map(s=>({symbol:s.symbol,name:'',patterns:detectPatterns(s),
  quality:{usable:true,fresh:true,simulated:false,source:'imported'},blockedBySafety:false}));
 attachRps(stocks,items);
 assert.ok(items.some(x=>ids(x.patterns).includes('rps120_breakout')));
 assert.ok(items.every(x=>x.patterns.rps120!=null));
 const split=stocks.map((s,i)=>({symbol:s.symbol,bars:s.bars.map((b,j)=>({...b,date:i<5?b.date:new Date(Date.UTC(2027,0,1+j)).toISOString().slice(0,10)}))}));
 const separated=items.map(x=>({...x,patterns:detectPatterns(stocks.find(s=>s.symbol===x.symbol))}));
 attachRps(split,separated);
 assert.ok(separated.every(x=>x.patterns.rps120==null));
});
test('research pools accept any positive hit but never promote blocked or simulated stocks',()=>{
 const one={id:'x',label:'测试看涨',side:'bullish',pool:'强势启动池'};
 const risk={id:'r',label:'测试风险',side:'bearish',pool:'形态风险池'};
 const quality={usable:true,fresh:true,simulated:false,source:'imported'};
 const items=[
  {symbol:'600001',name:'甲',quality,blockedBySafety:false,patterns:{usable:true,positiveCount:1,riskCount:1,confluencePoints:5,matched:[one,risk]}},
  {symbol:'600002',name:'乙',quality,blockedBySafety:true,patterns:{usable:true,positiveCount:1,riskCount:1,confluencePoints:5,matched:[one,risk]}},
  {symbol:'600003',name:'丙',quality:{...quality,simulated:true},blockedBySafety:false,patterns:{usable:true,positiveCount:1,riskCount:0,confluencePoints:5,matched:[one]}}
 ];
 const pools=buildPatternPools(items);
 assert.deepEqual(pools['强势启动池'].map(x=>x.symbol),['600001']);
 assert.deepEqual(pools['形态风险池'].map(x=>x.symbol),['600001','600002']);
});
test('end-to-end research scan creates pools and preserves original official candidate flag',()=>{
 const bars=makeBars(35);
 bars[bars.length-2]={...bars.at(-2),...bar(10,9.8,9.7,10.1)};
 bars[bars.length-1]={...bars.at(-1),...bar(9.7,12,9.6,12.1,2000000)};
 const now=Date.parse('2026-06-01T05:00:00Z');
 const result=scanUniverse({stocks:[{code:'600001',name:'示例',market:'main',feed:{source:'imported',timestamp:now},bars}],now});
 assert.equal(result.total,1);
 assert.ok(result.items[0].patterns.positiveCount>0);
 assert.ok(Object.values(result.patternPools).some(pool=>pool.some(x=>x.symbol==='600001')));
 assert.equal(result.items[0].score,result.items[0].strategy.legacyScore);
 assert.equal(result.items[0].tradable,false,'pattern research cannot override official selection gate');
});
test('research interface displays pool and individual pattern evidence',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');
 assert.match(html,/id="patternPools"/);
 assert.match(js,/看跌形态预警/);
 assert.match(js,/insufficient_data/);
 assert.match(js,/confluencePoints/);
});
