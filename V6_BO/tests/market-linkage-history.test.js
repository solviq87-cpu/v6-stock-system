'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {buildMarketSectorStockLinkage} = require('../src/core/market-sector-stock-linkage');
const {enrichMarketLinkageHistory} = require('../src/core/market-linkage-history');
const dates = ['2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'];
const close = d => Date.parse(d+'T15:00:00+08:00');
const symbols = ['600000','600001','600002','600003','600004'];
function setup(own = [.04,.04,.04,.04,.04]) {
 const events = dates.slice(1).map((date,i) => {
  const start=close(dates[i]),end=close(date),at=end+1000;
  const evidence={provider:'eastmoney',symbol:symbols[0],tradeDate:date,knownAt:at,window:{start,end},returnBasis:'price',benchmark:{provider:'eastmoney',code:'000001',name:'指数',methodologyVersion:'v1',return:.005,knownAt:at},classification:{provider:'eastmoney',version:'v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true},boards:[{code:'A',name:'行业',category:'industry',members:[...symbols],membersKnownAt:start,membersEffectiveAt:start,return:.01,knownAt:at}],stocks:symbols.map((symbol,j)=>({symbol,return:j===0?own[i]:.01-j*.001,knownAt:at}))};
  return {kind:'analysis',sequence:i+1,recordedAt:at+1000,data:{asOf:at,tradeDate:date,tradeDates:dates.slice(0,i+2),provider:'eastmoney',priceBasis:'unadjusted',symbol:symbols[0],context:{marketLinkageEvidence:evidence}}};
 });
 const selectedEvent=events.at(-1),asOf=selectedEvent.recordedAt;
 const view=buildMarketSectorStockLinkage(events,{selectedEvent,asOf});
 const run=()=>enrichMarketLinkageHistory(view,events,{selectedEvent,asOf});
 return {events,selectedEvent,view,run,asOf};
}
test('five matching frozen closes produce persistent candidate without mutating the source',()=>{
 const x=setup(),before=JSON.stringify(x.view),out=x.run(),trend=out.boards[0].members[0].trend;
 assert.equal(trend.role,'persistent-front-candidate');assert.equal(trend.frontSessions,5);assert.equal(trend.return,Number((1.04**5-1).toFixed(10)));assert.equal(out.boards[0].stock.trend.role,trend.role);assert.equal(JSON.stringify(x.view),before);
});
test('future calendar sessions do not displace selected history or use future observations',()=>{
 const x=setup();x.selectedEvent.data.tradeDates.push('2026-11-16','2026-11-17');
 const future=structuredClone(x.events.at(-1));future.sequence++;future.data.tradeDate='2026-11-16';future.data.context.marketLinkageEvidence.stocks[0].return=-.9;x.events.push(future);
 assert.equal(x.run().boards[0].members[0].trend.role,'persistent-front-candidate');
});
test('one front session or negative compound excess does not imply persistent front',()=>{
 const x=setup([.04,-.02,-.02,-.02,-.02]);const trend=x.run().boards[0].members[0].trend;
 assert.notEqual(trend.role,'persistent-front-candidate');assert.equal(trend.frontSessions,1);assert.equal(trend.role,'relative-weak-observation');
});
test('same-size member replacement invalidates history for that board',()=>{
 const x=setup();x.events[1].data.context.marketLinkageEvidence.boards[0].members[4]='600005';
 assert.equal(x.run().boards[0].members[0].trend.role,'unknown');
});
test('later archive and future-known evidence cannot leak into selected snapshot',()=>{
 const x=setup();const future=structuredClone(x.events[1]);future.sequence=99;future.data.context.marketLinkageEvidence.stocks[0].return=.9;x.events.push(future);
 assert.equal(x.run().boards[0].members[0].trend.frontSessions,5);
 x.events[1].data.context.marketLinkageEvidence.stocks[0].knownAt=x.selectedEvent.data.asOf+1;
 assert.equal(x.run().boards[0].members[0].trend.role,'unknown');
});
test('latest permitted revision is authoritative even when incompatible',()=>{
 const x=setup();const revision=structuredClone(x.events[1]);revision.sequence=4;revision.recordedAt++;revision.data.provider='tencent';x.events.push(revision);
 assert.equal(x.run().boards[0].members[0].trend.reason,'daily-snapshot-missing-or-incompatible');
});
test('gaps, mismatched windows, classification or corporate actions block comparison',()=>{
 for(const change of [x=>x.events.splice(1,1),x=>x.events[1].data.context.marketLinkageEvidence.window.start++,x=>x.events[1].data.context.marketLinkageEvidence.classification.version='v2',x=>x.events[1].data.context.marketLinkageEvidence.methodology.noCorporateActions=null]) {
  const x=setup();change(x);assert.equal(x.run().boards[0].members[0].trend.role,'unknown');
 }
});
test('missing member returns or insufficient coverage stay unknown',()=>{
 const x=setup();x.events[1].data.context.marketLinkageEvidence.stocks[0].return=null;
 assert.equal(x.run().boards[0].members[0].trend.reason,'member-coverage-or-return-unavailable');
 x.events[1].data.context.marketLinkageEvidence.stocks[1].return=null;
 assert.equal(x.run().boards[0].members[2].trend.role,'unknown');
});

test('five-day breadth uses one frozen common cohort and exposes relative strength without a trading decision',()=>{
 const x=setup(),v=x.run().boards[0].trend.structure;
 assert.equal(v.status,'observed-unverified');assert.equal(v.role,'broad-relative-strength');assert.equal(v.commonObserved,5);assert.equal(v.coverage,1);
 assert.equal(v.broadUpSessions,5);assert.equal(v.outperformSessions,5);assert.equal(v.daily.length,5);assert.equal(v.canTrade,false);
 assert.ok(v.daily.every(d=>d.up===5&&d.down===0&&d.flat===0));
});
test('one-stock pulse cannot label the whole board broad strength',()=>{
 const x=setup();for(const e of x.events)e.data.context.marketLinkageEvidence.stocks.slice(1).forEach(s=>s.return=-.01);
 const v=x.run().boards[0].trend.structure;assert.equal(v.role,'mixed');assert.equal(v.broadUpSessions,0);assert.equal(v.outperformSessions,5);
});
test('broad persistent weakness is distinct from a one-day reversal',()=>{
 const x=setup();for(const e of x.events){const q=e.data.context.marketLinkageEvidence;q.boards[0].return=-.03;q.stocks.forEach(s=>s.return=-.02);}
 let v=x.run().boards[0].trend.structure;assert.equal(v.role,'broad-relative-weakness');assert.equal(v.broadDownSessions,5);assert.equal(v.underperformSessions,5);
 for(const e of x.events.slice(0,4)){const q=e.data.context.marketLinkageEvidence;q.boards[0].return=.01;q.stocks.forEach(s=>s.return=.02);}
 v=x.run().boards[0].trend.structure;assert.notEqual(v.role,'broad-relative-weakness');
});
test('changing missing rows cannot create five-day common-cohort coverage',()=>{
 const x=setup();const extra='600005';for(const e of x.events){const q=e.data.context.marketLinkageEvidence;q.boards[0].members.push(extra);q.stocks.push({symbol:extra,return:.01,knownAt:q.knownAt});}
 x.events[0].data.context.marketLinkageEvidence.stocks[0].return=null;
 x.events[1].data.context.marketLinkageEvidence.stocks[1].return=null;
 x.view=buildMarketSectorStockLinkage(x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});
 const out=enrichMarketLinkageHistory(x.view,x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});const v=out.boards[0].trend.structure;
 assert.equal(v.status,'unknown');assert.equal(v.commonObserved,4);assert.equal(v.role,'unknown');assert.deepEqual(v.daily,[]);assert.equal(v.migration,null);
 assert.equal(out.boards[0].trend.status,'observed-unverified','independent supplied board-return evidence remains available');
});
test('prior front group is frozen before final return and its migration is separate from price strength',()=>{
 const x=setup();const last=x.events.at(-1).data.context.marketLinkageEvidence.stocks;last[0].return=-.03;last[1].return=.08;
 const v=x.run().boards[0].trend.structure.migration;assert.equal(v.priorDate,'2026-11-12');assert.equal(v.currentDate,'2026-11-13');
 assert.equal(v.priorFrontCount,1);assert.equal(v.currentFrontCount,1);assert.equal(v.retainedFront,0);assert.equal(v.enteredFront,1);assert.equal(v.leftFront,1);assert.equal(v.priorFrontCurrentMeanReturn,-.03);assert.equal(v.canTrade,false);
});
test('tied whole-board front ranks do not invent a unique cohort or a group advantage',()=>{
 const x=setup();for(const e of x.events)e.data.context.marketLinkageEvidence.stocks.forEach(s=>s.return=.01);
 const v=x.run().boards[0].trend.structure.migration;assert.equal(v.priorFrontCount,5);assert.equal(v.retainedFront,5);assert.equal(v.otherCurrentMeanReturn,null);
});
function twoIndustries(x){
 for(const e of x.events){const q=e.data.context.marketLinkageEvidence;const members=['600010','600011','600012','600013','600014'];q.boards.push({code:'B',name:'行业乙',category:'industry',members,membersKnownAt:q.window.start,membersEffectiveAt:q.window.start,return:.01,knownAt:q.knownAt});for(const symbol of members)q.stocks.push({symbol,return:.015,knownAt:q.knownAt});}
 x.view=buildMarketSectorStockLinkage(x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});return ()=>enrichMarketLinkageHistory(x.view,x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});
}
test('comparable industries are scoped to the frozen snapshot and ties coexist without winner selection',()=>{
 const x=setup(),run=twoIndustries(x),v=run().mainlineComparison;
 assert.equal(v.status,'observed-unverified');assert.equal(v.eligibleIndustries,2);assert.equal(v.totalIndustries,2);assert.equal(v.scope,'selected-snapshot-industries-only');assert.equal(v.canTrade,false);assert.deepEqual(v.rows.map(r=>r.rank),[1,1]);assert.ok(v.rows.every(r=>r.role==='broad-relative-strength'));
 x.events[0].data.context.marketLinkageEvidence.stocks.at(-1).return=null;
 const w=run().mainlineComparison;assert.equal(w.status,'insufficient-comparable-industries');assert.equal(w.eligibleIndustries,1);assert.equal(w.totalIndustries,2);assert.ok(w.rows.every(r=>r.rank===null));
});
test('incompatible history does not emit new comparison or migration evidence',()=>{
 const x=setup();x.events[1].data.context.marketLinkageEvidence.classification.version='v2';const out=x.run();
 assert.equal(out.mainlineComparison.status,'unknown');assert.deepEqual(out.mainlineComparison.rows,[]);assert.equal(out.boards[0].trend.structure,null);
});
test('late previous-session revision cannot retrospectively define the pre-open cohort',()=>{
 const x=setup();x.events[3].recordedAt=Date.parse('2026-11-13T10:00:00+08:00');
 const v=x.run().boards[0].trend.structure;assert.equal(v.status,'observed-unverified');assert.equal(v.migration,null);
});
test('common history may remain usable when previous and current coverage differ, but migration is withheld',()=>{
 const x=setup();const extra='600005';for(const e of x.events){const q=e.data.context.marketLinkageEvidence;q.boards[0].members.push(extra);q.stocks.push({symbol:extra,return:.01,knownAt:q.knownAt});}
 x.events.at(-1).data.context.marketLinkageEvidence.stocks.at(-1).return=null;
 const view=buildMarketSectorStockLinkage(x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});const v=enrichMarketLinkageHistory(view,x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf}).boards[0].trend.structure;
 assert.equal(v.status,'observed-unverified');assert.equal(v.commonObserved,5);assert.equal(v.migration,null);
});

test('F15.3 fixed lag compares only identical pairs; simultaneous alternating shocks are not leading evidence',()=>{
 const x=setup();for(let i=0;i<x.events.length;i++){
  const q=x.events[i].data.context.marketLinkageEvidence,dir=i%2?-1:1;
  q.stocks.forEach(s=>s.return=dir*.02);q.benchmark.return=dir*.01;
 }
 const v=x.run().boards[0].trend.structure.leadLag;
 assert.equal(v.lagSessions,1);assert.equal(v.attempted,4);assert.equal(v.pairedEvaluated,4);assert.equal(v.lagMatches,0);assert.equal(v.concurrentMatches,4);
 assert.equal(v.leadingConfirmed,false);assert.equal(v.outOfSampleVerified,false);assert.equal(v.canTrade,false);
});
test('F15.3 late or reversed archive clocks cannot be used as a pre-open signal',()=>{
 const x=setup();x.events[3].recordedAt=Date.parse('2026-11-13T10:00:00+08:00');
 let v=x.run().boards[0].trend.structure.leadLag;assert.equal(v.unknown,1);assert.equal(v.pairs.at(-1).reason,'clock-not-point-in-time');assert.equal(v.pairs.at(-1).lagMatch,null);
 x.events[3].recordedAt=x.events[3].data.asOf-1;v=x.run().boards[0].trend.structure.leadLag;assert.equal(v.unknown,2);assert.equal(v.pairedEvaluated,2);
});
test('F15.3 neutral direction is an abstention for both comparisons, not a successful prediction',()=>{
 const x=setup();for(const e of x.events)e.data.context.marketLinkageEvidence.benchmark.return=0;
 const v=x.run().boards[0].trend.structure.leadLag;assert.equal(v.pairedEvaluated,0);assert.equal(v.abstained,4);assert.equal(v.lagMatches,null);assert.equal(v.concurrentMatches,null);
});
test('F15.3 changing observed membership cannot define the prior cohort after the outcome',()=>{
 const x=setup();for(const e of x.events){const q=e.data.context.marketLinkageEvidence;q.boards[0].members.push('600005');q.stocks.push({symbol:'600005',return:.01,knownAt:q.knownAt});}
 x.events.at(-1).data.context.marketLinkageEvidence.stocks.at(-1).return=null;
 x.view=buildMarketSectorStockLinkage(x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf});
 const v=enrichMarketLinkageHistory(x.view,x.events,{selectedEvent:x.selectedEvent,asOf:x.asOf}).boards[0].trend.structure.leadLag;
 assert.equal(v.pairedEvaluated,3);assert.equal(v.unknown,1);assert.equal(v.pairs.at(-1).reason,'same-cohort-unavailable');
});
