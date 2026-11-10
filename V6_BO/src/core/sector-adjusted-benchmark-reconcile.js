'use strict';
/**
 * Offline reconciliation of supplier-reported adjusted INTRADAY total-return
 * levels against immutable raw sector cohorts, future raw quote snapshots,
 * explicit corporate-action coverage and a same-time index benchmark.
 *
 * Provider adjusted levels are NOT independently verified; costs are assumptions.
 * Never promote this output to net executable P&L, training, or actual trading.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const {evaluateSectorForwardPrices,HORIZONS}=require('./sector-frozen-forward-prices');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
const validTime=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const validText=x=>typeof x==='string'&&x.length>0&&x.length<=150&&
 !/[\u0000-\u001f<>]/.test(x)&&!/(^|[-_\s:])(test|mock|fixture|synthetic|simulated)([-_\s:]|$)/i.test(x);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const sectorId=x=>x.category+'|'+x.code;
const flags={verifiedLive:false,canTrain:false,canTrade:false,canNotify:false,
 outOfSampleValidated:false,autoPromotion:false,weightsChanged:false,
 productionWeightsChanged:false,labelsAvailable:false,netReturnsAvailable:false,
 sourceLicenseIndependentlyVerified:false,independentlyAudited:false};
const blocked=reason=>({schemaVersion:1,mode:'sector-adjusted-benchmark-reconciliation-only',
 status:'blocked',reason,horizons:[],...flags});
function validateFeed(feed,now){
 if(feed?.schemaVersion!==1||feed.source!=='imported'||!validText(feed.provider)||
  !validText(feed.datasetId)||!validText(feed.basisId)||!validTime(feed.observedAt)||
  feed.observedAt>now||feed.priceBasis!=='provider-total-return-adjusted-intraday-level'||
  feed.completed!==true||feed.upstreamLicenseIndependentlyVerified!==false||
  !Array.isArray(feed.rows)||feed.rows.length>100000)return null;
 const rows=new Map();
 for(const r of feed.rows){
  if(!code(r?.symbol)||!validDay(r.date)||!validTime(r.rawQuoteAt)||
   aShareCalendarDate(r.rawQuoteAt)!==r.date||
   !positive(r.rawPrice)||!positive(r.adjustedLevel)||
   r.basisId!==feed.basisId||r.currency!=='CNY')return null;
  const id=r.symbol+'|'+r.date;
  if(rows.has(id))return null;
  rows.set(id,r);
 }
 return rows;
}
function validateIndex(index,now){
 if(index?.schemaVersion!==1||index.source!=='imported'||
   !validText(index.provider)||!validText(index.datasetId)||
   !validText(index.indexCode)||!validText(index.basisId)||
   !validTime(index.observedAt)||index.observedAt>now||
   index.priceBasis!=='provider-total-return-index-intraday-level'||
   index.completed!==true||index.upstreamLicenseIndependentlyVerified!==false||
   index.currency!=='CNY'||!Array.isArray(index.rows)||index.rows.length>2500)return null;
 const rows=new Map();
 for(const r of index.rows){
  if(!validDay(r?.date)||!validTime(r.quoteAt)||
   aShareCalendarDate(r.quoteAt)!==r.date||
   !positive(r.level)||r.basisId!==index.basisId||rows.has(r.date))return null;
  rows.set(r.date,r);
 }
 return rows;
}
function validateActions(actions,now){
 if(actions?.schemaVersion!==1||actions.source!=='imported'||
  !validText(actions.provider)||!validText(actions.datasetId)||
  !validTime(actions.observedAt)||actions.observedAt>now||
  !validDay(actions.completeThrough)||actions.completeThrough>aShareCalendarDate(now)||
  actions.completed!==true||!Array.isArray(actions.coveredSymbols)||
  !Array.isArray(actions.events)||actions.coveredSymbols.length>10000||
  actions.events.length>10000)return null;
 const covered=new Set();
 for(const s of actions.coveredSymbols){if(!code(s)||covered.has(s))return null;covered.add(s);}
 for(const e of actions.events){
  if(!code(e?.symbol)||!covered.has(e.symbol)||!validDay(e.date)||
   e.date>actions.completeThrough||!validText(e.type))return null;
 }
 return covered;
}
function validateCosts(c,cohort){
 if(c===undefined)return null;
 if(c?.schemaVersion!==1||c.source!=='operator-assumed'||
   c.scheme!=='fixed-round-trip-bps-no-rebalance'||
   !validText(c.assumptionId)||!validTime(c.observedAt)||
   c.observedAt>cohort.frozenAt||
   typeof c.roundTripBps!=='number'||!Number.isFinite(c.roundTripBps)||
   c.roundTripBps<0||c.roundTripBps>300)return false;
 return c.roundTripBps;
}
function snapshotQuotes(snapshot,cohort,target,now){
 const start=Date.parse(snapshot?.startedAt||''),end=Date.parse(snapshot?.retrievedAt||'');
 if(!validTime(start)||!validTime(end)||start>end||end-start>120000||
  end>now||aShareCalendarDate(start)!==target||
  aShareCalendarDate(end)!==target||snapshot?.date!==target||
  snapshot.source!==cohort.source||
  !Number.isSafeInteger(snapshot.universeSize)||snapshot.universeSize<15||
  !Array.isArray(snapshot.stocks)||snapshot.stocks.length>10000||
  snapshot.stocks.length>snapshot.universeSize||
  Math.abs(((end+8*3600000)%86400000)-
    ((cohort.observedAt+8*3600000)%86400000))>30*60000)return null;
 const rows=new Map();let valid=0;
 for(const s of snapshot.stocks){
  if(!code(s?.code)||rows.has(s.code))return null;
  if(s.source!==undefined&&s.source!==cohort.source)return null;
  const status=classifyQuoteTime(s,{requestDate:target,retrievedAt:end,maxAgeMs:300000});
  if(status.quoteTimeStatus==='recent-source-unverified')valid++;
  rows.set(s.code,{...s,quoteStatus:status.quoteTimeStatus});
 }
 if(valid/snapshot.universeSize<.8)return null;
 return {end,rows};
}
function reconcileSectorAdjusted({cohort,observation,rawSnapshots,tradeDates,
 adjustedFeed,benchmarkFeed,corporateActions,costAssumptions,
 asOf=Date.now()}={}){
 if(!validTime(asOf)||!cohort||!validTime(cohort.frozenAt)||
  !Array.isArray(tradeDates)||tradeDates.length<2||tradeDates.length>120||
  tradeDates.some((d,i)=>!validDay(d)||(i>0&&d<=tradeDates[i-1]))||
  !Array.isArray(rawSnapshots)||rawSnapshots.length>3||
  !observation||observation.asOf>asOf||
  !validTime(observation.asOf))
  return blocked('invalid-frozen-input-calendar-or-clock');
 const index=tradeDates.indexOf(cohort.tradeDate);
 if(index<0)return blocked('frozen-date-not-in-trading-calendar');
 // Verify existing producer's full output exactly, rather than trusting only
 // a report fingerprint or hand-entered gross-return aggregates.
 const actual=evaluateSectorForwardPrices(cohort,rawSnapshots,{
  tradeDates,corporateActions,asOf:observation.asOf});
 if(actual.status!=='research-observation-unverified'||
   JSON.stringify(actual)!==JSON.stringify(observation))
  return blocked('upstream-frozen-observation-replay-mismatch');
 const adjusted=validateFeed(adjustedFeed,asOf),
  benchmark=validateIndex(benchmarkFeed,asOf),
  covered=validateActions(corporateActions,asOf),
  cost=validateCosts(costAssumptions,cohort);
 if(cost===false)return blocked('post-signal-or-invalid-cost-assumptions');
 // A missing or malformed independent source must never be interpreted as 0.
 const sourceComplete=adjusted!==null&&benchmark!==null&&covered!==null;
 const seenFuture=new Map();
 for(const s of rawSnapshots){
  if(seenFuture.has(s.date))return blocked('duplicate-future-snapshot');
  seenFuture.set(s.date,s);
 }
 const rows=HORIZONS.map(h=>{
  const target=tradeDates[index+h]||null;
  const pending=reason=>({sessions:h,targetDate:target,status:'pending',
   reason,observedSectorCount:0,benchmarkTotalReturnPct:null,sectors:[]});
  if(!target)return pending('explicit-trading-calendar-too-short');
  if(target>aShareCalendarDate(asOf))return pending('future-session');
  const snap=seenFuture.get(target);
  if(!snap)return pending('target-snapshot-missing');
  const checked=snapshotQuotes(snap,cohort,target,asOf);
  if(!checked)return {sessions:h,targetDate:target,status:'unknown',
   reason:'raw-snapshot-source-time-or-coverage',observedSectorCount:0,
   benchmarkTotalReturnPct:null,sectors:[]};
  const baseIdx=benchmark?.get(cohort.tradeDate),targetIdx=benchmark?.get(target);
  const referenceOK=sourceComplete&&
   corporateActions.completeThrough>=target&&
   adjustedFeed.observedAt>=checked.end&&
   benchmarkFeed.observedAt>=checked.end&&
   corporateActions.observedAt>=checked.end&&
   baseIdx&&targetIdx&&
   Math.abs(baseIdx.quoteAt-cohort.observedAt)<=300000&&
   Math.abs(targetIdx.quoteAt-checked.end)<=300000;
  const indexReturn=referenceOK?
   Number(((targetIdx.level/baseIdx.level-1)*100).toFixed(5)):null;
  const sectors=cohort.sectors.map(s=>{
   const row={category:s.category,code:s.code,baselineRank:s.rank,
    status:'unknown',reason:null,memberCount:s.members.length,
    observedMembers:0,providerAdjustedGrossPct:null,
    benchmarkTotalReturnPct:indexReturn,
    providerAdjustedExcessPct:null,
    illustrativeAfterAssumedCostExcessPct:null};
   if(!sourceComplete){row.reason='adjusted-index-or-action-evidence-missing';return row;}
   if(!referenceOK){row.reason='benchmark-or-corporate-action-time-unmatched';return row;}
   let sum=0;
   for(const m of s.members){
    const q=checked.rows.get(m.symbol);
    if(!positive(m.baselinePrice)||!validTime(m.baselineQuoteAt)||
       !q||q.quoteStatus!=='recent-source-unverified'||
       !positive(q.latestPrice)||q.volumeLots===0){
      row.reason='baseline-or-target-raw-quote-missing';return row;
    }
    if(!covered.has(m.symbol)){
      row.reason='corporate-action-symbol-coverage-missing';return row;
    }
    const a=adjusted.get(m.symbol+'|'+cohort.tradeDate),
      b=adjusted.get(m.symbol+'|'+target);
    if(!a||!b){
      row.reason='matched-adjusted-level-missing';return row;
    }
    if(a.rawQuoteAt!==m.baselineQuoteAt||a.rawPrice!==m.baselinePrice||
      b.rawQuoteAt!==q.vendorQuoteAt||b.rawPrice!==q.latestPrice){
      row.reason='adjusted-raw-provenance-mismatch';return row;
    }
    const change=(b.adjustedLevel/a.adjustedLevel-1)*100;
    if(!Number.isFinite(change)||change< -90||change>500){
      row.reason='adjusted-discontinuity-requires-review';return row;
    }
    sum+=change;
   }
   const gross=Number((sum/s.members.length).toFixed(5));
   row.status='provider-adjusted-reconciled-unverified';
   row.observedMembers=s.members.length;
   row.providerAdjustedGrossPct=gross;
   row.providerAdjustedExcessPct=Number((gross-indexReturn).toFixed(5));
   if(cost!==null)row.illustrativeAfterAssumedCostExcessPct=
    Number((gross-indexReturn-cost/100).toFixed(5));
   return row;
  });
  const n=sectors.filter(s=>s.status==='provider-adjusted-reconciled-unverified').length;
  return {sessions:h,targetDate:target,
   status:n===sectors.length?'provider-adjusted-reconciled-unverified':'partial-or-unknown',
   observedSectorCount:n,benchmarkTotalReturnPct:indexReturn,sectors};
 });
 return {schemaVersion:1,mode:'sector-adjusted-benchmark-reconciliation-only',
  status:rows.some(r=>r.status==='provider-adjusted-reconciled-unverified')?
   'supplier-adjusted-reconciliation-unverified':'insufficient-evidence',
  tradeDate:cohort.tradeDate,frozenFingerprint:cohort.fingerprint,
  asOf,rawObservationAsOf:observation.asOf,
  adjustedDatasetId:adjustedFeed?.datasetId||null,
  adjustedBasisId:adjustedFeed?.basisId||null,
  benchmarkIndex:benchmarkFeed?.indexCode||null,
  assumedRoundTripBps:cost===false?null:cost,
  horizons:rows,retrospectiveAdjustment:true,
  sourceClaimsIndependentlyVerified:false,...flags,
  note:'独立导入的供应商复权盘中总收益价格与真实原报价逐票对账；假定双向成本仅展示示意差值。供应商复权因子、基准、公司行为与许可均未独立核验，不是净可执行收益、训练许可或样本外alpha认证'};
}
module.exports={reconcileSectorAdjusted};
