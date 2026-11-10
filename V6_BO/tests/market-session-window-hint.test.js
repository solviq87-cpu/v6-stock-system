'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chinaMarketWindowHint,auditSnapshotQuoteTimes,classifyQuoteTime}=
 require('../src/core/market-snapshot-quote-time');
const at=datetime=>Date.parse(datetime);
const phase=chinaLocal=>chinaMarketWindowHint(at(chinaLocal));
test('Shanghai market-window hints are independent of the machine timezone',()=>{
 for(const [date,expected,continuous] of [
  ['2026-11-10T09:14:59+08:00','pre-market',false],
  ['2026-11-10T09:15:00+08:00','pre-open-or-auction-window',false],
  ['2026-11-10T09:29:59+08:00','pre-open-or-auction-window',false],
  ['2026-11-10T09:30:00+08:00','morning-continuous-window',true],
  ['2026-11-10T11:29:59+08:00','morning-continuous-window',true],
  ['2026-11-10T11:30:00+08:00','lunch-break',false],
  ['2026-11-10T12:05:53+08:00','lunch-break',false],
  ['2026-11-10T13:00:00+08:00','afternoon-continuous-window',true],
  ['2026-11-10T14:59:59+08:00','afternoon-continuous-window',true],
  ['2026-11-10T15:00:00+08:00','post-market',false],
  ['2026-11-15T10:00:00+08:00','weekend',false]
 ]){
  const v=phase(date);
  assert.equal(v.window,expected,date);
  assert.equal(v.continuousTradingWindowHint,continuous,date);
  assert.equal(v.exchangeCalendarVerified,false);
  assert.equal(v.canTrade,false);
 }
});
test('weekday holidays are clock hints, never certified market sessions',()=>{
 const v=phase('2026-10-01T10:00:00+08:00');
 assert.equal(v.window,'morning-continuous-window');
 assert.equal(v.exchangeCalendarVerified,false);
 assert.equal(v.canTrade,false);
});
test('fresh vendor timestamps during lunch never certify market trading',()=>{
 const now=at('2026-11-10T12:05:55+08:00');
 const quoteAt=at('2026-11-10T12:05:53+08:00');
 const snapshot={date:'2026-11-10',source:'eastmoney-clist-unverified-live',
  retrievedAt:new Date(now).toISOString(),stocks:[{code:'600519',vendorQuoteAt:quoteAt}]};
 const row=classifyQuoteTime(snapshot.stocks[0],{requestDate:snapshot.date,retrievedAt:now});
 assert.equal(row.quoteTimeStatus,'recent-source-unverified');
 assert.equal(row.canTrade,false);
 const audit=auditSnapshotQuoteTimes(snapshot,{asOf:now});
 assert.equal(audit.marketWindowHint,'lunch-break');
 assert.equal(audit.continuousTradingWindowHint,false);
 assert.equal(audit.exchangeCalendarVerified,false);
 assert.equal(audit.quoteTimeVerified,false);
 assert.equal(audit.canTrade,false);
 assert.equal(audit.recentSourceTimeCount,1);
});
test('invalid quote clocks fail closed',()=>{
 for(const value of [-1,NaN,Infinity,'2026-11-10',null,2**60])
  assert.throws(()=>chinaMarketWindowHint(value));
});
