'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {validate,projectCompanyFact,collectSecCompanyFact}=require('../src/core/sec-companyfacts');
const now=Date.parse('2026-11-14T12:00:00Z');
const cfg={cik:'0000320193',tag:'Assets',unit:'USD',asOf:'2026-06-01',now,userAgent:'V6Research research@example.org'};
function row(overrides={}){
 return {start:undefined,end:'2025-12-31',val:2000,accn:'0000320193-26-000011',
  form:'10-K',filed:'2026-02-02',fy:2025,fp:'FY',frame:'CY2025I',...overrides};
}
const payload=rows=>({cik:320193,entityName:'Example Inc.',facts:{'us-gaap':{Assets:{units:{USD:rows}}}}});
const response=data=>({ok:true,status:200,
 headers:{get:k=>k==='content-type'?'application/json':null},
 body:Readable.from([Buffer.from(JSON.stringify(data))])});
test('SEC official XBRL host, exact CIK and declarative contact header',async()=>{
 let requests=0;
 const result=await collectSecCompanyFact({...cfg,fetchImpl:async (url,options)=>{
  requests++;
  assert.equal(url,'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers['User-Agent'],cfg.userAgent);
  assert.ok(options.signal);
  return response(payload([row()]));
 }});
 assert.equal(requests,1);assert.equal(result.provider,'sec-edgar');
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].reportedValue,2000);
 assert.equal(result.records[0].filedDate,'2026-02-02');
 assert.equal(result.records[0].acceptedAt,null);
 assert.equal(result.records[0].firstPublicAvailableAt,null);
 assert.equal(result.pointInTimeBacktestReady,false);
 assert.equal(result.canTrade,false);assert.equal(result.verifiedLive,false);
 assert.ok(/^[a-f0-9]{64}$/.test(result.sourceFingerprint));
 assert.doesNotMatch(JSON.stringify(result),/research@example\.org/);
});
test('filed cutoff keeps distinct restatements and never promotes later amendments',()=>{
 const a=row(),b=row({accn:'0000320193-26-000022',form:'10-K/A',filed:'2026-08-01',val:2500});
 const report=projectCompanyFact(payload([b,a]),{cik:320193,tag:'Assets',unit:'USD',asOf:'2026-06-01',now});
 assert.equal(report.records.length,1);assert.equal(report.records[0].reportedValue,2000);
 const later=projectCompanyFact(payload([a,b]),{cik:320193,tag:'Assets',unit:'USD',asOf:'2026-09-01',now});
 assert.equal(later.records.length,2);
 assert.deepEqual(later.records.map(x=>x.reportedValue),[2000,2500]);
 assert.equal(later.publicationTimestampVerified,false);
});
test('bogus CIK, accession, future filing, invalid unit and missing tag are fail-closed',()=>{
 const bad=[
  payload([row({accn:'fake'})]),payload([row({filed:'2026-02-30'})]),
  payload([row({filed:'2027-01-01'})]),
  payload([row({start:'2026-01-01',end:'2025-12-31'})]),
  payload([row({val:Infinity})]),payload([row({val:'2000'})]),
  payload([row({end:'2026-02-30'})]),{...payload([row()]),cik:987654}
 ];
 for(const p of bad)assert.throws(()=>projectCompanyFact(p,{cik:320193,tag:'Assets',unit:'USD',asOf:'2026-06-01',now}));
 assert.throws(()=>projectCompanyFact(payload([row(),row()]),{cik:320193,tag:'Assets',unit:'USD',asOf:'2026-06-01',now}),/重复/);
 assert.throws(()=>projectCompanyFact(payload([row()]),{cik:320193,tag:'CashAndCashEquivalentsAtCarryingValue',unit:'USD',asOf:'2026-06-01',now}),/标签/);
});
test('shares must be safe integers and never manufacture negative quantities',()=>{
 const fact=payload([row({val:1.5})]);
 fact.facts['us-gaap'].Assets.units.shares=fact.facts['us-gaap'].Assets.units.USD;
 assert.throws(()=>projectCompanyFact(fact,{cik:320193,tag:'Assets',unit:'shares',asOf:'2026-06-01',now}),/数值/);
 fact.facts['us-gaap'].Assets.units.shares=[row({val:-1})];
 assert.throws(()=>projectCompanyFact(fact,{cik:320193,tag:'Assets',unit:'shares',asOf:'2026-06-01',now}),/数值/);
});
test('undeclared access identity and future/invalid dates are rejected before network',async()=>{
 const cases=[{...cfg,userAgent:''},{...cfg,userAgent:'Secret\nX-Injected: hi'},
 {...cfg,cik:'../../etc'},{...cfg,tag:'../../fact'},{...cfg,asOf:'2099-01-01'},
 {...cfg,asOf:'2026-02-30'},{...cfg,unit:'CNY'},{...cfg,timeoutMs:100}];
 let calls=0;
 for(const opts of cases)await assert.rejects(async()=>collectSecCompanyFact({...opts,fetchImpl:async()=>{calls++;return response(payload([row()]));}}));
 assert.equal(calls,0);
 assert.doesNotThrow(()=>validate(cfg));
});
test('429 denial, invalid JSON, wrong content-type and oversized responses fail without fallback',async()=>{
 await assert.rejects(()=>collectSecCompanyFact({...cfg,fetchImpl:async()=>({ok:false,status:429})}),/429/);
 await assert.rejects(()=>collectSecCompanyFact({...cfg,fetchImpl:async()=>({
  ok:true,headers:{get:()=> 'text/html'},text:async()=>'<html />'
 })}),/Content-Type/);
 await assert.rejects(()=>collectSecCompanyFact({...cfg,fetchImpl:async()=>({
  ok:true,headers:{get:()=> 'application/json'},text:async()=>'{invalid-json'
 })}),/无效JSON/);
 await assert.rejects(()=>collectSecCompanyFact({...cfg,fetchImpl:async()=>({
  ok:true,headers:{get:k=>k==='content-length'?'50000000':'application/json'},body:Readable.from(['{}'])
 })}),/超过限制/);
});
