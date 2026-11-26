'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateRule,evaluateStrategy}=require('../src/core/strategy-engine');
const {evaluateMultiStrategy}=require('../src/core/multi-strategy-engine');
const {normalizeStock}=require('../src/strategy/snapshot-normalizer');
const {applyRiskFilter}=require('../src/strategy/risk-filter');
const {auditStrategyInputProvenance}=require('../src/strategy/strategy-input-provenance');
const pack=require('../strategies/a-share-strategy-pack.json').strategies;
const rule={id:'x',field:'x',op:'>=',value:1,weight:25};
test('coercible objects and inherited values never match rules',()=>{
 for(const x of [[],[0],{}, {valueOf:()=>0}])
  assert.equal(evaluateRule({x},{field:'x',op:'===',value:0}),false);
 assert.equal(evaluateRule(Object.create({x:5}),rule),false);
 assert.equal(evaluateRule({x:'1'},rule),true);
});
test('duplicate identities or equivalent conditions invalidate a strategy',()=>{
 for(const duplicate of [{...rule,field:'y'},{...rule,id:'other',value:'1'},{...rule}]){
  const r=evaluateStrategy({x:2,y:2},{rules:[rule,duplicate],minScore:50});
  assert.equal(r.pass,false);assert.equal(r.score,0);
  assert.equal(r.configurationErrors.includes('DUPLICATE_RULE'),true);
 }
});
test('distinct conditions on one factor and original signed weights are preserved',()=>{
 const r=evaluateStrategy({x:2},{rules:[{field:'x',op:'>=',value:1,weight:30},{field:'x',op:'<',value:3,weight:-5}],minScore:25});
 assert.equal(r.pass,true);assert.equal(r.score,25);
});
test('bad rule weights and overflow cannot earn an aggregate contribution',()=>{
 const good={name:'good',rules:[rule],minScore:20};
 for(const rules of [[{...rule,weight:true}],[{...rule,weight:[25]}],[{...rule,weight:1e308},{...rule,id:'y',field:'y',weight:1e308}]]){
  const r=evaluateStrategy({x:2,y:2},{rules,minScore:1});
  assert.equal(r.pass,false);assert.equal(r.score,0);
  assert.equal(r.configurationValid,false);
 }
 const bad={name:'bad',rules:[rule,{...rule,id:'new'}],minScore:1};
 const combined=evaluateMultiStrategy({snapshot:{x:2,riskScore:0},strategies:[good,bad]});
 assert.equal(combined.strategies.find(s=>s.name==='bad').adjusted,0);
});
test('out-of-range and conflicting raw scores are not observations or support',()=>{
 const raw={trendScore:999,riskScore:-10,relativeStrength:80,relativeStrengthScore:10,capitalScore:[80]};
 const p=auditStrategyInputProvenance(raw);
 assert.equal(p.rawObserved,0);
 assert.equal(p.fields.relativeStrengthScore.reason,'conflict');
 const s=normalizeStock(raw);
 assert.equal(s.trendScore,null);assert.equal(s.relativeStrengthScore,null);
 assert.equal(s.maAlignmentScore,null);assert.equal(s.breakoutScore,null);
 assert.equal(s.capitalScore,null);assert.equal(s.fundFlowScore,null);
 assert.equal(s.riskScore,50);assert.equal(applyRiskFilter(s).pass,false);
});
test('risk flags preserve explicit negative and conflicting aliases',()=>{
 for(const tradable of [false,'false',0,'0','no',{}])
  assert.equal(applyRiskFilter(normalizeStock({tradable})).pass,false);
 assert.equal(applyRiskFilter(normalizeStock({isST:false,st:true})).pass,false);
 assert.equal(applyRiskFilter(normalizeStock({suspended:false,isSuspended:'true'})).pass,false);
 assert.equal(applyRiskFilter(normalizeStock({isST:'false',suspended:'0',tradable:'true'})).pass,true);
});
test('missing direct risk is neutral, real zero remains a zero penalty',()=>{
 for(const riskScore of [undefined,null,false,' ',-1,101,[]]){
  assert.equal(evaluateMultiStrategy({snapshot:{x:2,riskScore},strategies:[{name:'x',rules:[rule],minScore:25}]}).riskPenalty,11);
 }
 assert.equal(evaluateMultiStrategy({snapshot:{x:2,riskScore:0},strategies:[{name:'x',rules:[rule],minScore:25}]}).riskPenalty,0);
});
test('legal original strategy pack and score aliases preserve normal output',()=>{
 const stock={trendScore:80,relativeStrength:80,relativeStrengthScore:'80',riskScore:0,pctChange:5,amount:90000000,turnoverRate:8,volumeRatio:2};
 const s=normalizeStock(stock);
 assert.equal(s.relativeStrengthScore,80);assert.equal(s.riskScore,0);
 assert.equal(applyRiskFilter(s).pass,true);
 const r=evaluateMultiStrategy({snapshot:s,strategies:pack});
 assert.equal(r.finalScore,82.2);assert.equal(r.pass,true);
 assert.equal(r.strategies.some(s=>s.configurationValid===false),false);
});
