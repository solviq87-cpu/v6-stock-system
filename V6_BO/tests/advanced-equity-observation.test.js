'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/core/account-equity-evidence');
const {fixture,BASE}=require('./helpers/account-equity-fixture');
const observe=(f,price=10,extra={})=>E.buildAccountEquityEvidence({book:f.service.read(),accountId:'pool',quotes:{600000:f.quote('600000',price)},now:f.now,...extra});
const calc=(rows,current,extra={})=>E.buildObservedEquityPerformance({observations:rows,current,now:current.observedAt,...extra});
test('recent equity window uses original reconciled marks, not invented cash flows or full-period performance',t=>{
 const f=fixture(t);f.buy('600000',1000,10);const a=observe(f);f.setNow(BASE+60000);const b=observe(f,11);f.setNow(BASE+120000);const c=observe(f,9);
 const r=calc([a,b],c,{truncated:true});
 assert.equal(r.status,'observed-unverified');assert.deepEqual([r.from,r.to,r.sampleCount],[BASE,BASE+120000,3]);
 assert.equal(r.equityChange,c.equity-a.equity);assert.equal(r.returnRatio,c.equity/a.equity-1);assert.equal(r.observedMaxDrawdownPct,(b.equity-c.equity)/b.equity*100);
 assert.equal(r.externalNetFlow,null);assert.equal(r.externalFlowStatus,'not-exposed-by-authority');assert.equal(r.fullPeriodCertified,false);assert.equal(r.truncated,true);assert.equal(r.canTrade,false);
 assert.equal(r.finalEvidenceRef,c.fingerprint);assert.equal(r.accountFingerprint,c.source.snapshotFingerprint);
});
test('only the latest contiguous suffix is compared; missing valuation, future evidence and another account cannot bridge',t=>{
 const f=fixture(t);f.buy();const a=observe(f);f.setNow(BASE+180000);const b=observe(f,11);assert.equal(calc([a],b).status,'unknown');
 f.setNow(BASE+240000);const c=observe(f,12);const r=calc([a,b],c);assert.equal(r.from,b.observedAt);assert.equal(r.sampleCount,2);assert.equal(r.earlierSamplesExcluded,true);
 f.setNow(BASE+300000);const missing=observe(f,10,{quotes:{}});assert.equal(calc([a,b,c],missing).status,'unknown');
 f.setNow(BASE+360000);const d=observe(f,10);assert.equal(calc([a,b,c,missing],d).status,'unknown');assert.equal(calc([d],c).status,'unknown');
 const foreign=observe(f,10,{accountId:'pre'});assert.equal(calc([a,foreign],d).status,'unknown');
});
test('existing advanced-account worker reads the original private equity journal, preserves conflict provenance and performs no writes', {timeout:15000},async t=>{
 const f=fixture(t),now=Date.now()-60000;f.setNow(now);f.buy();const historical=observe(f,10);
 const riskRoot=path.join(f.root,'risk-evidence'),equityRoot=path.join(riskRoot,'equity'),store=E.createAccountEquityEvidenceStore({root:equityRoot,clock:()=>f.now,canWrite:()=>true});
 store.append({evidence:historical});const accounts=path.join(f.root,'accounts');fs.mkdirSync(accounts,{mode:0o700});fs.copyFileSync(path.join(f.root,'authority.json'),path.join(accounts,'pool.json'));
 require('../src/core/paper-application-service').createPaperApplicationService({file:path.join(accounts,'pre.json')}).initialize(100000);
 const old=process.env.V6_RISK_EVIDENCE_DIR;process.env.V6_RISK_EVIDENCE_DIR=riskRoot;t.after(()=>{if(old===undefined)delete process.env.V6_RISK_EVIDENCE_DIR;else process.env.V6_RISK_EVIDENCE_DIR=old;});
 const journalFile=fs.readdirSync(path.join(equityRoot,'pool',historical.accountEpoch,historical.day)).find(n=>/^\d+\.json$/.test(n));assert.ok(journalFile);
 const file=path.join(equityRoot,'pool',historical.accountEpoch,historical.day,journalFile),before=fs.readFileSync(file),bookBefore=fs.readFileSync(path.join(accounts,'pool.json'));
 const run=async flags=>{const requestAt=Date.now();return require('../src/server/advanced-account-risk-job').runAdvancedAccountRiskJob({root:accounts,requestAt,day:require('../src/core/a-share-calendar').aShareCalendarDate(requestAt),marketOpen:true,continuous:true,quotes:{600000:{quote:{code:'600000',price:12,quoteAt:requestAt,receivedAt:requestAt,quoteSource:'tencent',canTrade:true,...flags},suspended:false,limitDown:false}}});};
 const report=await run({});assert.equal(report.status,'observed');const pool=report.accounts.find(x=>x.account==='pool'),pre=report.accounts.find(x=>x.account==='pre');
 const r=pool.portfolioEvidence.observedEquityPerformance;assert.equal(r.status,'observed-unverified');assert.equal(r.equityChange,200);assert.equal(r.externalNetFlow,null);assert.equal(pool.portfolioEvidence.performance.timeWeightedReturn,null);assert.equal(pre.portfolioEvidence.observedEquityPerformance.status,'unknown');
 for(const flags of [{sourceConflict:true},{conflict:true},{evidenceStatus:'conflict'},{quoteStatus:'conflict'},{canTrade:null}]){const blocked=(await run(flags)).accounts.find(x=>x.account==='pool');assert.equal(blocked.equity,null);assert.equal(blocked.portfolioEvidence.observedEquityPerformance.status,'unknown');}
 assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(path.join(accounts,'pool.json')),bookBefore);assert.equal(fs.existsSync(path.join(equityRoot,'pre')),false);
});
