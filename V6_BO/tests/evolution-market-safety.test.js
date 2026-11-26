'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildRelativeStrengthEvidence:relative,buildMultiTimeframeEvidence:multi,buildFinancialHealthEvidence:financial,reviewSignalValidity:validity,buildEvolutionMarketEvidence:bundle}=require('../src/core/evolution-market-evidence');
const {createShortlinePressureReader}=require('../src/research/shortline-pressure');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const stamp=(date,time='15:00:00')=>Date.parse(date+'T'+time+'+08:00');
const day='2026-11-20',at=stamp(day,'10:00:00'),code='600000';
const bar=(date,close,patch={})=>({code,date,open:close,high:close+1,low:close-1,close,volume:1000,priceBasis:'unadjusted',source:'tencent',knownAt:stamp(date.slice(0,10)),availableAt:date,...patch});
const signal=()=>({id:'signal-1',code,decisionAt:at-60000,expiresAt:at+60000,evidenceHash:'a'.repeat(64),settingsVersion:'v1',entryMin:9.8,entryMax:10.1,stop:9.4,target:10.8});
const evidence=()=>({code,source:'tencent',observedAt:at-1000,knownAt:at,conditions:[{id:'original-condition',pass:true}],evidenceHash:'a'.repeat(64),settingsVersion:'v1'});
const quote=(price=10,patch={})=>({code,price,quoteSource:'tencent',quoteAt:at-1000,receivedAt:at,mode:'public-live-unverified',...patch});

test('31 and 33 future benchmark identities and finer cadences cannot change earlier projections',()=>{
 const bars=[bar('2026-11-18',10),bar('2026-11-19',11),bar('2026-11-18',100,{role:'index',code:'IX'}),bar('2026-11-19',101,{role:'index',code:'IX'})];
 const first=relative({archive:{bars},code,asOf:'2026-11-19',windows:[1]});
 const later=relative({archive:{bars:[...bars,bar('2026-11-20',100,{role:'index',code:'FUTURE-IX'})]},code,asOf:'2026-11-19',windows:[1]});
 assert.deepEqual(later,first);assert.equal(first.comparisons[0].status,'observed-research-only');
 const minute=[bar(day+' 09:55',10,{period:'5分钟',knownAt:stamp(day,'09:55:00')}),bar(day+' 10:00',11,{period:'5分钟',knownAt:at})];
 const before=multi({archive:{bars:minute},code,asOf:at});
 const after=multi({archive:{bars:[...minute,bar(day+' 10:01',99,{period:'1分钟',knownAt:at+60000})]},code,asOf:at});
 assert.deepEqual(after,before);assert.equal(after.frames[0].sourcePeriod,'5分钟');
});

test('31 and 33 receipt aliases, explicit closing times and price-basis conflicts fail closed',()=>{
 const row=bar('2026-11-19',10,{knownAt:stamp('2026-11-19'),receivedAt:stamp('2026-11-21')});
 assert.equal(multi({archive:{bars:[row]},code,asOf:day}).frames.find(r=>r.period==='day').status,'unknown');
 const partial=bar(day+' 10:00',10,{period:'5分钟',knownAt:at+300000,closedAt:at+300000,availableAt:at+300000});
 assert.equal(multi({archive:{bars:[partial]},code,asOf:at+299999}).frames[0].status,'unknown');
 assert.equal(multi({archive:{bars:[partial]},code,asOf:at+300000}).frames[0].latest.closedAt,at+300000);
 const b=bar('2026-11-19',10);
 for(const input of [[{...b,priceBasis:undefined}],[b,{...b,priceBasis:'forward-adjusted'}]])assert.equal(multi({archive:{bars:input},code,asOf:day}).frames.find(r=>r.period==='day').status,'unknown');
});

const disclosure=(patch={})=>({id:'audit-2026-q3',code,category:'audit',auditOpinion:'qualified',description:'原报告列示保留意见',verified:true,source:'issuer-report-unit-case',reportDate:'2026-09-30',publishedAt:stamp('2026-10-30'),updatedAt:stamp('2026-10-30'),knownAt:at-10000,availableAt:at-10000,evidenceHash:'b'.repeat(64),revisionId:'version-1',...patch});

test('59 audit disclosures preserve actual revision time, conflicts, missing evidence and test isolation',()=>{
 const v1=disclosure(),v2=disclosure({auditOpinion:'unmodified',description:'后续修订无保留意见',knownAt:at+1000,availableAt:at+1000,updatedAt:at+1000,evidenceHash:'c'.repeat(64),revisionId:'version-2'});
 const read=(items,asOf=at)=>financial({financials:{symbol:code,disclosures:items},code,asOf});
 const before=read([v1,v2]),audit=before.disclosures.categories.find(c=>c.id==='audit');
 assert.equal(audit.items[0].auditOpinion,'qualified');assert.ok(before.risks.some(r=>r.id==='audit'));
 assert.equal(read([v1,v2],at+1000).disclosures.categories[0].items[0].auditOpinion,'unmodified');
 assert.equal(read([v1,{...v1,description:'同一修订时间相反事实'}]).disclosures.categories[0].status,'unknown');
 for(const patch of [{code:'000001'},{sampleSet:'test'},{knownAt:at+1},{recordedAt:at+1},{availableAt:at+1},{revisionId:''},{evidenceHash:''},{publishedAt:at+1},{updatedAt:at+1},{auditOpinion:'title-guessed'}])assert.equal(read([{...v1,...patch}]).disclosures.categories[0].status,'unknown');
 assert.ok(before.missing.includes('股东减持及重要股权变化'));assert.ok(before.missing.includes('市净率行业对照'));assert.equal(before.disclosures.absenceIsNotNoRisk,true);
});

test('59 reuses the existing pressure collector and keeps headline clues distinct from verified facts',async()=>{
 const observedAt=stamp(day,'15:16:00');
 const pressure=createShortlinePressureReader({now:()=>observedAt,pool:()=>[code],requestJson:async target=>{
  const u=new URL(target),notice=u.hostname.startsWith('np-');
  const data=notice?[{art_code:'AN2026112012345',title:'回复问询函并说明商誉事项',notice_date:day,display_time:day+' 13:00:00',codes:[{stock_code:code}],columns:[{column_name:'问询函'}]}]:({
   RPT_EXECUTIVE_HOLD_DETAILS:[{SECURITY_CODE:code,CHANGE_DATE:'2026-11-17',CHANGE_REASON:'二级市场买卖',CHANGE_SHARES:-20000,PERSON_NAME:'资料人员',HOLD_TYPE:'A股'}],
   RPT_LIFT_STAGE:[],RPT_GOODWILL_STOCKDETAILS:[{SECURITY_CODE:code,NOTICE_DATE:'2026-10-31',REPORT_DATE:'2026-09-30',SUMSHEQUITY:1000,GOODWILL:350,SUMSHEQUITY_RATIO:.35}]
  })[u.searchParams.get('reportName')];
  return {raw:Buffer.from(JSON.stringify(notice?{data:{list:data,total_hits:data.length}}:{success:true,result:{count:data.length,data}}))};
 }});
 const report=await pressure({code,day}),archive={scope:'live',pressureHistory:[report]},result=bundle({archive,code,asOf:observedAt}).financialHealth;
 const categories=result.disclosures.categories;
 assert.equal(categories.find(c=>c.id==='shareholding').items[0].value,20000);
 assert.equal(categories.find(c=>c.id==='impairment').items[0].value,35);
 assert.equal(categories.find(c=>c.id==='material-risk').status,'clues-only');
 assert.equal(categories.find(c=>c.id==='audit').status,'unknown');assert.equal(result.disclosures.sourceCoverage.length,4);
 assert.ok(result.risks.some(r=>r.id==='impairment'));assert.equal(result.canTrade,false);
 assert.equal(bundle({archive,code,asOf:observedAt-1}).financialHealth.disclosures.coverage.observed,0);
 assert.equal(bundle({archive:{...archive,scope:'demo'},code,asOf:observedAt}).financialHealth.disclosures.coverage.observed,0);
});

const valuation=(patch={})=>({code,source:'financial-valuation-unit-case',observedAt:at-1000,knownAt:at,availableAt:at,financialPublishedAt:stamp('2026-10-30'),evidenceHash:'c'.repeat(64),revisionId:'valuation-1',metric:'peTtm',value:12,unit:'ratio',basis:'TTM',currency:'CNY',priceBasis:'unadjusted',
 industry:{code:'banking',classificationVersion:'classification-2026',membershipKnownAt:stamp('2026-01-01'),source:'industry-observation-unit-case',observedAt:at-1000,knownAt:at,availableAt:at,metric:'peTtm',value:10,unit:'ratio',basis:'TTM',currency:'CNY',priceBasis:'unadjusted',method:'median',sampleSize:20,evidenceHash:'d'.repeat(64),revisionId:'industry-1'},...patch});

test('59 valuation comparison requires contemporaneous price, disclosed fundamentals, units and membership',()=>{
 const read=(entry,asOf=at)=>financial({financials:{symbol:code,valuationObservations:[entry]},code,asOf}).valuation.metrics[0];
 const v=valuation(),r=read(v);assert.equal(r.value,12);assert.equal(r.industryComparison.premiumPct,20);assert.equal(r.industryComparison.difference,2);
 for(const patch of [{observedAt:at-2000},{knownAt:at+1},{membershipKnownAt:at},{unit:'percent'},{classificationVersion:''},{basis:'forward-estimate'},{sampleSize:2},{evidenceHash:''},{method:'maximum'}]){
  const result=read({...v,industry:{...v.industry,...patch}});assert.equal(result.value,12);assert.equal(result.industryComparison.status,'unknown');
 }
 for(const patch of [{financialPublishedAt:at},{knownAt:at+1},{sampleSet:'test'},{currency:'USD'},{priceBasis:'forward-adjusted'},{basis:'forecast'},{revisionId:''}])assert.equal(read({...v,...patch}).value,null);
 assert.equal(read({...v,value:-10}).industryComparison.status,'not-comparable');
 assert.equal(read(v,at-1).value,null);
});

test('60 current price must remain in original frozen bounds and cannot be revalidated past risk barriers',()=>{
 const base=signal(),e=evidence(),revalidation={signalId:base.id,evaluatedAt:at,evidenceHash:e.evidenceHash,status:'pass'};
 for(const [price,status] of [[9.8,'inside-range'],[10.1,'inside-range'],[10.2,'outside-range'],[9.4,'stop-condition'],[10.8,'target-condition']]){
  const r=validity({signal:base,latestEvidence:e,latestQuote:quote(price),asOf:at,revalidation});
  assert.equal(r.priceReview.status,status);assert.equal(r.status,status==='inside-range'?'research-valid':'requires-revalidation');
  assert.equal(r.revalidation.status,status==='inside-range'?'research-revalidated':'rejected');assert.equal(r.canTrade,false);
 }
 assert.equal(validity({signal:base,latestEvidence:e,asOf:at}).priceReview.status,'unknown');
 const blocked=validity({signal:base,latestEvidence:{...e,gate:{canTrade:false}},latestQuote:quote(),asOf:at,revalidation});assert.equal(blocked.revalidation.status,'rejected');
});

test('60 price evidence rejects stale, late, research-only, wrong-stock and pre-plan quotations',()=>{
 const read=latestQuote=>validity({signal:signal(),latestEvidence:evidence(),latestQuote,asOf:at});
 assert.equal(read(quote(10,{quoteAt:at-15000})).priceReview.status,'inside-range');
 for(const patch of [{quoteAt:at-15001},{quoteAt:at+1},{receivedAt:at+1},{knownAt:at+1},{receivedAt:null},{code:'000001'},{mode:'historical-bars'},{canTrade:false},{price:null},{timestamp:at},{quoteAt:at-60001},{tradeDate:'2026-11-19'}])assert.equal(read(quote(10,patch)).priceReview.status,'unknown');
 const e={...evidence(),knownAt:at-1000,receivedAt:at+1};assert.equal(validity({signal:signal(),latestEvidence:e,latestQuote:quote(),asOf:at}).status,'requires-revalidation');
});

function observedPlan(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day,name:'原计划专项验证',calculatedAt:at-60000,strategyAt:at-90000,quoteBasis:{source:'tencent',quoteAt:at-61000},plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(at-50000).toISOString(),...decisionPlanPayload(card)},card);
 const row={...quote(),name:'原计划专项验证',preClose:10,quoteAt:at,receivedAt:at,canTrade:true,quoteMode:'public-live-unverified',volume:100000,suspended:false,tradable:true};
 const q={...row,symbol:code,provider:'tencent',timestamp:at,tradeDate:day,mode:row.quoteMode,volume:row.volume*100,volumeUnit:'shares',upperLimit:11,lowerLimit:9,
  inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 const book={revision:1,legacy:{enabled:true},feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account:{cash:10000,events:[],positions:{}},orders:{}};
 const observed=observePaperPlans({plans:[plan],book,quotes:{[code]:q},day,now:at,calendar:{isOpen:d=>d===day},continuous:true,
  entryEligibilityByPlan:{[plan.id]:{allowed:true,reason:'原预检通过',checkedAt:at,quoteAt:at}}});
 assert.deepEqual(observed.rejected,[]);return {plan,record:observed.records[0]};
}

test('60 real plan observation remains read-only, version-bound and stops at original 14:57 entry expiry',()=>{
 const {plan,record}=observedPlan(),copy=structuredClone(record),read=(signal=plan,asOf=at,observation=record)=>validity({signal,latestEvidence:evidence(),latestObservation:observation,asOf});
 const current=read();assert.equal(current.priceReview.status,'inside-range');assert.equal(current.priceReview.evidenceKind,'validated-plan-observation');assert.equal(current.priceReview.observationFingerprint,record.fingerprint);
 assert.equal(current.expiryBasis,'original-plan-entry-session-policy');assert.equal(current.expiresAt,stamp(day,'14:57:00'));assert.equal(current.originalHashBasis,'original-decision-id');
 assert.equal(read({...plan,entryMax:10}).priceReview.status,'unknown');assert.equal(read(plan,at+15001).priceReview.status,'unknown');
 assert.equal(read(plan,stamp(day,'14:57:00')).status,'expired');
 const expired=validity({signal:plan,latestEvidence:{...evidence(),observedAt:stamp(day,'14:57:00'),knownAt:stamp(day,'14:57:00')},latestQuote:quote(10,{quoteAt:stamp(day,'14:57:00'),receivedAt:stamp(day,'14:57:00')}),asOf:stamp(day,'14:57:00'),revalidation:{signalId:plan.id,evaluatedAt:stamp(day,'14:57:00'),evidenceHash:'a'.repeat(64),status:'pass'}});
 assert.equal(expired.revalidation.status,'rejected');assert.equal(current.canTrade,false);assert.equal(current.priceReview.canTrade,false);assert.deepEqual(record,copy);
});

test('59 original official announcement feed supplies research clues without inventing audit results',()=>{
 const announcement={code,title:'关于审计报告、股权变更及商誉减值风险提示的公告',source:'巨潮资讯',url:'https://static.cninfo.com.cn/finalpage/2026-11-20/123456.pdf',publishedAt:new Date(at-10000).toISOString(),knownAt:at};
 const archive={scope:'live',v6Observation:{code,observedAtMs:at,stock:{announcements:[announcement]}}};
 const result=financial({archive,code,asOf:at});
 assert.equal(result.disclosures.coverage.observed,0);assert.ok(result.disclosures.categories.every(c=>c.status==='clues-only'));
 assert.ok(result.disclosures.categories.every(c=>c.clues[0].verified===false));assert.equal(result.risks.length,0);
 assert.ok(financial({archive,code,asOf:at-1}).disclosures.categories.every(c=>c.status==='unknown'));
 const changed=structuredClone(archive);changed.v6Observation.stock.announcements[0].knownAt=at+1;
 assert.ok(financial({archive:changed,code,asOf:at}).disclosures.categories.every(c=>c.status==='unknown'));
});

test('31 sector comparison names relative weakness, sector-following and opposing strength without probabilities',()=>{
 const dates=['2026-11-18','2026-11-19'],stock=prices=>dates.map((date,i)=>bar(date,prices[i]));
 const run=(own,bench)=>relative({archive:{bars:stock(own)},benchmarks:[{kind:'sector',id:'S1',membershipKnownAt:stamp('2026-11-01'),bars:stock(bench).map(b=>({...b,code:'S1',role:'sector'}))}],code,asOf:day,windows:[1]}).comparisons[0];
 assert.ok(run([10,9],[100,105]).tags.includes('板块强而个股弱'));
 assert.ok(run([10,9],[100,105]).tags.includes('个股相对走弱'));
 assert.ok(run([10,11],[100,95]).tags.includes('板块弱而个股强'));
 assert.ok(run([10,10.5],[100,105]).tags.includes('跟随板块上涨'));
 assert.equal(run([10,11],[100,95]).probability,undefined);
});

test('60 malformed expiry, absent current rule version and test signals never become research-valid',()=>{
 for(const patch of [{expiresAt:'invalid'},{entryMin:11},{stop:11},{target:9},{sampleSet:'test'}])assert.notEqual(validity({signal:{...signal(),...patch},latestEvidence:evidence(),latestQuote:quote(),asOf:at}).status,'research-valid');
 const e=evidence();delete e.settingsVersion;
 const r=validity({signal:signal(),latestEvidence:e,latestQuote:quote(),asOf:at,revalidation:{signalId:'signal-1',evaluatedAt:at,evidenceHash:'a'.repeat(64),status:'pass'}});
 assert.ok(r.reasons.includes('当前规则版本未取得'));assert.equal(r.revalidation.status,'rejected');
});


test('59 future or invalid parent snapshots cannot backdate typed disclosures and valuations',()=>{
 const version={symbol:code,disclosures:[disclosure()],valuationObservations:[valuation()]};
 const read=financials=>financial({financials,code,asOf:at});
 assert.equal(read(version).disclosures.categories[0].status,'observed');
 for(const key of ['knownAt','receivedAt','recordedAt','availableAt','createdAt','observedAt','observedAtMs','capturedAt','decisionAt','asOf','publishedAt','updatedAt'])for(const value of [at+1,'invalid',null]){
  for(const envelope of [{...version,[key]:value},{[key]:value,versions:[version]},{versions:[{...version,[key]:value}]}]){
   const result=read(envelope);assert.equal(result.disclosures.categories[0].status,'unknown',key);assert.equal(result.valuation.metrics[0].value,null,key);
  }
 }
 for(const envelope of [{...version,sampleSet:'test'},{sampleSet:'test',versions:[version]},{retracted:true,versions:[version]}])assert.equal(read(envelope).disclosures.coverage.observed,0);
});
