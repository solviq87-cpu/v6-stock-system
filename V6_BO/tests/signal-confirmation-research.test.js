'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {catalog,evaluateSignalConfirmation}=require('../src/strategy/signal-confirmation-research');
const {evaluatePublicRuleForwardAudit}=require('../src/strategy/public-rule-forward-audit');

function history(){
  const bars=Array.from({length:90},(_,index)=>{
    const close=index<75?10:10.2;
    const date=new Date(Date.UTC(2025,0,index+2)).toISOString().slice(0,10);
    return {date,open:close,high:close+0.05,low:close-0.05,close,volume:1000};
  });
  return {source:'fixture',asOf:bars.at(-1).date,
    priceAdjustment:{mode:'unadjusted',provider:'fixture'},
    stocks:[{symbol:'600001',market:'main',limitPct:10,corporateActionsVerified:true,bars}]};
}

const options={windows:1,testDays:15,gapDays:2,horizons:[1,5]};

test('a fresh crossover needs confirmation and completed, tradable daily bars',()=>{
  const [stock]=history().stocks;
  const bars=stock.bars.slice(0,76);
  assert.deepEqual(evaluateSignalConfirmation({...stock,bars:bars.slice(0,-1)}).map(x=>x.status),
    ['not_matched','not_matched']);
  assert.deepEqual(evaluateSignalConfirmation({...stock,bars}).map(x=>x.status),
    ['candidate','candidate']);
  const conflicted=[...bars.slice(0,-1),{...bars.at(-1),low:9.5}];
  assert.equal(evaluateSignalConfirmation({...stock,bars:conflicted})[0].status,'not_matched');
  for(const [flags,status] of [[{complete:false},'insufficient_data'],[{suspended:true},'risk_blocked'],[{volume:0},'risk_blocked']]){
    const changed=[...bars.slice(0,-1),{...bars.at(-1),...flags}];
    assert.ok(evaluateSignalConfirmation({...stock,bars:changed}).every(x=>x.status===status));
  }
});

test('opt-in integrates with replay, next-session timing and same-family deduplication',()=>{
  const input=history(),bars=input.stocks[0].bars;
  const baseline=evaluatePublicRuleForwardAudit(input,options);
  const enabled={...options,includeSignalConfirmation:true};
  const report=evaluatePublicRuleForwardAudit(input,enabled);
  const ids=catalog.map(rule=>rule.id);
  assert.equal(baseline.rules.length,2);
  assert.deepEqual(report.rules.slice(2).map(rule=>rule.id),ids);
  assert.deepEqual(report.events.filter(event=>!ids.includes(event.ruleId)),baseline.events);
  const events=report.events.filter(event=>ids.includes(event.ruleId));
  assert.equal(events.length,4);
  assert.ok(events.every(event=>event.signalDate===bars[75].date&&
    event.entryDate===bars[76].date&&event.exitDate===bars[76+event.horizon].date));
  for(const id of ids){
    assert.equal(report.ruleInputDiagnostics[id].candidateDays,1);
    assert.equal(report.overlapDiagnostics.byRule[id].sameFamilyOverlapDays,1);
  }
  assert.equal(report.canTrade,false);
  assert.equal(report.weightsChanged,false);
  const future=structuredClone(input);
  future.stocks[0].bars[89].close=10.23;
  const replay=evaluatePublicRuleForwardAudit(future,enabled);
  const keys=result=>result.events.filter(event=>ids.includes(event.ruleId))
    .map(({signalDate,ruleId,horizon})=>[signalDate,ruleId,horizon]);
  assert.deepEqual(keys(replay),keys(report));
  assert.throws(()=>evaluatePublicRuleForwardAudit(input,{...options,includeSignalConfirmation:'true'}),/布尔值/);
});
