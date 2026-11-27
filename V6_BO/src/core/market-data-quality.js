'use strict';
/** Evidence-oriented A-share historical data audit.
 * Never infer suspension, price adjustment or corporate actions from a flat price series.
 * Flags are research review items, not proof the external feed was validated. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const round=n=>Math.round(n*10000)/10000;

// Reconciliation is an extension of the existing quality audit. The caller
// supplies a closing snapshot and the original readMarketDataAsOf projection;
// a matching hash reference is not independently authenticated here.
const {assessDailyBarFinality}=require('./a-share-calendar');
const {snapshotCaptureWindow,classifyQuoteTime}=require('./market-snapshot-quote-time');
const {sourceLineage}=require('./data-source-lineage');
const clockOK=n=>Number.isSafeInteger(n)&&n>=946684800000&&n<4102444800000;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hashOK=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const codeOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const unsafe=x=>['simulated','synthetic','fixture','mock','testSample','canTrade','canNotify','canTrain',
 'verifiedLive','certifiedLive','exchangeVerified','autoPromotion','releaseReady','productionWeightsChanged']
 .some(k=>x?.[k]!==undefined&&x[k]!==false)||
 ['sourceConflict','quoteSourceConflict','conflict'].some(k=>x?.[k]===true)||
 x?.evidenceStatus==='conflict'||x?.quoteStatus==='conflict';
const closeSafe=Object.freeze({researchOnly:true,canTrade:false,canTrain:false,canNotify:false,
 verifiedExternal:false,verifiedLive:false,archiveReceiptIndependentlyVerified:false,
 exchangeCalendarVerified:false,independenceVerified:false,wholeMarketCertified:false});
const block=reason=>({schemaVersion:1,mode:'daily-close-price-reconciliation',status:'blocked',reason,...closeSafe});
function reconcileDailyCloseEvidence(history,input={}){
 if(!record(input)||unsafe(input)||!clockOK(input.decisionAt))return block('invalid-reconciliation-clock-or-scope');
 const {snapshot,historyReceipt:r,decisionAt,priceToleranceBps=5}=input;
 if(typeof priceToleranceBps!=='number'||!Number.isFinite(priceToleranceBps)||priceToleranceBps<0||priceToleranceBps>50)
  return block('invalid-price-tolerance');
 let valid;try{valid=validateDataset(history);}catch{return block('invalid-history-dataset');}
 if(history.source!=='imported'||unsafe(history)||history.priceAdjustment?.mode!=='unadjusted'||
  typeof history.provider!=='string'||typeof history.datasetId!=='string'||!history.datasetId.trim())
  return block('history-source-or-adjustment-unavailable');
 const identity=sourceLineage(history.provider);
 if(!identity?.known||identity.market!=='CN'||identity.upstreamAmbiguous||
    !['a-share-daily','a-share-bars'].includes(identity.dataClass))
  return block('history-provider-category-unavailable');
 if(!record(snapshot)||unsafe(snapshot)||snapshot.source!=='eastmoney-clist-unverified-live'||
    snapshot.verifiedLive!==false||snapshot.date!==valid.lastDate||history.asOf!==snapshot.date||
    snapshot.tradeDate!==undefined&&snapshot.tradeDate!==snapshot.date||
    snapshot.priceBasis!==undefined&&snapshot.priceBasis!=='unadjusted'||
    !Number.isSafeInteger(snapshot.universeSize)||snapshot.universeSize<1||snapshot.universeSize>10000||
    !Array.isArray(snapshot.stocks)||snapshot.stocks.length>snapshot.universeSize)
  return block('invalid-or-unmatched-original-snapshot');
 const day=snapshot.date,closeAt=Date.parse(day+'T15:00:00+08:00');
 const {startedAt,originalRetrievedAt:receivedAt,invalidStart}=snapshotCaptureWindow(snapshot);
 if(invalidStart||!clockOK(startedAt)||!clockOK(receivedAt)||
    [0,6].includes(new Date(day+'T00:00:00Z').getUTCDay())||
    startedAt<closeAt||receivedAt>closeAt+600000||receivedAt<startedAt||
    receivedAt-startedAt>120000||receivedAt>decisionAt)
  return block('invalid-or-nonclosing-capture-window');
 if(!record(r)||unsafe(r)||r.status!=='available-research-snapshot'||r.researchOnly!==true||
    r.canTrade!==false||r.canNotify!==false||r.decisionAt!==decisionAt||
    !hashOK(r.archiveHash)||!hashOK(r.dataVersion)||!record(r.data)||sha(r.data)!==sha(history)||
    !clockOK(r.receivedAt)||!clockOK(r.availableAt)||r.receivedAt>r.availableAt||r.availableAt>decisionAt||
    r.receivedAt<receivedAt||!assessDailyBarFinality(day,{observedAt:r.receivedAt,now:decisionAt}).usable)
  return block('history-receipt-not-visible-or-unfinished');
 const quotes=new Map();
 for(const q of snapshot.stocks){
  if(!record(q)||!codeOK(q.code)||quotes.has(q.code))return block('duplicate-or-invalid-quote-identity');
  quotes.set(q.code,q);
 }
 const observedOK=at=>at==null||clockOK(at)&&at<=r.receivedAt&&
    assessDailyBarFinality(day,{observedAt:at,now:decisionAt}).usable;
 const items=[];
 for(const s of history.stocks){
  const code=s.code??s.symbol;
  if(!codeOK(code)||s.code!=null&&s.code!==code||s.symbol!=null&&s.symbol!==code)
   return block('invalid-history-security-identity');
  const bar=s.bars.at(-1),q=quotes.get(code);
  let reason=null;
  if(!q)reason='missing-closing-quote';
  else if(unsafe(q)||q.symbol!=null&&q.symbol!==code||
    q.source!=null&&q.source!==snapshot.source||q.provider!=null&&q.provider!=='eastmoney'||
    q.tradeDate!=null&&q.tradeDate!==day||
    q.quoteAt!=null&&q.quoteAt!==q.vendorQuoteAt||
    q.receivedAt!=null&&(!clockOK(q.receivedAt)||q.receivedAt<q.vendorQuoteAt||q.receivedAt>receivedAt)||
    q.priceBasis!=null&&q.priceBasis!=='unadjusted'||q.price!=null&&q.price!==q.latestPrice)
   reason='contradictory-quote-evidence';
  else if(!positive(q.latestPrice)||!clockOK(q.vendorQuoteAt)||q.vendorQuoteAt<closeAt||
    q.vendorQuoteAt>closeAt+300000||
    classifyQuoteTime(q,{requestDate:day,retrievedAt:receivedAt,originalRetrievedAt:receivedAt,maxAgeMs:300000}).quoteTimeStatus!=='recent-source-unverified')
   reason='missing-or-nonclosing-original-quote';
  else if(q.suspended===true||q.tradable===false||q.volumeLots!=null&&!positive(q.volumeLots)||
    bar.suspended===true||bar.volume===0)
   reason='suspended-or-zero-volume';
  else if(unsafe(s)||unsafe(bar)||!observedOK(history.observedAt)||!observedOK(s.observedAt)||
    !observedOK(bar.observedAt)||bar.date!==day||
    [s,bar].some(x=>x.provider!=null&&x.provider!==history.provider||
     x.priceBasis!=null&&x.priceBasis!=='unadjusted'||x.adjustment!=null&&x.adjustment!=='unadjusted'||
     x.code!=null&&x.code!==code||x.symbol!=null&&x.symbol!==code))
   reason='contradictory-historical-bar-evidence';
  const diff=reason?null:10000*Math.abs(q.latestPrice-bar.close)/Math.max(q.latestPrice,bar.close);
  items.push({code,status:reason?'unknown':diff>priceToleranceBps?'discrepancy':'within-tolerance-unverified',
   reason,quoteAt:reason?null:q.vendorQuoteAt,quoteReceivedAt:reason?null:q.receivedAt??receivedAt,
   dailyReceivedAt:r.receivedAt,priceDifferenceBps:diff===null?null:Number(diff.toFixed(4))});
 }
 const compared=items.filter(x=>x.status!=='unknown').length,discrepancies=items.filter(x=>x.status==='discrepancy').length;
 return {schemaVersion:1,mode:'daily-close-price-reconciliation',
  status:discrepancies?'discrepancy-review-required':compared===items.length?'within-declared-tolerance-unverified':'partial-or-unknown',
  tradeDate:day,decisionAt,priceToleranceBps,scope:'historical-stock-pool-not-whole-market',
  snapshotDeclaredUniverseSize:snapshot.universeSize,snapshotRows:snapshot.stocks.length,
  expectedSymbols:items.length,comparedSymbols:compared,unknownSymbols:items.length-compared,
  discrepantSymbols:discrepancies,withinToleranceSymbols:compared-discrepancies,
  quoteProvider:'eastmoney',historicalProvider:history.provider,
  sourceRelationship:identity.upstreamGroup==='eastmoney'?'catalogued-same-upstream':'catalogued-distinct-upstream-unverified',
  snapshotStartedAt:startedAt,snapshotReceivedAt:receivedAt,historyReceivedAt:r.receivedAt,historyAvailableAt:r.availableAt,
  snapshotFingerprint:sha(snapshot),historicalProjectionFingerprint:sha(history),
  historyArchiveReference:r.archiveHash,historyVersionReference:r.dataVersion,
  items,volumeCompared:false,amountCompared:false,...closeSafe,
  note:'仅比较原始收盘观察与明确未复权历史日线，未认证交易所收盘价、归档真实性或上游独立性；缺档保留原历史股票池分母。'};
}

function auditMarketData(history,{maxStalenessDays=5,closingEvidence}={}){
 const valid=validateDataset(history);
 if(!Number.isSafeInteger(maxStalenessDays)||maxStalenessDays<0||maxStalenessDays>365)throw Error('行情陈旧阈值无效');
 const issues=[],bySymbol=[],ref=Date.parse(history.asOf+'T00:00:00Z');
 const dated=Boolean(valid.lastDate);
 const age=dated?Math.floor((ref-Date.parse(valid.lastDate+'T00:00:00Z'))/86400000):null;
 if(age!==null&&age>maxStalenessDays)issues.push({severity:'warning',code:'STALE_DATA',detail:`行情最后日期比截至日期早 ${age} 个自然日（含休市日；需交易所日历核验）`});
 if(history.source==='imported'&&(!history.provider||!history.datasetId))issues.push({severity:'blocker',code:'UNTRACKED_SOURCE',detail:'外部行情缺失provider或datasetId'});
 if(history.source!=='imported')issues.push({severity:'blocker',code:'NON_EXTERNAL_SOURCE',detail:'fixture/simulated 数据不得作为真实行情通过验收'});
 const adjustment=history.priceAdjustment;
 if(!adjustment||!['qfq','hfq','unadjusted'].includes(adjustment.mode)||typeof adjustment.provider!=='string'||!adjustment.provider.trim()){
  issues.push({severity:'blocker',code:'ADJUSTMENT_UNVERIFIED',detail:'缺少明确的复权模式及供应商出处；不能判断除权除息影响'});
 }
 let zeroVolume=0, largeGaps=0, lockedBars=0;
 for(const s of history.stocks){
  const symbol=String(s.symbol||s.code);let zeros=0,gaps=0,locks=0;const bars=s.bars;
  for(let i=0;i<bars.length;i++){
   const b=bars[i];if(b.volume===0)zeros++;
   if(i>0){
    const prev=bars[i-1],gapPct=Math.abs((b.open/prev.close-1)*100);
    if(gapPct>30)gaps++;
    if(b.high===b.low&&Math.abs(b.open/prev.close-1)>=0.048)locks++;
   }
  }
  zeroVolume+=zeros;largeGaps+=gaps;lockedBars+=locks;
  const flags=[];
  if(zeros)flags.push('存在零成交量，需核实停牌/数据缺失');
  if(gaps)flags.push('存在超过30%的隔夜跳空，需核实公司行为及异常行情');
  if(locks)flags.push('存在疑似涨跌停一字板，纸面撮合应限制');
  if(s.corporateActionsVerified!==true&&history.source==='imported')flags.push('公司行为尚未逐股票验证');
  bySymbol.push({symbol,bars:bars.length,zeroVolumeBars:zeros,largeOpenGaps:gaps,suspectedLimitLockedBars:locks,flags});
 }
 if(largeGaps)issues.push({severity:'warning',code:'LARGE_GAPS',detail:`发现 ${largeGaps} 处超过30%的隔夜跳空，需要供应商核验复权及公司行为`});
 if(zeroVolume)issues.push({severity:'warning',code:'ZERO_VOLUME',detail:`发现 ${zeroVolume} 条零成交量K线，撮合时必须禁止交易`});
 const closingReconciliation=closingEvidence===undefined?undefined:reconcileDailyCloseEvidence(history,closingEvidence);
 if(closingReconciliation&&closingReconciliation.status!=='within-declared-tolerance-unverified')
  issues.push({severity:'blocker',code:'CLOSING_RECONCILIATION_UNRESOLVED',detail:'所提供的日终报价与未复权日线对账尚有缺失、冲突或无效回执'});
 const ready=history.source==='imported'&&issues.every(i=>i.severity!=='blocker')&&history.stocks.every(s=>s.corporateActionsVerified===true);
 return {schemaVersion:1,mode:'offline-market-quality-audit',canTrade:false,verifiedExternal:false,
  source:history.source,provider:history.provider||null,datasetId:history.datasetId||null,
  asOf:history.asOf,lastDate:valid.lastDate,calendarVerified:false,adjustmentVerified:Boolean(adjustment&&['qfq','hfq','unadjusted'].includes(adjustment.mode)&&adjustment.provider),
  dataFingerprint:sha(history),summary:{stocks:valid.stocks,barsPerStock:valid.barsPerStock,stalenessCalendarDays:age,zeroVolumeBars:zeroVolume,largeOpenGaps:largeGaps,suspectedLimitLockedBars:lockedBars},
  reviewReady:ready,releaseReady:false,issues,bySymbol,...(closingReconciliation===undefined?{}:{closingReconciliation}),
  limitations:['自然日滞后不是交易所休市日历验证','复权声明不等于复权正确性检验','公司行为须核对外部可信来源','数据质量审核不等于实盘可交易授权']};
}
module.exports={auditMarketData,reconcileDailyCloseEvidence};
