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
 const d=dashboardView(s,{upN:2,downN:1,flatN:0},now,{pushLog:[{ts:now-30000,status:'✅ 已送达',extra:{codes:['000001']}}],pushGov:{minProb:70},pushLast:{sent:true,t:now-30000}});
 assert.equal(d.pushes.counts.sent,1);
 assert.equal(d.pushes.counts.candidate,1);
 assert.equal(d.pushes.items[0].stage,'sent');
 assert.equal(d.pushes.items[0].conditions[0].threshold,70);
 assert.equal(d.pushes.items[0].conditionsSummary.label,'条件满足 2/2');
});
