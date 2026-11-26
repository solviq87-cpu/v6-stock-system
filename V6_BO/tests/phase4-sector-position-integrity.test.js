'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeSectorRelations}=require('../src/strategy/sector-relations');
const {marketPosition}=require('../src/core/research-workspace-analytics');
const dates=Array.from({length:24},(_,i)=>new Date(Date.UTC(2025,8,i+1)).toISOString().slice(0,10));
const at=(d,t='16:30:00')=>Date.parse(d+'T'+t+'+08:00');
const last=dates.at(-1),asOf=at(last,'18:00:00'),symbols=['600001','600002','600003','600004','600005'];
const h=()=>dates.map((tradeDate,i)=>({tradeDate,source:'eastmoney',classificationVersion:'v1',observedAt:at(tradeDate),
 returnMethod:'vendor-board-reported-change',benchmarkMethod:'index-change',marketChangePct:Math.cos(i),
 sectors:[{code:'BK1000',name:'甲',category:'industry',members:symbols.slice(),changePct:Math.sin(i)+Math.cos(i),mainNetInflow:100,amountCny:1000},
 {code:'BK1001',name:'乙',category:'concept',members:symbols.slice(),changePct:Math.sin(i)*2,mainNetInflow:-50,amountCny:1000}]}));
const relations=(history=h(),extras={})=>analyzeSectorRelations({asOf,tradeDates:dates,history,...extras});
const node=r=>r.nodes.find(n=>n.code==='BK1000');
test('return-method changes cannot masquerade as a single sector return series',()=>{
 const x=h();x[4].returnMethod='equal-weight-constituents-proxy';
 let r=relations(x);assert.equal(r.edges[0].sameDayCorrelation.reason,'return-method-changed');
 assert.equal(r.edges[0].sameDayCorrelation.coefficient,null);
 x[4].returnMethod=x[0].returnMethod;x[4].benchmarkMethod='other-index';
 r=relations(x);assert.equal(r.edges[0].sameDayCorrelation.status,'descriptive-unverified');
 assert.equal(r.edges[0].marketResidualCorrelation.reason,'benchmark-method-changed');
 assert.equal(r.edges[0].marketResidualCorrelation.coefficient,null);
});
test('partial or stale membership cannot certify current member overlap or continuity',()=>{
 for(const patch of [{membershipComplete:false},{membersObservedAt:at(dates.at(-2))},{membersObservedAt:asOf+1}]){
  const x=h();Object.assign(x.at(-1).sectors[0],patch);
  const r=relations(x);assert.equal(node(r).members,null);
  assert.equal(r.edges[0].membershipOverlap.status,'unknown');
  assert.equal(node(r).flowContinuity.threeSession.reason,'membership-unknown');
 }
});
test('explicit quote dates and capture timestamps must be consistent before comparing observations',()=>{
 for(const patch of [{quoteDate:dates.at(-2)},{quoteAt:at(last)+1},{quoteAt:at(dates.at(-2))}]){
  const x=h();Object.assign(x.at(-1).sectors[0],patch);
  const r=relations(x);assert.equal(node(r).changePct,null);assert.equal(node(r).mainNetInflow,null);
  assert.equal(r.edges[0].sameDayCorrelation.reason,'quote-date-or-time-conflict');
 }
 const x=h();x[5].observedAt='2025-02-30T16:30:00+08:00';
 assert.equal(relations(x).coverage.acceptedDays,23);
 assert.equal(relations(x,{asOf:'2025-09-24T24:00:00+08:00'}).reason,'invalid-as-of');
});
test('incompatible fund units and incomplete evidence cannot create sector rotation, real zero is preserved',()=>{
 for(const patch of [{unit:'USD'},{fundsMethod:'other'},{partial:true},{mainInflow:999},{dailyResearchEligible:false}]){
  const x=h();Object.assign(x.at(-1).sectors[0],patch);
  const r=relations(x);assert.equal(node(r).mainNetInflow,null);
  assert.equal(node(r).flowContinuity.threeSession.status,'unknown');assert.equal(r.rotation.length,0);
 }
 const x=h();x.at(-1).sectors[0].mainNetInflow=0;
 const r=relations(x);assert.equal(node(r).mainNetInflow,0);assert.equal(node(r).flowIntensity,0);
 assert.equal(node(r).flowContinuity.threeSession.direction,'mixed-or-flat');
});
test('same-day current repetition cannot conceal changed calculation or membership metadata',()=>{
 const x=h(),current=JSON.parse(JSON.stringify(x.at(-1)));
 current.returnMethod='other-method';assert.equal(relations(x,{current}).reason,'latest-session-evidence-missing');
 current.returnMethod=x.at(-1).returnMethod;current.sectors[0].membershipComplete=false;
 assert.equal(relations(x,{current}).reason,'latest-session-evidence-missing');
});
function board(d,change,patch={}){return {code:'BK1000',name:'甲',category:'industry',membershipComplete:true,members:symbols.slice(),
 quoteAt:at(d,'15:01:00'),quoteDate:d,membersObservedAt:at(d,'16:00:00'),changePct:change,mainNetInflow:0,...patch};}
function event(symbol,d,change=1,boards=[],patch={}){
 const prev=dates[dates.indexOf(d)-1];
 return {kind:'analysis',hash:symbol+'/'+d,sequence:dates.indexOf(d)+1,recordedAt:at(d)+10,data:{
  symbol,asOf:at(d),tradeDate:d,tradeDates:dates,provider:'tencent',priceBasis:'unadjusted',
  bars:[{date:prev,close:10,knownAt:at(prev)},{date:d,close:10*(1+change/100),knownAt:at(d)}],
  context:{sectorContext:{current:{provider:'eastmoney',classificationVersion:'v1',boards}}},...patch}};
}
const target=symbols[0],ranked=(changes=[5,4,3,2,1])=>symbols.map((s,i)=>event(s,last,changes[i],i===0?[board(last,3)]:[]));
const position=x=>marketPosition(x,target,asOf);
test('sector trend is anchored to the latest three explicit sessions, not an old streak',()=>{
 const e=ranked(),d=dates.slice(-5,-2);
 for(let i=0;i<d.length;i++)e.push(event(target,d[i],1,[board(d[i],i)]));
 e[0].data.context.sectorContext.current.boards[0].changePct=null;
 assert.equal(position(e).phase,'unknown');
 const good=ranked();good.push(event(target,dates.at(-3),1,[board(dates.at(-3),1)]),event(target,dates.at(-2),1,[board(dates.at(-2),2)]));
 assert.equal(position(good).phase,'warming');
 good.at(-1).data.context.sectorContext.current.classificationVersion='v2';assert.equal(position(good).phase,'unknown');
});
test('rank never substitutes old last bars, later-known prices or adjusted price bases',()=>{
 for(const mutate of [d=>{d.bars=d.bars.map(b=>({...b,date:dates[dates.indexOf(b.date)-1]}))},
  d=>{d.bars.at(-1).knownAt=d.asOf+1},d=>{d.bars[0].knownAt=d.asOf+1},d=>{d.priceBasis='qfq'}]){
  const e=ranked();mutate(e[1].data);const p=position(e);
  assert.equal(p.boards[0].observedMembers,4);assert.equal(p.role,'unknown');
 }
 const e=ranked();assert.equal(position(e).role,'relative-front');assert.equal(position(e).boards[0].rank,1);
});
test('ties spanning a role boundary report rank interval rather than a code-based leader',()=>{
 const p=position(ranked([5,5,3,2,1]));
 assert.equal(p.role,'unknown');assert.equal(p.boards[0].rank,null);
 assert.deepEqual(p.boards[0].rankRange,{best:1,worst:2});
 const middle=position(ranked([3,5,3,2,1]));
 assert.equal(middle.role,'relative-middle');assert.equal(middle.boards[0].rank,null);
 assert.deepEqual(middle.boards[0].rankRange,{best:2,worst:3});assert.equal(p.canTrade,false);
});
test('stale member identities or duplicate board selection are not valid rank denominators',()=>{
 for(const patch of [{membersObservedAt:at(dates.at(-2))},{members:[...symbols.slice(0,4),'invalid']}]) {
  const e=ranked();Object.assign(e[0].data.context.sectorContext.current.boards[0],patch);
  assert.equal(position(e).boards.length,0);
 }
 const e=ranked(),list=e[0].data.context.sectorContext.current.boards;list.push({...list[0]});
 assert.equal(position(e).boards.length,0);
});
