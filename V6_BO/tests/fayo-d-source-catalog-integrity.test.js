'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const registry=require('../config/data-source-registry-2026.json');
const lineage=require('../src/core/data-source-lineage');
const {auditRegisteredSourceReadiness:audit}=require('../src/core/data-source-readiness-audit');
const NOW=Date.parse('2026-11-10T13:58:00+08:00');
const read=()=>audit({asOf:NOW});
const find=(report,id)=>report.routes.find(r=>r.id===id);
function probe(group='tencent'){
 return {schemaVersion:1,mode:'one-shot-public-quote-endpoint-health',
  code:'600519',status:'completed-unverified',startedAt:new Date(NOW-1100).toISOString(),
  finishedAt:new Date(NOW).toISOString(),providerLicensed:false,verifiedLive:false,
  exchangeCalendarVerified:false,canTrade:false,canNotify:false,
  providers:[{provider:'tencent',upstreamGroup:group,status:'fresh-source-unverified',httpStatus:200,
   quoteAt:NOW-1000,quoteAgeMs:1000,price:10,previousClose:10,elapsedMs:10}]};
}
test('all catalogue rows partition exactly into resolved groups and unresolved routes, not independent publishers',()=>{
 const r=read(),g=r.lineage;
 assert.equal(r.summary.registeredRoutes,122);
 assert.equal(g.cataloguedPublisherGroups,73);assert.equal(g.resolvedRouteCount,114);
 assert.equal(g.sharedPublisherGroups,18);assert.equal(g.sharedPublisherRoutes,59);
 assert.equal(g.singleRoutePublisherGroups,55);
 assert.equal(g.unresolvedRouteIds.length,8);
 const ids=[...g.groups.flatMap(x=>x.routeIds),...g.unresolvedRouteIds];
 assert.equal(ids.length,122);assert.equal(new Set(ids).size,122);
 assert.deepEqual(ids.sort(),registry.sources.map(x=>x.id).sort());
 assert.equal(r.summary.cataloguedPublisherGroups,73);
 assert.equal(r.summary.unresolvedUpstreamRoutes,8);
 assert.equal(r.summary.sharedPublisherGroups,18);assert.equal(r.summary.sharedPublisherRoutes,59);
 assert.equal(r.summary.singleRoutePublisherGroups,55);
 assert.equal(g.independentlyAuthenticatedPublishers,0);
 assert.equal(g.providerIndependenceVerified,false);assert.equal(g.commonFailureRiskMeasured,false);
});
test('eastmoney SDKs, history and funds share one declared upstream; ambiguous frameworks remain unresolved',()=>{
 const r=read(),g=r.lineage.groups.find(x=>x.upstreamGroup==='eastmoney');
 assert.equal(g.routeCount,9);assert.ok(g.routeIds.includes('choice'));
 assert.ok(g.routeIds.includes('efinance-fund'));assert.ok(g.routeIds.includes('akshare-em-daily'));
 assert.ok(g.dataClasses.includes('cn-fund'));assert.ok(g.dataClasses.includes('a-share-quote'));
 assert.equal(g.publisherIdentityVerified,false);
 for(const id of g.routeIds){
  const x=find(r,id);assert.equal(x.upstreamUnique,true);
  assert.equal(x.upstreamResolved,true);assert.equal(x.upstreamGroupRouteCount,9);
  assert.equal(x.sharesCataloguedUpstream,true);
 }
 const single=find(r,'baostock');assert.equal(single.upstreamGroupRouteCount,1);
 assert.equal(single.sharesCataloguedUpstream,false);
 for(const id of ['ashare','tickflow','ashareapi','openbb']){
  const x=find(r,id);assert.equal(x.upstreamUnique,false);assert.equal(x.upstreamResolved,false);
  assert.equal(x.upstreamGroupRouteCount,null);assert.equal(x.sharesCataloguedUpstream,null);
  assert.ok(r.lineage.unresolvedRouteIds.includes(id));
 }
});
test('mutable require-cache rows cannot create extra catalogue routes or change their identity and access',()=>{
 const prior=registry.sources,raw=prior.find(x=>x.id==='efinance'),saved={...raw};
 try{
  raw.upstreamGroup='tencent';raw.access='guarded-research';raw.adapter='public-quote-probe';
  registry.sources=[...prior.filter(x=>x.id!=='baostock'),{...raw,id:'new-unauthorized'}];
  const r=read();
  assert.equal(r.routes.length,122);assert.equal(r.summary.registeredRoutes,122);
  assert.equal(find(r,'new-unauthorized'),undefined);
  assert.ok(find(r,'baostock'));
  assert.equal(find(r,'efinance').upstreamGroup,'eastmoney');
  assert.equal(find(r,'efinance').access,'permission-review');
  assert.equal(find(r,'efinance').declaredAdapter,'optional-research-sources.py');
  assert.equal(r.summary.guardedResearchRoutes,2);
 }finally{Object.assign(raw,saved);registry.sources=prior;}
});
test('probe identity comes from the same immutable catalogue as source resolution',()=>{
 const raw=registry.sources.find(x=>x.id==='tencent'),saved={...raw};
 try{
  raw.upstreamGroup='eastmoney';
  const r=audit({asOf:NOW,snapshot:probe()});
  assert.equal(find(r,'tencent').upstreamGroup,'tencent');
  assert.equal(find(r,'tencent').successfulQuoteObservation,true);
  assert.throws(()=>audit({asOf:NOW,snapshot:probe('eastmoney')}),/身份/);
 }finally{Object.assign(raw,saved);}
});
test('exported registry projection is detached from the validated catalogue',()=>{
 const rows=lineage.registeredSourceRows();
 assert.equal(rows.length,122);
 const a=rows.find(x=>x.id==='eastmoney');
 assert.deepEqual(Object.keys(a).sort(),['access','adapter','dataClass','id','market','upstreamGroup']);
 a.upstreamGroup='bad';rows.pop();
 assert.equal(lineage.sourceLineage('eastmoney').upstreamGroup,'eastmoney');
 assert.equal(lineage.registeredSourceRows().length,122);
 assert.equal(find(read(),'eastmoney').upstreamGroup,'eastmoney');
});
test('mutating a returned graph cannot alter later reports',()=>{
 const first=read(),group=first.lineage.groups.find(x=>x.upstreamGroup==='eastmoney');
 group.routeIds.push('fake');group.routeCount=99;first.lineage.unresolvedRouteIds.pop();
 const next=read(),again=next.lineage.groups.find(x=>x.upstreamGroup==='eastmoney');
 assert.equal(again.routeCount,9);assert.equal(again.routeIds.includes('fake'),false);
 assert.equal(next.lineage.unresolvedRouteIds.length,8);
});
test('existing exact-route attempts, authorization and observed evidence remain separate',()=>{
 const r=audit({asOf:NOW,snapshot:probe()});
 assert.equal(r.summary.reportedExactRoutes,1);assert.equal(r.summary.attemptedExactRoutes,1);
 assert.equal(r.summary.successfulQuoteObservations,1);
 assert.equal(find(r,'easyquotation-tencent').attemptedOnThisExactRoute,false);
 assert.equal(find(r,'tencent').phases.authorization,'unknown');
 assert.equal(r.summary.licensedLiveSourcesVerified,0);
 assert.equal(r.summary.productionActiveSourcesVerified,0);
 assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
 assert.equal(JSON.stringify(r).includes('price":10'),false);
});
