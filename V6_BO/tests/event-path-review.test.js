'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),J=require('../src/core/news-evidence-journal');
const {projectEventReview:project}=require('../src/core/event-path-review');
const t=Date.parse('2026-11-12T14:30:00Z'),at=t+10000;
const body='发文机关甲：适用于产品甲。计划购买宽基ETF。已完成公开披露的操作。指数调仓说明。';
const event=(p={})=>({id:'event-1',source:'public-document',sourceUrl:'https://example.org/disclosure',revision:1,symbol:'600000',publishedAt:t,firstKnownAt:t+1000,recordedAt:t+2000,title:'政策文件',bodyScope:'declared-body',body,policyApplicability:{entityId:'product:alpha',productId:'alpha',clause:'适用于产品甲'},publisherEvidence:{role:'issuing-entity',publisher:'发文机关甲',clause:'发文机关甲：适用于产品甲'},...p});
const relation=(p={})=>({id:'business-1',source:'company-disclosure',sourceUrl:'https://example.org/company',revision:1,publishedAt:t-10000,firstKnownAt:t-9000,recordedAt:t-8000,from:'600000',to:'product:alpha',productId:'alpha',marketRegion:'US',relation:'supplier',relationClass:'business',bodyScope:'declared-body',documentText:'公司主营产品甲。',businessClause:'主营产品甲',validFrom:t-20000,validUntil:null,...p});
const account=(p={})=>({status:'observed-account',sourceAt:at-1000,positions:[{symbol:'600000',shares:100}],...p});
const run=(events=[event()],relations=[relation()],options={})=>project({events,relations,asOf:at,account:account(),...options});
test('policy application and company product need separate literal documents and point-in-time identity',()=>{
 const r=run(),p=r.rows[0].policy;assert.equal(p.status,'declared-path-review');assert.equal(p.paths[0].productId,'alpha');assert.equal(p.paths[0].evidence.id,'business-1');assert.equal(p.benefitAmount,null);assert.equal(p.impactDirection,null);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 for(const rr of [relation({relation:null}),relation({from:null}),relation({productId:'beta'}),relation({relationClass:'concept'}),relation({businessClause:'不存在于原文'}),relation({recordedAt:t+3000}),relation({validUntil:t+1000}),relation({from:'600001'}),relation({retracted:true})])assert.equal(run([event()],[rr]).rows[0].policy.status,'unknown');
 for(const e of [event({bodyScope:'provider-summary'}),event({policyApplicability:{entityId:'product:alpha',productId:'alpha',clause:'虚构条款'}})])assert.equal(run([e]).rows[0].policy.status,'unknown');
});
test('foreign release uses explicit timezone and matching business geography; unknown exposure is not zero',()=>{
 const e=event({overseasEvent:{region:'US',entityId:'product:alpha',publishedAtIso:'2026-11-12T09:30:00-05:00'}});
 assert.equal(run([e]).rows[0].overseas.status,'declared-path-review');assert.equal(run([e]).rows[0].overseas.exposureAmount,null);
 const missing=run([e],[relation({marketRegion:'EU'})]).rows[0].overseas;assert.equal(missing.status,'public-time-only');assert.equal(missing.domesticExposure,null);
 for(const publishedAtIso of ['2026-11-12T09:30:00','2026-11-12T09:30:00+08:00','2026-11-12T14:30:00+99:00'])assert.equal(run([{...e,overseasEvent:{...e.overseasEvent,publishedAtIso}}]).rows[0].overseas.status,'unknown');
 const global=run([{...e,symbol:null}]).rows[0];assert.equal(global.symbol,null);assert.equal(global.holdingRelated,null);assert.equal(global.overseas.domesticExposure,null);
});
test('exact text copies form one review group; holdings and declared authority remain separate',()=>{
 const a=event(),b=event({id:'event-2',source:'repost',symbol:'600001',publisherEvidence:null}),c=event({id:'event-3',symbol:'600002',body:'另一原文',publisherEvidence:null});
 let r=run([a,b,c]);assert.equal(r.rows.length,3);assert.equal(r.reviewOrder.length,2);assert.equal(r.reviewOrder[0].refs.length,2);assert.equal(r.reviewOrder[0].holdingRelated,true);assert.equal(r.reviewOrder[0].authorityClue,true);assert.equal(r.sourceAuthorityVerified,false);assert.equal(r.notificationQueueVerified,false);
 r=run([a,b,c],[],{account:account({sourceAt:at-15001})});assert.equal(r.holdingsStatus,'unknown');assert.ok(r.reviewOrder.every(g=>g.holdingRelated===null));
 r=run([a,b],[],{account:account({positions:[]})});assert.equal(r.holdingsStatus,'current-account-association');assert.equal(r.reviewOrder[0].holdingRelated,false);
});
test('plan and executed disclosure remain separate from trade receipt and buyer identity',()=>{
 const f={planClause:'计划购买宽基ETF',executionClause:'已完成公开披露的操作',executionAt:t-1000,mechanisms:[{kind:'passive-rebalance',clause:'指数调仓说明'},{kind:'hedging',clause:'未在原文出现'}]};
 let r=run([event({fundActivity:f})]).rows[0].fund;assert.equal(r.status,'declared-plan');assert.equal(r.executionDisclosure,null);assert.equal(r.plan.clause,f.planClause);
 r=run([event({fundActivity:{...f,executionStatus:'reported-executed'}})]).rows[0].fund;assert.equal(r.status,'declared-execution-statement');assert.equal(r.executionDisclosure.independentlyVerified,false);assert.equal(r.executionRecord,null);assert.equal(r.buyerIdentity,null);assert.equal(r.amount,null);assert.equal(r.netSubscriptions,null);
 assert.equal(r.mechanisms.find(m=>m.kind==='passive-rebalance').status,'declared-text-clue');assert.equal(r.mechanisms.find(m=>m.kind==='hedging').status,'unknown');
 for(const e of [event({publisherEvidence:null,fundActivity:{...f,executionStatus:'reported-executed'}}),event({fundActivity:{...f,executionStatus:'reported-executed',executionAt:t+1}}),event({fundActivity:{...f,executionStatus:'reported-executed',executionClause:f.planClause}})])assert.equal(run([e]).rows[0].fund.executionDisclosure,null);
});
test('turnover surge without issuer text never classifies investor, motive or net subscriptions',()=>{
 const r=run([event({body:'成交额翻倍，盘面上涨',fundActivity:{turnover:200000000,mechanisms:[{kind:'stabilization',clause:'国家队买入'}]}})]).rows[0].fund;
 assert.equal(r.buyerIdentity,null);assert.equal(r.netSubscriptions,null);assert.equal(r.executionDisclosure,null);assert.ok(r.mechanisms.every(m=>m.status==='unknown'));
});
test('future/retracted/conflicting event identities cannot generate a review entry',()=>{
 const x=event();assert.equal(run([x,{...x,body:'conflict'}]).rows.length,0);assert.equal(run([event({retracted:true})]).rows.length,0);assert.equal(run([event({recordedAt:at+1})]).rows.length,0);assert.equal(run([event({sampleSet:'test'})]).rows.length,0);
});
test('journal text requires exact version and actual hash, not an imported hash label',()=>{
 const x={schemaVersion:1,source:'public-document',eventId:'archive-e',sourceRevisionId:'r1',kind:'original',supersedes:null,url:'https://example.org/disclosure',title:'政策文件',body,bodyScope:'declared-body',securities:['600000'],publishedAt:t,receivedAt:t+1000,revisedAt:null};
 const payload={schemaVersion:1,sequence:1,previousHash:null,recordedAt:t+2000,evidence:J.normalize(x,{now:t+2000}),...J.FLAGS};const raw={...payload,eventHash:J.hash(payload)};
 const e=event({id:'archive-e|600000',evidenceId:raw.eventHash,body:undefined});assert.equal(run([e],[relation()],{journalRows:[raw]}).rows[0].policy.status,'declared-path-review');
 const bad=structuredClone(raw);bad.evidence.body='篡改原文';assert.equal(run([e],[relation()],{journalRows:[bad]}).rows[0].policy.status,'unknown');
 assert.equal(run([{...e,firstKnownAt:t+1500}],[relation()],{journalRows:[raw]}).rows[0].policy.status,'unknown');
});
test('duplicate provider summaries are grouped for review without becoming source authority or original text',()=>{
 const a=event({bodyScope:'provider-summary'}),b=event({id:'event-2',source:'another-provider',bodyScope:'provider-summary'}),c=event({id:'event-3',bodyScope:'declared-body'});
 const r=run([a,b,c]);assert.equal(r.reviewOrder.length,2);assert.ok(r.reviewOrder.some(g=>g.refs.length===2&&g.authorityClue===false));
 assert.ok(r.rows.filter(x=>x.event.id!=='event-3').every(x=>x.policy.status==='unknown'&&x.authority.status==='authority-unknown'));
});
test('bounded review prioritizes a known holding before newer nonholding copies',()=>{
 const held=event({id:'older-held',publishedAt:t-200000,firstKnownAt:t-199000,recordedAt:t-198000});
 const copies=Array.from({length:101},(_,i)=>event({id:'new-'+i,symbol:'600001',publisherEvidence:null}));
 const r=run([...copies,held]);assert.equal(r.eligibleEvents,102);assert.equal(r.truncatedEvents,2);assert.equal(r.reviewOrder[0].holdingRelated,true);assert.ok(r.rows.some(x=>x.event.id==='older-held'));
});
