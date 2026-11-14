'use strict';
/** Fail-closed comparison of two OPERATOR-SUPPLIED, independently labeled feeds.
 * Comparison does not certify market truth or grant a live-trading capability. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {resolveUpstream}=require('./data-source-lineage');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function compareMarketFeeds(primary,secondary,{priceToleranceBps=5,volumeTolerancePct=5,amountTolerancePct=5,maxDiscrepancies=100,requireKnownIndependentUpstreams=false}={}){
 if(typeof requireKnownIndependentUpstreams!=='boolean')throw Error('上游独立性参数无效');
 for(const [name,v,min,max] of [['priceToleranceBps',priceToleranceBps,0,1000],['volumeTolerancePct',volumeTolerancePct,0,100],['amountTolerancePct',amountTolerancePct,0,100],['maxDiscrepancies',maxDiscrepancies,1,1000]]){
  if((name==='maxDiscrepancies'&&!Number.isSafeInteger(v))||typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('多源核对参数无效: '+name);
 }
 const a=validateDataset(primary),b=validateDataset(secondary);
 if(primary.source!=='imported'||secondary.source!=='imported'||!primary.provider||!secondary.provider||primary.provider===secondary.provider||!primary.datasetId||!secondary.datasetId)throw Error('多源核对必须为不同供应商提供的独立 imported 数据');
 // Two differently named adapters sourcing one tape are only ONE publisher.
 // Unknown legacy vendor labels remain comparable for offline testing, but
 // never gain a verified-independence or live-trading claim.
 const upstreamA=resolveUpstream(primary.provider,primary.upstreamGroup);
 const upstreamB=resolveUpstream(secondary.provider,secondary.upstreamGroup);
 if((upstreamA.known&&upstreamA.ambiguous)||(upstreamB.known&&upstreamB.ambiguous))
  throw Error('已登记多源包装器缺少逐接口原始上游，不能认定数据独立');
 if(upstreamA.group===upstreamB.group)
  throw Error('同一原始上游重复包装，不是独立供应商数据');
 if(requireKnownIndependentUpstreams&&(!upstreamA.known||!upstreamB.known||upstreamA.ambiguous||upstreamB.ambiguous))
  throw Error('双源独立性证据不足：严格导入只接受两家已登记且上游明确不同的来源');

 if(!a.firstDate||!b.firstDate||a.lastDate!==b.lastDate||a.firstDate!==b.firstDate||a.barsPerStock!==b.barsPerStock||a.stocks!==b.stocks||primary.asOf!==secondary.asOf)throw Error('多源行情交易日范围或股票池不一致');
 if(!primary.priceAdjustment||!secondary.priceAdjustment||!['qfq','hfq','unadjusted'].includes(primary.priceAdjustment.mode)||primary.priceAdjustment.mode!==secondary.priceAdjustment.mode)throw Error('多源核对要求一致且明确的复权方式');
 // Unit parity is mandatory once either source declares an explicit volume unit.
 // Older fixtures stay comparable for price-only legacy research, but are NOT
 // claimed to have certified share-count units.
 const volumeUnitVerified=primary.volumeUnit==='shares'&&secondary.volumeUnit==='shares';
 if((primary.volumeUnit!==undefined||secondary.volumeUnit!==undefined)&&!volumeUnitVerified)
  throw Error('多源成交量单位不一致或未归一为 shares，禁止核对通过');
 const hasAmounts=feed=>feed.stocks.some(stock=>stock.bars.some(bar=>bar.amount!==undefined));
 const amountRequested=[primary,secondary].some(feed=>hasAmounts(feed)||feed.amountUnit!==undefined||feed.amountBasis!==undefined);
 if(amountRequested&&(!volumeUnitVerified||
    primary.amountUnit!=='CNY'||secondary.amountUnit!=='CNY'||
    primary.amountBasis!=='actual-unadjusted-turnover'||
    secondary.amountBasis!=='actual-unadjusted-turnover'))
  throw Error('多源成交额必须都标明 shares/CNY 与 actual-unadjusted-turnover 原始成交口径');
 // Optional source clock evidence must be supplied by BOTH feeds. Never
 // infer quote freshness from asOf (a trading date) or local receipt time.
 const aClock=primary.observedAt,bClock=secondary.observedAt;
 if((aClock===undefined)!==(bClock===undefined))throw Error('多源时间戳缺失：两份数据必须同时提供 observedAt');
 let observationSkewMs=null;
 if(aClock!==undefined){
  if(!Number.isSafeInteger(aClock)||!Number.isSafeInteger(bClock)||aClock<=0||bClock<=0)
   throw Error('多源 observedAt 时间戳无效');
  observationSkewMs=Math.abs(aClock-bClock);
  if(observationSkewMs>300000)throw Error('多源行情观察时间相差超过五分钟，禁止一致性放行');
 }
 const bs=new Map(secondary.stocks.map(s=>[String(s.code||s.symbol),s]));
 const differences=[];let total=0,comparedBars=0,amountComparedBars=0,amountCoverageGapBars=0;
 let maximumPriceDifferenceBps=0,maximumVolumeDifferencePct=0,maximumAmountDifferencePct=0;
 function note(symbol,date,field,lhs,rhs,relative){total++;if(differences.length<maxDiscrepancies)differences.push({symbol,date,field,primary:lhs,secondary:rhs,relativeDifference:Math.round(relative*1e4)/1e4});}
 for(const s of primary.stocks){
  const symbol=String(s.code||s.symbol),other=bs.get(symbol);
  if(!other)throw Error('多源股票代码集合不一致: '+symbol);
  for(let i=0;i<s.bars.length;i++){
   const x=s.bars[i],y=other.bars[i];if(x.date!==y.date)throw Error('多源交易日错位: '+symbol);
   comparedBars++;
   for(const field of ['open','high','low','close']){
    const value=Math.abs(x[field]-y[field])/Math.max(Math.abs(x[field]),Math.abs(y[field]),1e-9)*10000;
    maximumPriceDifferenceBps=Math.max(maximumPriceDifferenceBps,value);
    if(value>priceToleranceBps)note(symbol,x.date,field,x[field],y[field],value);
   }
   const volume=Math.abs(x.volume-y.volume)/Math.max(x.volume,y.volume,1)*100;
   maximumVolumeDifferencePct=Math.max(maximumVolumeDifferencePct,volume);
   if(volume>volumeTolerancePct)note(symbol,x.date,'volume',x.volume,y.volume,volume);
   if(amountRequested){
    // Never silently ignore missing monetary fields or compare yuan to thousands.
    if(x.amount===undefined||y.amount===undefined){
     amountCoverageGapBars++;
     note(symbol,x.date,'amount-coverage',x.amount??null,y.amount??null,100);
    }else{
     amountComparedBars++;
     const amount=Math.abs(x.amount-y.amount)/Math.max(x.amount,y.amount,1)*100;
     maximumAmountDifferencePct=Math.max(maximumAmountDifferencePct,amount);
     if(amount>amountTolerancePct)note(symbol,x.date,'amount',x.amount,y.amount,amount);
     // Matching nonsense still is not trustworthy: a traded share cannot
     // have zero actual cash turnover, and zero traded shares imply zero cash.
     if((x.volume===0)!==(x.amount===0)||
        (y.volume===0)!==(y.amount===0))
      note(symbol,x.date,'amount-volume-integrity',x.amount,y.amount,100);
    }
   }
  }
 }
 const amountUnitVerified=amountRequested&&amountCoverageGapBars===0&&amountComparedBars===comparedBars;
 const evidenceChecks={
  cataloguedDifferentUpstreams:upstreamA.known&&upstreamB.known&&!upstreamA.ambiguous&&!upstreamB.ambiguous,
  tradingDatesAligned:true,priceAdjustmentAligned:true,sharesNormalized:volumeUnitVerified,
  fullCnyTurnover:amountUnitVerified,captureTimesComparable:observationSkewMs!==null,
  valuesAgree:total===0
 };
 const evidenceCoverageScore=Math.round(100*Object.values(evidenceChecks).filter(Boolean).length/Object.keys(evidenceChecks).length);
 const researchComparisonReady=Object.values(evidenceChecks).every(Boolean);
 return {schemaVersion:1,mode:'independent-feed-shape-and-value-consensus',canTrade:false,verifiedExternal:false,
  primary:{provider:primary.provider,upstreamGroup:upstreamA.group,datasetId:primary.datasetId,fingerprint:sha(primary)},
  secondary:{provider:secondary.provider,upstreamGroup:upstreamB.group,datasetId:secondary.datasetId,fingerprint:sha(secondary)},
  upstreamIdentityCatalogued:upstreamA.known&&upstreamB.known,
  upstreamIndependenceVerified:false,
  // Data as-of DATE is a comparison key, not a distinct capture-session certificate.
  asOf:primary.asOf,priceAdjustmentMode:primary.priceAdjustment.mode,observationSkewMs,
  timestampComparable:observationSkewMs!==null,volumeUnitVerified,amountUnitVerified,
  evidenceChecks,evidenceCoverageScore,researchComparisonReady,
  comparisonDecision:total?'disagreement-quarantined':researchComparisonReady?'research-evidence-only':'insufficient-evidence',
  comparedBars,amountComparedBars,amountCoverageGapBars,discrepancies:total,displayedDiscrepancies:differences,
  maximumPriceDifferenceBps:Math.round(maximumPriceDifferenceBps*1e4)/1e4,
  maximumVolumeDifferencePct:Math.round(maximumVolumeDifferencePct*1e4)/1e4,
  maximumAmountDifferencePct:amountRequested?Math.round(maximumAmountDifferencePct*1e4)/1e4:null,
  consensus:total===0,releaseReady:false,
  warning:'同一上游多SDK不算独立；证据覆盖分不是股价准确率。数值一致不证明源授权、真实性、交易日历、公司行为或实盘可用性。'};
}
module.exports={compareMarketFeeds};
