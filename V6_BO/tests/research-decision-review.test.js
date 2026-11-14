'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildDecisionReview:review,buildHypothesisTimeline:timeline,summarizeConditions,summarizeRuleDisagreement,buildScreeningFunnel}=require('../src/core/research-decision-review');
const at=Date.parse('2026-11-12T09:00:00Z'),sha=c=>c.repeat(64);
function fixture(){return {asOf:at,stock:{symbol:'600000',provider:'tencent',source:'tencent',priceBasis:'unadjusted',observedAt:at-10,bars:[{}]},
 history:{tradeDate:'2026-11-12',source:'tencent',retrievedAt:at,sourceTimestamp:null},observation:{revision:1,observationHash:sha('a')},
 evidenceBundle:{hash:sha('b'),symbol:'600000',provider:'tencent',priceBasis:'unadjusted',observationHash:sha('a'),decisionAt:at,recordedAt:at,
  marketContext:{status:'unknown'},sourceRefs:[{source:'tencent',sha256:sha('c'),receivedAt:at,url:'https://example.org/?token=SECRET'}]},
 calendar:{status:'available',source:'fixture'},currentFormation:{patterns:{usable:true},availableAt:at},readiness:{blockers:[]},
 research36:{code:'600000',asOf:at,evaluations:[{id:'one',name:'one',status:'research_candidate',checks:[{field:'flow',pass:true,value:0,op:'>=',threshold:0}]}]}};}
function h(id=sha('a'),overrides={}){return {hypothesisHash:id,targetDate:'2026-11-13',signalDate:'2026-11-12',decisionAt:at-20,recordedAt:at-10,dueAt:at+100,
 prediction:'up',state:'bullish',matchedPatternIds:['breakout'],evidenceBundleHash:sha('b'),ruleVersion:'test',...overrides};}
test('review keeps original timestamp unknown, real zero and private references without mutating input',()=>{
 const f=fixture(),before=JSON.stringify(f),r=review(f);assert.equal(JSON.stringify(f),before);
 assert.equal(r.evidence[0].sourceTimestamp,null);assert.equal(r.evidence[0].receivedAt,at);assert.equal(r.conditions.rows[0].support[0].value,0);
 assert.equal(r.evidence.find(x=>x.id==='context').status,'unknown');assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.doesNotMatch(JSON.stringify(r),/SECRET|example.org|token=/);assert.equal(r.evidenceBundleHash,sha('b'));
});
test('mismatched symbol, provider, observation or future archive cannot claim linked evidence',()=>{
 for(const mutate of [x=>x.evidenceBundle.symbol='000001',x=>x.evidenceBundle.provider='eastmoney',x=>x.evidenceBundle.observationHash=sha('d'),x=>x.evidenceBundle.decisionAt=at+1,x=>x.evidenceBundle.recordedAt=at+1]){
  const f=fixture();mutate(f);const r=review(f);assert.equal(r.evidenceBundleHash,null);assert.deepEqual(r.sourceRefs,[]);
 }
 const f=fixture();f.evidenceBundle.recordedAt=at+1;assert.equal(review(f,{viewAt:at+1}).evidenceBundleHash,sha('b'));
});
test('old hypothesis requires its own sealed reference and cannot borrow latest evidence',()=>{
 const f=fixture();f.priceEventResearch={currentHypothesis:{evidenceBundleHash:sha('d'),decisionAt:at-100,recordedAt:at-90}};
 f.hypothesisEvidence=f.evidenceBundle;assert.equal(review(f).evidence.find(x=>x.id==='frozen').status,'unknown');
 f.hypothesisEvidence={...f.evidenceBundle,hash:sha('d'),decisionAt:at-100,recordedAt:at-90};assert.equal(review(f).evidence.find(x=>x.id==='frozen').status,'observed-unverified');
});
test('future or cross-symbol rule evidence is not presented as current coverage',()=>{
 const f=fixture();f.research36.code='000001';assert.equal(review(f).conditions.total,0);f.research36.code='600000';f.research36.asOf=at+1;assert.equal(review(f).conditions.total,0);
 f.history.tradeDate='2026-11-13';assert.equal(review(f).tradeDate,null);
});
test('condition partitions count disabled, unknown, failure and success separately',()=>{
 const r=summarizeConditions([{id:'pass',status:'research_candidate',checks:[{pass:true,value:0}]},{id:'fail',checks:[{pass:false,value:0}]},
 {id:'missing',checks:[{field:'cashflow',pass:null,missing:'未提供证据'}]},{id:'disabled',status:'disabled',checks:[{pass:true}]}]);
 assert.deepEqual(r.counts,{disabled:1,insufficient_data:1,not_matched:1,research_candidate:1});assert.equal(r.mixedConditions,true);
 assert.deepEqual(r.missingFields,[{field:'cashflow',strategies:['missing']}]);assert.equal(Object.values(r.counts).reduce((a,b)=>a+b),r.total);
});
test('eight-word evidence availability cannot become a bullish vote',()=>{
 const r=summarizeRuleDisagreement({bazi:{available:true,dimensions:[{id:'trend',status:'pass',score:0}]},gpt:[{name:'test',rules:[{label:'条件',status:'fail'}]}]});
 const b=r.rows.find(x=>x.id==='bazi');assert.deepEqual(b.support,[]);assert.equal(b.counts.pass,1);assert.equal(r.mixedConditions,false);assert.equal(r.combinedScore,null);
});
test('timeline distinguishes due-without-evidence from evaluation and filters future outcomes',()=>{
 const state={hypotheses:[h()],outcomes:[{hypothesisHash:sha('a'),targetDate:'2026-11-13',knownAt:at+200,recordedAt:at+200,outcome:'up',matched:true}],corrections:[]};
 assert.equal(timeline(state,at).rows[0].status,'pending');assert.equal(timeline(state,at+100).rows[0].status,'awaiting-evidence');
 assert.equal(timeline(state,at+200).rows[0].status,'evaluated');assert.equal(timeline(state,at+200).rows[0].outcome.matched,true);
 assert.equal(timeline(state,at-15).total,0);
});
test('timeline changes are factual fields, revisions retain original outcome and archive stays untouched',()=>{
 const state={hypotheses:[h(),h(sha('c'),{decisionAt:at,recordedAt:at,prediction:'down',state:'bearish',matchedPatternIds:['risk']})],
 outcomes:[{hypothesisHash:sha('a'),targetDate:'2026-11-13',knownAt:at,recordedAt:at,outcome:'down',matched:false}],
 corrections:[{hypothesisHash:sha('a'),knownAt:at+1,recordedAt:at+1}]};
 const before=JSON.stringify(state),r=timeline(state,at+1);assert.equal(JSON.stringify(state),before);assert.equal(r.rows[0].outcome.matched,false);assert.equal(r.rows[0].corrections,1);
 assert.equal(r.rows[1].changes.length,2);assert.deepEqual(r.rows[1].addedPatterns,['risk']);assert.deepEqual(r.rows[1].removedPatterns,['breakout']);
});
test('timeline is bounded, keeps total and does not silently accept duplicate IDs',()=>{
 const state={hypotheses:Array.from({length:55},(_,i)=>h(i.toString(16).padStart(64,'0'),{decisionAt:at-100+i,recordedAt:at-100+i})),outcomes:[],corrections:[]};
 const r=timeline(state,at);assert.equal(r.total,55);assert.equal(r.rows.length,50);assert.equal(r.truncated,true);
 state.hypotheses.push(state.hypotheses[0]);assert.throws(()=>timeline(state,at),/重复/);
});
test('different-date and future sector quotes cannot provide same-day amounts or invent leader roles',()=>{
 const f=fixture();f.linkage={tradeDate:'2026-11-12',memberBoards:[{name:'board',quoteDate:'2026-11-11',quoteAt:at,membersObservedAt:at,sameQuoteDate:true,changePct:99,mainNetInflow:99}]};
 let r=review(f);assert.equal(r.marketPosition.boards[0].changePct,null);assert.equal(r.marketPosition.role,'unknown');
 const b=f.linkage.memberBoards[0];b.quoteDate='2026-11-12';b.mainNetInflow=0;b.changePct=0;r=review(f);assert.equal(r.marketPosition.boards[0].mainNetInflow,0);
 b.quoteAt=at+1;assert.equal(review(f).marketPosition.boards[0].mainNetInflow,null);
});
test('funnel counts first rejection only and never mutates original ranking',()=>{
 const good={quality:{usable:true,fresh:true},blockedBySafety:false,strategy:{pass:true},tradable:true};
 const items=[{...good,symbol:'000005'}, {...good,symbol:'000001',quality:{usable:false,errors:['缺来源']},blockedBySafety:true},
 {...good,symbol:'000002',blockedBySafety:true}, {...good,symbol:'000003',strategy:{pass:false}}, {...good,symbol:'000004',quality:{usable:true,fresh:false},tradable:false}];
 const before=JSON.stringify(items),r=buildScreeningFunnel(items);assert.equal(JSON.stringify(items),before);assert.equal(r.remaining,1);
 assert.deepEqual(r.steps.map(x=>[x.before,x.after]),[[5,4],[4,3],[3,2],[2,1]]);assert.equal(r.steps.reduce((n,s)=>n+s.removed,0)+r.remaining,r.total);
 assert.equal(buildScreeningFunnel([{}]).steps[0].unknown,1);
});
