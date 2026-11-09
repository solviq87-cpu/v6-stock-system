'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {freezeCohort,evaluateForward}=require('../src/core/forward-signal-observer');
const {freezeFeatureEpisode}=require('../src/core/factor-shadow-evolution');
const {runOnce:trackOnce}=require('../src/core/forward-tracking-store');
const {auditOneDay,auditFactorHorizonSeries,spearman}=
 require('../src/core/factor-industry-multihorizon');
const {runOnce:auditOnce,parse}=require('../scripts/factor-horizon-neutral');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const at=(day,time='16:00:00')=>Date.parse(day+'T'+time+'+08:00');
function weekdays(n){
 const days=[];let t=Date.parse('2026-05-04T00:00:00Z');
 while(days.length<n){
  const d=new Date(t);
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10));
  t+=86400000;
 }
 return days;
}
const dates=weekdays(100),ids=['sector_heat','leader_strength'],
 source={source:'imported',provider:'synthetic-price-only',
  datasetId:'unadjusted-unit',priceBasis:'unadjusted'},
 factorFeed={source:'imported',provider:'synthetic-factor-only',datasetId:'factor-unit'};
const now=at('2026-11-10');
function episode(index=0,{industry=true,last=60,flipH20=false,
 missingH5=false,corporateH5=false,duplicates=false}={}){
 const d=dates[index],signals=[],rows=[],stocks=[];
 for(let j=0;j<6;j++){
  const symbol='60000'+j,id=d+'-'+symbol,sector=j<3?'SW_A':'SW_B',
   within=j%3,base=j<3?-4:6,
   vals={sector_heat:j<3?20+within:80+within,
    leader_strength:j<3?80-within:20-within};
  signals.push({signalId:id,symbol,system:'manual',cohort:'industry-unit',
   provenance:'synthetic-not-stock-market',signalDate:d,
   signalAt:at(d),baselineClose:10});
  const row={signalId:id,symbol,signalDate:d,values:vals,evidence:{
   sector_heat:{source:factorFeed.provider,observedAt:at(d)},
   leader_strength:{source:factorFeed.provider,observedAt:at(d)}
  }};
  if(industry)row.industry={code:sector,source:factorFeed.provider,
   observedAt:at(d),classificationVersion:'unit-industry-2026'};
  rows.push(row);
  const future=[1,5,20,60],bars=[
   {date:d,close:10,volume:100,suspended:false}
  ];
  for(const h of future){
   if(index+h>=dates.length||h>last)continue;
   if(h===5&&missingH5&&j===0){bars.push({
    date:dates[index+h],close:null,volume:0,suspended:true});continue;}
   const withinComponent=h===20&&flipH20?within*.25:(2-within)*.25;
   const pct=base+withinComponent;
   bars.push({date:dates[index+h],close:10*(1+pct/100),
    volume:100,suspended:false});
  }
  stocks.push({symbol,bars,corporateActions:corporateH5&&j===0?
   [dates[index+3]]:[]});
 }
 if(duplicates){
  const duplicate={...signals[0],signalId:signals[0].signalId+'-repeat'};
  signals.push(duplicate);
  rows.push({...rows[0],signalId:duplicate.signalId});
 }
 const cohort=freezeCohort({schemaVersion:1,feed:source,signals},
  {now:at(d,'16:01:00')});
 const features=freezeFeatureEpisode({cohort,feed:factorFeed,
  factorIds:ids,rows},{now:at(d,'16:01:00')});
 const lastDate=dates[index+last];
 const market={schemaVersion:1,feed:source,
  asOf:lastDate,observedAt:at(lastDate,'16:03:00'),
  calendar:dates.slice(index,index+61),stocks};
 const report=evaluateForward(cohort,market,{now:at(lastDate,'16:04:00')});
 return {cohort,features,report,market};
}
test('within-industry neutral IC separates sector-wide gains from stock-level factor information',()=>{
 const x=episode();
 const a=auditOneDay(x.features,x.report,{now});
 assert.equal(a.windows.length,4);
 const h5=a.windows[1];
 assert.equal(h5.tradingDays,5);
 assert.equal(h5.observedSignals,6);
 assert.equal(h5.industryObservedSignals,6);
 const factor=h5.factorIC.sector_heat;
 assert.ok(factor.rawIC>.5,'sector-level return correlation should be positive');
 assert.ok(factor.industryNeutralIC<-.5,
  'within both industries higher factor scores identify lower stock returns');
 assert.equal(factor.industryGroups,2);
 assert.equal(factor.industryStatus,'descriptive-only');
 assert.equal(h5.duplicateSignalsExcluded,0);
 assert.equal(a.windows[3].observedSignals,6);
 assert.equal(a.windows[3].factorIC.sector_heat.industryNeutralIC<0,true);
});
test('missing historical sector membership does not get backfilled from todays industry map',()=>{
 const x=episode(0,{industry:false});
 const a=auditOneDay(x.features,x.report,{now});
 for(const period of a.windows){
  assert.equal(period.factorIC.sector_heat.industryNeutralIC,null);
  assert.equal(period.factorIC.sector_heat.industryStatus,'insufficient-industry-groups');
  assert.equal(period.industryObservedSignals,0);
  assert.ok(period.factorIC.sector_heat.rawIC!==null);
 }
});
test('pending 20/60 day windows, suspended and corporate-action outcomes are never treated as zero',()=>{
 const partial=episode(0,{last:5,missingH5:true});
 const a=auditOneDay(partial.features,partial.report,{now});
 assert.equal(a.windows[1].missingOrSuspended,1);
 assert.equal(a.windows[1].observedSignals,5);
 assert.equal(a.windows[2].pending,6);
 assert.equal(a.windows[3].pending,6);
 assert.equal(a.windows[2].factorIC.sector_heat.rawIC,null);
 assert.equal(a.windows[3].factorIC.sector_heat.industryNeutralIC,null);
 const corporate=episode(0,{last:5,corporateH5:true});
 const c=auditOneDay(corporate.features,corporate.report,{now});
 assert.equal(c.windows[1].corporateActionUnresolved,1);
 assert.equal(c.windows[1].observedSignals,5);
});
test('same stock repeated signals never masquerade as two independent industry samples',()=>{
 const x=episode(0,{duplicates:true});
 const report=auditOneDay(x.features,x.report,{now});
 assert.equal(report.windows[1].duplicateSignalsExcluded,2);
 assert.equal(report.windows[1].uniqueSignals,5);
 assert.equal(report.windows[1].observedSignals,5);
 assert.equal(report.windows[1].factorIC.sector_heat.neutralSamples,5);
 assert.equal(report.windows[1].factorIC.sector_heat.industryGroups,2);
});
test('future price evidence and invalid status are rejected rather than used for factor evaluation',()=>{
 const x=episode(0,{last:5});
 const advanced=structuredClone(x.report);
 advanced.records[0].windows[2].status='observed';
 advanced.records[0].windows[2].priceReturnPct=5;
 assert.throws(()=>auditOneDay(x.features,advanced,{now}),/未来交易日/);
 const zero=structuredClone(x.report);
 zero.records[0].windows[1].status='missing-or-suspended';
 zero.records[0].windows[1].priceReturnPct=0;
 assert.throws(()=>auditOneDay(x.features,zero,{now}),/未成熟记录|不能填零|缺少/);
 const target=structuredClone(x.report);
 target.records[1].windows[0].targetDate=dates[0];
 assert.throws(()=>auditOneDay(x.features,target,{now}),/目标日期/);
});
test('15 different signal days permit descriptive four-horizon comparison, never automatic promotion',()=>{
 const inputs=Array.from({length:15},(_,i)=>episode(i,{flipH20:true}));
 const r=auditFactorHorizonSeries(inputs,{now});
 assert.equal(r.batchCount,15);
 assert.equal(r.windows.length,4);
 assert.equal(r.minimumDays,15);
 assert.ok(r.windows.every(w=>w.observedSignals===90));
 assert.equal(r.windows[0].factors.sector_heat.industryNeutralICDays,15);
 assert.equal(r.windows[3].factors.sector_heat.industryNeutralStatus,'descriptive-only');
 assert.equal(r.consistency.sector_heat.status,'mixed-horizon-directions');
 assert.equal(r.consistency.sector_heat.safeForAutomaticProductionPromotion,false);
 assert.equal(r.autoPromotion,false);
 assert.equal(r.weightsChanged,false);
 assert.equal(r.verifiedLive,false);
 const {fingerprint,...body}=r;
 assert.equal(fingerprint,hash(body));
});
test('insufficient mature independent days cannot be misreported as multi-horizon success',()=>{
 const records=Array.from({length:6},(_,i)=>episode(i,{last:5}));
 const r=auditFactorHorizonSeries(records,{now});
 for(const w of r.windows.slice(2)){
  assert.equal(w.factors.sector_heat.industryNeutralICDays,0);
  assert.equal(w.factors.sector_heat.meanIndustryNeutralIC,null);
 }
 assert.equal(r.consistency.sector_heat.status,'insufficient-multi-horizon-industry-evidence');
 assert.throws(()=>auditFactorHorizonSeries([records[0],records[0]],{now}),
  /重复计算/);
});
test('verified point-in-time industry and factor source is required, and tampered freeze is rejected',()=>{
 const x=episode();
 const {fingerprint,...body}=x.features;
 const changed=structuredClone(x.features);
 changed.features[0].industry.code='SW_CHANGED';
 assert.throws(()=>auditOneDay(changed,x.report,{now}),/指纹/);
 const tampered=structuredClone(x.features);
 tampered.features[0].industry.observedAt+=86400000;
 tampered.fingerprint=hash((({fingerprint,...rest})=>rest)(tampered));
 assert.throws(()=>auditOneDay(tampered,x.report,{now}),/行业分类/);
 assert.equal(fingerprint,hash(body));
});
test('offline archived price evidence produces an append-only private research report, never trades',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-neutral-horizon-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const x=episode(),day=x.features.signalDay;
 const captures=path.join(dir,'private','captures'),
  tracking=path.join(dir,'private','tracking'),out=path.join(dir,'private','reports');
 fs.mkdirSync(captures,{recursive:true});
 const receipt={schemaVersion:1,mode:'causal-factor-eod-capture-receipt',
  signalDay:day,createdAt:x.cohort.frozenAt,
  inputFingerprint:'a'.repeat(64),
  cohortFingerprint:x.cohort.fingerprint,
  featureFingerprint:x.features.fingerprint,canTrade:false};
 fs.writeFileSync(path.join(captures,'cohort-'+day+'.json'),JSON.stringify(x.cohort));
 fs.writeFileSync(path.join(captures,'features-'+day+'.json'),JSON.stringify(x.features));
 fs.writeFileSync(path.join(captures,'receipt-'+day+'.json'),
  JSON.stringify({...receipt,integrity:hash(receipt)}));
 trackOnce({cohort:x.cohort,market:x.market,
  stateFile:path.join(tracking,day,'current.json'),now:at(x.market.asOf,'16:04:00')});
 const first=auditOnce({captureDir:captures,trackingDir:tracking,outDir:out,now});
 assert.equal(first.status,'research-audit-written');
 assert.equal(first.batchCount,1);
 assert.equal(first.periods[3].observedSignals,6);
 const files=fs.readdirSync(out);
 assert.equal(files.length,1);
 assert.equal(fs.statSync(path.join(out,files[0])).mode&0o777,0o600);
 const stored=JSON.parse(fs.readFileSync(path.join(out,files[0]),'utf8'));
 const {fingerprint,...payload}=stored;
 assert.equal(fingerprint,hash(payload));
 assert.equal(stored.windows[0].factors.sector_heat.industryNeutralStatus,
  'insufficient-independent-days');
 const again=auditOnce({captureDir:captures,trackingDir:tracking,outDir:out,now});
 assert.equal(again.status,'unchanged');
 assert.equal(fs.readdirSync(out).length,1);
 assert.throws(()=>parse(['once',captures,tracking,
  path.join(dir,'public','report')]),/公开/);
 const alias=path.join(dir,'alias');
 fs.symlinkSync(out,alias);
 assert.throws(()=>parse(['once',captures,tracking,alias]),/符号链接/);
});
