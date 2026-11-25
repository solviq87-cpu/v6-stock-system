'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditPointInTime,indicatorWarmup}=require('../src/core/research-causal-diagnostics');
const {returnStudy}=require('../public/nova/shortline/backtest-analytics.mjs');
const {signals,parseKCsv,similarCases}=require('../public/nova/shortline/backtest.mjs');
const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../public/nova/shortline');
function archive(){return {catalog:require(path.join(base,'catalog.json')),bars:parseKCsv(fs.readFileSync(path.join(base,'sample-kline.csv'),'utf8')),market:[],corrections:[]};}
test('actual signal evaluator rejects future perturbations and truncation',()=>{
 const input=archive(),cutoff='2025-05-16';
 assert.ok(signals(input,cutoff).length);
 const result=auditPointInTime({evaluate:signals,input,cutoff,variants:[
  {name:'truncate',mutate:(s,t)=>({...s,bars:s.bars.filter(b=>b.date<=t)})},
  {name:'future OHLCV',mutate:(s,t)=>({...s,bars:s.bars.map(b=>b.date<=t?b:{...b,close:b.close*2,high:b.high*2,volume:b.volume*2})})}
 ]});
 assert.equal(result.status,'pass');assert.equal(result.canTrade,false);
});
test('audit detects leak and refuses unchanged perturbation',()=>{
 const input={rows:[1,2]};
 assert.equal(auditPointInTime({input,cutoff:'2025-01-01',evaluate:s=>s.rows.at(-1),variants:[{name:'leak',mutate:s=>({rows:[1,9]})}]}).status,'fail');
 assert.equal(auditPointInTime({input,cutoff:'x',evaluate:s=>s.rows,variants:[{name:'noop',mutate:s=>s}]}).status,'not-evaluated');
});
test('warmup requires strictly longer reference and reports instability',()=>{
 const bars=Array.from({length:150},(_,i)=>{const close=i<125?100:10;return {date:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),open:close,high:close+1,low:close-1,close,volume:10000};});
 const r=indicatorWarmup(bars,{lengths:[26,150]});
 assert.equal(r.checks[0].status,'fail');assert.equal(r.checks[1].status,'not-evaluated');
 const stable=bars.map(b=>({...b,open:10,high:11,low:9,close:10}));
 assert.equal(indicatorWarmup(stable,{lengths:[60]}).status,'pass');
 assert.equal(indicatorWarmup(stable.slice(0,20)).status,'not-evaluated');
 assert.equal(indicatorWarmup(stable.reverse()).status,'not-evaluated');
});
test('net payoff and tail exposure respect mature labels and unknowns',()=>{
 const make=(id,close)=>({id,code:'600000',date:'2025-01-01',decisionAt:'2025-01-01 15:00',outcomes:{5:{close,entry:'2025-01-02',end:'2025-01-08',availableAt:'2025-01-08 15:00'}}});
 const rows=[make('a',4),make('b',-2),make('c',0),make('d',100)];
 rows[3].outcomes[5].availableAt='2025-02-01 15:00';
 const options={end:'2025-01-10',horizon:5,costBps:0,slipBps:0};
 const r=returnStudy(rows,options);
 assert.equal(r.n,3);assert.equal(r.expectation.averageWin,4);assert.equal(r.expectation.averageLoss,-2);
 assert.equal(r.expectation.payoff,2);assert.equal(r.expectation.netExpectancy,2/3);
 assert.equal(r.expectation.tailMean5Pct,-2);assert.equal(r.expectation.distinctEntryDays,1);
 assert.equal(returnStudy([],options).expectation.netExpectancy,null);
 assert.equal(returnStudy([make('e',2)],options).expectation.payoff,null);
});
test('similarity report retains ranked censored neighbours and excursions',()=>{
 const s=archive(),results=signals(s).map(target=>({target,report:similarCases(s,target)}));
 assert.ok(results.some(({report})=>report.neighbours.length));
 assert.ok(results.some(({report})=>report.excursions[5].n>0));
 for(const {target,report} of results){
  assert.equal(report.excursions[5].n+report.excursions[5].unavailable,report.neighbours.length);
  for(const [i,n] of report.neighbours.entries()){
   assert.ok(n.date<target.date);
   if(i)assert.ok(report.neighbours[i-1].similarity>=n.similarity);
   if(n.available)assert.ok(n.outcome.end<=target.date);
   else assert.equal(n.outcome,null);
  }
 }
});
