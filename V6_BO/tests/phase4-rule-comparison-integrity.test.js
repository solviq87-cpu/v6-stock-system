'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coverage,packComparison,compareRuleSystems}=require('../src/strategy/rule-comparison');
const {summarizeRuleDisagreement}=require('../src/core/research-decision-review');
const raw=require('../myrules');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const stock={code:'600000',name:'样本',price:10,floatCap:5e9};
const input=patch=>({stock:{...stock},rows:[],...patch});
const cmp=x=>compareRuleSystems({myrulesInput:x}).systems.fourteen;
const rule=(r,id)=>r.rules.find(x=>x.id===id);
test('invalid status strings and absent entries are unknown rather than failed evidence',()=>{
 assert.deepEqual(coverage([{status:'pass'},{status:'fail'},{status:'n/a'},{},null]),
  {total:5,known:2,passed:1,failed:1,unknown:3,coverageRate:0.4,knownPassRate:0.5});
});
test('out of domain GPT scores and invalid thresholds do not create supporting or opposing evidence',()=>{
 for(const value of [-1,101,Infinity,NaN]){
  const r=packComparison({trendScore:value})[0].rules[0];
  assert.equal(r.status,'unknown');assert.equal(r.observed,null);
 }
 const rules=[{id:'a',field:'trendScore',op:'>=',value:null},{id:'b',field:'trendScore',op:'<',value:[]}];
 assert.equal(packComparison({trendScore:80},[{name:'x',rules}])[0].coverage.known,0);
});
test('equivalent or duplicate GPT conditions are all unknown; distinct valid conditions still work',()=>{
 const rules=[{id:'a',field:'trendScore',op:'>=',value:60},
  {id:'b',field:'trendScore',op:'>=',value:'60'},
  {id:'c',field:'riskScore',op:'<=',value:25},{id:'c',field:'riskScore',op:'>=',value:20},
  {id:'d',field:'trendScore',op:'between',min:60,max:80},
  {id:'e',field:'riskScore',op:'===',value:0}];
 const r=packComparison({trendScore:75,riskScore:0},[{name:'x',rules}])[0];
 assert.deepEqual(r.rules.map(x=>x.status),['unknown','unknown','unknown','unknown','pass','pass']);
});
test('fourteen condition 8 cannot use partial ratios or traded shares as turnover',()=>{
 const x=input({auction:{auctionAmount:2e8},stock:{...stock,amount:1e8,sealAmount:2e8},
  rows:[{volume:1e6},{volume:1e6}]});
 const native=raw.evaluateOne(x);
 // The comparison must remain conservative on both the legacy and corrected native evaluator.
 // Do not require the legacy false positive to survive the native repair.
 if(native.evaluatorVersion==='v6-fourteen-native-2'){
  assert.equal(native.items.find(r=>r.i===8).unknown,true);
  assert.equal(native.items.find(r=>r.i===8).ok,false);
 }
 const out=cmp(x);assert.equal(rule(out,8).status,'unknown');assert.equal(rule(out,8).observed,null);
 x.rows[0].amount=1e8;
 assert.equal(rule(cmp(x),8).status,'pass');
 x.rows[0].amount=0;
 assert.equal(rule(cmp(x),8).status,'unknown');
});
test('missing or invalid consecutive-limit count cannot certify exclusion safety',()=>{
 for(const limitUpCount of [undefined,null,-1,1.5,'0',NaN]){
  const x=input({stock:{...stock,limitUpCount}});
  const out=cmp(x);assert.equal(rule(out,11).status,'unknown');
  assert.equal(out.pass,false);assert.equal(out.verdict,'unknown');
 }
 const known=cmp(input({stock:{...stock,limitUpCount:0}}));
 assert.equal(rule(known,11).status,'pass');
 assert.equal(cmp(input({stock:{...stock,limitUpCount:4}})).verdict,'fail');
});
test('first board rule requires original count, break count and positive turnover',()=>{
 for(const patch of [{limitUpCount:undefined},{breakCount:undefined},{amount:0},{sealAmount:null}]){
  const out=cmp(input({stock:{...stock,limitUpCount:1,breakCount:0,amount:1e8,sealAmount:4e7,...patch}}));
  assert.equal(rule(out,9).status,'unknown');
 }
 const out=cmp(input({stock:{...stock,limitUpCount:1,breakCount:0,amount:1e8,sealAmount:4e7}}));
 assert.equal(rule(out,9).status,'pass');
 assert.equal(out.hits,out.coverage.passed);
 assert.equal(out.nativeHits,raw.evaluateOne(input({stock:{...stock,limitUpCount:1,breakCount:0,amount:1e8,sealAmount:4e7}})).hits);
});
test('known zero or multiple consecutive boards are never first-board support',()=>{
 for(const limitUpCount of [0,2,3]){
  const x=input({stock:{...stock,limitUpCount,breakCount:0,amount:1e8,sealAmount:4e7}});
  const out=cmp(x);
  assert.equal(rule(out,9).status,'fail');
  assert.equal(out.hits,out.coverage.passed);
  assert.equal(out.nativeHits,raw.evaluateOne(x).hits);
 }
 const good=cmp(input({stock:{...stock,limitUpCount:1,breakCount:0,amount:1e8,sealAmount:4e7}}));
 assert.equal(rule(good,9).status,'pass');
});
test('partial eight-word dimensions preserve raw score but never count as complete evidence',()=>{
 const rows=Array.from({length:70},(_,i)=>({open:10,high:11,low:9,close:10+i*.001,volume:10000}));
 const out=compareRuleSystems({baziInput:{code:'600000',price:10.07,rows}}).systems.bazi;
 const partial=Object.entries(out.raw.dims).filter(([,d])=>finite(d.score)&&Array.isArray(d.miss)&&d.miss.length);
 assert.ok(partial.length>0);
 for(const [id,d] of partial){
  const observed=out.dimensions.find(x=>x.id===id);
  assert.equal(observed.status,'unknown');assert.equal(observed.score,null);assert.equal(observed.partialScore,d.score);
 }
 assert.equal(out.coverage.known,out.raw.coverage.completeDimensions);
});
test('Python comparison requires exactly three ordered round identities and a real calendar date',()=>{
 const p={provenance:'python-runtime:offline-test',date:'2026-11-26',rules:[1,2,3].map(i=>({id:'round-'+i,status:'pass'}))};
 const good=compareRuleSystems({pythonResult:p}).systems.python;
 assert.equal(good.available,true);assert.equal(good.coverage.known,3);assert.equal(good.verifiedLive,false);
 for(const patch of [{date:'2026-02-30'},{rules:[p.rules[0]]},{rules:[p.rules[0],p.rules[0],p.rules[2]]},{rules:[p.rules[0],{...p.rules[1],status:'pending'},p.rules[2]]}]){
  assert.equal(compareRuleSystems({pythonResult:{...p,...patch}}).systems.python.available,false);
 }
});
test('unavailable system cannot contribute support or opposition even with stale rule rows',()=>{
 const r=summarizeRuleDisagreement({fourteen:{available:false,rules:[{id:'a',status:'pass'},{id:'b',status:'fail'}]},gpt:[],python:{available:false,rules:[null]}});
 const f=r.rows.find(x=>x.id==='fourteen');
 assert.deepEqual(f.counts,{pass:0,fail:0,unknown:2});assert.deepEqual(f.support,[]);assert.deepEqual(f.opposition,[]);
 assert.equal(r.mixedConditions,false);assert.equal(r.combinedScore,null);
});
