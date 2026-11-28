'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const root=path.resolve('..'),out=process.env.FAYO_STUDY_RECEIPTS;assert.ok(out);fs.mkdirSync(out,{recursive:true});
const history=JSON.parse(fs.readFileSync(path.join(__dirname,'history.json'))),now=Date.parse('2026-11-28T10:00:00+08:00'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-comparison-clock-')),clock=path.join(dir,'clock');fs.writeFileSync(clock,String(now));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
(async()=>{const f=await createFixture({count:0,clockFile:clock});try{
 const before=await f.request('/api/research/complete-run','POST',{history});assert.equal(before.status,200);assert.equal(before.body.ok,true);assert.equal(before.body.result.strategyComparison,undefined);
 const t=performance.now(),after=await f.request('/api/research/complete-run','POST',{history,includeStrategyComparison:true}),elapsed=performance.now()-t;
 assert.equal(after.status,200);assert.equal(after.body.ok,true);const v=after.body.result.strategyComparison;assert.equal(v.totalCandidateSignals,89);assert.equal(v.commonEvaluatedSignals,0);assert.ok(v.systems.every(s=>s.paperReturnPct===null&&s.coverage.unknown===89));
 for(const k of ['backtest','paper','strategies','reconciliation'])assert.deepEqual(after.body.result[k],before.body.result[k]);
 const viewer=await f.request('/api/research/complete-run','POST',{history,includeStrategyComparison:true},f.viewerToken);assert.equal(viewer.body.ok,false);assert.equal(viewer.body.readOnly,true);assert.equal(viewer.body.result,undefined);
 const bad=await f.request('/api/research/complete-run','POST',{history,includeStrategyComparison:'true'});assert.equal(bad.body.ok,false);assert.match(bad.body.error,/布尔/);assert.equal(bad.body.result,undefined);
 const invalid=await f.request('/api/research/complete-run','POST',{history,includeStrategyComparison:true,strategyComparisonConfig:{feeBps:-1}});assert.equal(invalid.status,200);assert.equal(invalid.body.result.strategyComparison.status,'unavailable');assert.deepEqual(invalid.body.result.paper,before.body.result.paper);
 const r=spawnSync('python',[path.join(__dirname,'browser.py')],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out,history:path.join(__dirname,'history.json'),now,expectedDatasetFingerprint:v.datasetFingerprint,expectedProtocolFingerprint:v.protocolFingerprint}),encoding:'utf8',timeout:240000});assert.equal(r.status,0,r.stderr.slice(-3500));
 const files=['src/core/complete-workbench.js','src/core/unified-strategy-project.js','src/core/strategy-portfolio-lab.js','public/nova/research.js','public/nova/strategy-comparison-view.mjs','tests/helpers/v6-studio-fixture.js'];
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(p))])),actualHistoricalSource:'sina',newSupplierRequests:0,inputRawHash:history.rawHash,controls:{withoutComparison:200,comparison:200,viewer:{http:viewer.status,denied:true,readOnly:true},malformedFlag:{http:bad.status,rejected:true},invalidConfigUnavailable:200,originalOutputsUnchanged:true},workerRoundTripMs:elapsed,comparison:v,noActualPortfolio:true,clockIsControlled:true},null,2)+'\n');
 console.log(JSON.stringify({controls:5,total:89,common:0,workerRoundTripMs:elapsed,browserWidths:[1366,390,320]}));
 }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});
