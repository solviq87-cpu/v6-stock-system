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
