'use strict';
// Isolated provider-observation tests. No account, execution, or live-network use.
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeReasonEvidence,applyDatedLimitReason,reasonMatchesDay}=require('../src/core/limit-reason-evidence');
const {mergeLimitReviewPools}=require('../src/core/limit-review-pool');
const day='2026-11-13',next='2026-11-16';
const receivedAt=Date.parse('2026-11-13T15:10:00+08:00');
test('provider evidence dates cannot be borrowed from requested refresh day',()=>{
 const evidence=normalizeReasonEvidence({reason:'历史原因',firstTime:new Date('2026-11-13T09:31:00+08:00')},
  {requestedDate:next,receivedAt,source:'ths'});
 assert.equal(evidence.reasonTradeDate,day);
 assert.equal(evidence.reasonDateStatus,'mismatch');
 assert.equal(reasonMatchesDay(evidence,next),false);
 const row=applyDatedLimitReason({code:'600001'},evidence,null,next);
 assert.equal(row.reason,'');
 assert.equal(row.reasonTradeDate,day);
});
test('same-day 37+38 source union retains ST and its provenance but never authorizes trades',()=>{
 const em=Array.from({length:37},(_,i)=>({code:String(600000+i),name:'研究样本'+i,tradeDate:day,sourceTradeDate:day,src:'em',price:10,receivedAt}));
 const cls=Array.from({length:38},(_,i)=>({
  code:String(600000+i),name:i===37?'*ST研究样本':'研究样本'+i,
  tradeDate:day,sourceTradeDate:day,src:'cls',isST:i===37,price:11,
  reason:'同日来源原因',reasonSource:'cls',reasonTradeDate:day,reasonDateStatus:'matched',
  sectorTags:[{name:'原始题材'}],receivedAt,sourceEventAt:receivedAt-600000,quoteAt:null
 }));
 const out=mergeLimitReviewPools({eastmoneyRows:em,eastmoneyMeta:{totalCount:37,receivedAt},
  cls:{status:'available',complete:true,tradeDate:day,totalCount:38,fetchedCount:38,uniqueCount:38,
  scope:'provider-up-pool-including-st',items:cls,receivedAt},tradeDate:day});
 assert.equal(out.rows.length,38);
 assert.equal(out.meta.intersectionCount,37);
 assert.equal(out.meta.clsOnlyCount,1);
 assert.equal(out.meta.wholeMarketCertified,false);
 assert.equal(out.meta.totalCount,null);
 assert.equal(out.rows[37].isST,true);
 assert.ok(out.rows.every(row=>row.canTrade===false&&row.canNotify===false));
 assert.equal(out.rows[0].clsObservation.quoteAt,undefined);
});
test('historical provider material is retained with its date, never promoted to today',()=>{
 const rows=[{code:'600001',name:'旧研究数据',tradeDate:day,sourceTradeDate:day,src:'em',
  sources:['eastmoney'],receivedAt,quoteAt:null,canTrade:false,canNotify:false}];
 const meta={tradeDate:day,status:'ready',sources:[{source:'eastmoney',providerComplete:true,tradeDate:day,receivedAt}]};
 const out=mergeLimitReviewPools({eastmoneyRows:[],cls:{status:'unavailable'},previousRows:rows,previousMeta:meta,tradeDate:next});
 assert.equal(out.meta.status,'retained');
 assert.equal(out.meta.tradeDate,day);
 assert.equal(out.rows[0].currentSourceConfirmed,false);
 assert.equal(out.rows[0].receivedAt,receivedAt);
 assert.equal(out.rows[0].recordStatus,'held-source-observation');
});
