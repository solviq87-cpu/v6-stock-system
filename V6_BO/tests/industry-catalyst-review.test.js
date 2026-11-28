'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectEventReview}=require('../src/core/event-path-review');
const T=Date.parse('2026-11-12T10:00:00+08:00'),now=T+10000;
const event=(patch={})=>({id:'e1',source:'issuer-public',sourceUrl:'https://example.org/event',revision:1,symbol:'600000',publishedAt:T,firstKnownAt:T+1000,recordedAt:T+2000,title:'正式政策',bodyScope:'declared-body',body:'政策适用于产品甲。产品甲价格上涨。尚未签订新订单。已公告政策全文。',...patch});
const metric=(metric,value,clause)=>({metric,value,clause,period:'2026Q3',unit:'万元',observedAt:T-100000,knownAt:T-30000});
const related=metric('related-revenue',20,'2026Q3产品甲收入20万元');
const total=metric('total-revenue',100,'2026Q3公司总收入100万元');
const inv=metric('inventory',8,'2026Q3库存8万元');
const order={status:'signed',confirmedAt:T-90000,clause:'已签订产品甲合同'};
const rel=(patch={})=>({id:'rel-1',source:'company-doc',sourceUrl:'https://example.org/company',revision:1,publishedAt:T-60000,firstKnownAt:T-40000,recordedAt:T-20000,validFrom:T-200000,validUntil:null,from:'600000',to:'product:alpha',productId:'alpha',stage:'downstream',relation:'customer',relationClass:'business',bodyScope:'declared-body',documentText:'主营产品甲。2026Q3产品甲收入20万元；2026Q3公司总收入100万元；2026Q3库存8万元；已签订产品甲合同；意向订单；产品甲作为采购原料。',businessClause:'主营产品甲',industryFacts:{revenue:{related,total},order,indicators:[inv],costExposure:{productId:'alpha',role:'input-cost',clause:'产品甲作为采购原料'}},...patch});
const run=(events=[event()],relations=[rel()],asOf=now)=>projectEventReview({events,relations,asOf});
const path=(r)=>r.rows.find(x=>x.event.id==='e1').industry.businessPaths[0];
test('F06.1 company code, product, link and effective interval bind independent business document',()=>{
 const p=path(run());assert.equal(p.entityId,'product:alpha');assert.equal(p.stage,'downstream');assert.equal(p.evidence.id,'rel-1');
 for(const r of [rel({from:'600001'}),rel({to:'同名公司'}),rel({stage:null}),rel({productId:null}),rel({validUntil:T-1}),rel({recordedAt:now}),rel({businessClause:'虚构主营'}),rel({retracted:true})])assert.equal(run([event()],[r]).rows[0].industry.businessPaths.length,0);
});
test('F06.2 policy text paths and structured industry record coexist, no inferred benefit amount',()=>{
 const e=event({policyApplicability:{entityId:'product:alpha',productId:'alpha',clause:'政策适用于产品甲'}});const r=run([e]).rows[0];assert.equal(r.policy.status,'declared-path-review');assert.equal(r.industry.status,'declared-business-review');assert.equal(r.industry.benefitAmount,null);assert.equal(r.policy.benefitAmount,null);
});
test('F06.3 same period and unit denominator; actual zero, intention and invalid quantity remain separate',()=>{
 const p=path(run());assert.equal(p.revenueShare.share,.2);assert.equal(p.orderEvidence.stage,'signed');assert.equal(p.orderEvidence.realizedRevenue,null);
 for(const m of [{...related,period:'2026Q2'},{...related,unit:'元'},{...related,value:21},{...related,knownAt:T-1},{...related,clause:'2026Q3公司总收入100万元'},{...related,value:2026}]){const r=rel();r.industryFacts={...r.industryFacts,revenue:{related:m,total}};assert.equal(path(run([event()],[r])).revenueShare,null);}
 const r=rel();r.industryFacts={...r.industryFacts,order:{...order,clause:'意向订单'}};assert.equal(path(run([event()],[r])).orderEvidence,null);
 const zero=rel({documentText:rel().documentText.replace('收入20万元','收入0万元')});zero.industryFacts={...zero.industryFacts,revenue:{related:metric('related-revenue',0,'2026Q3产品甲收入0万元'),total}};assert.equal(path(run([event()],[zero])).revenueShare.share,0);
});
test('F06.4 concept association stays observation-only, including when business has expired',()=>{
 const r=run([event()],[rel({validUntil:T-1}),rel({id:'concept-2',relationClass:'concept'})]);assert.equal(r.rows[0].industry.status,'concept-observation-only');assert.equal(r.rows[0].industry.businessPaths.length,0);assert.equal(r.rows[0].industry.conceptObservations[0].role,'observation-only');
});
test('F06.5 disclosed operating metric is preserved without creating lag findings or future receipts',()=>{
 assert.equal(path(run()).indicators[0].value,8);assert.equal(run().rows[0].industry.lagVerified,false);const r=rel();r.industryFacts={...r.industryFacts,indicators:[{...inv,knownAt:now}]};assert.deepEqual(path(run([event()],[r])).indicators,[]);
});
test('F06.6 input and output exposure give opposite hypotheses, not profit or stock direction',()=>{
 const e=event({costShock:{productId:'alpha',direction:'rising',observedAt:T-1000,clause:'产品甲价格上涨'}});const a=rel(),b=rel({id:'output',stage:'upstream'});b.industryFacts={...b.industryFacts,costExposure:{...b.industryFacts.costExposure,role:'output-price'}};const p=run([e],[a,b]).rows[0].industry.businessPaths;assert.deepEqual(p.map(x=>x.costDirection.pressure),['adverse','favorable']);assert.ok(p.every(x=>x.costDirection.profitImpact===null));assert.equal(path(run([e],[rel({documentText:'主营产品甲。'})])).costDirection,null);
});
test('F07.1 only prior public draft with same policy identity qualifies as text comparison',()=>{
 const draft=event({id:'draft',publishedAt:T-60000,firstKnownAt:T-50000,recordedAt:T-40000,body:'征求意见：支持产品乙。',policyDraft:{policyId:'P01',clause:'支持产品乙'}});const e=event({policyExpectation:{policyId:'P01',draftId:'draft',draftSource:draft.source,formalClause:'政策适用于产品甲'}});
 const r=run([draft,e]).rows.find(x=>x.event.id==='e1').catalyst;assert.equal(r.policyExpectation.exactClauseChanged,true);assert.equal(r.policyExpectation.surpriseDirection,null);
 for(const d of [{...draft,recordedAt:T+1},{...draft,bodyScope:'provider-summary'},{...draft,policyDraft:{...draft.policyDraft,policyId:'P02'}},{...draft,retracted:true}])assert.equal(run([d,e]).rows.find(x=>x.event.id==='e1').catalyst.policyExpectation,null);
});
test('F07.3 catalyst postponement/cancellation and occurrence preserve planned vs actual, never grant a signal',()=>{
 const c={id:'calendar-1',status:'planned',plannedAt:T+86400000,clause:'已公告政策全文'};let x=run([event({catalyst:c})]).rows[0].catalyst;assert.equal(x.plannedAt,c.plannedAt);assert.equal(x.actualAt,null);assert.equal(x.active,false);
 x=run([event({catalyst:{...c,status:'rescheduled',previousPlannedAt:c.plannedAt,plannedAt:c.plannedAt+86400000}})]).rows[0].catalyst;assert.equal(x.previousPlannedAt,c.plannedAt);assert.equal(x.status,'rescheduled');
 x=run([event({catalyst:{...c,status:'cancelled',actualAt:T-1}})]).rows[0].catalyst;assert.equal(x.status,'cancelled');assert.equal(x.actualAt,null);
 x=run([event({catalyst:{...c,status:'occurred',actualAt:T+1,actualClause:'已公告政策全文'}})]).rows[0].catalyst;assert.equal(x.status,'occurrence-unverified');
 x=run([event({catalyst:{...c,status:'occurred',actualAt:T-1,actualClause:'已公告政策全文',plannedClause:'政策适用于产品甲'}})]).rows[0].catalyst;assert.equal(x.status,'occurred');assert.equal(x.actualAt,T-1);assert.equal(x.expiresAt,null);assert.equal(x.canNotify,false);
});
test('F10.5 literal sentences and explicit security only; summaries, old withdrawn or unrelated rows not hallucinated',()=>{
 const x=run().rows[0].textBaseline;assert.deepEqual(x.entityIds,['600000']);assert.ok(x.sentences.some(s=>s.quote==='尚未签订新订单。'&&s.negationHint));assert.ok(x.sentences.every(s=>event().body.includes(s.quote)));assert.equal(x.independentlyVerified,false);
 assert.deepEqual(run([event({bodyScope:'provider-summary'})]).rows[0].textBaseline.sentences,[]);assert.equal(run([event({retracted:true})]).rows.length,0);
});
