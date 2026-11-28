'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseFinancials}=require('../src/core/public-stock-financials');
const {fundamentalEvidence,liquidityEvidence,riskEvidence,enrichDecisionEvidence,createDecisionFinancialReader}=require('../src/core/decision-evidence');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00'),receivedAt=Date.parse('2026-11-20T10:00:00+08:00'),code='600000';
function financialCapture(patch={}){
 const record=(date,roe)=>({SECURITY_CODE:code,SECUCODE:code+'.SH',CURRENCY:'CNY',REPORT_DATE:date,
  NOTICE_DATE:date==='2025-09-30'?'2025-10-30':'2026-10-30',UPDATE_DATE:'2026-10-30',ROEJQ:roe,ZCFZL:40,PARENTNETPROFITTZ:20,TOTALOPERATEREVETZ:10,...patch});
 const rows=[record('2025-09-30',10),record('2026-09-30',12)];
 const periodRaw=Buffer.from(JSON.stringify({success:true,result:{data:rows}})),quarterRaw=Buffer.from(JSON.stringify({success:true,result:{data:[rows[1]]}}));
 const period=parseFinancials(periodRaw,{symbol:code,kind:'period',receivedAt});
 const quarter=parseFinancials(quarterRaw,{symbol:code,kind:'quarter',receivedAt:receivedAt+1000,period});
 const originals=[{set:period,raw:periodRaw},{set:quarter,raw:quarterRaw}];
 return {data:{symbol:code,source:'eastmoney-financials',datasets:{period,quarter}},originals,
  sourceRefs:originals.map(({set,raw})=>({sha256:set.rawHash,source:set.source,receivedAt:set.receivedAt,byteLength:raw.length,url:null}))};
}
const financials=patch=>financialCapture(patch).data;
function writeOriginals(observationRoot,capture){
 const dir=path.join(observationRoot,'source-responses');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 for(const {set,raw}of capture.originals)fs.writeFileSync(path.join(dir,set.rawHash+'.json'),raw,{mode:0o600});
}
const quote=patch=>({code,poolDay:day,price:10,amount:1e8,quoteAt:now-1000,receivedAt:now-500,
 quoteSource:'tencent',quoteMode:'public-live-unverified',levels:{stop:9.5},
 levelsEvidence:{source:'tencent-qfq',sourceAt:now-60000,quoteAt:now-1000},...patch});
const account={equity:100000,cash:100000,executionPolicy:{allocationPct:19.6}};
const accountEvidence={kind:'server-account-snapshot',source:'原账户',sourceAt:now};
test('financial bridge evaluates frozen actual report features without changing their receipt clocks',()=>{
 const data=financials(),before=JSON.stringify(data),value=fundamentalEvidence(data,{code,day,now});
 assert.equal(value.value,100);assert.equal(value.knownAt,receivedAt+1000);assert.notEqual(value.knownAt,now);
 assert.equal(value.reportDate,'2026-09-30');assert.equal(value.rules.length,4);assert.match(value.reason,/12%.*10%/);
 assert.equal(value.inputs.find(x=>x.field==='roePriorYearPct').reportDate,'2025-09-30');
 assert.equal(value.sourceTimes.length,4);assert.equal(value.canTrade,false);assert.equal(value.calibrationCertified,false);
 assert.equal(JSON.stringify(data),before);
});
test('missing, future, mismatched, stale and synthetic financial features never receive a partial perfect score',()=>{
 const data=financials();
 for(const change of [v=>v.symbol='000001',v=>v.mock=true,v=>v.datasets.period.fixture=true,
  v=>delete v.datasets.quarter,v=>v.datasets.quarter.receivedAt=now+1,
  v=>v.datasets.quarter.records[0].reportDate='2026-06-30',v=>v.datasets.period.records[1].values.ROEJQ=null]){
  const next=structuredClone(data);change(next);assert.equal(fundamentalEvidence(next,{code,day,now}).value,null);
 }
 assert.equal(fundamentalEvidence(data,{code,day:'2027-06-01',now:Date.parse('2027-06-01T10:00:00+08:00')}).value,null);
 assert.equal(fundamentalEvidence(data,{code,day,now:receivedAt-1}).value,null);
});
test('actual zero and negative financial values are assessed as values rather than missing data',()=>{
 const zero=fundamentalEvidence(financials({ROEJQ:0,PARENTNETPROFITTZ:0,TOTALOPERATEREVETZ:0}),{code,day,now});
 assert.equal(zero.value,75);assert.deepEqual(zero.missing,[]);
 const negative=fundamentalEvidence(financials({ROEJQ:-5,PARENTNETPROFITTZ:-20,TOTALOPERATEREVETZ:-10}),{code,day,now});
 assert.equal(negative.value,25);
});
test('liquidity keeps quote source time and known zero while rejecting missing units or wrong dates',()=>{
 const value=liquidityEvidence(quote(),{day,now});assert.ok(value.value>66&&value.value<67);assert.equal(value.sourceAt,now-1000);
 assert.equal(liquidityEvidence(quote({amount:0}),{day,now}).value,0);
 for(const patch of [{amount:null},{amount:-1},{quoteAt:now+1},{receivedAt:null},{poolDay:'2026-11-24'},
  {quoteSource:'unknown'},{amountUnit:'USD'},{synthetic:true}])assert.equal(liquidityEvidence(quote(patch),{day,now}).value,null);
});
test('risk score traces the original plan and account and disclaims gap and T+1 execution risk',()=>{
 const inputs={day,now,account,accountEvidence};
 const result=riskEvidence(quote(),inputs);assert.equal(result.inputs.accountLossPct,.98);assert.equal(result.value,75.5);
 assert.match(result.reason,/T\+1.*不是亏损上限/);assert.equal(result.sourceTimes.length,3);
 assert.equal(riskEvidence(quote(),{...inputs,accountEvidence:{...accountEvidence,sourceAt:now-15001}}).value,null);
 assert.equal(riskEvidence(quote({levels:{stop:11}}),inputs).value,null);
 const row=quote(),before=JSON.stringify(row),enriched=enrichDecisionEvidence(row,{...inputs,financials:financials()});
 assert.equal(enriched.factorScores.fundamental.value,100);assert.equal(enriched.factorScores.liquidity.sourceAt,now-1000);
 assert.equal(JSON.stringify(row),before);
});
test('archive reader requires both dataset source references, fails on corruption and bounds cached reads',()=>{
 const capture=financialCapture(),data=capture.data,bundle={symbol:code,decisionAt:receivedAt+2000,marketContext:{financials:data},sourceRefs:capture.sourceRefs};
 let calls=0,rawCalls=0;const reader=createDecisionFinancialReader({evidenceRoot:'/private/research',clock:()=>now,
  readRaw:()=>{rawCalls++;return true;},readBundle:(_root,{provider})=>{calls++;return provider==='eastmoney'?bundle:null;}});
 assert.equal(reader.read([code]).byCode[code].datasets.period.rawHash,data.datasets.period.rawHash);assert.equal(calls,2);assert.equal(rawCalls,2);
 reader.read([code]);assert.equal(calls,2);assert.equal(rawCalls,2);reader.invalidate(code);reader.read([code]);assert.equal(calls,4);assert.equal(rawCalls,4);
 for(const readBundle of [()=>({...bundle,sourceRefs:[]}),()=>{throw Error('corrupt');},()=>({...bundle,symbol:'000001'})]){
  const blocked=createDecisionFinancialReader({evidenceRoot:'/private/research',readBundle,readRaw:()=>true}).read([code],{now});
  assert.equal(blocked.byCode[code],undefined);assert.match(blocked.missingByCode[code],/校验未通过/);
 }
});
test('a later capture without financials cannot hide an archived report; as-of, identity, stale-report and full-chain corruption checks remain',()=>{
 const {freezeResearchEvidenceBundle:freeze,readResearchEvidenceBundle:read,readResearchFinancialEvidenceBundle:readFinancial}=require('../src/core/research-evidence-bundle');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'decision-financial-reader-'));
 const clock=(at,fn)=>{const original=Date.now;Date.now=()=>at;try{return fn();}finally{Date.now=original;}};
 try{
  const capture=financialCapture(),data=capture.data,observationRoot=path.join(root,'observations');writeOriginals(observationRoot,capture);
  const base={symbol:code,provider:'eastmoney',priceBasis:'unadjusted',observationHash:'a'.repeat(64),
   decisionAt:now-3000,marketContext:{financials:data},trigger:'financial-research',
   sourceRefs:capture.sourceRefs};
  const first=clock(now-2000,()=>freeze(root,base));
  const later=clock(now,()=>freeze(root,{...base,decisionAt:now-1000,marketContext:{source:'tencent',observedAt:now-1000},trigger:'price-only-research'}));
  assert.equal(read(root,{symbol:code,provider:'eastmoney',asOf:now}).hash,later.hash,'ordinary archive reads retain their latest-context behavior');
  assert.equal(readFinancial(root,{symbol:code,provider:'eastmoney',asOf:now}).hash,first.hash);
  assert.equal(readFinancial(root,{symbol:code,provider:'eastmoney',asOf:now-2001}),null,'later receipts cannot be read as historical evidence');
  assert.equal(readFinancial(root,{symbol:code,provider:'eastmoney',hash:later.hash,asOf:now}),null,'an explicit non-financial hash never falls back to another record');
  assert.equal(readFinancial(root,{symbol:'600001',provider:'eastmoney',hash:first.hash,asOf:now}),null);
  assert.equal(readFinancial(root,{symbol:code,provider:'tencent',hash:first.hash,asOf:now}),null);
  const reader=createDecisionFinancialReader({evidenceRoot:root,observationRoot,clock:()=>now});
  const original=reader.read([code]).byCode[code];assert.equal(original.datasets.period.rawHash,data.datasets.period.rawHash);
  assert.equal(fundamentalEvidence(original,{code,day:'2027-06-01',now:Date.parse('2027-06-01T10:00:00+08:00')}).score,null,'archive availability cannot revive an expired report');
  const file=fs.readdirSync(root,{recursive:true}).find(name=>name.endsWith('/'+later.hash+'.json'));
  assert.ok(file);const corrupted=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  corrupted.marketContext.source='rewritten';fs.writeFileSync(path.join(root,file),JSON.stringify(corrupted));
  assert.throws(()=>readFinancial(root,{symbol:code,provider:'eastmoney',hash:first.hash,asOf:now-2000}),/校验/,'even a later, nonfinancial, invisible record is checked for corruption');
  reader.invalidate(code);assert.equal(reader.read([code]).byCode[code],undefined);
  assert.match(reader.read([code]).missingByCode[code],/完整性/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('financial reader verifies both original private raw files and rejects deletion, corruption, links and open permissions after cache expiry',()=>{
 const {freezeResearchEvidenceBundle:freeze}=require('../src/core/research-evidence-bundle');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'decision-financial-raw-')),observationRoot=path.join(root,'observations');
 const capture=financialCapture(),base={symbol:code,provider:'eastmoney',priceBasis:'unadjusted',observationHash:'a'.repeat(64),
  decisionAt:now-1000,marketContext:{financials:capture.data},trigger:'financial-research',sourceRefs:capture.sourceRefs};
 const originalClock=Date.now;
 try{
  writeOriginals(observationRoot,capture);Date.now=()=>now;freeze(root,base);Date.now=originalClock;
  const reader=createDecisionFinancialReader({evidenceRoot:root,observationRoot,clock:()=>now});
  const file=path.join(observationRoot,'source-responses',capture.data.datasets.period.rawHash+'.json');
  assert.ok(reader.read([code]).byCode[code]);fs.unlinkSync(file);
  assert.ok(reader.read([code],{now:now+29999}).byCode[code],'original-byte verification is cached for at most 30 seconds');
  const missing=reader.read([code],{now:now+30000});assert.equal(missing.byCode[code],undefined);assert.match(missing.missingByCode[code],/文件或私有目录缺失/);
  writeOriginals(observationRoot,capture);reader.invalidate(code);assert.ok(reader.read([code]).byCode[code]);
  for(const {set,raw}of capture.originals){
   const target=path.join(observationRoot,'source-responses',set.rawHash+'.json'),corrupted=Buffer.from(raw);corrupted[0]^=1;
   fs.writeFileSync(target,corrupted);reader.invalidate(code);
   const result=reader.read([code]);assert.equal(result.byCode[code],undefined);assert.match(result.missingByCode[code],/SHA256/);
   fs.writeFileSync(target,raw);reader.invalidate(code);assert.ok(reader.read([code]).byCode[code]);
  }
  fs.writeFileSync(file,capture.originals[0].raw.subarray(1));reader.invalidate(code);
  assert.match(reader.read([code]).missingByCode[code],/尺寸/);writeOriginals(observationRoot,capture);
  const replacement=path.join(root,'identical-original.json');fs.writeFileSync(replacement,capture.originals[0].raw,{mode:0o600});
  fs.unlinkSync(file);fs.symlinkSync(replacement,file);reader.invalidate(code);
  assert.match(reader.read([code]).missingByCode[code],/软链接/);fs.unlinkSync(file);writeOriginals(observationRoot,capture);
  const dir=path.join(observationRoot,'source-responses'),moved=path.join(observationRoot,'original-responses');
  fs.renameSync(dir,moved);fs.symlinkSync(moved,dir);reader.invalidate(code);
  assert.match(reader.read([code]).missingByCode[code],/软链接/);fs.unlinkSync(dir);fs.renameSync(moved,dir);
  fs.chmodSync(file,0o644);reader.invalidate(code);assert.match(reader.read([code]).missingByCode[code],/私有权限/);fs.chmodSync(file,0o600);
  fs.chmodSync(dir,0o755);reader.invalidate(code);assert.match(reader.read([code]).missingByCode[code],/私有权限/);fs.chmodSync(dir,0o700);
  reader.invalidate(code);assert.ok(reader.read([code]).byCode[code]);
  const noRoot=createDecisionFinancialReader({evidenceRoot:root,clock:()=>now}).read([code]);
  assert.equal(noRoot.byCode[code],undefined);assert.match(noRoot.missingByCode[code],/目录未配置/);
  assert.deepEqual(fs.readFileSync(file),capture.originals[0].raw,'the reader never repairs or rewrites original receipts');
 }finally{Date.now=originalClock;fs.rmSync(root,{recursive:true,force:true});}
});
test('real receipt bridge reaches all four council views and all nine radar axes through the decision center',async()=>{
 const row=quote({score:85,paths:['趋势成立'],pathWhy:{趋势成立:'原均线规则'},canTrade:true,canNotify:true,
  levels:{ma5:9.8,stop:9.5,t1:11},baziDims:{trend:82,fund:78,position:75,support:70},baziWhy:{trend:'均线原条件成立'},
  bazi:{fundsEvidence:{observed:true,net:2e6,source:'eastmoney',sourceTimestamp:now-1000,method:'vendor-order-size-estimate'}}});
 const input={pool:[row],poolDay:day,trading:true,marketClock:{day,trading:true},
  decisionAccountEvidence:accountEvidence,paper:{pool:{...account,enabled:true,positions:[]}},
  decisionFinancials:{byCode:{[code]:financials()}},
  decisionLevels:{[code]:{levels:row.levels,source:'tencent',sourceAt:now-60000,throughDay:day,asOf:now,quoteAt:row.quoteAt,adjustment:'qfq'}},
  marketDistribution:{kind:'market-distribution-intraday',source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',day,
   quoteAt:now-10000,knownAt:now-9000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
  dabanke:{day,knownAt:now-9000,ecology:[{label:'当日封板',success:70,total:90}]}};
 const decision=await require('../src/core/decision-center').buildDecisionCenter(input,{now});
 assert.equal(decision.cards.length,1);assert.equal(decision.cards[0].council.assessed,4);assert.equal(decision.cards[0].council.llmInvoked,false);
 const visual=require('../src/core/intelligence-visuals').buildIntelligenceVisuals({candidatePool:[row]},decision,{day,now,code});
 assert.equal(visual.radar.known,9);assert.equal(visual.radar.axes.find(a=>a.id==='fundamental').knownAt,receivedAt+1000);
 assert.match(visual.radar.axes.find(a=>a.id==='risk').formula,/25/);
 const noFinancial=await require('../src/core/decision-center').buildDecisionCenter({...input,decisionFinancials:null},{now});
 assert.equal(noFinancial.cards[0].council.assessed,3);assert.equal(noFinancial.cards[0].council.views[0].score,null);
});

 
// F19.1: local, synthetic disclosure fixtures, not provider or investment evidence.
function seasonalFinancials(current,prior,priorDate='2025-09-30'){
 const rawRow=(reportDate,value,roe)=>({SECURITY_CODE:code,SECUCODE:code+'.SH',CURRENCY:'CNY',
  REPORT_DATE:reportDate,NOTICE_DATE:'2026-10-30',UPDATE_DATE:'2026-10-30',
  ROEJQ:roe,ZCFZL:40,PARENTNETPROFITTZ:20,TOTALOPERATEREVETZ:10,MGJYXJJE:value});
 const rows=[rawRow(priorDate,prior,10),rawRow('2026-09-30',current,12)];
 const bytes=data=>Buffer.from(JSON.stringify({success:true,result:{data}}));
 const period=parseFinancials(bytes(rows),{symbol:code,kind:'period',receivedAt});
 const quarter=parseFinancials(bytes([rows[1]]),{symbol:code,kind:'quarter',receivedAt:receivedAt+1000,period});
 return {symbol:code,source:'eastmoney-financials',datasets:{period,quarter}};
}
test('F19.1 preserves cash-flow same-period values, receipt and raw identity without changing four-rule score',()=>{
 const data=seasonalFinancials(1.25,.75),before=JSON.stringify(data);
 const result=fundamentalEvidence(data,{code,day,now}),cash=result.seasonalCash;
 assert.equal(result.score,100);assert.equal(result.rules.length,4);assert.equal(result.sourceTimes.length,4);
 assert.equal(cash.status,'observed-unverified');assert.equal(cash.current.value,1.25);assert.equal(cash.prior.value,.75);
 assert.equal(cash.differenceCnyPerShare,.5);assert.equal(cash.knownAt,receivedAt);
 assert.equal(cash.current.evidenceId.split(':')[0],data.datasets.period.rawHash);
 assert.equal(cash.prior.reportDate,'2025-09-30');assert.equal(cash.initialDisclosureVerified,false);
 assert.equal(cash.industryComparison,null);assert.equal(cash.orderEvidence,null);
 assert.equal(cash.canTrade,false);assert.equal(cash.canTrain,false);assert.equal(cash.canNotify,false);
 assert.equal(JSON.stringify(data),before);
 const enriched=enrichDecisionEvidence(quote(),{financials:data,code,day,now,account,accountEvidence});
 assert.deepEqual(enriched.fundamentalEvidence.seasonalCash,cash);
 assert.deepEqual(enriched.factorScores.fundamental.seasonalCash,cash);
});
test('F19.1 treats zero and negative cash flow as observed values rather than missing or growth ratios',()=>{
 const cash=fundamentalEvidence(seasonalFinancials(-.5,0),{code,day,now}).seasonalCash;
 assert.equal(cash.status,'observed-unverified');assert.equal(cash.prior.value,0);assert.equal(cash.differenceCnyPerShare,-.5);
});
test('F19.1 leaves missing, invalid and nonmatching quarters unknown without substituting zeros',()=>{
 for(const data of [seasonalFinancials(null,1),seasonalFinancials(1,null),seasonalFinancials('1',0),seasonalFinancials(1,0,'2025-06-30')]){
  const cash=fundamentalEvidence(data,{code,day,now}).seasonalCash;
  assert.equal(cash.status,'unknown');assert.equal(cash.differenceCnyPerShare,null);assert.equal(cash.knownAt,null);
 }
});
test('F19.1 refuses future receipt, stale or wrong day, synthetic or withdrawn evidence',()=>{
 const data=seasonalFinancials(1,.5);
 const cases=[{data,day,now:receivedAt-1},{data,day:'2027-06-01',now:Date.parse('2027-06-01T10:00:00+08:00')},
  {data,day:'2026-11-24',now},{data:{...data,simulated:true},day,now},{data:{...data,retracted:true},day,now},
  {data:{...data,datasets:{...data.datasets,period:{...data.datasets.period,fixture:true}}},day,now}];
 for(const c of cases)assert.equal(fundamentalEvidence(c.data,{code,day:c.day,now:c.now}).seasonalCash.status,'unknown');
});

test('F19.3/4 same-period turnover and margin evidence retains units and explicit deterioration without invented industry or valuation',()=>{
 const make=(period,margin,net,inventory,receivables)=>({SECURITY_CODE:code,SECUCODE:code+'.SH',CURRENCY:'CNY',REPORT_DATE:period,
  NOTICE_DATE:'2026-10-30',UPDATE_DATE:'2026-10-30',ROEJQ:10,ZCFZL:40,XSMLL:margin,XSJLL:net,CHZZTS:inventory,YSZKZZTS:receivables});
 const a=make('2025-09-30',20,10,40,30),b=make('2026-09-30',15,5,60,0);
 const period=parseFinancials(Buffer.from(JSON.stringify({success:true,result:{data:[a,b]}})),{symbol:code,kind:'period',receivedAt});
 const data={symbol:code,source:'eastmoney-financials',datasets:{period}},before=JSON.stringify(data);
 const r=fundamentalEvidence(data,{code,day,now}),v=r.operatingResearch;
 assert.equal(v.status,'company-observations-only');assert.deepEqual(v.rows.map(x=>[x.field,x.unit,x.delta]),
  [['grossMarginPct','percent',-5],['netMarginPct','percent',-5],['receivableDays','days',-30],['inventoryDays','days',20]]);
 assert.equal(v.valuationDivergence.samePeriodMarginsBothLower,true);
 assert.equal(v.valuationDivergence.persistentDeterioration,null);assert.equal(v.valuationDivergence.peerValuation,null);
 assert.equal(v.industryDemand.value,null);assert.equal(v.earningsGuidance.consensusExpectation,null);assert.equal(v.canTrade,false);
 assert.equal(r.score,null);assert.equal(JSON.stringify(data),before);
 const wrong=structuredClone(data);wrong.datasets.period.records[0].reportDate='2025-06-30';
 assert.ok(fundamentalEvidence(wrong,{code,day,now}).operatingResearch.rows.every(x=>x.delta===null));
 const missing=structuredClone(data);missing.datasets.period.records[1].values.CHZZTS=-1;
 assert.equal(fundamentalEvidence(missing,{code,day,now}).operatingResearch.rows.find(x=>x.field==='inventoryDays').status,'unknown');
 assert.equal(fundamentalEvidence({...data,retracted:true},{code,day,now}).operatingResearch.status,'unknown');
});
