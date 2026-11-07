'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {buildSession,saveSession,loadSession,validateSession}=require('../src/core/paper-session');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function session(){const history={source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',market:'main',bars:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:100000}))}]};return buildSession(history).session;}
test('session validates independent metadata and history/report binding even with recomputed report checksum',()=>{
 for(const edit of [s=>s.revision=0,s=>s.lastDate='2026-01-01',s=>s.report.fingerprint='a'.repeat(64),s=>s.report.metrics.finalEquity+=100,s=>s.report.equity.at(-1).date='2026-01-01']){const s=session();edit(s);s.reportHash=sha(s.report);assert.throws(()=>validateSession(s),/完整性/);}
});
test('direct append rejects corrupt configuration and unsafe mode flags',()=>{
 const s=session();s.config.maxPositions=2;assert.throws(()=>buildSession(s.history,s.config,s),/完整性/);
 const bad=session();bad.canTrade=true;assert.throws(()=>buildSession(bad.history,{},bad),/完整性/);
});
test('invalid save preserves previously persisted valid account bytes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-consistency-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'account.json'),s=session();saveSession(file,s);const before=fs.readFileSync(file);s.revision=-1;assert.throws(()=>saveSession(file,s));assert.deepEqual(fs.readFileSync(file),before);assert.equal(loadSession(file).revision,1);
});
test('legacy session without optional config checksum and cash ledger remains readable for migration',()=>{
 const s=session();delete s.configHash;delete s.report.cashFlows;s.reportHash=sha(s.report);assert.equal(validateSession(s),s);const migrated=buildSession(s.history,{},s);assert.equal(migrated.updated,true);assert.ok(migrated.session.report.cashFlows);
});
