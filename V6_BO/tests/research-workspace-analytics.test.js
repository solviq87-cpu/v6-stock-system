'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/core/research-workspace-decision'),A=require('../src/core/research-workspace-analytics');
const {fixture,native,event,at,dates}=require('./helpers/research-workspace-fixtures');
function history(){
 const signal=D.buildWorkspaceDecision(fixture(),native()),later=D.buildWorkspaceDecision(fixture({index:140}),native(140));
 later.benchmarkSeries={provider:'tencent',symbol:'000001',source:'synthetic-index',priceBasis:'unadjusted',frequency:'1d',bars:[71,72,76,91,131].map(i=>({date:dates[i],open:100+i,knownAt:at(i)}))};
 return [event(signal),event(later,2)];
}
test('scorecards retain all four systems and mature/pending denominators across 1/5/20/60 sessions',()=>{
 const events=history(),r=A.scorecards(events,{asOf:at(140)});assert.deepEqual(r.systems.map(x=>x.id),['fourteen','bazi','gpt','python']);
 for(const h of [1,5,20,60]){const g=r.groups.find(g=>g.system==='python'&&g.horizon===h);assert.equal(g.total,2);assert.equal(g.passed,2);assert.equal(g.modeledCount,1);assert.equal(g.pending,1);assert.equal(g.nonOverlappingWindows,1);assert.equal(g.status,'insufficient-independent-samples');}
 assert.ok(r.groups.every(g=>g.total===g.rejected+g.unknown+g.passed&&g.passed===g.modeledCount+g.pending+g.missing+g.blocked));
});
test('cost and benchmark use matching next-session open-to-open prices; expensive assumptions reduce estimates',()=>{
 const events=history(),r=A.scorecards(events,{asOf:at(140)}),o=r.observations.find(x=>x.runId===events[0].hash&&x.system==='python'&&x.horizon===1);
 assert.equal(o.entryDate,dates[71]);assert.equal(o.exitDate,dates[72]);assert.equal(o.benchmarkStatus,'matched-open-to-open');assert.ok(Math.abs(o.benchmarkReturnPct-100*(172/171-1))<1e-10);
 assert.ok(o.netReturnPct<o.priceReturnPct);const stress=A.scorecards(events,{asOf:at(140),feeBps:32,slippageBps:50});assert.ok(stress.groups.find(x=>x.system==='python'&&x.horizon===1).averageNetReturnPct<r.groups.find(x=>x.system==='python'&&x.horizon===1).averageNetReturnPct);
 const wrong=structuredClone(events);wrong[1].data.benchmarkSeries.priceBasis='adjusted';assert.equal(A.scorecards(wrong,{asOf:at(140)}).observations.find(x=>x.runId===events[0].hash&&x.system==='python'&&x.horizon===1).benchmarkStatus,'missing-matching-open-series');
});
for(const defect of ['suspended','zero-volume','one-price','unknown-action','late-status','missing-price','late-signal','unknown-limit','limit-up-open','limit-down-exit'])test('scorecard never reports net results for '+defect,()=>{
 const events=history(),bar=events[1].data.bars[71];
 if(defect==='suspended')bar.suspended=true;
 if(defect==='zero-volume')bar.volume=0;
 if(defect==='one-price')bar.high=bar.low;
 if(defect==='unknown-action')delete bar.corporateAction;
 if(defect==='late-status')bar.statusKnownAt=at(71);
 if(defect==='missing-price')events[1].data.bars=events[1].data.bars.filter(x=>x.date!==dates[71]);
 if(defect==='late-signal')events[0].recordedAt=at(71,'10:00');
 if(defect==='unknown-limit')delete bar.limitKnownAt;
 if(defect==='limit-up-open')bar.open=bar.limitUpPrice;
 if(defect==='limit-down-exit'){const exit=events[1].data.bars[72];exit.open=Math.round(exit.limitReferencePrice*.9*100)/100;}
 const o=A.scorecards(events,{asOf:at(140)}).observations.find(x=>x.runId===events[0].hash&&x.system==='python'&&x.horizon===1);assert.equal(o.netReturnPct,null);assert.notEqual(o.status,'paper-estimate');
});
test('corporate action inside a multi-session holding window blocks a share-constant net estimate',()=>{
 const events=history();events[1].data.bars[73].corporateAction=true;const o=A.scorecards(events,{asOf:at(140)}).observations.find(x=>x.runId===events[0].hash&&x.system==='python'&&x.horizon===5);assert.equal(o.netReturnPct,null);assert.equal(o.status,'unverified-execution');
});
test('same-day recalculation cannot replace the first frozen signal or import future outcomes into replay',()=>{
 const events=history(),revised=structuredClone(events[0]);revised.sequence=2;revised.hash='revision';revised.data.systems.find(s=>s.id==='python').verdict='fail';revised.recordedAt++;
 const r=A.scorecards([events[0],revised,events[1]],{asOf:at(140)});assert.equal(r.groups.find(g=>g.system==='python'&&g.horizon===1).rejected,0);
 assert.equal(A.scorecards(events,{asOf:at(70)}).observations.length,0);
});
test('holding defense reads authoritative holdings, matches entry evidence and refuses incomplete or stale valuation',()=>{
 const one=D.buildWorkspaceDecision(fixture()),two=D.buildWorkspaceDecision(fixture({index:71}));one.conditions[0].status='pass';two.conditions[0].status='fail';
 const events=[event(one),event(two,2)],now=at(71),accounts={fourteen:{positions:{'600000':{name:'合成持仓',shares:100,buyPrice:10,buyTs:at(70)+1000,locked:true},'600001':{shares:200,buyPrice:20,buyTs:at(70)+1000}}}};
 const q=(price,quoteAt=now-100)=>({price,quoteAt,receivedAt:now,quoteSource:'public-price-provider',canTrade:true,tradable:true,suspended:false});
 const quotes=new Map([['600000',{wireQuote:q(11)}],['600001',{wireQuote:q(22)}]]),before=JSON.stringify(accounts);
 let r=A.holdingDefense(events,accounts,quotes,now,{maxPositionPct:10});assert.equal(r.rows[0].weightPct,20);assert.equal(r.rows[0].invalidated.length,1);assert.equal(r.rows[0].concentrationWarning,true);assert.equal(r.rows[0].locked,true);
 assert.equal(JSON.stringify(accounts),before);assert.equal(r.canTrade,false);
 quotes.set('600001',{wireQuote:q(22,now-15001)});r=A.holdingDefense(events,accounts,quotes,now);assert.ok(r.rows.every(p=>p.weightPct===null));assert.equal(r.rows[1].status,'quote-unusable');
 accounts.fourteen.positions['600000'].buyTs=at(60);assert.equal(A.holdingDefense(events,accounts,quotes,now).rows[0].entryRunId,null);
});
