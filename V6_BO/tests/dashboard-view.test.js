'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dashboardView}=require('../src/core/dashboard-view');
test('dashboard empty state has unknown metrics, no invented market prices or strategy performance',()=>{
 const d=dashboardView({});assert.equal(d.counts.candidates,null);assert.equal(d.mood.upRatio,null);assert.deepEqual(d.indices,[]);assert.ok(d.strategies.every(x=>x.count===null));assert.equal(d.verifiedLive,false);
});
test('dashboard preserves source ordering, uses actual strategy membership and only publishes display fields',()=>{
 const s={stocksAt:123,idxRt:{at:456,items:[{code:'1.000001',name:'上证',price:3000,pct:0,secret:'hidden'}]},candidatePool:[{code:'000002',name:'B',price:20,pct:-1,score:30,bazi:{total:70,verdict:'观察'},token:'secret'},{code:'000001',name:'A',score:90,focused:true}],myrules:{date:'2026-11-05',count:1,items:[{code:'000001'}]},signals:[],news:{badCodes:new Set(['000002'])},paper:{cash:99999}};
 const d=dashboardView(s,{upN:3,downN:1,flatN:0,mood:'偏暖'});assert.deepEqual(d.rows.map(x=>x.code),['000002','000001']);assert.equal(d.rows[1].fourteen,true);assert.equal(d.mood.upRatio,75);assert.equal(d.counts.risk,1);assert.equal(d.indices[0].pct,0);assert.equal(d.strategies[2].count,null);assert.ok(!JSON.stringify(d).includes('secret'));assert.ok(!JSON.stringify(d).includes('99999'));
});
test('dashboard never coerces absent or malformed numbers to observed zeros',()=>{
 const d=dashboardView({stocksAt:100,candidatePool:[{code:'000001',score:NaN,price:null,pct:'2'}],idxRt:{items:[{price:Infinity,pct:null}]}});assert.equal(d.rows[0].score,null);assert.equal(d.rows[0].price,null);assert.equal(d.rows[0].pct,null);assert.equal(d.indices[0].price,null);
});
test('dashboard push projection separates candidate/trigger/sent states using signal and push logs',()=>{
 const now=Date.parse('2026-11-12T10:10:00Z');
 const s={stocksAt:now,candidatePool:[{code:'000001',name:'甲',price:10,pct:1,score:80,sector:'算力'},{code:'000002',name:'乙',price:8,pct:-2,score:60,sector:'券商'}],signals:[{type:'趋势票',code:'000001',name:'甲',price:10.1,pct:1.2,prob:78,ts:now-60000}],news:{badCodes:new Set()}};
 const d=dashboardView(s,{upN:2,downN:1,flatN:0},now,{pushLog:[{ts:now-30000,status:'✅ 已送达',extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts:now-60000}]}}],pushGov:{minProb:70},pushLast:{sent:true,t:now-30000},strategyVersion:'v-test'});
 assert.equal(d.pushes.counts.sent,1);
 assert.equal(d.pushes.counts.candidate,1);
 assert.equal(d.pushes.items[0].stage,'sent');
 assert.equal(d.pushes.items[0].conditions[0].threshold,70);
 assert.equal(d.pushes.items[0].conditionsSummary.label,'条件满足 2/2');
 assert.equal(d.pushes.items[0].strategyVersion,'v-test');
 assert.ok(Array.isArray(d.pushes.items[0].pushHistory));
 assert.equal(d.pushes.items[0].pushHistory.length,1);
});

test('dashboard push projection keeps duplicate signal history and per-code push history',()=>{
 const now=Date.parse('2026-11-12T10:10:00Z');
 const s={stocksAt:now,candidatePool:[{code:'000001',name:'甲',price:10,pct:1,score:80,sector:'算力'}],signals:[
  {type:'趋势票',code:'000001',name:'甲',price:10.1,pct:1.2,prob:78,ts:now-60000,msg:'first'},
  {type:'趋势票',code:'000001',name:'甲',price:10.2,pct:1.3,prob:81,ts:now-30000,msg:'second'}
 ],news:{badCodes:new Set()}};
 const d=dashboardView(s,{upN:2,downN:1,flatN:0},now,{pushLog:[
  {ts:now-20000,status:'✅ 已送达',channel:'wx',extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts:now-30000}]}},
  {ts:now-70000,status:'❌ 未送达',channel:'wx',extra:{codes:['000001']}}
 ],pushGov:{minProb:70},pushLast:{sent:true,t:now-20000}});
 assert.equal(d.pushes.items.length,1);
 assert.equal(d.pushes.items[0].duplicateSignalCount,1);
 assert.equal(d.pushes.items[0].signalHistory.length,2);
 assert.equal(d.pushes.items[0].pushHistory.length,2);
 assert.equal(d.pushes.items[0].pushHistory[0].status,'✅ 已送达');
 assert.equal(d.pushes.items[0].pushHistory[1].status,'❌ 未送达');
});

test('dashboard push projection does not silently truncate candidate rows',()=>{
 const pool=Array.from({length:95},(_,i)=>({
  code:String(i+1).padStart(6,'0'),
  name:`股${i+1}`,
  price:10+i*0.01,
  pct:0.2,
  score:80-(i*0.1),
  sector:'测试'
 }));
 const d=dashboardView({stocksAt:Date.now(),candidatePool:pool,signals:[],news:{badCodes:new Set()}},{upN:1,downN:0,flatN:0},Date.now(),{pushLog:[],pushGov:{},pushLast:null});
 assert.equal(d.rows.length,95);
 assert.equal(d.pushes.items.length,95);
});
