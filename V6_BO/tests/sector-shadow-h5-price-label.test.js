'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels:evaluate}=require('../src/core/sector-shadow-h5-price-label');
const tradeDates=['2026-11-10','2026-11-11','2026-11-12',
 '2026-11-13','2026-11-16','2026-11-17'];
const day='2026-11-10',end=Date.parse(day+'T15:00:00+08:00');
const signalAt=Date.parse(day+'T16:01:00+08:00');
const frozenAt=Date.parse(day+'T16:02:00+08:00');
const future=Date.parse('2026-11-17T17:00:00+08:00');
const feed={source:'imported',provider:'operator-eod-research-unverified',
 datasetId:'eod-dataset-fixed-v1',priceBasis:'unadjusted'};
function seed(){
 const stocks=[],sectors=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);
   members.push(code);
   stocks.push({code,pctChange:[3,1,-2][g]+j*.04,
    vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,
   name:'industry'+g,memberCount:members.length,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',
  startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),universeSize:stocks.length,stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',
  classificationVersion:'fixed-sector-version-20261110',
  tradeDate:day,observedAt:end-120000,sectors};
 const preflight=inspect(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const members=sectors[0].members;
 const signals=members.map((symbol,j)=>({
  signalId:'sig-'+symbol,symbol,system:'manual',cohort:'sector-shadow/industry/BS_0',
  provenance:'same-day-operator-imported-signal-unverified',
  signalDate:day,signalAt,baselineClose:10+j}));
 const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:frozenAt});
 return {preflight,membership,cohort,members};
}
function marketOf(group,{asOf='2026-11-17',corporateActionSymbol=null,
 suspendedSymbol=null,missingSymbol=null,returnPct=10}={}){
 const reached=asOf>='2026-11-17';
 return {schemaVersion:1,feed:{...feed},calendar:tradeDates,
  asOf,observedAt:Date.parse(asOf+'T16:05:00+08:00'),
  stocks:group.members.map((symbol,i)=>{
   const base=10+i;
   const bars=[{date:day,close:base,volume:1000,suspended:false}];
   if(reached&&symbol!==missingSymbol)bars.push({
    date:'2026-11-17',close:base*(1+returnPct/100),
    volume:symbol===suspendedSymbol?0:1000,
    suspended:symbol===suspendedSymbol});
   return {symbol,bars,corporateActions:
    reached&&symbol===corporateActionSymbol?['2026-11-13']:[]};
  })};
}
const opt={sectorCode:'BS_0',now:future};
const exec=(g,m=marketOf(g),options=opt)=>
 evaluate(g.preflight,g.membership,g.cohort,m,options);
test('complete frozen industry H5 gross-price label reuses true forward close calculation',()=>{
 const g=seed(),market=marketOf(g);
 const before=JSON.stringify({g,market});
 const r=exec(g,market);
 assert.equal(r.status,'gross-h5-label-observed-unverified');
 assert.equal(r.targetDate,'2026-11-17');
 assert.equal(r.labelsAvailable,true);
 assert.equal(r.observedMembers,5);
 assert.equal(r.memberCount,5);
 assert.equal(r.coveragePct,100);
 assert.equal(r.records.length,5);
 assert.equal(r.grossMeanReturnPct,10);
 assert.equal(r.grossMedianReturnPct,10);
 assert.ok(r.records.every(x=>x.status==='observed'&&x.priceReturnPct===10));
 assert.equal(r.returnBasis,'signal-day-close-to-h5-close-unadjusted-gross');
 assert.equal(r.outOfSampleValidated,false);
 assert.equal(r.priceSourceAuthorized,false);
 assert.equal(r.prospectiveCertified,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.canTrade,false);
 assert.equal(r.autoPromotion,false);
 assert.equal(r.productionWeightsChanged,false);
 assert.match(r.cohortFingerprint,/^[0-9a-f]{64}$/);
 assert.match(r.marketFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(JSON.stringify({g,market}),before,'input must remain immutable');
});
test('H5 cannot mature before fifth explicit session, even when calendar lists it',()=>{
 const g=seed(),m=marketOf(g,{asOf:'2026-11-13'});
 const r=exec(g,m,{...opt,now:Date.parse('2026-11-13T17:00:00+08:00')});
 assert.equal(r.status,'pending-future-session');
 assert.equal(r.labelsAvailable,false);
 assert.equal(r.grossMeanReturnPct,null);
 assert.equal(r.canTrain,false);
});
test('short explicit calendar cannot invent a five-session target',()=>{
 const g=seed(),m=marketOf(g,{asOf:'2026-11-16'});
 m.calendar=tradeDates.slice(0,-1);
 const r=exec(g,m,{...opt,now:Date.parse('2026-11-16T17:00:00+08:00')});
 assert.equal(r.status,'pending-calendar');
 assert.equal(r.targetDate,null);
 assert.equal(r.labelsAvailable,false);
});
test('missing, suspended or corporate-action members never become zero or a cherry-picked sector label',()=>{
 for(const column of ['corporateActionSymbol','suspendedSymbol','missingSymbol']){
  const g=seed(),m=marketOf(g,{[column]:g.members[0]});
  const r=exec(g,m);
  assert.equal(r.status,'partial-h5-evidence');
  assert.equal(r.labelsAvailable,false);
  assert.equal(r.observedMembers,4);
  assert.equal(r.coveragePct,80);
  assert.equal(r.grossMeanReturnPct,null);
  assert.equal(r.grossMedianReturnPct,null);
  const affected=r.records.find(x=>x.symbol===g.members[0]);
  assert.equal(affected.priceReturnPct,null);
  assert.ok(['missing-or-suspended','corporate-action-unresolved'].includes(affected.status));
 }
});
test('future price can be negative return; no positive-only sample filtering',()=>{
 const g=seed(),r=exec(g,marketOf(g,{returnPct:-12}));
 assert.equal(r.status,'gross-h5-label-observed-unverified');
 assert.equal(r.grossMeanReturnPct,-12);
 assert.ok(r.records.every(x=>x.priceReturnPct===-12));
});
test('tampered baseline, cross-feed, simulated source and bad bars are rejected',()=>{
 for(const mutate of [
  m=>{m.stocks[0].bars[0].close+=.01;},
  m=>{m.feed.datasetId='later-changed';},
  m=>{m.feed.source='simulated';},
  m=>{m.stocks[0].bars.at(-1).close=-1;},
  m=>{m.stocks.push(structuredClone(m.stocks[0]));}
 ]){
  const g=seed(),m=marketOf(g);mutate(m);
  const r=exec(g,m);
  assert.equal(r.status,'blocked');
  assert.equal(r.labelsAvailable,false);
  assert.equal(r.canTrain,false);
 }
});
test('the entire frozen sector, not only its winners, must be represented exactly',()=>{
 for(const mutate of [
  g=>{g.cohort.signals.pop();},
  g=>{g.cohort.signals[0].symbol='699999';},
  g=>{g.cohort.signals[0].cohort='another-sector';},
  g=>{g.cohort.signals[0].signalAt-=3600000;},
  g=>{g.membership.sectors[0].members.pop();},
  g=>{g.membership.sectors[0].memberCount=6;},
  g=>{g.membership.classificationVersion='after-signal-version';},
  g=>{g.preflight.shadowSample.tradeDate='2026-11-11';},
  g=>{g.preflight.canTrain=true;}
 ]){
  const g=seed();mutate(g);
  const r=exec(g);
  assert.equal(r.status,'blocked');
  assert.equal(r.labelsAvailable,false);
  assert.equal(r.canTrade,false);
 }
});
test('historical backfill and a 501-member sector must not produce training samples',()=>{
 const g=seed();
 g.cohort.frozenAt+=86400000;
 assert.equal(exec(g).status,'blocked');
 const many=seed();
 many.membership.sectors[0].members=Array.from({length:501},(_,i)=>String(601000+i));
 many.membership.sectors[0].memberCount=501;
 assert.equal(exec(many).status,'blocked');
});
test('no 3-day price-label claim is invented from the separate descriptive rotation study',()=>{
 const g=seed(),r=exec(g);
 assert.equal(r.returnBasis,'signal-day-close-to-h5-close-unadjusted-gross');
 assert.equal(r.mode,'sector-shadow-gross-h5-price-label-research');
 assert.equal(r.outOfSampleValidated,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.canNotify,false);
});

test('ranked sector preview freezes a SHA-256 identity for every member group',()=>{
 const g=seed();
 const ranked=g.preflight.shadowSample.sectors;
 assert.equal(ranked.length,3);
 for(const s of ranked){
  assert.equal(s.memberCount,5);
  assert.match(s.memberSha256,/^[a-f0-9]{64}$/);
 }
 const r=exec(g);
 assert.equal(r.status,'gross-h5-label-observed-unverified');
 assert.equal(r.frozenMemberSha256,ranked[0].memberSha256);
 assert.equal(r.canTrain,false);
 assert.equal(r.canTrade,false);
});
test('same-count member replacement fails closed even if later cohort and prices are swapped to match',()=>{
 const g=seed(),replacement='600999';
 // Old logic only checked the unchanged version and complete count. A
 // retrospectively swapped five-stock cohort could pass those gates.
 g.membership.sectors[0].members[0]=replacement;
 const oldSignals=g.cohort.signals;
 const revised=oldSignals.map((s,i)=>i?{...s}:{
  ...s,signalId:'sig-'+replacement,symbol:replacement});
 g.cohort=freezeCohort({schemaVersion:1,feed,signals:revised},{now:frozenAt});
 const m=marketOf(g);
 assert.equal(m.stocks[0].symbol,replacement);
 const r=exec(g,m);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'frozen-sector-member-identity-mismatch');
 assert.equal(r.labelsAvailable,false);
 assert.equal(r.grossMeanReturnPct,null);
 assert.equal(r.canTrain,false);
});
test('a legacy preview lacking frozen member identity cannot acquire H5 price labels',()=>{
 const g=seed();
 delete g.preflight.shadowSample.sectors[0].memberSha256;
 const r=exec(g);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'frozen-sector-member-identity-mismatch');
 assert.equal(r.labelsAvailable,false);
 assert.equal(r.canTrade,false);
});
test('constituent order alone does not change canonical member identity',()=>{
 const g=seed(),market=marketOf(g);
 // Preserve each symbol's existing baseline when only the membership display
 // order changes; reassigning closes by the new array order would be invalid.
 g.membership.sectors[0].members.reverse();
 const r=exec(g,market);
 assert.equal(r.status,'gross-h5-label-observed-unverified');
 assert.equal(r.frozenMemberSha256,g.preflight.shadowSample.sectors[0].memberSha256);
 assert.equal(r.canTrain,false);
});
