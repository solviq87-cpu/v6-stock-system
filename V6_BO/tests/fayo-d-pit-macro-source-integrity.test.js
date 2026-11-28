'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/core/public-stock-status-evidence');
const SEC=require('../src/core/sec-companyfacts');
const WB=require('../src/core/worldbank-indicators');
const U=require('../src/core/historical-universe');
const NOW=Date.parse('2026-11-26T16:05:00+08:00'),DAY='2026-11-26',CODE='600000';
const page=rows=>({raw:JSON.stringify({success:true,result:{data:rows,count:rows.length,pages:rows.length?1:0}})});
const dividend={SECURITY_CODE:CODE,SECUCODE:CODE+'.SH',REPORT_DATE:'2025-12-31',PRETAX_BONUS_RMB:0};
const suspension={SECURITY_CODE:CODE,SECUCODE:CODE+'.SH',SUSPEND_START_DATE:'2026-11-27',PREDICT_RESUME_DATE:'2026-11-30'};
function quote(){const f=Array(49).fill('');f[2]=CODE;f[30]='20261126092000';f[47]='12';f[48]='8';return {raw:'v_sh600000="'+f.join('~')+'";'};}
const collector=(overrides={},clock=()=>NOW)=>S.fetchPublicStockStatusEvidence({symbol:CODE,date:DAY},{now:clock,requestJson:async target=>{
 if(target.includes('qt.gtimg.cn'))return quote();
 return target.includes('RPT_SHAREBONUS_DET')?page(overrides.dividend??[dividend]):page(overrides.suspension??[suspension]);
}});
test('security status cannot accept the correct six digits with a contradictory exchange suffix',async()=>{
 for(const group of ['dividend','suspension']){
  const row={...(group==='dividend'?dividend:suspension),SECUCODE:CODE+'.SZ'};
  const r=await collector({[group]:[row]}),report=group==='dividend'?r.dividendEvents:r.suspensionAnnouncements;
  assert.equal(report.coverage.complete,false);assert.equal(report.records.length,0);
  assert.ok(r.errors.some(e=>e.code==='source-identity'));assert.equal(r.priceLimits.limitUpPrice,12);
 }
 const ok=await collector();assert.equal(ok.dividendEvents.coverage.complete,true);
 assert.equal(ok.dividendEvents.records[0].pretaxBonusRmb,0);
 assert.equal(ok.suspensionAnnouncements.records[0].suspendStartDate,'2026-11-27');
 assert.equal(ok.suspensionAnnouncements.absenceClaim,null);assert.equal(ok.canTrade,false);
});
test('same-batch status capture rejects an intermediate clock rollback even after clock recovery',async()=>{
 let samples=0;
 await assert.rejects(()=>collector({},()=>{samples++;return samples===1?NOW:samples===2?NOW+1000:samples===3?NOW+500:NOW+2000;}),/时钟/);
});
test('invalid or throwing initial clock stops before transport, without a fabricated receipt',async()=>{
 let calls=0;
 for(const now of [()=>NaN,()=>NOW+.5,()=>{throw Error('fixture clock')}])
  await assert.rejects(()=>S.fetchPublicStockStatusEvidence({symbol:CODE,date:DAY},{now,requestJson:async()=>{calls++;return page([])}}),/时钟/);
 assert.equal(calls,0);
});
const secCfg={cik:320193,tag:'Assets',unit:'USD',asOf:'2026-10-31',now:NOW};
const fact=overrides=>({end:'2025-12-31',filed:'2026-02-02',accn:'0000320193-26-000011',form:'10-K',val:0,...overrides});
const company=rows=>({cik:320193,facts:{'us-gaap':{Assets:{units:{USD:rows}}}}});
test('direct SEC history projection validates typed identity, reporting cutoff and actual clock',()=>{
 for(const change of [{tag:['Assets']},{asOf:'2026-02-30'},{asOf:'2026-11-27'},{now:NaN},{now:String(NOW)}])
  assert.throws(()=>SEC.projectCompanyFact(company([fact()]),{...secCfg,...change}),/投影/);
 const r=SEC.projectCompanyFact(company([fact()]),secCfg);
 assert.equal(r.records[0].reportedValue,0);assert.equal(r.records[0].acceptedAt,null);assert.equal(r.canTrade,false);
});
test('SEC raw accession and request identifiers cannot be coerced arrays',()=>{
 assert.throws(()=>SEC.projectCompanyFact(company([fact({accn:['0000320193-26-000011']})]),secCfg),/凭据/);
 for(const change of [{cik:['320193']},{tag:['Assets']}])
  assert.throws(()=>SEC.validate({...secCfg,userAgent:'Fixture research@example.invalid',...change}),/CIK/);
});
const wbCfg={country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2022,endYear:2025,observedAt:NOW};
const wbRows=rows=>[{page:1,pages:1,per_page:'100',total:rows.length},rows.map(([date,value])=>({date,countryiso3code:'CHN',indicator:{id:wbCfg.indicator},value}))];
test('World Bank direct projector revalidates typed request and future data years',()=>{
 for(const change of [{country:['CHN']},{indicator:['NY.GDP.MKTP.CD']},{startYear:2022.5},{endYear:2027}])
  assert.throws(()=>WB.parseWorldBankResponse(wbRows([['2024',0]]),{...wbCfg,...change}),/不合法/);
});
test('World Bank single-page metadata must match the actual response, not merely coerce to one',()=>{
 for(const meta of [{pages:[1]},{pages:true},{total:2},{page:2},{per_page:0}]){
  const p=wbRows([['2024',0]]);Object.assign(p[0],meta);
  assert.throws(()=>WB.parseWorldBankResponse(p,wbCfg),/分页/);
 }
 const valid=wbRows([['2024',0]]);valid[0].pages='1';valid[0].total='1';
 assert.equal(WB.parseWorldBankResponse(valid,wbCfg).rows.length,1);
});
test('World Bank coverage separates omitted years, explicit null and real zero',()=>{
 const r=WB.parseWorldBankResponse(wbRows([['2022',0],['2024',null],['2025',10]]),wbCfg);
 assert.deepEqual(r.coverage,{requestedYears:4,returnedYears:3,knownValueYears:2,explicitMissingValueYears:1,omittedYears:[2023],yearRowsComplete:false,allValuesKnown:false,publicationCoverageVerified:false});
 assert.deepEqual(r.rows.map(x=>x.value),[0,null,10]);assert.equal(r.publicationVintageVerified,false);assert.equal(r.canTrade,false);
});
const master=()=>({source:'security-archive',dataVersion:'v1',knownAt:'2026-01-01T00:00:00Z',availableAt:'2026-01-01T00:00:00Z',listedOn:'2000-01-01',delistedOn:null,board:'main',isST:false,suspended:false,limitPct:10,priceBasis:'unadjusted',corporateActionStatus:'none',actionIds:[],feeVersion:'fee1',evidenceHash:'a'.repeat(64)});
const membership=(change={})=>({symbol:CODE,from:'2026-04-01',through:'2026-04-30',eligible:true,source:'membership-archive',knownAt:'2026-01-01T00:00:00Z',securityMaster:master(),...change});
const bar={date:'2026-04-02',isST:false,suspended:false,limitPct:10,volume:100};
const hist=()=>({requirePointInTime:true,priceBasis:'unadjusted',universeHistory:[membership()],stocks:[{code:CODE,market:'main',bars:[{...bar}]}],feeSchedules:[{source:'fee-archive',version:'fee1',knownAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',feeBps:1,minFee:0,sellTaxBps:5}]});
test('historical membership must have real civil source dates and typed security identities',()=>{
 for(const change of [{symbol:600000},{symbol:[CODE]},{knownAt:'2026-02-30T00:00:00Z'},{knownAt:'2026-01-01 00:00:00Z'}])
  assert.throws(()=>U.validateUniverseHistory([membership(change)]),/股票池/);
 const r=membership();r.securityMaster.evidenceHash=['a'.repeat(64)];assert.throws(()=>U.validateUniverseHistory([r]),/证券主数据/);
});
test('point-in-time lookup rechecks source date and eligibility even if caller skipped dataset validation',()=>{
 const r=membership({knownAt:'2026-02-30T00:00:00Z'});
 assert.throws(()=>U.universeObservation([r],CODE,bar.date),/股票池/);
 assert.throws(()=>U.universeObservation([membership({eligible:'false'})],CODE,bar.date),/股票池/);
 const future=membership({knownAt:'2026-04-03T00:00:00Z'});
 assert.equal(U.universeObservation([future],CODE,bar.date).eligible,false);
 assert.equal(U.universeObservation([membership()],CODE,bar.date).eligible,true);
});
test('PIT coverage refuses empty, duplicated or orphaned history, without falsely claiming complete evidence',()=>{
 for(const change of [
  h=>{h.stocks[0].bars=[];},
  h=>{h.stocks[0].bars.push({...bar});},
  h=>{h.universeHistory.push(membership({symbol:'000001'}));},
  h=>{h.stocks[0].code=600000;}
 ]){
  const h=hist();change(h);assert.throws(()=>U.historicalUniverseCoverage(h),/行情|证券/);
 }
 const ok=U.historicalUniverseCoverage(hist());assert.equal(ok.complete,true);assert.equal(ok.checkedBars,1);
 assert.equal(ok.fullHistoricalUniverseVerified,false);assert.equal(ok.canTrade,false);
});
test('PIT fee and security-master invalid calendar clocks cannot backfill historical knowledge',()=>{
 const h=hist();h.feeSchedules[0].knownAt='2026-02-30T00:00:00Z';
 assert.throws(()=>U.historicalUniverseCoverage(h),/费率/);
 const r=membership();r.securityMaster.availableAt='2026-02-30T00:00:00Z';
 assert.throws(()=>U.validateUniverseHistory([r]),/证券主数据/);
});

test('F42 opening cutoff hides future master contents rather than returning blocked future metadata',()=>{const row=membership();row.securityMaster.availableAt='2026-04-02T02:00:00Z';const old=U.universeObservation([row],CODE,bar.date,{at:'open'});assert.equal(old.eligible,false);assert.equal(old.reason,'SECURITY_MASTER_NOT_AVAILABLE');assert.equal(Object.hasOwn(old,'securityMaster'),false);assert.equal(Object.hasOwn(old,'securityLifecycle'),false);const later=U.universeObservation([row],CODE,bar.date);assert.equal(later.eligible,true);assert.equal(later.securityLifecycle.dataVersion,row.securityMaster.dataVersion);assert.ok(Number.isInteger(later.securityLifecycle.listingAgeCalendarDays));});
test('F42 direct lookup fails closed for overlapping intervals regardless of order',()=>{const a=membership(),b=membership({eligible:false});for(const rows of [[a,b],[b,a]]){const r=U.universeObservation(rows,CODE,bar.date);assert.equal(r.eligible,false);assert.equal(r.reason,'AMBIGUOUS_POINT_IN_TIME_MEMBERSHIP');assert.equal(Object.hasOwn(r,'securityMaster'),false);}});
