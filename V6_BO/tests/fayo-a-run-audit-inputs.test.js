'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildRunAudit}=require('../src/core/unified-run-audit');
const history={source:'fixture',asOf:'2025-01-31',splitDay:20,stocks:[]};
const native={details:{fixture:[]}};
const audit=(options={},execution)=>buildRunAudit(history,options,native,execution);
function distinct(a,b,key){const x=audit(a),y=audit(b);assert.notEqual(x.runId,y.runId);assert.notEqual(x.inputFingerprints[key],y.inputFingerprints[key]);}
test('identical audit inputs remain reproducible and explicitly unverified',()=>{
 const x=audit(),y=audit();assert.deepEqual(x,y);assert.match(x.runId,/^[0-9a-f]{64}$/);assert.equal(x.assertions.realMarketDataVerified,false);assert.equal(x.assertions.realOrdersPlaced,false);assert.equal(x.assertions.pythonRulesAudited,false);
});
test('research time and native generated time bind run identity',()=>{
 distinct({now:1738310400000},{now:1738396800000},'researchClock');
 distinct({generatedAt:'2025-01-31T00:00:00Z'},{generatedAt:'2025-02-01T00:00:00Z'},'researchClock');
});
test('market-quality settings bind run identity',()=>distinct({marketQuality:{maxStalenessDays:1}},{marketQuality:{maxStalenessDays:5}},'marketQuality'));
test('portfolio execution settings bind run identity',()=>distinct({portfolioConfig:{initialCash:100000}},{portfolioConfig:{initialCash:200000}},'portfolioConfig'));
test('strategy health thresholds bind run identity',()=>{
 distinct({strategyHealth:{minClosedTrades:10}},{strategyHealth:{minClosedTrades:20}},'strategyHealth');
 distinct({strategyHealth:{maxDrawdownAlertPct:10}},{strategyHealth:{maxDrawdownAlertPct:15}},'strategyHealth');
});
test('Python execution modes, calls and verification labels bind identity without granting trust',()=>{
 const base={mode:'operator-supplied-python-native',calls:40,scriptSha256:'a'.repeat(64),verifiedStrategyRules:false};
 const a=audit({},base);
 for(const patch of [{mode:'fixture'},{calls:41},{verifiedStrategyRules:true},{scriptSha256:'b'.repeat(64)}]){const b=audit({},{...base,...patch});assert.notEqual(a.runId,b.runId);assert.notEqual(a.inputFingerprints.pythonExecution,b.inputFingerprints.pythonExecution);assert.equal(b.assertions.pythonRulesAudited,false);}
 assert.notEqual(audit().runId,a.runId);
});
test('explicit defaults for omitted settings preserve equivalent identity',()=>{
 assert.equal(audit().runId,audit({generatedAt:'1970-01-01T00:00:00Z',marketQuality:{},portfolioConfig:{},strategyHealth:{}}).runId);
});
test('original input and strategy fingerprints are unchanged in scope',()=>{
 const crypto=require('node:crypto'),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const a=audit({snapshots:{x:1},pythonEvidence:{y:2},splitDay:15});assert.equal(a.inputFingerprints.history,hash(history));assert.equal(a.inputFingerprints.snapshots,hash({x:1}));assert.equal(a.inputFingerprints.pythonEvidence,hash({y:2}));assert.equal(a.strategyEvidenceSha256,hash(native.details));assert.equal(a.splitDay,15);
});
