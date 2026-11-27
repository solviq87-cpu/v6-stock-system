'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registeredSourceRows}=require('../src/core/data-source-lineage');
const {auditSourceCommercialEvidence:audit}=require('../src/core/source-commercial-evidence');
const {auditRegisteredSourceReadiness:readiness,auditRuntimeSourceUsage}=require('../src/core/data-source-readiness-audit');
const AT=Date.parse('2026-11-27T16:00:00+08:00'),D=86400000;
const sha='a'.repeat(64);
const license=(p={})=>({status:'declared-permitted',scope:'personal-research',observedAt:AT-2*D,effectiveAt:AT-2*D,expiresAt:AT+D,documentSha256:sha,...p});
const cost=(p={})=>({basis:'reported-allocated-data-service-cost',currency:'CNY',amountMinor:0,periodStartAt:AT-2*D,periodEndAt:AT-D,recordedAt:AT,documentSha256:sha,...p});
const record=(routeId='eastmoney',licenses=[license()],costs=[cost()])=>({routeId,licenses,costs});
const ledger=records=>({schemaVersion:1,mode:'operator-declared-source-commercial-evidence',records});
const get=(records,at=AT)=>audit({asOf:at,ledger:ledger(records),registeredRoutes:registeredSourceRows()});
const row=(r,id='eastmoney')=>r.routes.find(x=>x.routeId===id);
test('D73 all exact registered routes retain distinct missing license and cost status',()=>{
 const r=get([record()]);assert.equal(r.registeredRouteCount,122);assert.equal(r.reportedLicenseRouteCount,1);assert.equal(r.reportedCostRouteCount,1);
 assert.equal(row(r).reportedCosts[0].amountMinor,0);assert.equal(row(r).costStatus,'declared-cost-unverified');
 assert.deepEqual(row(r,'akshare-em-daily').currentLicenseDeclarations,[]);assert.deepEqual(row(r,'akshare-em-daily').reportedCosts,[]);
 assert.equal(row(r,'akshare-em-daily').costStatus,'unknown-cost');assert.equal(r.actualAuthorizationVerifiedCount,0);assert.equal(r.canTrade,false);
});
test('D73 current declared scope preserves previous license history and does not revive revoked rights',()=>{
 const r=row(get([record('eastmoney',[license({status:'declared-revoked',observedAt:AT-D}),license(),license({scope:'display',status:'declared-restricted'})],[])]));
 assert.equal(r.licenseHistory.length,3);assert.equal(r.currentLicenseDeclarations.length,2);
 assert.equal(r.currentLicenseDeclarations.find(l=>l.scope==='personal-research').currentDeclaredStatus,'declared-revoked');
 assert.equal(r.currentLicenseDeclarations.find(l=>l.scope==='display').currentDeclaredStatus,'declared-restricted');
 assert.ok(r.licenseHistory.every(l=>l.licenseGrantsRuntimePermission===false&&l.independentlyVerified===false));
});
test('D73 expiry boundary and future effective declaration do not grant permission',()=>{
 const cases=[[license({expiresAt:AT}),'declared-expired'],[license({effectiveAt:AT+1,expiresAt:null}),'not-yet-effective'],[license({status:'unknown'}),'unknown']];
 for(const [l,status] of cases){
  const x=row(get([record('eastmoney',[l],[])]));
  assert.equal(x.currentLicenseDeclarations[0].currentDeclaredStatus,status);assert.equal(x.actualAuthorizationVerified,false);
 }
});
test('D73 reject unknown route, duplicates, sparse arrays and contradictory same-scope revision',()=>{
 for(const records of [[record('unknown')],[record(),record()],[record('eastmoney',[license(),license()],[])],
  [record('eastmoney',Array(1),[])],Array(1),[record('eastmoney',[],[])]])
  assert.throws(()=>get(records),/证据无效/);
});
test('D73 refuse future, malformed or privilege-bearing declarations and do not echo secrets',()=>{
 for(const l of [license({observedAt:AT+1}),license({expiresAt:AT-3*D}),license({documentSha256:'no'}),
  license({scope:'all'}),license({status:'verified-authorized'}),license({canTrade:true}),license({token:'SECRET'})])
  assert.throws(()=>get([record('eastmoney',[l],[])]),/证据无效/);
});
test('D76 valid allocated cost periods preserve original minor currency amounts and cannot be combined automatically',()=>{
 const r=row(get([record('eastmoney',[],[cost({currency:'JPY',amountMinor:50,periodStartAt:AT-D,periodEndAt:AT,documentSha256:'b'.repeat(64)}),cost()])]));
 assert.equal(r.reportedCosts[0].currency,'CNY');assert.equal(r.reportedCosts[0].amountMinor,0);
 assert.equal(r.reportedCosts[1].currency,'JPY');assert.equal(r.reportedCosts[1].amountMinor,50);
 assert.equal(r.costVerified,false);assert.equal(r.productionEnabled,null);
});
test('D76 overlapping, duplicated, estimated, invalid and premature total costs are rejected',()=>{
 for(const cs of [[cost(),cost({documentSha256:'b'.repeat(64)})],[cost(),cost({periodStartAt:AT-D,periodEndAt:AT})],
  [cost({amountMinor:-1})],[cost({amountMinor:'0'})],[cost({currency:'unknown'})],[cost({basis:'estimated-free'})],
  [cost({recordedAt:AT+1})],[cost({recordedAt:AT-2*D})],[cost({periodEndAt:AT+1})],[cost({rawInvoice:'private'})]])
  assert.throws(()=>get([record('eastmoney',[],cs)]),/证据无效/);
});
test('D73 registered readiness attaches commercial review without modifying existing authorization and usage evidence',()=>{
 const r=readiness({asOf:AT,commercialLedger:ledger([record('tencent')])}),x=r.routes.find(x=>x.id==='tencent');
 assert.equal(r.commercialEvidence.reportedLicenseRouteCount,1);assert.equal(r.commercialEvidence.reportedCostRouteCount,1);
 assert.equal(x.commercialReview.reportedCosts[0].amountMinor,0);assert.equal(x.phases.authorization,'unknown');
 assert.equal(x.licensedForLive,null);assert.equal(x.productionEnabled,null);assert.equal(x.canTrade,false);
 assert.equal(r.summary.licensedLiveSourcesVerified,0);assert.equal(r.summary.attemptedExactRoutes,0);
 assert.equal(r.autoEnableNewProviders,false);
});
test('D73 original no-evidence readiness remains backward compatible',()=>{
 const r=readiness({asOf:AT});assert.equal(r.schemaVersion,2);assert.equal(r.commercialEvidence,undefined);
 assert.equal(r.summary.registeredRoutes,122);assert.equal(r.summary.attemptedExactRoutes,0);assert.equal(r.canTrade,false);
});
test('D73 commercial evidence cannot be smuggled into the report root through extra fields',()=>{
 assert.throws(()=>audit({asOf:AT,registeredRoutes:registeredSourceRows(),ledger:{...ledger([]),canTrade:true}}),/证据无效/);
 assert.throws(()=>get([{...record(),privatePath:'/secret'}]),/证据无效/);
});
test('D73 native original readiness CLI reads commercial ledger privately with strict byte validation',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d-commercial-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'commercial.json'),link=path.join(dir,'link.json'),cli=path.resolve(__dirname,'../scripts/audit-data-source-readiness.js');
 const run=p=>spawnSync(process.execPath,[cli,'--commercial-evidence',p],{encoding:'utf8',timeout:20000});
 const input=ledger([record()]);fs.writeFileSync(file,JSON.stringify(input));fs.symlinkSync(file,link);
 const a=run(file);assert.equal(a.status,0,a.stderr);const r=JSON.parse(a.stdout);
 assert.equal(r.commercialEvidence.reportedCostRouteCount,1);assert.equal(r.canTrade,false);assert.equal(run(link).status,2);
 const text=JSON.stringify(input),i=text.indexOf('CNY');
 fs.writeFileSync(file,Buffer.concat([Buffer.from(text.slice(0,i)),Buffer.from([255]),Buffer.from(text.slice(i+3))]));
 assert.equal(run(file).status,2);
});
