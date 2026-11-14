'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {inspectLearningRuntime}=require('../src/core/learning-runtime-preflight');
const {runAgent}=require('../src/core/factor-research-agent');
const now=Date.parse('2026-09-21T08:04:00Z');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-preflight-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cycle={schemaVersion:1,mode:'v6-factor-daily-research-cycle',researchOnly:true,canTrade:false};
 for(const key of ['historyFile','picksFile','factorsFile','marketFile','captureDir','trackingDir','manifestFile','neutralDir','modelDir'])cycle[key]=path.join(dir,key);
 const config={schemaVersion:1,mode:'v6-factor-research-agent',researchOnly:true,canTrade:false,cycle,outputDir:path.join(dir,'memory')};
 const file=path.join(dir,'agent.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 return {dir,cycle,config,file,env:{V6_FACTOR_AGENT_CONFIG_FILE:file}};
}
test('unconfigured has no side effects and no network by default',async()=>{
 const report=await inspectLearningRuntime({env:{},now});
 assert.equal(report.overall,'unconfigured');assert.equal(report.model.status,'disabled');assert.equal(report.current.status,'unconfigured');
});
test('private configuration, matching memory, missing data and journal corruption',async t=>{
 const {dir,config,file,env}=fixture(t),before=fs.readdirSync(dir);
 let report=await inspectLearningRuntime({env,now});
 assert.equal(report.overall,'needs-data');assert.equal(report.current.status,'needs-data');assert.deepEqual(fs.readdirSync(dir),before);
 report=await inspectLearningRuntime({env:{...env,V6_FACTOR_AGENT_DIR:path.join(dir,'other')},now});
 assert.equal(report.configuration.status,'memory-mismatch');assert.equal(report.lastRun,null);
 fs.chmodSync(file,0o644);assert.equal((await inspectLearningRuntime({env,now})).overall,'blocked');fs.chmodSync(file,0o600);
 const link=path.join(dir,'alias');fs.symlinkSync(file,link);assert.equal((await inspectLearningRuntime({env:{V6_FACTOR_AGENT_CONFIG_FILE:link},now})).overall,'blocked');
 runAgent(config,{apply:true,now});
 report=await inspectLearningRuntime({env,now:now+1});assert.equal(report.current.status,'needs-data');assert.equal(report.overall,'needs-data');assert.equal(report.lastRun.status,'needs-data');
 fs.appendFileSync(path.join(config.outputDir,fs.readdirSync(config.outputDir)[0]),'broken');
 report=await inspectLearningRuntime({env,now:now+2});assert.equal(report.overall,'blocked');assert.equal(report.lastRun,null);assert.equal(JSON.stringify(report).includes(dir),false);
});
test('model probe is opt-in, strict, bounded and never sends chat',async t=>{
 const digest='a'.repeat(64),requests=[];let reply={models:[{name:'qwen:1',digest:'sha256:'+digest}]},status=200;
 const server=http.createServer((req,res)=>{requests.push(req.url);res.statusCode=status;res.end(typeof reply==='string'?reply:JSON.stringify(reply));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const env={V6_LOCAL_LEARNING_MODEL:'qwen:1',V6_LOCAL_LEARNING_DIGEST:digest,V6_LOCAL_LEARNING_ENDPOINT:`http://127.0.0.1:${server.address().port}`};
 let report=await inspectLearningRuntime({env,now});assert.equal(report.model.status,'not-probed');assert.deepEqual(requests,[]);
 report=await inspectLearningRuntime({env,now,probeModel:true});assert.equal(report.overall,'unconfigured');assert.equal(report.model.status,'verified');assert.equal(report.model.inferenceVerified,false);assert.deepEqual(requests,['/api/tags']);
 reply={models:[{name:'qwen:1',digest:'b'.repeat(64)}]};assert.equal((await inspectLearningRuntime({env,now,probeModel:true})).model.status,'digest-mismatch');
 reply={models:[{name:'qwen:1',digest},{name:'qwen:1',digest}]};assert.equal((await inspectLearningRuntime({env,now,probeModel:true})).model.status,'digest-mismatch');
 status=302;assert.equal((await inspectLearningRuntime({env,now,probeModel:true})).model.status,'unavailable');
 status=200;reply='x'.repeat(65537);assert.equal((await inspectLearningRuntime({env,now,probeModel:true})).model.status,'unavailable');
 for(const endpoint of ['http://127.0.0.1:80','http://127.0.0.1:00080','http://localhost:11434','http://127.1:11434','http://user@127.0.0.1:11434','http://127.0.0.1:11434/a','http://127.0.0.1:11434?x'])assert.equal((await inspectLearningRuntime({env:{...env,V6_LOCAL_LEARNING_ENDPOINT:endpoint},now})).model.status,'invalid-config');
 report=await inspectLearningRuntime({env:{...env,V6_LOCAL_LEARNING_DIGEST:'sha256:'+digest},now});assert.equal(report.model.status,'not-probed');assert.equal(report.model.modelDigest,digest);
});
test('untrusted environment cannot forge actual agent preview',async t=>{
 const {env}=fixture(t);
 const report=await inspectLearningRuntime({env:{...env,V6_LOCAL_LEARNING_MODEL:'x',V6_LOCAL_LEARNING_DIGEST:'a'.repeat(64)},now});
 assert.equal(report.current.status,'blocked');assert.equal(report.overall,'blocked');
});
test('historical completion cannot hide missing current inputs and a failed journal remains latched',async t=>{
 const crypto=require('node:crypto'),{dir,config,env}=fixture(t);
 runAgent(config,{apply:true,now});
 const oldPath=path.join(config.outputDir,fs.readdirSync(config.outputDir)[0]);
 const old=JSON.parse(fs.readFileSync(oldPath));
 function replace(outcome,status){
  const {fingerprint,...body}=old;body.outcome=outcome;body.summary.status=status;
  body.summary.nextAction=outcome==='failed'?'audit-private-research-artifacts-before-retry':'await-next-source-or-research-lineage';
  body.inputFingerprint='b'.repeat(64);body.settledFingerprint='c'.repeat(64);
  const id=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  for(const name of fs.readdirSync(config.outputDir))fs.unlinkSync(path.join(config.outputDir,name));
  fs.writeFileSync(path.join(config.outputDir,`event-00000001-${id.slice(0,12)}.json`),JSON.stringify({...body,fingerprint:id}),{mode:0o600});
 }
 replace('completed','research-cycle-completed-not-certified');
 let report=await inspectLearningRuntime({env,now:now+1});
 assert.equal(report.lastRun.status,'research-cycle-completed-not-certified');assert.equal(report.current.status,'needs-data');assert.equal(report.overall,'needs-data');
 replace('failed','failed-stop-and-audit-before-retry');
 const archives=path.join(config.cycle.trackingDir,'2026-09-21','forward-tracking-history');fs.mkdirSync(archives,{recursive:true});
 const h5=path.join(archives,'00000002-2026-09-21.json');fs.writeFileSync(h5,'private future answer');
 const original=fs.readFileSync;let opened=false;
 t.mock.method(fs,'readFileSync',function(file,...args){if(file===h5)opened=true;return original.call(fs,file,...args);});
 report=await inspectLearningRuntime({env,now:now+86400000});
 assert.equal(report.overall,'blocked');assert.equal(report.current.status,'blocked');assert.equal(report.lastRun.status,'failed-stop-and-audit-before-retry');assert.equal(opened,false);assert.equal(JSON.stringify(report).includes(dir),false);
});
test('probe has a five second total timeout',async t=>{
 const server=http.createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>server.closeAllConnections());t.after(()=>server.close());
 const env={V6_LOCAL_LEARNING_MODEL:'m',V6_LOCAL_LEARNING_DIGEST:'a'.repeat(64),V6_LOCAL_LEARNING_ENDPOINT:`http://127.0.0.1:${server.address().port}`};
 const start=Date.now(),report=await inspectLearningRuntime({env,probeModel:true});
 assert.equal(report.model.status,'unavailable');assert.ok(Date.now()-start>=4500&&Date.now()-start<7500);
});
function readyFixture(t){
 const f=fixture(t),days=[];
 for(let n=70;n>=0;n--){const date=new Date(now-n*86400000);if(![0,6].includes(date.getUTCDay()))days.push(date.toISOString().slice(0,10));}
 const stocks=['600001','600002','600003','000001','000002'],day=days.at(-1),stamp=Date.parse(day+'T15:00:00+08:00');
 const history={schemaVersion:1,source:'imported',provider:'unit-research-only',datasetId:'frozen-test-daily',priceBasis:'unadjusted',asOf:day,observedAt:now-60000,
  stocks:stocks.map((symbol,j)=>({symbol,corporateActions:[],bars:days.map((date,i)=>({date,open:10+j+i*.04,high:10.08+j+i*.04,low:9.92+j+i*.04,close:10+j+i*.04,volume:200+i,priceBasis:'unadjusted',suspended:false}))}))};
 const picks={asOf:now-165000,board:'all',totalScanned:3200,count:5,items:stocks.map(code=>({code,hit:[{id:1,text:'unit synthetic probe'}],hitIds:[1]}))};
 const provider='unit-point-in-time';
 const factors={schemaVersion:1,feed:{source:'imported',provider,datasetId:'unit-factor-snapshot'},asOf:now-180000,rows:stocks.map((code,j)=>({code,feed:{source:provider,timestamp:stamp},sectorHeatScore:25+j*10,leaderStrengthScore:80-j*7,industryCode:j<3?'SW_A':'SW_B',industryEvidence:{code,source:provider,timestamp:stamp,classificationVersion:'synthetic-taxonomy-v1'},factorEvidence:{sectorHeatScore:{code,source:provider,timestamp:stamp},leaderStrengthScore:{code,source:provider,timestamp:stamp}}}))};
 for(const [key,value] of Object.entries({historyFile:history,picksFile:picks,factorsFile:factors}))fs.writeFileSync(f.cycle[key],JSON.stringify(value));
 return f;
}
test('ready preview and an unchanged plan with stale source checks are distinguished',async t=>{
 const f=readyFixture(t);
 let report=await inspectLearningRuntime({env:f.env,now});
 assert.equal(report.current.status,'preview-ready');assert.equal(report.overall,'ready-for-research');
 assert.equal(runAgent(f.config,{apply:true,now}).status,'research-cycle-completed-not-certified');
 assert.equal(runAgent(f.config,{now:now+1}).status,'unchanged');
 // The source bridge requires observations at or after 16:00 local, so an
 // eight-hour same-day expiry is unreachable today. Simulate that boundary
 // while retaining the actual unchanged journal and causal input fixture.
 const cycle=require('../src/core/factor-daily-research-cycle');
 t.mock.method(cycle,'checkSource',()=>({status:'skip-source-observation-too-old'}));
 const modulePath=require.resolve('../src/core/learning-runtime-preflight');
 delete require.cache[modulePath];
 const fresh=require(modulePath).inspectLearningRuntime;
 try{report=await fresh({env:f.env,now:now+1});}finally{delete require.cache[modulePath];}
 assert.equal(report.lastRun.status,'research-cycle-completed-not-certified');assert.equal(report.current.status,'needs-data');assert.equal(report.current.nextAction,'provide-current-day-authorized-source');assert.equal(report.overall,'needs-data');
});
test('CLI uses exit codes for ready, waiting and blocked',t=>{
 const {spawnSync}=require('node:child_process'),f=readyFixture(t);
 const hook=path.join(f.dir,'clock.cjs');fs.writeFileSync(hook,`Date.now=()=>${now};`);
 const cli=path.join(__dirname,'../scripts/learning-runtime-preflight.js');
 const env={...process.env,...f.env};delete env.V6_FACTOR_AGENT_DIR;delete env.V6_LOCAL_LEARNING_MODEL;delete env.V6_LOCAL_LEARNING_ENDPOINT;delete env.V6_LOCAL_LEARNING_DIGEST;
 function run(){const r=spawnSync(process.execPath,['-r',hook,cli],{env,encoding:'utf8'});assert.equal(r.stderr,'');return {code:r.status,report:JSON.parse(r.stdout)};}
 let result=run();assert.equal(result.code,0);assert.equal(result.report.overall,'ready-for-research');
 fs.unlinkSync(f.cycle.historyFile);result=run();assert.equal(result.code,2);assert.equal(result.report.overall,'needs-data');
 fs.chmodSync(f.file,0o644);result=run();assert.equal(result.code,1);assert.equal(result.report.overall,'blocked');
});
