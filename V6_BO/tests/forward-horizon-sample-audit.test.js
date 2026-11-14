'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {auditForwardRules}=require('../src/core/forward-rule-audit');
const {readSnapshot,runOnce}=require('../src/core/forward-tracking-store');
const {breadthFixture}=require('./helpers/forward-audit-breadth');
const seal=body=>({...body,integrity:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')});
const legacyAudit=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/forward-audit-v1.json'),'utf8'));
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-horizon-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function oldSnapshot(report){return seal({schemaVersion:1,mode:'v6-forward-tracking-snapshot',revision:1,
 observedAt:report.observedAt,report,audit:legacyAudit()});}

test('pending symbols cannot supply breadth to an already observed horizon',()=>{
 const {report}=breadthFixture(),audit=auditForwardRules(report),g=audit.groups[0];
 assert.equal(g.distinctSymbols,10);assert.equal(g.windows[0].observedCount,30);
 assert.equal(g.windows[0].observedCoveragePct,100);
 assert.equal(g.windows[0].status,'insufficient-matured-sample');
 assert.equal(g.windows[0].distinctObservedSymbols,1);assert.equal(audit.schemaVersion,2);
 assert.equal(g.windows[1].distinctObservedSymbols,1);
 assert.equal(g.windows[2].distinctObservedSymbols,0);
});
test('missing and corporate-action symbols cannot pad observed breadth even at adequate coverage',()=>{
 for(const status of ['missing-or-suspended','corporate-action-unresolved']){
  const {report}=breadthFixture();
  // 40 observations on one symbol + nine excluded symbols => coverage above 80%.
  for(let i=0;i<10;i++)report.records.push({...structuredClone(report.records[0]),signalId:'extra-'+i});
  report.records.slice(30,39).forEach(r=>r.windows[0]={...r.windows[0],status,priceReturnPct:null});
  const h=auditForwardRules(report).groups[0].windows[0];
  assert.equal(h.observedCount,40);assert.ok(h.observedCoveragePct>=80);
  assert.equal(h.status,'insufficient-matured-sample');assert.equal(h.distinctObservedSymbols,1);
 }
});
test('breadth belongs to each horizon and stays separate between strategy groups',()=>{
 const {report}=breadthFixture();
 report.records.slice(30).forEach(r=>r.windows[0]={...r.windows[0],status:'observed',priceReturnPct:0});
 let g=auditForwardRules(report).groups[0];
 assert.equal(g.windows[0].status,'descriptive-only');assert.equal(g.windows[0].distinctObservedSymbols,10);
 assert.equal(g.windows[1].status,'insufficient-matured-sample');
 report.records.slice(30).forEach(r=>r.cohort='separate');
 g=auditForwardRules(report).groups[0];assert.equal(g.windows[0].distinctObservedSymbols,1);
 assert.equal(g.windows[0].status,'insufficient-matured-sample');
 assert.equal(g.windows[0].ruleEffectiveness,'not-proven');
});
test('non-observed outcomes must remain null, including zero and coercible values',()=>{
 for(const status of ['pending','calendar-incomplete','missing-or-suspended','corporate-action-unresolved']){
  for(const value of [0,1,'0',false,undefined]){
   const {report}=breadthFixture();report.records[0].windows[1]={tradingDays:5,status,priceReturnPct:value};
   assert.throws(()=>auditForwardRules(report),/未观察.*null/);
  }
 }
});
test('real review CLI persists corrected counts without treating them as strategy evidence',t=>{
 const dir=temp(t),input=path.join(dir,'report.json'),output=path.join(dir,'audit.json');
 fs.writeFileSync(input,JSON.stringify(breadthFixture().report));
 const args=[path.join(__dirname,'../scripts/forward-signals.js'),'review',input,output];
 const run=()=>spawnSync(process.execPath,args,{encoding:'utf8'});
 const r=run();assert.equal(r.status,0,r.stderr);const saved=fs.readFileSync(output,'utf8'),audit=JSON.parse(saved);
 assert.equal(audit.groups[0].windows[0].status,'insufficient-matured-sample');
 assert.equal(audit.groups[0].windows[0].distinctObservedSymbols,1);
 assert.equal(audit.canTrade,false);assert.equal(audit.weightsUpdated,false);
 assert.equal(run().status,1);assert.equal(fs.readFileSync(output,'utf8'),saved);
});
test('v1 archives validate unchanged, then upgrade exactly once while preserving pinned history',t=>{
 const dir=temp(t),file=path.join(dir,'current.json'),f=breadthFixture();
 const raw=JSON.stringify(oldSnapshot(f.report))+'\n';
 const history=path.join(dir,'forward-tracking-history');fs.mkdirSync(history);
 const pinned=path.join(history,'00000001-'+f.report.asOf+'.json');
 fs.writeFileSync(file,raw);fs.writeFileSync(pinned,raw);
 assert.equal(readSnapshot(file).audit.schemaVersion,1,'legacy statistics retain their historical version');
 assert.equal(fs.readFileSync(file,'utf8'),raw,'read never rewrites evidence');
 const update=runOnce({...f,stateFile:file});assert.equal(update.changed,true);assert.equal(update.revision,2);
 const current=readSnapshot(file);assert.equal(current.audit.schemaVersion,2);
 assert.equal(current.audit.groups[0].windows[0].status,'insufficient-matured-sample');
 assert.deepEqual(current.report,f.report);assert.equal(fs.readFileSync(pinned,'utf8'),raw);
 assert.equal(readSnapshot(pinned).audit.groups[0].windows[0].status,'descriptive-only');
 const repeat=runOnce({...f,stateFile:file});assert.equal(repeat.changed,false);assert.equal(repeat.revision,2);
 assert.equal(fs.readdirSync(history).length,2);
});
test('resealed but inconsistent legacy aggregates, unknown versions and fake v2 counts still reject',t=>{
 const dir=temp(t),file=path.join(dir,'current.json'),f=breadthFixture();
 for(const change of [
  data=>data.audit.groups[0].windows[0].observedCount++,
  data=>data.audit.schemaVersion=99,
  data=>{data.audit=auditForwardRules(data.report);data.audit.groups[0].windows[0].distinctObservedSymbols=10;}
 ]){
  const {integrity,...body}=oldSnapshot(f.report);change(body);const raw=JSON.stringify(seal(body));fs.writeFileSync(file,raw);
  assert.throws(()=>readSnapshot(file),/规则审核/);
  assert.throws(()=>runOnce({...f,stateFile:file}),/规则审核/);
  assert.equal(fs.readFileSync(file,'utf8'),raw);
 }
});
