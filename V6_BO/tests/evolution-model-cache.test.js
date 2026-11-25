'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../src/core/intelligence-evolution');
const S=require('../src/core/evolution-research-statistics');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asOf=Date.parse('2026-11-23T14:00:00+08:00');
test('model diagnosis binds original visible numeric inputs, not later archive revisions or future records',async()=>{
 const archive={scope:'main',dictionaryVersion:'original',catalog:[],checks:[],trades:[],plans:[],bars:[]};
 const base=await E.buildEvolutionReport({archive,code:'600001',asOf});
 const diagnostic={kind:'diagnostic',recordedAt:asOf,hash:'a'.repeat(64),data:{protocol:'evolution-diagnostics-v1',code:'600001',asOf,horizon:5,
  historyFingerprint:hash(null),nativeInputsFingerprint:hash(S.diagnosticInputsFromEvents([],null,{asOf})),
  implementationFingerprint:base.sources.implementationFingerprint,modelInputsFingerprint:base.sources.modelInputsFingerprint,
  result:{status:'not-evaluated',reason:'原档案尚无成熟样本'}}};
 const read=state=>E.buildEvolutionReport({archive:state,events:[diagnostic],code:'600001',asOf});
 assert.equal((await read(archive)).sources.diagnosticRecord,diagnostic.hash);
 const future=structuredClone(archive);future.revision=900;future.checks.push({id:'late',code:'600001',createdAt:asOf+1,asOf:asOf+1});
 assert.equal((await read(future)).sources.diagnosticRecord,diagnostic.hash);
 assert.equal((await read(future)).sources.modelInputsFingerprint,base.sources.modelInputsFingerprint);
 const changed=structuredClone(archive);changed.checks.push({id:'known',code:'600001',createdAt:asOf-1,asOf:asOf-1});
 assert.equal((await read(changed)).sources.diagnosticRecord,null,'changed learning inputs invalidate saved diagnosis');
 const unbound=structuredClone(diagnostic);delete unbound.data.modelInputsFingerprint;
 assert.equal((await E.buildEvolutionReport({archive,events:[unbound],code:'600001',asOf})).sources.diagnosticRecord,null,'old receipt cannot certify new actual model execution');
});
test('model cache binds safe operator identity and preserves teaching markers without exposing executable paths',async()=>{
 const archive={sampleScope:'test',checks:[],plans:[],trades:[],bars:[]};
 assert.equal(E.modelDiagnosticArchive(archive,asOf).sampleScope,'test');
 const trusted={identity:{status:'configured',scriptSha256:'a'.repeat(64)},config:{script:'/private/one.py'}};
 const first=await E.modelDiagnosticIdentity(archive,asOf,trusted);
 assert.equal(await E.modelDiagnosticIdentity(archive,asOf,{...trusted,config:{script:'/private/two.py'}}),first,'private path is not serialized into cache identity');
 assert.notEqual(await E.modelDiagnosticIdentity(archive,asOf,{...trusted,identity:{...trusted.identity,scriptSha256:'b'.repeat(64)}}),first);
});
test('strict original settlement maturity invalidates cache while unchanged effective inputs remain reusable',async()=>{
 const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture'),f=await feedbackFixture();
 const boundary=Math.max(...f.state.trades.map(r=>Date.parse(r.createdAt))),trusted={identity:{status:'not-configured'}};
 const first=await E.modelDiagnosticIdentity(f.state,boundary,trusted);
 const matured=await E.modelDiagnosticIdentity(f.state,boundary+1,trusted);
 assert.notEqual(first,matured,'the exact original 505-to-510 training-row boundary invalidates the earlier receipt');
 assert.equal(await E.modelDiagnosticIdentity(f.state,boundary+1000,trusted),matured,'query milliseconds alone do not invalidate the audit');
});
test('nested future factor values do not alter past cache inputs or edit frozen source records',async()=>{
 const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture'),f=await feedbackFixture();
 const cutoff=Date.parse(f.calendar.days[70]+'T23:59:59.999+08:00'),source=structuredClone(f.state),trusted={identity:{status:'not-configured'}};
 source.checks[0].factorObservations['TL-01'].knownAt=cutoff+1;
 const before=JSON.stringify(source),first=await E.modelDiagnosticIdentity(source,cutoff,trusted);
 assert.equal(JSON.stringify(source),before);
 source.checks[0].factorObservations['TL-01'].value=99999;
 assert.equal(await E.modelDiagnosticIdentity(source,cutoff,trusted),first);
});
