'use strict';
/**
 * Independent-format, TWO provider-labelled adjusted-price comparisons.
 * Never average conflicting supplier estimates or certify actual independence.
 * The existing raw-cohort-to-adjusted-level reconcile gates run TWICE first.
 */
const crypto=require('node:crypto');
const {reconcileSectorAdjusted}=require('./sector-adjusted-benchmark-reconcile');
const {HORIZONS}=require('./sector-frozen-forward-prices');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id=x=>x.category+'|'+x.code;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safe={verifiedLive:false,canTrade:false,canTrain:false,canNotify:false,
 outOfSampleValidated:false,autoPromotion:false,weightsChanged:false,
 netReturnsAvailable:false,labelsAvailable:false,independentlyAudited:false,
 sourceLicenseIndependentlyVerified:false,providersIndependentlyVerified:false};
const block=reason=>({schemaVersion:1,mode:'sector-dual-adjusted-source-agreement-only',
 status:'blocked',reason,horizons:[],...safe});
const fixedFields=['cohort','observation','rawSnapshots','tradeDates',
 'corporateActions','costAssumptions','asOf'];
function validTolerance(policy){
 return policy?.schemaVersion===1&&policy.mode==='operator-dual-source-tolerance'&&
  Number.isSafeInteger(policy.maxStockReturnDifferenceBps)&&
  policy.maxStockReturnDifferenceBps>=1&&policy.maxStockReturnDifferenceBps<=100&&
  Number.isSafeInteger(policy.maxIndexReturnDifferenceBps)&&
  policy.maxIndexReturnDifferenceBps>=1&&policy.maxIndexReturnDifferenceBps<=100&&
  Number.isSafeInteger(policy.declaredAt)&&policy.declaredAt>0;
}
function indexByDate(feed){
 const m=new Map();
 for(const row of feed.rows||[])m.set(row.date,row.level);
 return m;
}
function priceRows(feed){
 const m=new Map();
 for(const row of feed.rows||[])m.set(row.symbol+'|'+row.date,row.adjustedLevel);
 return m;
}
function auditSectorDualSource({primary,secondary,policy,asOf=Date.now()}={}){
 if(!primary||!secondary||typeof primary!=='object'||
  typeof secondary!=='object'||!validTolerance(policy)||
  !Number.isSafeInteger(asOf)||asOf<=0)
  return block('invalid-dual-source-input-or-tolerance');
 if(!primary.cohort||policy.declaredAt>primary.cohort.frozenAt||
  policy.declaredAt>asOf)return block('tolerance-not-declared-before-signal-freeze');
 for(const f of fixedFields){
  if(f==='asOf')continue;
  if(hash(primary[f]??null)!==hash(secondary[f]??null))
   return block('shared-frozen-source-or-calendar-not-identical:'+f);
 }
 if(primary.asOf!==secondary.asOf||primary.asOf!==asOf)
  return block('dual-report-as-of-conflict');
 const a=primary.adjustedFeed,b=secondary.adjustedFeed,
  ia=primary.benchmarkFeed,ib=secondary.benchmarkFeed;
 if(!a||!b||!ia||!ib||typeof a.provider!=='string'||
  typeof b.provider!=='string'||a.provider===b.provider||
  a.datasetId===b.datasetId||
  typeof ia.provider!=='string'||typeof ib.provider!=='string'||
  ia.provider===ib.provider||ia.datasetId===ib.datasetId||
  ia.indexCode!==ib.indexCode||
  !ia.indexCode||typeof ia.indexCode!=='string')
  return block('provider-identity-or-independent-index-provenance-conflict');
 const p=reconcileSectorAdjusted(primary),q=reconcileSectorAdjusted(secondary);
 if(p.status==='blocked'||q.status==='blocked')
  return block('one-or-both-raw-to-adjusted-reconciliations-blocked');
 if(!Array.isArray(p.horizons)||p.horizons.length!==3||
  !Array.isArray(q.horizons)||q.horizons.length!==3)
  return block('one-or-both-reports-missing-horizons');
 const pr=priceRows(a),sr=priceRows(b),pi=indexByDate(ia),si=indexByDate(ib),
  sectors=primary.cohort.sectors,base=primary.cohort.tradeDate;
 const toleranceStock=policy.maxStockReturnDifferenceBps,
  toleranceIndex=policy.maxIndexReturnDifferenceBps;
 const horizons=HORIZONS.map((n,i)=>{
  const x=p.horizons[i],y=q.horizons[i];
  const target=x?.targetDate;
  const result={sessions:n,targetDate:target||null,
   status:'unknown',reason:null,comparedSectors:0,agreedSectors:0,
   disagreeingSectors:0,unknownSectors:0,indexReturnDifferenceBps:null,
   sectors:[]};
  if(x?.sessions!==n||y?.sessions!==n||target!==y.targetDate){
   result.reason='provider-window-date-mismatch';return result;
  }
  if(x.status==='pending'||y.status==='pending'){
   result.status='pending';result.reason='one-or-both-future-windows-pending';return result;
  }
  if(x.status==='unknown'||y.status==='unknown'){
   result.reason='one-or-both-original-snapshots-not-comparable';return result;
  }
  const pb=pi.get(base),pt=pi.get(target),sb=si.get(base),st=si.get(target);
  if(![pb,pt,sb,st].every(v=>finite(v)&&v>0)){
   result.reason='two-provider-index-levels-missing';return result;
  }
  const indexGap=Math.abs(((pt/pb-1)-(st/sb-1))*10000);
  if(!finite(indexGap)){result.reason='index-return-invalid';return result;}
  result.indexReturnDifferenceBps=Number(indexGap.toFixed(5));
  const rowsA=new Map(x.sectors.map(z=>[id(z),z])),
   rowsB=new Map(y.sectors.map(z=>[id(z),z]));
  if(rowsA.size!==sectors.length||rowsB.size!==sectors.length){
   result.reason='sector-identity-coverage-not-comparable';return result;
  }
  for(const sector of sectors){
   const sid=id(sector),ra=rowsA.get(sid),rb=rowsB.get(sid);
   const row={category:sector.category,code:sector.code,
    memberCount:sector.members.length,status:'unknown',reason:null,
    comparedStocks:0,maxStockReturnDifferenceBps:null,
    primaryAdjustedReturnPct:null,secondaryAdjustedReturnPct:null};
   if(!ra||!rb||ra.status!=='provider-adjusted-reconciled-unverified'||
    rb.status!=='provider-adjusted-reconciled-unverified'){
    row.reason='incomplete-or-incomparable-supplier-adjusted-sector';
    result.unknownSectors++;
    result.sectors.push(row);continue;
   }
   let diffMax=0,sumA=0,sumB=0,complete=true;
   for(const member of sector.members){
    const prefix=member.symbol+'|',a0=pr.get(prefix+base),a1=pr.get(prefix+target),
     b0=sr.get(prefix+base),b1=sr.get(prefix+target);
    if(![a0,a1,b0,b1].every(v=>finite(v)&&v>0)){complete=false;break;}
    const ar=a1/a0-1,br=b1/b0-1;
    if(!finite(ar)||!finite(br)){complete=false;break;}
    sumA+=ar;sumB+=br;diffMax=Math.max(diffMax,Math.abs(ar-br)*10000);
   }
   if(!complete){
    row.reason='adjusted-member-series-not-comparable';
    result.unknownSectors++;result.sectors.push(row);continue;
   }
   row.comparedStocks=sector.members.length;
   row.maxStockReturnDifferenceBps=Number(diffMax.toFixed(5));
   row.primaryAdjustedReturnPct=Number((sumA/sector.members.length*100).toFixed(5));
   row.secondaryAdjustedReturnPct=Number((sumB/sector.members.length*100).toFixed(5));
   result.comparedSectors++;
   if(diffMax>toleranceStock||indexGap>toleranceIndex){
    row.status='disagreement';
    row.reason=diffMax>toleranceStock?
     'one-or-more-frozen-stocks-disagree':'index-benchmark-providers-disagree';
    result.disagreeingSectors++;
   }else{row.status='supplier-agreement-unverified';result.agreedSectors++;}
   result.sectors.push(row);
  }
  result.status=result.disagreeingSectors?'disagreement':
   result.agreedSectors===sectors.length?'supplier-agreement-unverified':
   'partial-or-unknown';
  return result;
 });
 return {schemaVersion:1,mode:'sector-dual-adjusted-source-agreement-only',
  status:horizons.some(h=>h.status==='disagreement')?'supplier-disagreement':
   horizons.some(h=>h.status==='supplier-agreement-unverified')?
    'supplier-agreement-unverified':'insufficient-evidence',
  tradeDate:base,frozenFingerprint:primary.cohort.fingerprint,
  primaryAdjustedProvider:a.provider,secondaryAdjustedProvider:b.provider,
  primaryIndexProvider:ia.provider,secondaryIndexProvider:ib.provider,
  indexCode:ia.indexCode,asOf,
  toleranceDeclaredAt:policy.declaredAt,
  maxStockReturnDifferenceBps:toleranceStock,
  maxIndexReturnDifferenceBps:toleranceIndex,horizons,...safe,
  note:'仅比对两个声明不同的供应商复权价与同一总收益指数的相对变动，没有独立认证来源是否真正独立、授权是否合法或复权因子是否正确。分歧拒绝平均；一致不是模型训练许可或可交易净收益'};
}
module.exports={auditSectorDualSource};
