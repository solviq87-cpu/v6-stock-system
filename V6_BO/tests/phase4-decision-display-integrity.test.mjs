import test from 'node:test';
import assert from 'node:assert/strict';
import {readDecisionBoard,stockConclusion} from '../public/nova/decision-model.mjs';
const day='2026-11-26',at=s=>Date.parse(day+'T'+s+'+08:00'),now=at('10:00:00'),code='600000';
function fixture(clock=now){
 const authority='fayo-decision-center',decisionId='a'.repeat(64),quoteAt=clock-1000,receivedAt=clock-500;
 const quoteBasis={code,price:10,quoteAt,receivedAt,source:'tencent',mode:'public-live-unverified'};
 const conclusion={authority,schemaVersion:1,code,day,asOf:clock,quoteAt,label:'可关注',reason:'原证据',evidence:[]};
 const plan={authority,decisionId,asOf:clock,buyLow:9.8,buyHigh:10,stop:9.7,target:11,positionPct:19.6,
  lineage:Object.fromEntries(['buyLow','buyHigh','stop','target','positionPct'].map(k=>[k,{source:'原证据',derivedBy:'原规则',sourceAt:clock-2000}]))};
 const card={authority,decisionId,code,day,calculatedAt:clock,quoteBasis,quoteAt,receivedAt,quoteSource:'tencent',
  quoteMode:quoteBasis.mode,price:10,canTrade:true,canNotify:true,score:80,resonanceScore:1,resonanceStrategies:[{id:'original',label:'原策略'}],plan,conclusion};
 return {authority,schemaVersion:1,day,calculatedAt:clock,sessionOpen:true,weather:{day,status:'green',label:'可做多',summary:'原市场依据',canConsider:true,missing:[],positionCapPct:20},
  reasons:[],cards:[card],conclusions:{[code]:conclusion}};
}
test('risk-veto and conflicting current quote evidence cannot become an actionable opportunity',()=>{
 for(const patch of [p=>p.cards[0].conclusion.label='回避',p=>p.cards[0].conclusion.label='等待回封',
  p=>p.cards[0].conclusion.quoteAt--,p=>p.cards[0].sourceConflict=true,p=>p.cards[0].suspended=true,p=>p.cards[0].tradable=false,
  p=>{p.cards[0].quoteBasis.source='synthetic';p.cards[0].quoteSource='synthetic';}]){
  const p=fixture();patch(p);assert.equal(readDecisionBoard(p,{now}).cards.length,0);
 }
});
test('a card cannot use evidence from after the package calculation or from another calculation',()=>{
 for(const patch of [
  p=>p.cards[0].calculatedAt--,p=>p.cards[0].plan.asOf--,p=>p.cards[0].plan.lineage.stop.sourceAt=now-10,
  p=>{p.cards[0].quoteBasis.receivedAt=now;p.cards[0].receivedAt=now;},
  p=>p.cards[0].conclusion.asOf=now]){
  const p=fixture(now-100);patch(p);assert.equal(readDecisionBoard(p,{now}).cards.length,0);
 }
});
test('stale open flag at the continuous-auction boundary never keeps buy cards visible',()=>{
 for(const time of ['11:30:00','14:57:00','15:00:00','09:29:59']){
  const clock=at(time);const p=fixture(clock-1000);
  assert.equal(readDecisionBoard(p,{now:clock}).cards.length,0);
 }
 const p=fixture();p.weather.status='red';p.weather.canConsider=false;
 assert.equal(readDecisionBoard(p,{now}).weather.canConsider,false);
 assert.equal(readDecisionBoard(p,{now}).weather.status,'unknown');
});
test('duplicate securities and decision identifiers cannot inflate opportunity count',()=>{
 const p=fixture();p.cards.push({...p.cards[0]});
 assert.equal(readDecisionBoard(p,{now}).cards.length,0);
});
test('a stock drawer without matching identity does not borrow another stock conclusion',()=>{
 const p=fixture(),c=p.cards[0].conclusion;
 assert.equal(stockConclusion({conclusion:c},{day,now}).label,'回避');
 assert.equal(stockConclusion({code:'600001',conclusion:c},{day,now}).label,'回避');
 assert.equal(stockConclusion({code,conclusion:c},{day,now}).label,'可关注');
});
test('valid server card keeps original values and unchanged evidence at the 15s boundary',()=>{
 const p=fixture(now-14000),before=JSON.stringify(p);
 const r=readDecisionBoard(p,{now});assert.equal(r.cards.length,1);
 assert.equal(r.cards[0].plan,p.cards[0].plan);
 assert.equal(r.cards[0].quoteAt,now-15000);assert.equal(JSON.stringify(p),before);
});

function attachRisk(p){
 const c=p.cards[0],plan=c.plan;
 const rr={status:'meets-gross-discipline',minimumGrossRewardRisk:2,ratio:(plan.target-plan.buyHigh)/(plan.buyHigh-plan.stop),
  canTrade:false,costBasis:'gross-before-fees-slippage-and-T+1-gap-risk'};
 plan.riskReward={...rr};c.conclusion.riskReward={...rr};return p;
}
const riskCases=[
 ['legacy valid geometry remains compatible without inventing a new receipt',p=>{},true],
 ['ordered legacy plan with reward below risk discipline is withheld',p=>{p.cards[0].plan.stop=9;},false],
 ['true equality including floating-point roundoff survives',p=>{p.cards[0].plan.target=10.6;attachRisk(p);},true],
 ['rounded 1.9667 cannot become an actionable ratio of two',p=>{p.cards[0].plan.target=10.59;attachRisk(p);p.cards[0].plan.riskReward.ratio=2;p.cards[0].conclusion.riskReward.ratio=2;},false],
 ['valid server plan and conclusion evidence survive unchanged',p=>attachRisk(p),true],
 ['tampered target cannot keep an older positive receipt',p=>{attachRisk(p);p.cards[0].plan.target=10.8;},false],
 ['server plan risk receipt differs from the original arithmetic',p=>{attachRisk(p);p.cards[0].plan.riskReward.ratio=99;},false],
 ['server conclusion risk receipt conflicts',p=>{attachRisk(p);p.cards[0].conclusion.riskReward.status='insufficient-gross-reward';},false],
 ['explicitly missing risk receipt must not act like a legacy field',p=>{attachRisk(p);p.cards[0].plan.riskReward=null;},false],
 ['only one of the two new receipts is present',p=>{attachRisk(p);delete p.cards[0].conclusion.riskReward;},false],
 ['new receipt cannot relax the fixed gross discipline',p=>{attachRisk(p);p.cards[0].plan.riskReward.minimumGrossRewardRisk=1;},false],
 ['descriptive risk receipt cannot claim trade authority',p=>{attachRisk(p);p.cards[0].conclusion.riskReward.canTrade=true;},false],
 ['gross scenario ratio cannot be relabelled as net performance',p=>{attachRisk(p);p.cards[0].plan.riskReward.costBasis='net-confirmed-return';},false]
];
for(const [name,alter,allowed] of riskCases)test('dual-client reward risk: '+name,()=>{
 const p=fixture();alter(p);const before=JSON.stringify(p),out=readDecisionBoard(p,{now});
 assert.equal(out.cards.length,allowed?1:0);
 if(allowed)assert.equal(out.cards[0].plan,p.cards[0].plan);
 assert.equal(JSON.stringify(p),before);
});
test('an explicit insufficient gross reward receipt cannot remain a positive stock drawer conclusion',()=>{
 const p=attachRisk(fixture()),c=p.cards[0].conclusion;c.riskReward.status='insufficient-gross-reward';
 assert.equal(stockConclusion({code,conclusion:c},{day,now}).label,'回避');
});
