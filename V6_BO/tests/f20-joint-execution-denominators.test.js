'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/research-v2-position-ledger-backtest');
const fixture=()=>['600000','600001'].map(symbol=>({symbol,market:'main',volumeUnit:'shares',
 bars:Array.from({length:45},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),
  open:10,high:10.1,low:9.9,close:10,volume:30000}))}));
const opts=stocks=>({stocks,start:27,end:32,topN:1,holdDays:1,maxParticipationPct:1,
 selectCandidates:(rows,day)=>day===27?['600000','600001','600000']:[]});
test('F20.4 counts all ranked candidates, capacity-limited entry and eventual full exit once',()=>{
 const stocks=fixture();stocks[0].bars[28].volume=10000;stocks[0].bars[29].volume=10000;
 const before=JSON.stringify(stocks),r=ledgerBacktest(opts(stocks)),d=r.signalExecution;
 assert.equal(d.status,'descriptive-only');
 assert.deepEqual([d.rankedSignals,d.slotExcluded,d.scheduledBuySignals,d.enteredCohorts],[2,1,1,1]);
 assert.deepEqual([d.fullEntryCohorts,d.partialEntryCohorts,d.fullyExitedCohorts,d.fullyRequestedEntryAndExitCohorts],[0,1,1,0]);
 assert.deepEqual([d.ordinaryPartialExitCohorts,d.ordinaryPartialExitAttempts,d.openEntryCohorts,d.unknownExitCohorts],[1,2,0,0]);
 assert.equal(d.allRankedEntryAndFullExitPct,50);assert.equal(d.enteredFullExitPct,100);
 assert.equal(d.allRankedFullRequestedEntryAndExitPct,0);assert.equal(d.predictiveProbability,null);
 assert.equal(r.trades.reduce((n,t)=>n+t.shares,0),300);
 assert.equal(JSON.stringify(stocks),before);assert.equal(d.canTrade,false);
});
test('F20.4 preserves blocked entry, unclosed entry and empty denominators',()=>{
 const blocked=fixture();blocked[0].bars[28].volume=0;
 let d=ledgerBacktest(opts(blocked)).signalExecution;
 assert.equal(d.blockedBuySignals,1);assert.equal(d.enteredCohorts,0);assert.equal(d.allRankedEntryPct,0);assert.equal(d.enteredFullExitPct,null);
 d=ledgerBacktest({...opts(fixture()),end:28}).signalExecution;
 assert.equal(d.openEntryCohorts,1);assert.equal(d.fullyExitedCohorts,0);assert.equal(d.enteredFullExitPct,0);
 d=ledgerBacktest({...opts(fixture()),selectCandidates:()=>[]}).signalExecution;
 assert.equal(d.rankedSignals,0);assert.equal(d.allRankedEntryPct,null);assert.equal(d.enteredFullExitPct,null);
});
test('F20.4 corporate share changes retain ledger exits but ordinary entry-cohort completion stays unknown',()=>{
 const stocks=fixture(),b=stocks[0].bars[29];
 b.corporateAction={type:'cash-and-shares',source:'isolated-fixture',netCashPerShare:0,shareMultiplier:2,referenceClose:5,
  publishedAt:b.date+'T08:00:00+08:00',cashDate:b.date,sharesAvailableDate:b.date};
 Object.assign(b,{open:5,high:5.1,low:4.9,close:5});
 for(let i=30;i<=32;i++)Object.assign(stocks[0].bars[i],{open:5,high:5.1,low:4.9,close:5});
 const r=ledgerBacktest(opts(stocks)),d=r.signalExecution;
 assert.equal(d.status,'descriptive-only');assert.equal(d.unknownExitCohorts,1);
 assert.equal(d.fullyExitedCohorts,0);assert.ok(r.trades.length>0);
 assert.equal(d.predictiveProbability,null);assert.equal(d.executionCertified,false);
});
