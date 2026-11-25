'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const A=require('../src/core/evolution-model-causality');
const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture');
const day=i=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
const at=i=>Date.parse(day(i)+'T23:59:59.999+08:00');
const history=()=>({source:'fixture',priceBasis:'unadjusted',asOf:day(39),stocks:[{code:'600000',bars:Array.from({length:40},(_,i)=>({
 date:day(i),open:10+i/10,close:10+i/10,high:11+i/10,low:9+i/10,volume:1000,knownAt:at(i)-1000}))}]});
const scriptBody=`import json,sys
x=json.load(sys.stdin)
assert all(b['date'] <= x['date'] for b in x['bars'])
assert all('labels' not in b and 'futureReturn' not in b and 'lateAnnouncement' not in b for b in x['bars'])
assert len(x['bars']) == 36 and x['bars'][-1]['close'] == 13.5
reason=str(len(x['bars']))+':'+str(x['bars'][-1]['close'])
print(json.dumps({'symbol':x['symbol'],'date':x['date'],'observedThrough':x['date'],'evaluatorVersion':'python-native/audit-fixture','provenance':'python-runtime:isolated-mechanism-test','rounds':[{'round':i,'verdict':'pass','observedThrough':x['date'],'reason':reason} for i in [1,2,3]]}))
`;
function trusted(t,body=scriptBody){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-causality-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const script=path.join(dir,'native_strategy.py');fs.writeFileSync(script,body);
 return {script,...A.readTrustedPythonConfig({...process.env,V6_PYTHON_NATIVE_SCRIPT:script,V6_PYTHON_NATIVE_SHA256:''})};
}
test('missing or untrusted Python configuration remains unevaluated and never exposes private paths',()=>{
 const absent=A.readTrustedPythonConfig({}),r=A.pythonCausalDiagnostics({history:history(),cutoff:day(35),trustedPython:absent});
 assert.equal(r.status,'not-evaluated');assert.equal(r.executed,false);assert.equal(r.calls,0);
 const invalid=A.readTrustedPythonConfig({V6_PYTHON_NATIVE_SCRIPT:'relative.py'});
 assert.equal(invalid.config,null);assert.equal(invalid.identity.status,'unavailable');
 assert.equal(JSON.stringify(invalid).includes('relative.py'),false);
});
test('actual trusted Python process reruns all four future attacks with the full warmup prefix',t=>{
 const configuration=trusted(t),source=history(),before=JSON.stringify(source);
 const result=A.pythonCausalDiagnostics({history:source,cutoff:day(35),trustedPython:configuration});
 assert.equal(result.status,'pass');assert.equal(result.executed,true);assert.equal(result.executionAttempted,true);
 assert.equal(result.calls,5);assert.equal(result.attemptedRuns,5);assert.equal(result.checks.length,4);
 assert.ok(result.checks.every(c=>c.executed&&c.status==='pass'));
 assert.equal(result.systems[0].rounds[0].verdict,'pass');assert.equal(result.verifiedStrategyRules,false);
 assert.equal(result.inputPurpose,'synthetic-diagnostic-fixture');
 assert.equal(JSON.stringify(result).includes(configuration.script),false);assert.equal(JSON.stringify(source),before);
});
test('native private reasons are compared but never exposed in the diagnostic response',t=>{
 const configuration=trusted(t,scriptBody.replace("reason=str(len(x['bars']))+':'+str(x['bars'][-1]['close'])","reason=__file__"));
 const result=A.pythonCausalDiagnostics({history:history(),cutoff:day(35),trustedPython:configuration});
 assert.equal(result.status,'pass');assert.match(result.outputFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(result).includes(configuration.script),false);assert.equal(Object.hasOwn(result.systems[0].rounds[0],'reason'),false);
});
test('actual Python output drift is detected instead of trusting preexisting receipts',t=>{
 const body=scriptBody.replace('reason=str(len(x[\'bars\']))',`from pathlib import Path
p=Path(__file__+'.runs')
n=int(p.read_text()) if p.exists() else 0
p.write_text(str(n+1))
reason=str(n)+str(len(x['bars']))`);
 const result=A.pythonCausalDiagnostics({history:history(),cutoff:day(35),trustedPython:trusted(t,body)});
 assert.equal(result.status,'fail');assert.ok(result.checks.every(c=>c.status==='fail'));assert.equal(result.calls,5);
});
test('script revision invalidates identity and a stale configuration cannot execute the replacement',t=>{
 const original=trusted(t);fs.appendFileSync(original.script,'\n# new revision\n');
 const changed=A.readTrustedPythonConfig({...process.env,V6_PYTHON_NATIVE_SCRIPT:original.script,V6_PYTHON_NATIVE_SHA256:''});
 assert.notEqual(changed.identity.scriptSha256,original.identity.scriptSha256);
 assert.notEqual(changed.identity.configFingerprint,original.identity.configFingerprint);
 const stale=A.pythonCausalDiagnostics({history:history(),cutoff:day(35),trustedPython:original});
 assert.equal(stale.status,'not-evaluated');assert.equal(stale.calls,0);
 const pinned=A.readTrustedPythonConfig({...process.env,V6_PYTHON_NATIVE_SCRIPT:original.script,V6_PYTHON_NATIVE_SHA256:original.identity.scriptSha256});
 assert.equal(pinned.identity.status,'unavailable');
});
test('Python total wall budget kills a slow process without claiming a completed model run',t=>{
 const config=trusted(t,'import time\ntime.sleep(5)\n'+scriptBody),started=Date.now();
 const result=A.pythonCausalDiagnostics({history:history(),cutoff:day(35),trustedPython:config,deadlineAt:Date.now()+150});
 assert.equal(result.status,'not-evaluated');assert.equal(result.executionAttempted,true);assert.equal(result.executed,false);
 assert.equal(result.calls,0);assert.ok(Date.now()-started<2500);assert.equal(result.errorCode,'TIMEOUT');
});
test('late historical prices cannot be rewritten as original Python observations',t=>{
 const source=history();source.stocks[0].bars[10].knownAt=at(36);
 const result=A.pythonCausalDiagnostics({history:source,cutoff:day(35),trustedPython:trusted(t)});
 assert.equal(result.status,'not-evaluated');assert.equal(result.executionAttempted,false);assert.equal(result.calls,0);
});
test('original numeric settlement fitting and scoring remain causal under all four attacks',async()=>{
 const fixture=await feedbackFixture(),cutoffAt=Date.parse(fixture.calendar.days[70]+'T23:59:59.999+08:00');
 const before=JSON.stringify(fixture.state),result=await A.numericCausalDiagnostics({archive:fixture.state,asOf:fixture.now,cutoffAt});
 assert.equal(result.status,'pass',JSON.stringify(result));assert.equal(result.executed,true);assert.ok(result.trainingRows>=12);
 assert.equal(result.checks.length,4);assert.ok(result.checks.every(c=>c.status==='pass'));assert.ok(result.scorable>0);
 assert.match(result.evaluator,/fitNumericModel/);assert.equal(result.productionWeightsChanged,false);
 assert.equal(JSON.stringify(fixture.state),before);
 const changed=structuredClone(fixture.state);changed.trades[0].pnl=9999;
 const rechecked=await A.numericCausalDiagnostics({archive:changed,asOf:fixture.now,cutoffAt});
 assert.notEqual(rechecked.trainingFingerprint,result.trainingFingerprint,'an actual prior invalid settlement must affect eligibility');
 assert.notEqual(rechecked.modelFingerprint,result.modelFingerprint);
});
test('numeric audit does not mistake insufficient, teaching or budget-exhausted input for a passing model',async()=>{
 assert.equal((await A.numericCausalDiagnostics({archive:{scope:'live'},asOf:at(39)})).status,'not-evaluated');
 const fixture=await feedbackFixture();
 const teaching=await A.numericCausalDiagnostics({archive:{...fixture.state,scope:'demo'},asOf:fixture.now});
 assert.equal(teaching.status,'not-evaluated');assert.equal(teaching.executed,false);
 const expired=await A.numericCausalDiagnostics({archive:fixture.state,asOf:fixture.now,deadlineAt:Date.now()-1});
 assert.equal(expired.status,'not-evaluated');assert.match(expired.reason,/预算/);
});
test('effective numeric inputs change at actual maturity boundaries and stay stable between them',async()=>{
 const {state}=await feedbackFixture(),cutoffAt=Math.max(...state.trades.map(row=>Date.parse(row.createdAt)));
 const before=JSON.stringify(state);
 const exact=await A.numericDiagnosticInputState({archive:state,cutoffAt});
 const justAfter=await A.numericDiagnosticInputState({archive:state,cutoffAt:cutoffAt+1});
 const later=await A.numericDiagnosticInputState({archive:state,cutoffAt:cutoffAt+1000});
 assert.equal(exact.status,'ready');assert.equal(exact.rows.length,505);assert.equal(justAfter.rows.length,510);
 assert.deepEqual(justAfter,later,'no query-clock field may expire an unchanged effective input');
 assert.equal(Object.hasOwn(exact,'cutoffAt'),false);assert.equal(exact.scoringVectors.length,5);
 const changed=structuredClone(state);changed.checks[0].factorObservations['TL-01'].value+=1;
 const revised=await A.numericDiagnosticInputState({archive:changed,cutoffAt:cutoffAt+1});
 assert.equal(revised.rows.length,justAfter.rows.length);assert.notDeepEqual(revised.rows,justAfter.rows,'unchanged row IDs do not hide changed factor evidence');
 assert.equal(JSON.stringify(state),before);
});
test('combined model audit preserves missing original Python as an independent unresolved condition',async()=>{
 const fixture=await feedbackFixture(),result=await A.modelCausalDiagnostics({archive:fixture.state,asOf:fixture.now,cutoff:fixture.calendar.days[70]});
 assert.equal(result.numeric.status,'pass');assert.equal(result.python.status,'not-evaluated');assert.equal(result.status,'not-evaluated');
 assert.equal(result.externalModelsInvoked,false);assert.ok(result.modelLibrary.tests.includes('tests/model-research.test.js'));
});
