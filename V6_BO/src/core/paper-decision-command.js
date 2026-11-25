'use strict';

// A bounded, immediate command adapter. The existing paperBuy implementation
// remains the only executor; this module neither keeps orders nor writes books.
const {createHash,randomUUID}=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {quoteSourceAllowsUse}=require('./quote-observation-view');

const fields=new Set(['action','account','code','day','entryMin','entryMax','policy','token']);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=value=>Number(value.toFixed(8));
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

function paperDecisionPolicy(cfg,{atrMultiplier,atrStopMaxPct}={}){
  if(!object(cfg)||!Number.isSafeInteger(cfg.maxPos)||cfg.maxPos<1||cfg.maxPos>100||
    !finite(cfg.sl)||cfg.sl>=0||cfg.sl<=-1||!finite(cfg.tp)||cfg.tp<=0||
    !Number.isSafeInteger(cfg.expireDays)||cfg.expireDays<1||
    !finite(atrMultiplier)||atrMultiplier<=0||!finite(atrStopMaxPct)||atrStopMaxPct>=0||atrStopMaxPct<=-100)return null;
  const policy={
    version:1,executor:'paperBuy',maxPos:cfg.maxPos,positionPct:round(98/cfg.maxPos),
    stopPct:round(-cfg.sl*100),targetPct:round(cfg.tp*100),expireDays:cfg.expireDays,
    positionMode:'equity-equal-weight-98pct',stopMode:'account-atr-and-peak-t1',
    atrMultiplier,maxStopPct:round(Math.max(-cfg.sl*100,-atrStopMaxPct)),customConditions:false
  };
  return {...policy,fingerprint:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}

function samePolicy(submitted,current){
  return object(submitted)&&object(current)&&Object.keys(submitted).length===Object.keys(current).length&&
    Object.keys(current).every(key=>Object.hasOwn(submitted,key)&&submitted[key]===current[key]);
}

function blocked(reasonCode,error,extra={}){
  return {ok:false,status:'blocked',paperOnly:true,queued:false,filled:false,reasonCode,error,...extra};
}

function tradeDay(trade){
  if(Number.isSafeInteger(trade?.t)&&trade.t>0)return aShareCalendarDate(trade.t);
  return validDay(trade?.tradeDate)?trade.tradeDate:null;
}

function receiptOf(trade,command,revision){
  return {account:command.account,code:command.code,day:command.day,
    eventId:trade.eventId,orderId:trade.orderId||null,executedAt:trade.t,
    quoteAt:trade.fillEvidence?.quoteAt??trade.quoteAt??null,
    price:trade.price,shares:trade.shares,amount:trade.amount,fee:trade.fee,
    reason:trade.reason,accountRevision:revision};
}

async function submitPaperDecision(command,context){
  if(!object(command)||Object.keys(command).some(key=>!fields.has(key))||
    command.action!=='submitDecision'||command.account!=='pool'||
    typeof command.code!=='string'||!/^\d{6}$/.test(command.code)||!validDay(command.day)||
    !finite(command.entryMin)||!finite(command.entryMax)||command.entryMin<=0||command.entryMax<command.entryMin||
    command.entryMax>10000000||!object(command.policy)||
    Object.hasOwn(command,'token')&&typeof command.token!=='string'){
    return blocked('INVALID_DECISION','仅接受系统精选 A 跟单盘的股票、交易日、买入区间和当前账户规则；不接受自定义价格、股数、仓位或止损。');
  }

  // Load the exact shared selection rules before reading current state. There
  // is no asynchronous gap between the final checks and the original executor.
  const {eligiblePick,pickReasons,systemPickDay}=await import('../../public/nova/system-picks.mjs');
  const now=context.now();
  if(!Number.isSafeInteger(now)||now<=0)return blocked('CLOCK_UNAVAILABLE','服务器交易时钟不可用。');
  if(context.isReplica())return blocked('REPLICA_READ_ONLY','当前是副本，不能提交模拟买入。');
  if(command.day!==aShareCalendarDate(now))return blocked('WRONG_TRADING_DAY','所选日期与当前北京时间交易日不一致，请重新读取今日计划。');
  if(!context.isContinuousTrading())return blocked('OUTSIDE_CONTINUOUS_SESSION','当前不在连续竞价时段；本次未成交，也未创建待执行订单。');

  const policy=context.policy(command.account);
  if(!policy)return blocked('POLICY_UNAVAILABLE','账户规则不完整，暂不能提交模拟买入。');
  if(!samePolicy(command.policy,policy))return blocked('POLICY_CHANGED','账户规则与确认时不一致，或提交了不支持的自定义条件，请重新读取并确认。',{policy});

  const matching=context.candidates().filter(row=>row?.code===command.code);
  if(matching.length!==1)return blocked('CANDIDATE_NOT_CURRENT','该股票不在唯一、有效的当前系统精选候选中，请重新读取。');
  const candidate=matching[0];
  if(!eligiblePick(candidate)||!quoteSourceAllowsUse(candidate)||candidate.researchOnly===true||candidate.historicalClose===true||
    systemPickDay(candidate,null,now)!==command.day||
    !pickReasons(candidate).length||context.newsBlocked(candidate.code)){
    return blocked('CANDIDATE_BLOCKED','该股票的当日候选证据或现有风险门禁未通过。');
  }

  let before;
  try{before=context.readAccount(command.account);}catch{return blocked('AUTHORITY_UNAVAILABLE','无法读取权威模拟账户，本次未提交。');}
  const account=before?.account;
  if(!object(account)||!object(account.positions)||!Array.isArray(account.trades)||
    !finite(account.cash)||account.cash<0||!Number.isSafeInteger(before.revision)){
    return blocked('AUTHORITY_UNAVAILABLE','权威模拟账户回执不完整，本次未提交。');
  }
  if(account.enabled!==true)return blocked('ACCOUNT_PAUSED','模拟账户已暂停，请先在账户中确认跟踪状态。');
  if(account.positions[command.code]||account.trades.some(trade=>trade.code===command.code&&
    trade.side==='买入'&&tradeDay(trade)===command.day)){
    return blocked('DUPLICATE_DECISION','该股已有持仓或当日买入成交，本次拒绝重复买入。');
  }

  // These are the same complete source rows used by paperBuy. No supplied
  // client price, score or synthetic display projection can be used here.
  const quote=context.executionQuotes()[command.code];
  if(!quote||quote.symbol!==command.code||quote.tradeDate!==command.day||!finite(quote.price)||quote.price<=0||
    !Number.isSafeInteger(quote.quoteAt)||quote.quoteAt<=0||quote.quoteAt>now||now-quote.quoteAt>15000||
    !Number.isSafeInteger(quote.receivedAt)||quote.receivedAt<quote.quoteAt||quote.receivedAt>now||
    quote.suspended===true||quote.tradable===false){
    return blocked('EXECUTION_QUOTE_UNAVAILABLE','没有通过原始时点及完整行情门禁的当前报价，本次未提交。');
  }
  if(quote.price<command.entryMin||quote.price>command.entryMax){
    return blocked('OUTSIDE_ENTRY_RANGE','当前有效报价不在确认的买入区间，本次未成交；没有建立自动等待队列。');
  }

  const reason=`FAYO作战台(${command.day}/${command.code}/${randomUUID()})`;
  const previousSkips=context.skipCounts?.()||{};
  let executionFailed=false;
  try{context.execute(command.account,candidate,reason);}catch{executionFailed=true;}

  let after;
  try{after=context.readAccount(command.account);}catch{
    return {ok:false,status:'receipt-unavailable',paperOnly:true,queued:false,filled:null,
      reasonCode:'RECEIPT_UNAVAILABLE',error:'提交后的权威回执暂不可读，请刷新账户确认成交；不要直接重复提交。'};
  }
  if(!object(after?.account)||!Array.isArray(after.account.trades)||!Number.isSafeInteger(after.revision)){
    return {ok:false,status:'receipt-unavailable',paperOnly:true,queued:false,filled:null,
      reasonCode:'RECEIPT_UNAVAILABLE',error:'提交后的权威回执不完整，请刷新账户确认成交；不要直接重复提交。'};
  }
  const fill=after.account.trades.find(trade=>trade.code===command.code&&trade.side==='买入'&&
    trade.reason===reason&&tradeDay(trade)===command.day&&Number.isSafeInteger(trade.t)&&trade.t>=now&&
    typeof trade.eventId==='string'&&trade.eventId&&finite(trade.price)&&trade.price>0&&
    Number.isSafeInteger(trade.shares)&&trade.shares>0);
  if(fill&&after.revision>before.revision){
    return {ok:true,status:'filled',paperOnly:true,queued:false,filled:true,
      receipt:receiptOf(fill,command,after.revision),policy,
      note:'已由原 paperBuy 执行，并从权威账户核对成交。仓位、ATR 止损、收益保护和 T+1 沿用账户规则。'};
  }
  const skips=Object.entries(context.skipCounts?.()||{}).filter(([key,value])=>
    Number.isFinite(value)&&value>(previousSkips[key]||0)).map(([key])=>({code:key,label:context.skipLabel?.(key)||key}));
  return blocked(executionFailed?'EXECUTION_FAILED':'EXECUTION_NOT_FILLED',
    skips.length?skips.map(item=>item.label).join('；'):'原执行器没有生成对应的权威成交回执，请核对账户、行情与风控状态。',
    {attempted:true,skips});
}

module.exports={paperDecisionPolicy,submitPaperDecision};
