'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {fetchPublicStockStatusEvidence}=require('../src/core/public-stock-status-evidence');
const {auditCorporateSourceLinkage}=require('../src/core/corporate-source-linkage');
const CAPTURED=Date.parse('2026-07-15T10:00:00+08:00');
const REVIEWED=Date.parse('2026-11-13T16:00:00+08:00');
const original={SECURITY_CODE:'600000',SECUCODE:'600000.SH',SECURITY_NAME_ABBR:'样本',
 REPORT_DATE:'2025-12-31 00:00:00',PLAN_NOTICE_DATE:'2026-07-10 00:00:00',
 EQUITY_RECORD_DATE:'2026-07-15 00:00:00',EX_DIVIDEND_DATE:'2026-07-16 00:00:00',
 NOTICE_DATE:'2026-07-10 00:00:00',PUBLISH_DATE:'2026-07-10 00:00:00',
 PRETAX_BONUS_RMB:4.2,IMPL_PLAN_PROFILE:'仅用于单测的分红',ASSIGN_PROGRESS:'实施分配'};
const raw=x=>({raw:Buffer.from(JSON.stringify(x))});
function provider(target){
 const u=new URL(target);
 if(u.hostname==='qt.gtimg.cn')return Promise.resolve({raw:'unavailable vendor quote'});
 if(u.searchParams.get('reportName')==='RPT_SHAREBONUS_DET')
  return Promise.resolve(raw({success:true,result:{data:[original],count:1,pages:1}}));
 return Promise.resolve(raw({success:true,result:{data:[],count:0,pages:0}}));
}
const captured=now=>fetchPublicStockStatusEvidence({symbol:'600000',date:'2026-07-15'},
 {now:()=>now,requestJson:provider});
const event=(id,overrides={})=>({eventId:'evt-cash',actionId:'action-one',
 sourceRecordId:id,symbol:'600000',kind:'cash-dividend',source:'imported',
 provider:'eastmoney',effectiveDate:'2026-07-16',
 publishedAt:'2026-07-10T08:00:00+08:00',
 expectedQuantity:100,expectedCostBasis:1000,
 cashDelta:10,shareDelta:0,basisDelta:0,...overrides});
test('raw vendor response row hash links one settlement but never certifies its actual payment or exchange truth',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 assert.match(id,/^[a-f0-9]{64}$/);
 assert.equal(report.dividendEvents.records[0].recordHashBasis,'parsed-vendor-json-row');
 const result=auditCorporateSourceLinkage({capture:report,settlements:[event(id)],now:REVIEWED});
 assert.equal(result.status,'raw-row-linkage-consistent-unverified');
 assert.equal(result.sourceRowCount,1);
 assert.equal(result.sourceRowsMatchRawBytes,true);
 assert.equal(result.linkedSourceRows,1);
 assert.equal(result.bySettlement[0].dateRelation,'matches-reported-ex-date');
 assert.equal(result.bySettlement[0].observedBeforeOpen,true);
 assert.equal(result.bySettlement[0].status,'matched-row-only-not-certified');
 for(const prop of ['sourceAuthenticated','exchangeVerified','originalPublicationInstantVerified',
  'corporateActionsVerified','pointInTimeBacktestReady','canApplySettlement','canTrade'])
  assert.equal(result[prop],false);
 assert.equal('data' in result,false,'never republish upstream raw response');
});
test('late report capture cannot be backfilled to become an earlier known historical ex-date',async()=>{
 const report=await captured(REVIEWED),id=report.dividendEvents.records[0].sourceRecordId;
 const result=auditCorporateSourceLinkage({capture:report,settlements:[event(id)],now:REVIEWED});
 assert.equal(result.status,'requires-source-review');
 assert.equal(result.bySettlement[0].observedBeforeOpen,false);
 assert.ok(result.bySettlement[0].issues.includes('SOURCE_OBSERVED_AFTER_EFFECTIVE_OPEN'));
 assert.equal(result.bySettlement[0].status,'not-point-in-time-supported');
 assert.equal(result.canTrade,false);
});
test('effective cash pay date is not silently treated as an ex-rights date',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 const result=auditCorporateSourceLinkage({capture:report,settlements:[event(id,{
  effectiveDate:'2026-07-20'})],now:REVIEWED});
 assert.equal(result.status,'requires-source-review');
 assert.equal(result.bySettlement[0].dateRelation,'effective-date-role-not-proven-by-this-report');
 assert.ok(result.bySettlement[0].issues.includes('CASH_OR_SHARE_EFFECTIVE_DATE_NOT_PROVEN'));
});
test('unknown row IDs or different provider names never manufacture vendor evidence',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 const result=auditCorporateSourceLinkage({capture:report,now:REVIEWED,
  settlements:[event('f'.repeat(64)),event(id,{eventId:'provider-two',provider:'tencent'})]});
 assert.equal(result.status,'requires-source-review');
 assert.ok(result.bySettlement[0].issues.includes('UNLINKED_SOURCE_RECORD'));
 assert.ok(result.bySettlement[1].issues.includes('PROVIDER_NOT_IDENTICAL'));
 assert.equal(result.linkedSourceRows,0);
});
test('reparsed summary and raw byte hash must agree: changed dates/IDs cannot be accepted',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 for(const mutate of [
  r=>{r.dividendEvents.records[0].sourceRecordId='f'.repeat(64);},
  r=>{r.dividendEvents.records[0].pretaxBonusRmb=9999;},
  r=>{r.dividendEvents.records[0].planText='篡改方案';},
  r=>{r.dividendEvents.records[0].name='错误证券';},
  r=>{r.dividendEvents.records[0].exDividendDate='2026-07-17';},
  r=>{r.dividendEvents.records[0].vendorDates.EX_DIVIDEND_DATE.raw='2026-07-17';},
  r=>{r.dividendEvents.records[0].vendorDates.EX_DIVIDEND_DATE.precision='instant';},
  r=>{r.dividendEvents.records[0].knownAt++;},
  r=>{r.rawEvidence.find(e=>e.source==='eastmoney:dividendEvents').sha256='f'.repeat(64);},
  r=>{r.rawEvidence.find(e=>e.source==='eastmoney:dividendEvents').data='ZW1wdHk=';},
  r=>{r.dividendEvents.coverage.declaredCount=2;}
 ]){
  const altered=structuredClone(report);
  mutate(altered);
  assert.throws(()=>auditCorporateSourceLinkage({capture:altered,settlements:[event(id)],now:REVIEWED}),
   /核验拒绝/);
 }
});
test('absent or incomplete dividend source preserves unknown status without any entitlement',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 const incomplete=structuredClone(report);incomplete.dividendEvents.coverage.complete=false;
 const r=auditCorporateSourceLinkage({capture:incomplete,settlements:[event(id)],now:REVIEWED});
 assert.equal(r.status,'source-coverage-incomplete');
 assert.equal(r.sourceRowCount,0);
 assert.equal(r.canApplySettlement,false);
});
test('operator announcement date is not proof of vendor publication instant',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 const incorrect=event(id,{publishedAt:'2026-07-09T08:00:00+08:00'});
 const r=auditCorporateSourceLinkage({capture:report,settlements:[incorrect],now:REVIEWED});
 assert.equal(r.status,'requires-source-review');
 assert.ok(r.bySettlement[0].issues.includes('CLAIMED_PUBLICATION_BEFORE_REPORTED_DATE'));
});
test('read-only CLI writes a new private audit file and refuses overwriting existing evidence',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-corp-link-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 const input=path.join(dir,'capture.json'),settled=path.join(dir,'settlements.json'),
  output=path.join(dir,'linkage.json');
 fs.writeFileSync(input,JSON.stringify(report));
 fs.writeFileSync(settled,JSON.stringify([event(id)]));
 const script=path.resolve(__dirname,'../scripts/audit-corporate-source-linkage.js');
 const args=[script,input,settled,output,String(REVIEWED)];
 const first=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(first.status,0,first.stderr);
 const saved=fs.readFileSync(output,'utf8');
 assert.equal(JSON.parse(saved).sourceRowsMatchRawBytes,true);
 assert.equal(fs.statSync(output).mode&0o777,0o600);
 const repeat=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.notEqual(repeat.status,0);
 assert.equal(fs.readFileSync(output,'utf8'),saved);
});

test('replaying one settlement event twice cannot manufacture two independent source confirmations',async()=>{
 const report=await captured(CAPTURED),id=report.dividendEvents.records[0].sourceRecordId;
 assert.throws(()=>auditCorporateSourceLinkage({capture:report,
  settlements:[event(id),event(id)],now:REVIEWED}),/结算事件ID重复/);
});
