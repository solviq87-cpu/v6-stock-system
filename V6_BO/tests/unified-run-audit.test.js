'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const {parseArgs}=require('../scripts/unified-strategy-project');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:32,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i/10,high:11+i/10,low:9+i/10,close:10+i/10,volume:1000}))}]};
test('unified audit is reproducible and remains explicitly unverified',()=>{
 const a=runUnifiedStrategyProject(history),b=runUnifiedStrategyProject(history);
 assert.deepEqual(a.audit,b.audit);assert.match(a.audit.runId,/^[0-9a-f]{64}$/);
 assert.equal(a.audit.assertions.realMarketDataVerified,false);
 assert.equal(a.audit.assertions.realOrdersPlaced,false);
});
test('audit identifies changed snapshots even without new trade signals',()=>{
 const a=runUnifiedStrategyProject(history),b=runUnifiedStrategyProject(history,{snapshots:{[`000001/${dates[0]}`]:{symbol:'000001',observedThrough:dates[0]}}});
 assert.notEqual(a.audit.runId,b.audit.runId);
 assert.notEqual(a.audit.inputFingerprints.snapshots,b.audit.inputFingerprints.snapshots);
});
test('audit binds supplied Python script fingerprint',()=>{
 const a=runUnifiedStrategyProject(history,{pythonExecution:{mode:'operator-supplied-python-native',calls:40,scriptSha256:'a'.repeat(64),verifiedStrategyRules:false}});
 const b=runUnifiedStrategyProject(history,{pythonExecution:{mode:'operator-supplied-python-native',calls:40,scriptSha256:'b'.repeat(64),verifiedStrategyRules:false}});
 assert.notEqual(a.audit.runId,b.audit.runId);
 assert.equal(a.audit.execution.verifiedStrategyRules,false);
});
test('CLI parses flags in either order and refuses mixed evidence',()=>{
 assert.equal(parseArgs(['--python-native-script','/tmp/trusted.py','history.json']).script,'/tmp/trusted.py');
 assert.equal(parseArgs(['history.json','snapshots.json','--python-native-script','/tmp/trusted.py']).snapshotsPath,'snapshots.json');
 assert.throws(()=>parseArgs(['history.json','snapshots.json','evidence.json','--python-native-script','/tmp/trusted.py']),/不能混用/);
 assert.throws(()=>parseArgs(['history.json','--unknown']),/未知参数/);
});
