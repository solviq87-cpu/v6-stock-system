'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const research=require('../src/core/intelligence-research');
const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture');
const {verifiedLearningObservation,settlementObservation}=require('../public/nova/shortline/sample-quality.mjs');
const report=x=>research.buildIntelligenceResearch({day:x.day,now:x.now,archive:x.state,calendar:x.calendar}).feedback;
const ms=(day,clock)=>Date.parse(day+'T'+clock+'+08:00');

test('strict learning and center use recovery knowledge time, while original settlements stay intact',async()=>{
 const x=await feedbackFixture(),{readLearningRows}=await import('../public/nova/shortline/learning.mjs');
 x.state.bars=[];x.state.checks=[];x.state.trades=x.state.trades.slice(0,1);
 const row=x.state.trades[0],restored=ms(x.day,'15:06:00');
 row.planEvidenceReview={status:'revalidated',firstQuarantinedAt:restored-120000,
  lastQuarantinedAt:restored-60000,revalidatedAt:restored};
 const training=clock=>readLearningRows(x.state,clock).filter(r=>r.learningOutcomeBasis==='recorded-settlement');
 assert.equal(verifiedLearningObservation(row,restored-1),null);
 assert.equal(training(restored-1).length,0);
 assert.equal(report({...x,now:restored-1}).matureTrades,0);
 assert.equal(verifiedLearningObservation(row,restored).knownAt,restored);
 assert.equal(training(restored)[0].labelKnownAt,x.day+'T15:06');
 assert.equal(report({...x,now:restored}).matureTrades,1);
 assert.ok(settlementObservation(row,restored-1,{requireReceipt:true}));
 row.planEvidenceReview.lastQuarantinedAt=restored+1;
 assert.equal(training(x.now).length,0);assert.equal(report(x).matureTrades,0);
 assert.equal(x.state.trades[0],row);assert.ok(Number.isFinite(row.pnl));
});

test('unverified or contradictory settlement cannot count toward center learning readiness',async()=>{
 const x=await feedbackFixture(),{readLearningRows}=await import('../public/nova/shortline/learning.mjs');
 x.state.bars=[];x.state.checks=[];x.state.trades=x.state.trades.slice(0,1);
 const row=x.state.trades[0],good=structuredClone(row);
 row.snapshotVerified=false;
 assert.equal(report(x).matureTrades,0);
 assert.ok(settlementObservation(row,x.now,{requireReceipt:true}));
 x.state.trades=[good,{...good,snapshotVerified:false}];
 assert.equal(report(x).matureTrades,0);
 assert.equal(readLearningRows(x.state,x.now).filter(r=>r.learningOutcomeBasis==='recorded-settlement').length,0);
 x.state.trades=[good];
 assert.equal(report(x).matureTrades,1);
 assert.equal(readLearningRows(x.state,x.now).filter(r=>r.learningOutcomeBasis==='recorded-settlement').length,1);
});
