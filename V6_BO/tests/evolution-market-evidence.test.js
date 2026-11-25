'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {VERSION,evaluateMarketFactorGain:gain,buildRelativeStrengthEvidence:relative,buildMultiTimeframeEvidence:multi,buildFinancialHealthEvidence:financial,reviewSignalValidity:validity,buildEvolutionMarketEvidence:bundle}=require('../src/core/evolution-market-evidence');
const {parseFinancials,financialFeatures}=require('../src/core/public-stock-financials');
const t=s=>Date.parse(s+'+08:00');
const close=day=>t(day+'T15:00:00');
const bar=(date,price,extra={})=>({code:'600000',date,open:price,high:price+1,low:price-1,close:price,volume:1000,source:'verified-archive-unit-case',knownAt:close(date.slice(0,10)),availableAt:date,priceBasis:'unadjusted',...extra});
const dates=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20'];
const stocks=dates.map((d,i)=>bar(d,10+i,{sector:'S1',indexCode:'IX'}));
const index=dates.map((d,i)=>bar(d,100-i,{code:'IX',role:'index'}));

test('31 compares exactly aligned source windows and keeps versioned independent gain inputs',()=>{
 const r=relative({archive:{bars:[...stocks,...index]},code:'600000',asOf:'2026-11-20',windows:[1,4]});
 assert.equal(r.comparisons.length,2);assert.equal(r.comparisons[1].stockReturnPct,40);assert.equal(r.comparisons[1].benchmarkReturnPct,-4);assert.equal(r.comparisons[1].excessPct,44);
 assert.ok(r.comparisons[1].tags.includes('逆势走强'));assert.ok(r.missing.includes('行业同窗基准'));assert.equal(r.factors.length,2);
 assert.equal(r.independentGain.status,'not-evaluated');assert.equal(r.factors[1].knownAt,close('2026-11-20'));assert.equal(r.canTrade,false);
 const earlier=relative({archive:{bars:[...stocks,...index]},code:'600000',asOf:'2026-11-19',windows:[1]});
 const perturbed=relative({archive:{bars:[...stocks.map(r=>r.date>'2026-11-19'?{...r,close:999}:r),...index]},code:'600000',asOf:'2026-11-19',windows:[1]});
 assert.deepEqual(earlier,perturbed);
});
test('31 rejects mismatched dates, price basis, missing receipts and unknown membership',()=>{
 const options={code:'600000',asOf:'2026-11-20',windows:[4]};
 const noDate=relative({...options,archive:{bars:[...stocks,...index.filter(r=>r.date!=='2026-11-18')]}});
 assert.equal(noDate.comparisons[0].status,'unknown');assert.equal(noDate.comparisons[0].excessPct,null);
 const wrongBasis=relative({...options,archive:{bars:[...stocks,...index.map(r=>({...r,priceBasis:'forward-adjusted'}))]}});assert.equal(wrongBasis.factors.length,0);
 assert.equal(relative({...options,archive:{bars:stocks.map(({knownAt,...r})=>r)}}).status,'unknown');
 const noMembership=relative({...options,archive:{bars:stocks},benchmarks:[{kind:'sector',id:'S1',bars:index}]});assert.equal(noMembership.comparisons[0].status,'unknown');
 assert.equal(relative({...options,code:''}).status,'unknown');assert.equal(relative({...options,asOf:'2026-02-30 15:00'}).status,'unknown');
 const forged=relative({...options,windows:[1],archive:{bars:[...stocks,...index,bar('2026-11-25',999,{knownAt:close('2026-11-20'),availableAt:'2026-11-20'})]}});
 assert.equal(forged.comparisons[0].to,'2026-11-20');
});
test('31 retains all explicit benchmark kinds and rejects same-time conflicting revisions',()=>{
 const specs=['market','industry','sector','theme'].map(kind=>({kind,id:kind,bars:index,membershipKnownAt:close(dates[0])}));
 const r=relative({archive:{bars:stocks},code:'600000',asOf:dates.at(-1),benchmarks:specs,windows:[4]});assert.equal(r.status,'observed-research-only');assert.equal(r.comparisons.length,4);
 const conflict=relative({archive:{bars:[...stocks,{...stocks[1],close:900,high:901},...index]},code:'600000',asOf:dates.at(-1),windows:[4]});assert.equal(conflict.factors.length,0);assert.ok(conflict.missing.some(s=>s.includes('冲突')));
});
test('31 independent gain comparison pairs frozen, mature, nonoverlapping out-of-sample returns',()=>{
 const samples=Array.from({length:6},(_,i)=>{const day='2026-11-'+String(i+10).padStart(2,'0');return {id:'case'+i,source:'settlement-archive-unit-case',factorVersion:VERSION,evidenceHash:'a'.repeat(64),decisionAt:t(day+'T09:20:00'),frozenAt:t(day+'T09:19:00'),entryAt:t(day+'T09:30:00'),exitAt:t(day+'T15:00:00'),knownAt:t(day+'T15:01:00'),trainingEnd:close('2026-10-20'),testStart:close('2026-11-01'),baselineNetReturnPct:i%2?-2:1,enhancedNetReturnPct:i%2?-1:2,feeBps:8,slippageBps:10,costIncluded:true};});
 const r=gain({samples,asOf:'2026-11-20',minSamples:5});assert.equal(r.status,'evaluated');assert.equal(r.n,6);assert.equal(r.difference.meanNetReturnPct,1);assert.ok(r.difference.settledMaxDrawdownPct<0);assert.equal(r.autoPromotion,false);
 const bad=[{...samples[0],id:'late',knownAt:close('2026-11-21')},{...samples[1],id:'leak',trainingEnd:close('2026-11-20')},{...samples[2],id:'nocost',costIncluded:false},{...samples[3],id:'test',sampleSet:'test'}];
 const no=gain({samples:bad,asOf:'2026-11-20'});assert.equal(no.status,'not-evaluated');assert.equal(no.excluded.length,4);
 const duplicate=gain({samples:[...samples,samples[0]],asOf:'2026-11-20',minSamples:5});assert.equal(duplicate.n,6);assert.equal(duplicate.excluded[0].reason,'重复样本');
});
test('33 incomplete current weekly/monthly bars do not masquerade as closed evidence',()=>{
 const rows=[bar('2026-11-18',11,{period:'周K',closed:true}),bar('2026-11-18',11,{period:'月K',closed:true}),bar('2026-11-18',11)];
 const r=multi({archive:{bars:rows},code:'600000',asOf:'2026-11-18'});
 assert.equal(r.frames.find(f=>f.period==='day').status,'closed');assert.equal(r.frames.find(f=>f.period==='week').status,'unknown');assert.equal(r.frames.find(f=>f.period==='month').status,'unknown');
 assert.deepEqual(r.frames.find(f=>f.period==='week').incompleteCycles,['2026-11-16','2026-11-18']);assert.equal(r.canTrade,false);
});
test('33 derives complete weeks only with contemporaneous complete calendar and reveals direction conflicts',()=>{
 const calendar={source:'exchange-calendar-unit-case',knownAt:close('2026-01-01'),from:'2026-11-01',to:'2026-11-30',tradeDates:dates};
 const minute=bar('2026-11-20 14:59',12,{period:'1分钟',knownAt:t('2026-11-20T14:59:00'),open:14,high:15});
 const r=multi({archive:{bars:[...stocks,minute]},code:'600000',asOf:'2026-11-20',calendar});
 const week=r.frames.find(f=>f.period==='week');assert.equal(week.status,'closed');assert.equal(week.latest.derived,true);assert.equal(week.latest.evidence.length,5);assert.equal(week.latest.open,10);assert.equal(week.latest.close,14);
 assert.ok(r.conflicts.some(c=>c.periods.includes('minute')&&c.periods.includes('week')));
 const gap=multi({archive:{bars:stocks.filter(r=>r.date!==dates[2])},code:'600000',asOf:'2026-11-20',calendar});assert.equal(gap.frames.find(f=>f.period==='week').status,'unknown');
 const late=multi({archive:{bars:stocks},code:'600000',asOf:'2026-11-20',calendar:{...calendar,knownAt:close('2026-11-21')}});assert.equal(late.frames.find(f=>f.period==='week').status,'unknown');
});
test('33 never mixes minute cadences or uses future bars to determine current direction',()=>{
 const bars=[bar('2026-11-20 10:00',10,{period:'1分钟',knownAt:t('2026-11-20T10:00:00')}),bar('2026-11-20 10:01',11,{period:'1分钟',knownAt:t('2026-11-20T10:01:00')}),bar('2026-11-20 10:00',100,{period:'5分钟',knownAt:t('2026-11-20T10:00:00')}),bar('2026-11-20 10:02',1,{period:'1分钟',knownAt:t('2026-11-20T10:02:00')})];
 const f=multi({archive:{bars},code:'600000',asOf:'2026-11-20 10:01'}).frames[0];assert.equal(f.sourcePeriod,'1分钟');assert.equal(f.direction,'up');assert.equal(f.latest.close,11);
});
test('31 and 33 evidence fingerprints bind numeric inputs and both closed comparison cycles',()=>{
 const input={archive:{bars:[...stocks,...index]},code:'600000',asOf:'2026-11-20'};
 const before=relative({...input,windows:[1]}),changed=structuredClone(input);
 changed.archive.bars.find(b=>b.code==='600000'&&b.date==='2026-11-19').close=12;
 assert.notEqual(relative({...changed,windows:[1]}).factors[0].evidenceHash,before.factors[0].evidenceHash);
 const day=r=>r.frames.find(f=>f.period==='day'),a=multi(input),b=multi(changed);
 assert.equal(day(a).comparisonEvidence.length,2);assert.equal(day(a).latest.close,day(b).latest.close);
 assert.notEqual(a.factors.find(f=>f.code==='EV33_CLOSED_DAY_RETURN').evidenceHash,b.factors.find(f=>f.code==='EV33_CLOSED_DAY_RETURN').evidenceHash);
});
const financialRow=()=>({SECURITY_CODE:'600000',SECUCODE:'600000.SH',CURRENCY:'CNY',REPORT_DATE:'2026-09-30',NOTICE_DATE:'2026-10-30',UPDATE_DATE:'2026-10-30',ROEJQ:12,ZCFZL:40,XSMLL:20,XSJLL:8,EPSJB:0.8,MGJYXJJE:1.2,YSZKZZTS:35,CHZZTS:80,LD:1.5,SD:1.1,PARENTNETPROFITTZ:10,TOTALOPERATEREVETZ:4});
function finance(data,receivedAt){const raw=JSON.stringify({success:true,result:{data:[data]}}),period=parseFinancials(raw,{symbol:'600000',kind:'period',receivedAt}),quarter=parseFinancials(raw,{symbol:'600000',kind:'quarter',receivedAt,period});return {symbol:'600000',source:'eastmoney-financials',datasets:{period,quarter}};}
test('59 preserves optional field units and discloses all financial health gaps without altering radar',()=>{
 const at=t('2026-11-02T10:00:00'),f=finance(financialRow(),at),radar={axes:[{name:'现金流',value:null}]};
 const features=financialFeatures(f,{code:'600000',asOf:at});assert.equal(features.operatingCashPerShare.unit,'CNY/share');assert.equal(features.receivableDays.unit,'days');assert.equal(features.grossMarginPct.unit,'percent');assert.equal(features.operatingCashToProfit,undefined);
 const r=financial({financials:f,code:'600000',asOf:at,radar});assert.equal(r.coverage.observed,12);assert.equal(r.coverage.total,16);assert.equal(r.metrics.find(m=>m.id==='operatingCashToProfit').value,null);assert.deepEqual(r.existingRadar,radar);assert.equal(r.status,'partial');
 r.existingRadar.axes[0].value=5;assert.equal(radar.axes[0].value,null);assert.equal(financial({financials:f,code:'600000',asOf:at-1}).status,'unknown');
});
test('59 chooses the latest known revision for each report without leaking later restatements',()=>{
 const first=t('2026-11-02T10:00:00'),second=t('2026-11-05T10:00:00'),v1=finance(financialRow(),first),v2=finance({...financialRow(),ROEJQ:-4,UPDATE_DATE:'2026-11-04'},second);
 const before=financial({financials:{versions:[v2,v1]},code:'600000',asOf:second-1});assert.equal(before.metrics.find(m=>m.id==='roePct').value,12);
 const after=financial({financials:{versions:[v2,v1]},code:'600000',asOf:second});assert.equal(after.metrics.find(m=>m.id==='roePct').value,-4);assert.ok(after.risks.some(r=>r.id==='roePct'));assert.equal(after.metrics.find(m=>m.id==='roePct').evidence.recordedAt,second);
 assert.equal(financial({financials:{versions:[v1,{...v2,simulated:true}]},code:'600000',asOf:second}).metrics.find(m=>m.id==='roePct').value,12);
});
test('59 optional evidence requires disclosure, revision, receipt, units and identity',()=>{
 const at=t('2026-11-02T10:00:00'),e={code:'600000',value:0.5,unit:'ratio',source:'audited-report-unit-case',reportDate:'2026-09-30',publicationDate:'2026-10-30',updatedDate:'2026-10-30',recordedAt:at,availableAt:at,evidenceHash:'a'.repeat(64),revisionId:'r1'};
 const f={symbol:'600000',features:{operatingCashToProfit:e}},read=financials=>financial({financials,code:'600000',asOf:at}).metrics.find(m=>m.id==='operatingCashToProfit');
 assert.equal(read(f).value,.5);assert.ok(read(f).risk);
 for(const change of [{code:'000001'},{unit:'percent'},{recordedAt:at+1},{updatedDate:'2026-11-03'},{revisionId:''},{evidenceHash:''}])assert.equal(read({...f,features:{operatingCashToProfit:{...e,...change}}}).value,null);
});
test('60 expiry boundaries, evidence changes and revalidation preserve original execution gates',()=>{
 const at=t('2026-11-20T10:00:00'),signal={id:'s1',code:'600000',decisionAt:at-60000,expiresAt:at+60000,evidenceHash:'a'.repeat(64),settingsVersion:'v1'},e={code:'600000',source:'quote-archive-unit-case',observedAt:at-1000,knownAt:at,conditions:[{id:'condition',pass:true}],evidenceHash:'a'.repeat(64),settingsVersion:'v1'};
 assert.equal(validity({signal,latestEvidence:e,asOf:at}).status,'research-valid');
 assert.equal(validity({signal,latestEvidence:e,asOf:at+60000}).status,'expired');
 const newer={...e,evidenceHash:'b'.repeat(64)},r=validity({signal,latestEvidence:newer,asOf:at,revalidation:{signalId:'s1',evaluatedAt:at,evidenceHash:newer.evidenceHash,status:'pass'}});
 assert.equal(r.status,'requires-revalidation');assert.equal(r.revalidation.status,'research-revalidated');assert.equal(r.canTrade,false);assert.equal(r.revalidation.requiresOriginalExecutionGate,true);
 assert.equal(validity({signal,latestEvidence:{...e,conditions:[{id:'x',pass:false}]},asOf:at}).status,'requires-revalidation');
 assert.equal(validity({signal,latestEvidence:{...e,knownAt:at+1},asOf:at}).status,'requires-revalidation');
 assert.equal(validity({signal,latestEvidence:{...e,code:'000001'},asOf:at}).status,'requires-revalidation');
 assert.equal(validity({signal,latestEvidence:{...e,gate:{canTrade:false}},asOf:at}).status,'requires-revalidation');
 assert.equal(validity({signal:{...signal,evidenceHash:null},latestEvidence:e,asOf:at}).status,'requires-revalidation');
 assert.equal(validity({signal:{...signal,decisionAt:at+1},latestEvidence:e,asOf:at}).status,'unknown');
 assert.equal(bundle({code:'600000',asOf:at}).canTrade,false);
});
