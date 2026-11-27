'use strict';
// Internal observation binding for the original paper-plan path. Never an
// execution authorization, and never a substitute for the original account lock.
const {createHash}=require('node:crypto');
const {quoteUseEligibility}=require('./quote-observation-view');
const {aShareCalendarDate}=require('./a-share-calendar');
const SCOPE='original-paper-plan-entry-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^plan-[0-9a-f-]{36}$/.test(value);
const code=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const clock=value=>Number.isSafeInteger(value)&&value>0&&value<=8e15;
const reject=()=>{throw Error('原冻结计划的账户版本或报价证据已变化，请重新确认');};
function assertPlanEntryBinding(binding,{book,quote,now,trade}={}){
 if(!binding||binding.scope!==SCOPE||binding.accountId!=='pool'||binding.canAuthorize!==false||
    !id(binding.planId)||!hex(binding.frozenDecisionId)||!hex(binding.currentDecisionId)||!code(binding.symbol)||
    !Number.isSafeInteger(binding.accountRevision)||binding.accountRevision<1||!hex(binding.accountFingerprint)||
    book?.revision!==binding.accountRevision||book?.fingerprint!==binding.accountFingerprint||
    !clock(binding.checkedAt)||!clock(now)||now<binding.checkedAt||now-binding.checkedAt>15000||
    !quote||quote.symbol!==binding.symbol||quote.tradeDate!==binding.day||aShareCalendarDate(now)!==binding.day||
    quote.quoteAt!==binding.quoteAt||quote.price!==binding.price||quote.quoteSource!==binding.source||
    !hex(binding.quoteFingerprint)||hash(quote)!==binding.quoteFingerprint||quoteUseEligibility(quote,now).canTrade!==true)reject();
 if(trade!==undefined&&(!trade||trade.side!=='买入'||trade.code!==binding.symbol||trade.price!==binding.price||
    trade.reason!=='作战台计划['+binding.planId+'] '+binding.symbol+' · 原账户风控'||!clock(trade.t)||
    trade.t<binding.checkedAt||trade.t>now||aShareCalendarDate(trade.t)!==binding.day))reject();
 return binding;
}
function createPlanEntryBinding({plan,card,book,quote,now}={}){
 if(!plan||!card||!quote||card.code!==plan.code||card.day!==plan.intendedDate||
    quote.symbol!==plan.code||quote.tradeDate!==plan.intendedDate)reject();
 const binding={scope:SCOPE,accountId:'pool',canAuthorize:false,planId:plan.id,symbol:plan.code,day:plan.intendedDate,
  frozenDecisionId:plan.decisionId,currentDecisionId:card.decisionId,accountRevision:book?.revision,accountFingerprint:book?.fingerprint,
  quoteFingerprint:hash(quote),quoteAt:quote.quoteAt,price:quote.price,source:quote.quoteSource,checkedAt:now};
 return Object.freeze(assertPlanEntryBinding(binding,{book,quote,now}));
}
module.exports={createPlanEntryBinding,assertPlanEntryBinding};
