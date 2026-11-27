'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePreviousCloseRisk}=require('../src/core/portfolio-risk-gate');
const {evaluateEntryRisk,consecutiveLosses}=require('../src/core/common-entry-risk');
const close={priorEquity:90000,priorPeak:100000,previousEquity:100000};
const base={symbol:'600000',quantity:100,price:10,cash:100000};
const buy={side:'buy'},loss={side:'sell',realizedPnl:-5},win={side:'sell',realizedPnl:1};
function gate(patch,limits={maxDrawdownPausePct:7}){return evaluatePreviousCloseRisk({...close,...patch,...limits});}
function risk(previousClose){return evaluateEntryRisk({...base,policy:{version:'loss-evidence',maxDrawdownPausePct:7},previousClose});}
test('a claimed historical peak below the latest close cannot certify zero drawdown',()=>{
 assert.throws(()=>gate({priorEquity:100000,priorPeak:95000}),/前日净值风控输入无效/);
});
test('a claimed peak below the earlier known close cannot understate the actual drawdown',()=>{
 assert.throws(()=>gate({priorPeak:95000}),/前日净值风控输入无效/);
 const receipt=risk({...close,priorPeak:95000});
 assert.equal(receipt.allowed,false);assert.deepEqual(receipt.reasonCodes,['INVALID_PRIOR_CLOSE_EVIDENCE']);
});
test('drawdown and daily loss retain exact thresholds and valid independent meanings',()=>{
 assert.deepEqual(gate({}, {maxDrawdownPausePct:10,maxDailyLossPausePct:10}),{paused:true,reasons:['前日收盘回撤超限','前日收盘单日亏损超限'],drawdownPct:10,dailyLossPct:10});
 assert.equal(gate({}, {maxDrawdownPausePct:10.01,maxDailyLossPausePct:10.01}).paused,false);
 assert.equal(gate({priorEquity:100000,previousEquity:90000}).paused,false);
 assert.equal(gate({priorEquity:0}).drawdownPct,100);
});
test('existing research rounded closes remain compatible with an unrounded peak',()=>{
 for(const [priorPeak,rounded] of [[100000.006,100000.01],[100000.00006,100000.0001]]){
  assert.equal(gate({priorPeak,priorEquity:rounded,previousEquity:rounded}).paused,false);
  assert.equal(gate({priorPeak,priorEquity:90000,previousEquity:rounded}).paused,true);
 }
 // Not a valid 2- or 4-decimal representation of the original peak.
 assert.throws(()=>gate({priorPeak:100000.006,priorEquity:100000.009,previousEquity:100000}),/前日净值风控输入无效/);
});
test('missing or corrupt event collections are unknown rather than zero losses or exceptions',()=>{
 for(const events of [undefined,null,{},'sell',false,[null],Array(1)])assert.equal(consecutiveLosses(events),null);
 assert.equal(consecutiveLosses([]),0);
});
test('unknown transaction directions or inherited fields cannot hide a loss in the relevant suffix',()=>{
 for(const event of [{side:'unknown'},{},{side:'SELL'},Object.create({side:'buy'}),Object.create({side:'sell',realizedPnl:0}),Object.assign(Object.create({realizedPnl:0}),{side:'sell'})]){
  assert.equal(consecutiveLosses([loss,event,loss]),null);
 }
});
test('loss streak keeps settled partial exits, known buys and non-loss reset semantics',()=>{
 assert.equal(consecutiveLosses([win,loss,buy,loss,buy]),2);
 assert.equal(consecutiveLosses([loss,loss,{side:'sell',realizedPnl:0},buy]),0);
 assert.equal(consecutiveLosses([null,win,loss]),1);
 for(const realizedPnl of [null,undefined,'-1',NaN,Infinity])assert.equal(consecutiveLosses([loss,{side:'sell',realizedPnl}]),null);
});
test('unknown consecutive losses block new exposure but do not prevent risk-reducing exits',()=>{
 const policy={version:'loss-evidence',maxConsecutiveLosses:2};
 const lossStreak=consecutiveLosses([loss,{side:'unknown'}]);
 const r=evaluateEntryRisk({...base,policy,lossStreak});
 assert.equal(r.allowed,false);assert.deepEqual(r.reasonCodes,['MISSING_LOSS_STREAK']);
 assert.equal(evaluateEntryRisk({...base,policy,lossStreak,side:'sell'}).allowed,true);
 assert.equal(evaluateEntryRisk({...base,policy:null,lossStreak}).allowed,true);
 assert.equal(evaluateEntryRisk({...base,policy,lossStreak:1}).allowed,true);
 assert.equal(evaluateEntryRisk({...base,policy,lossStreak:2}).allowed,false);
});
