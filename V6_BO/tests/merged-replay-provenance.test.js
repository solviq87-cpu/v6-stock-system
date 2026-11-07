'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../src/core/paper-replay.js'),nativeRequire=createRequire(filename),moduleFixture={exports:{}};
// Supply explicit test decisions so this test actually exercises fills, independently of strategy ranking.
vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:moduleFixture,exports:moduleFixture.exports,require:id=>id==='../strategy/universe-scanner'?{scanUniverse:({stocks})=>({eligible:stocks.length,items:stocks.map(s=>({symbol:s.symbol,tradable:true}))})}:nativeRequire(id)});
const {replayPaperAccount,auditPaperReplayProvenance}=moduleFixture.exports;
function fixture(){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:65},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}

test('merged replay retains provenance, cash-flow statistics and execution participation limits',()=>{
 const history=fixture();history.source='simulated';
 const r=replayPaperAccount(history);assert.equal(r.provenanceAudit.ok,true);assert.ok(r.orders.length>0);assert.equal(r.accountReconciliation.ok,true);assert.ok(r.cashFlows.length>0);assert.ok(r.statistics);
 const changed=structuredClone(r);changed.orders[0].provenance.signalId='bad';assert.equal(auditPaperReplayProvenance(changed).ok,false);
 const capped=replayPaperAccount(history,{maxParticipationPct:0.0001});assert.equal(capped.orders.filter(o=>o.status==='filled').length,0);assert.equal(capped.provenanceAudit.ok,true);
});
