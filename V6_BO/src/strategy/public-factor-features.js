'use strict';
// Independent implementations of attributed mathematical definitions. This
// module neither scores stocks nor evaluates future returns or changes weights.
const {createHash}=require('node:crypto');
const definition=require('../../strategies/public-research-factors.json');
const catalog=Object.freeze(definition.factors.map(f=>Object.freeze({...f,
  requiredFields:Object.freeze([...f.requiredFields])})));
const names=Object.freeze(catalog.map(f=>f.id));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=256;
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const timestamp=x=>typeof x==='number'?(Number.isSafeInteger(x)&&x>0&&x<=8640000000000000?x:NaN):typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  dateOK(x.slice(0,10))?Date.parse(x):NaN;
const closeTime=date=>Date.parse(date+'T15:00:00+08:00');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

/**
 * asOf is an explicit completed China equity session, observedAt is its
 * information cutoff (no Date.now fallback). Supply an exchange tradingDates
 * calendar, not dates inferred from this stock's bars. Source and adjustment
 * declarations are recorded, not independently authenticated by this function.
 * metadata defaults to stock.factorMetadata and requires source, datasetVersion,
 * priceAdjustment='split-dividend-adjusted', volumeAdjustment='split-adjusted',
 * adjustmentAsOf, volumeUnit='shares'. Optional amountUnit='CNY' additionally
 * requires amountBasis='actual-unadjusted-turnover' for the Amihud adaptation.
 * Every used bar needs complete:true and its original publication availableAt.
 */
function featureObservation(stock={},options={}){
  stock=stock||{};options=options||{};
  const {asOf,observedAt,tradingDates}=options;
  const metadata=options.metadata??stock.factorMetadata;
  const cutoff=timestamp(observedAt);
  const result={schemaVersion:1,catalogVersion:definition.version,
    mode:'public-factor-research',symbol:typeof stock.symbol==='string'?stock.symbol:null,
    asOf:dateOK(asOf)?asOf:null,observedAt:finite(cutoff)?cutoff:null,
    status:'unavailable',reasons:[],values:Object.fromEntries(names.map(id=>[id,null])),
    factors:[],provenance:null,canTrade:false,verifiedLive:false,
    productionWeightsChanged:false,autoPromotion:false};
  const stop=reason=>({...result,reasons:[reason],factors:catalog.map(f=>({
    id:f.id,version:f.version,value:null,status:'unavailable',reasons:[reason]}))});
  if(!dateOK(asOf)||!finite(cutoff)||cutoff<closeTime(asOf))return stop('INVALID_SESSION_OR_CUTOFF');
  if(!metadata||!text(metadata.source)||!text(metadata.datasetVersion))return stop('SOURCE_METADATA_REQUIRED');
  if(metadata.priceAdjustment!=='split-dividend-adjusted'||metadata.volumeAdjustment!=='split-adjusted'||
    metadata.volumeUnit!=='shares')return stop('ADJUSTMENT_OR_VOLUME_UNIT_UNVERIFIED');
  const adjustmentAt=timestamp(metadata.adjustmentAsOf);
  if(!finite(adjustmentAt)||adjustmentAt>cutoff)return stop('ADJUSTMENT_VINTAGE_UNAVAILABLE');
  if(!Array.isArray(tradingDates)||tradingDates.length<21||tradingDates.length>20000||
    tradingDates.some((d,i)=>!dateOK(d)||(i>0&&d<=tradingDates[i-1])))return stop('INVALID_TRADING_CALENDAR');
  const end=tradingDates.indexOf(asOf);
  if(end<20)return stop('INSUFFICIENT_CALENDAR_HISTORY');
  const requiredDates=tradingDates.slice(end-20,end+1);
  if(!Array.isArray(stock.bars)||stock.bars.length<21||stock.bars.length>10000)return stop('INSUFFICIENT_BAR_HISTORY');
  // Dates establish the causal prefix. Future OHLCV/metadata are never read,
  // so adding or changing a future payload cannot alter an earlier feature.
  const prefix=[];let previous='';
  for(const bar of stock.bars){
    if(!bar||!dateOK(bar.date)||bar.date<=previous)return stop('INVALID_BAR_ORDER');
    if(bar.date>asOf)break;
    previous=bar.date;prefix.push(bar);
  }
  const window=prefix.slice(-21);
  if(window.length!==21||window.some((b,i)=>b.date!==requiredDates[i]))return stop('MISSING_TRADING_SESSION');
  for(const b of window){
    if(b.complete!==true)return stop('INCOMPLETE_BAR');
    if(![b.open,b.high,b.low,b.close,b.volume].every(finite)||
      Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||
      b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close))return stop('INVALID_OHLCV');
    if(b.suspended===true||b.tradable===false||b.volume===0)return stop('SUSPENDED_OR_ZERO_VOLUME');
    const available=timestamp(b.availableAt);
    if(!finite(available)||available<closeTime(b.date)||available>cutoff)return stop('BAR_NOT_AVAILABLE_AT_CUTOFF');
    for(const key of ['source','datasetVersion','priceAdjustment','volumeAdjustment','volumeUnit'])
      if(b[key]!==undefined&&b[key]!==metadata[key])return stop('MIXED_BAR_METADATA');
    if(b.adjustmentAsOf!==undefined&&timestamp(b.adjustmentAsOf)!==adjustmentAt)return stop('MIXED_BAR_METADATA');
  }
  const returns=[],changes=[],logChanges=[],weighted=[];
  for(let i=1;i<window.length;i++){
    const b=window[i],prior=window[i-1],r=b.close/prior.close-1;
    returns.push(r);changes.push(b.volume-prior.volume);
    logChanges.push(Math.log1p(b.volume/prior.volume));weighted.push(Math.abs(r)*b.volume);
  }
  const rMean=mean(returns),vMean=mean(logChanges);
  const centeredR=returns.map(r=>r-rMean),centeredV=logChanges.map(v=>v-vMean);
  const rSS=centeredR.reduce((s,r)=>s+r*r,0),vSS=centeredV.reduce((s,v)=>s+v*v,0);
  const cov=centeredR.reduce((s,r,i)=>s+r*centeredV[i],0);
  const totalChange=changes.reduce((s,v)=>s+Math.abs(v),0),wMean=mean(weighted);
  const wSD=Math.sqrt(weighted.reduce((s,v)=>s+(v-wMean)**2,0)/19);
  const entries=[
    ['qlib_cord20',rSS>0&&vSS>0?Math.max(-1,Math.min(1,cov/Math.sqrt(rSS)/Math.sqrt(vSS))):null,'CONSTANT_CORRELATION_INPUT'],
    ['qlib_vsumd20',totalChange>0?changes.reduce((s,v)=>s+v,0)/totalChange:null,'NO_VOLUME_CHANGE'],
    ['qlib_wvma20',wMean>0?wSD/wMean:null,'NO_WEIGHTED_PRICE_CHANGE']
  ];
  const amountReason=metadata.amountUnit!=='CNY'||metadata.amountBasis!=='actual-unadjusted-turnover'?
    'ACTUAL_CNY_AMOUNT_REQUIRED':window.slice(1).some(b=>!finite(b.amount)||b.amount<=0)?
    'MISSING_OR_INVALID_AMOUNT':window.slice(1).some(b=>
      (b.amountUnit!==undefined&&b.amountUnit!==metadata.amountUnit)||
      (b.amountBasis!==undefined&&b.amountBasis!==metadata.amountBasis))?'MIXED_AMOUNT_METADATA':null;
  entries.push(['amihud_illiq20_rmb',amountReason?null:
    mean(returns.map((r,i)=>Math.abs(r)/window[i+1].amount)),amountReason]);
  result.factors=entries.map(([id,value,reason])=>({id,version:catalog.find(f=>f.id===id).version,
    value:finite(value)?value:null,status:finite(value)?'available':'unavailable',
    reasons:finite(value)?[]:[reason||'NONFINITE_CALCULATION']}));
  // Overflow is not evidence: no clamping nonfinite calculations into a signal.
  if([...returns,...changes,...logChanges,...weighted,rSS,vSS,cov,totalChange,wMean,wSD].some(x=>!finite(x))){
    return stop('NONFINITE_CALCULATION');
  }
  result.values=Object.fromEntries(result.factors.map(f=>[f.id,f.value]));
  const available=result.factors.filter(f=>f.status==='available').length;
  result.status=available===names.length?'available':available?'partial':'unavailable';
  result.reasons=[...new Set(result.factors.flatMap(f=>f.reasons))];
  const declarations={source:metadata.source,datasetVersion:metadata.datasetVersion,
    priceAdjustment:metadata.priceAdjustment,volumeAdjustment:metadata.volumeAdjustment,
    adjustmentAsOf:adjustmentAt,volumeUnit:metadata.volumeUnit,
    amountUnit:typeof metadata.amountUnit==='string'?metadata.amountUnit:null,
    amountBasis:typeof metadata.amountBasis==='string'?metadata.amountBasis:null};
  const usedBars=window.map(b=>({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,
    volume:b.volume,amount:finite(b.amount)?b.amount:null,availableAt:timestamp(b.availableAt),
    amountUnit:typeof b.amountUnit==='string'?b.amountUnit:null,
    amountBasis:typeof b.amountBasis==='string'?b.amountBasis:null}));
  result.provenance={...declarations,verification:'declared-unverified',firstSession:window[0].date,
    lastSession:asOf,sessions:21,calendarSha256:hash(requiredDates),
    inputSha256:hash({symbol:result.symbol,asOf,observedAt:cutoff,metadata:declarations,bars:usedBars})};
  return result;
}
module.exports={catalog,names,featureObservation};
