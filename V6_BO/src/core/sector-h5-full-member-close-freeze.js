'use strict';
/**
 * Freeze the full industry signal-day EOD close as H5 baselines, using only
 * a contemporaneously sealed candidate and an operator-imported price batch.
 * Never fetch, fill, estimate, back-date, train, notify or order.
 */
const {isDeepStrictEqual}=require('node:util');
const {aShareCalendarDate}=require('./a-share-calendar');
const {freezeCohort}=require('./forward-signal-observer');
const {fingerprintSectorMembers}=require('./sector-member-identity-proof');
const {prepareSectorShadowCandidateCapture,hash}=require('./sector-shadow-candidate-capture');
const timeOK=n=>Number.isSafeInteger(n)&&n>946684800000&&n<4102444800000;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sym=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const meta={schemaVersion:1,mode:'sector-h5-full-member-close-freeze-preflight',
 verifiedLive:false,providerLicenseIndependentlyVerified:false,
 externallyTimestampCertified:false,prospectiveCertified:false,
 outOfSampleValidated:false,canTrain:false,canTrade:false,canNotify:false,
 autoPromotion:false,weightsChanged:false,productionWeightsChanged:false,
 canPublishTradeSignals:false};
const blocked=reason=>({...meta,status:'blocked',reason,freeze:null});
function freezeSectorH5MemberCloses(candidate,price,{now=Date.now()}={}){
 const c=candidate?.entry,day=c?.snapshot?.date;
 const sampled=Date.parse(c?.snapshot?.retrievedAt||'');
 const opening=Date.parse(day+'T16:00:00+08:00');
 const closing=Date.parse(day+'T17:00:00+08:00');
 if(!timeOK(now)||!timeOK(opening)||!timeOK(closing)||
   now<opening||now>closing||aShareCalendarDate(now)!==day||
   !timeOK(candidate?.candidateCapturedAt)||
   candidate.candidateCapturedAt>=opening||
   candidate.candidateCapturedAt>now||
   !timeOK(sampled)||
   candidate.candidateCapturedAt-sampled>300000||
   !hex(candidate?.integrity)||!hex(candidate?.sourceDigests?.snapshotSha256)||
   !hex(candidate?.sourceDigests?.membershipSha256)||
   candidate?.mode!=='sector-h5-single-day-readiness-input-unverified'||
   candidate.schemaVersion!==1||
   candidate.captureStage!=='same-day-sector-candidate-only-not-stock-price-cohorts'||
   candidate.canTrade!==false||candidate.canTrain!==false||
   candidate.prospectiveCertified!==false||
   !Array.isArray(c?.industries)||c.industries.length!==0||
   candidate.integrity!==hash(Object.fromEntries(
    Object.entries(candidate).filter(([k])=>k!=='integrity'))))
  return blocked('candidate-was-not-sealed-before-16-or-invalid');
 // Reconstruct original candidate at its ACTUAL seal timestamp. Historical
 // modification of ranks, members or quote quality cannot pass this gate.
 let prior;
 try{prior=prepareSectorShadowCandidateCapture(c.snapshot,c.membership,
  {now:candidate.candidateCapturedAt});}
 catch{return blocked('candidate-original-preflight-could-not-replay');}
 if(prior.status!=='candidate-freeze-prepared-unverified'||
   !isDeepStrictEqual({...prior.capture,sourceDigests:candidate.sourceDigests},
    Object.fromEntries(Object.entries(candidate).filter(([k])=>k!=='integrity'))))
  return blocked('candidate-original-quote-or-member-replay-differs');
 const sectors=c.preflight?.shadowSample?.sectors?.filter(s=>
  s.category==='industry'&&Number.isSafeInteger(s.rank)&&s.rank>0);
 if(!Array.isArray(sectors)||sectors.length<3||sectors.length>100)
  return blocked('unsupported-rank-count');
 const feed=price?.feed;
 if(price?.schemaVersion!==1||
   price.mode!=='sector-h5-imported-signal-day-eod-closes-unverified'||
   price.tradeDate!==day||
   !timeOK(price.observedAt)||price.observedAt<opening||
   price.observedAt>now||now-price.observedAt>300000||
   feed?.source!=='imported'||feed.priceBasis!=='unadjusted'||
   typeof feed.provider!=='string'||feed.provider.length<1||
   feed.provider.length>200||
   typeof feed.datasetId!=='string'||feed.datasetId.length<1||
   feed.datasetId.length>200||
   !Array.isArray(price.stocks)||price.stocks.length<15||
   price.stocks.length>6000||
   // Fail closed on extra payload keys: this entry point must NEVER import
   // future OHLC bars, corrections, or precomputed returns as EOD baselines.
   Object.keys(price).some(k=>!['schemaVersion','mode','tradeDate',
    'observedAt','feed','stocks'].includes(k))||
   Object.keys(feed).some(k=>!['source','provider','datasetId',
    'priceBasis'].includes(k)))
  return blocked('imported-eod-price-feed-or-timestamp-invalid');
 const prices=new Map();
 for(const p of price.stocks){
  if(!p||typeof p!=='object'||Array.isArray(p)||
    Object.keys(p).some(k=>!['symbol','tradeDate','close','volume',
     'suspended','vendorQuoteAt'].includes(k))||
    !sym(p.symbol)||prices.has(p.symbol)||
    p.tradeDate!==day||
    !finite(p.close)||p.close<=0||p.close>1000000||
    !Number.isSafeInteger(p.volume)||p.volume<=0||
    p.suspended!==false||!timeOK(p.vendorQuoteAt)||
    p.vendorQuoteAt<Date.parse(day+'T15:00:00+08:00')||
    p.vendorQuoteAt>Date.parse(day+'T16:00:00+08:00')||
    p.vendorQuoteAt>price.observedAt)
   return blocked('missing-stale-duplicate-or-suspended-raw-price');
  prices.set(p.symbol,p);
 }
 const used=new Set(),result=[];
 for(const group of sectors){
  const original=c.membership.sectors.filter(x=>
   x?.category==='industry'&&x.code===group.code);
  if(original.length!==1)return blocked('original-ranked-industry-member-record-missing');
  const g=original[0],members=g.members,proof=fingerprintSectorMembers(g);
  if(proof.status!=='identity-frozen-unverified'||
    proof.memberCount!==group.memberCount||
    proof.memberSha256!==group.memberSha256||
    !Array.isArray(members)||members.length<5||members.length>500||
    new Set(members).size!==members.length)
   return blocked('full-original-membership-identity-conflict');
  const signals=[];
  for(const symbol of [...members].sort()){
   if(used.has(symbol)||!prices.has(symbol))
    return blocked('no-complete-nonoverlapping-price-baseline-for-industry');
   used.add(symbol);
   signals.push({signalId:'sector-h5/'+day+'/'+group.code+'/'+symbol,
    symbol,system:'manual',cohort:'sector-shadow/industry/'+group.code,
    provenance:'operator-eod-unverified/'+candidate.integrity.slice(0,16),
    signalDate:day,signalAt:now,baselineClose:prices.get(symbol).close});
  }
  let cohort;
  try{cohort=freezeCohort({schemaVersion:1,feed,signals},{now});}
  catch{return blocked('frozen-cohort-contract-rejected');}
  result.push({sectorCode:group.code,memberCount:members.length,
   memberSha256:group.memberSha256,cohort});
 }
 if(used.size!==prices.size)
  return blocked('unranked-or-extra-stock-price-cannot-be-used-as-complete-evidence');
 const archive={schemaVersion:1,mode:'sector-h5-frozen-member-close-cohorts-unverified',
  tradeDate:day,frozenAt:now,
  originalCandidateIntegrity:candidate.integrity,
  priceFeed:{source:feed.source,provider:feed.provider,
   datasetId:feed.datasetId,priceBasis:feed.priceBasis},
  rankedIndustryCount:result.length,totalMemberCount:used.size,
  industries:result,canTrain:false,canTrade:false,canNotify:false,
  prospectiveCertified:false,outOfSampleValidated:false,
  autoPromotion:false,weightsChanged:false,productionWeightsChanged:false};
 return {...meta,status:'full-member-close-cohorts-frozen-unverified',
  tradeDate:day,rankedIndustryCount:result.length,
  totalMemberCount:used.size,freeze:archive,
  note:'所有已排名行业的全体成员EOD基准价已按当前运行时钟冻结；不证明外部时间可信、价格已获授权或未来收益可交易'};
}
module.exports={freezeSectorH5MemberCloses};
