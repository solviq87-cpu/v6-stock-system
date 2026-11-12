'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {runAgent,readAgentStatus,validateConfig}=require('../src/core/factor-research-agent');
const {main,parse}=require('../scripts/factor-research-agent');
const {preregisterCandidate}=require('../src/core/factor-candidate-prereg');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=Date.parse('2026-09-21T16:04:00+08:00');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'factor-agent-'));
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const cycle={schemaVersion:1,mode:'v6-factor-daily-research-cycle',researchOnly:true,canTrade:false};
 for(const key of ['historyFile','picksFile','factorsFile','marketFile','captureDir','trackingDir','manifestFile','neutralDir','modelDir'])
  cycle[key]=path.join(dir,key+(key.endsWith('File')?'.json':''));
 const days=[];
 for(let n=70;n>=0;n--){const date=new Date(now-n*86400000);if(![0,6].includes(date.getUTCDay()))days.push(date.toISOString().slice(0,10));}
 const stocks=['600001','600002','600003','000001','000002'],day=days.at(-1),stamp=Date.parse(day+'T15:00:00+08:00');
 const history={schemaVersion:1,source:'imported',provider:'unit-research-only',datasetId:'frozen-test-daily',priceBasis:'unadjusted',asOf:day,observedAt:now-60000,
  stocks:stocks.map((symbol,j)=>({symbol,corporateActions:[],bars:days.map((date,i)=>({date,open:10+j+i*.04,high:10.08+j+i*.04,low:9.92+j+i*.04,close:10+j+i*.04,volume:200+i,priceBasis:'unadjusted',suspended:false}))}))};
 const picks={asOf:now-165000,board:'all',totalScanned:3200,count:5,items:stocks.map(code=>({code,hit:[{id:1,text:'unit synthetic probe'}],hitIds:[1]}))};
 const provider='unit-point-in-time';
 const factors={schemaVersion:1,feed:{source:'imported',provider,datasetId:'unit-factor-snapshot'},asOf:now-180000,rows:stocks.map((code,j)=>({code,feed:{source:provider,timestamp:stamp},sectorHeatScore:25+j*10,leaderStrengthScore:80-j*7,industryCode:j<3?'SW_A':'SW_B',industryEvidence:{code,source:provider,timestamp:stamp,classificationVersion:'synthetic-taxonomy-v1'},factorEvidence:{sectorHeatScore:{code,source:provider,timestamp:stamp},leaderStrengthScore:{code,source:provider,timestamp:stamp}}}))};
 for(const [key,value] of Object.entries({historyFile:history,picksFile:picks,factorsFile:factors}))fs.writeFileSync(cycle[key],JSON.stringify(value));
 const config={schemaVersion:1,mode:'v6-factor-research-agent',researchOnly:true,canTrade:false,cycle,outputDir:path.join(dir,'agent')};
 const file=path.join(dir,'agent-settings.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 return {dir,config,file};
}
const tree=dir=>fs.readdirSync(dir,{recursive:true}).sort();
test('default agent and CLI preview use real causal source, choose capture and write zero bytes',t=>{
 const {dir,config,file}=setup(t),before=tree(dir);
 const preview=runAgent(config,{now});
 assert.equal(preview.status,'preview-ready');assert.equal(preview.nextAction,'run-capture-research-cycle');
 assert.equal(main(['once',file],{now}).status,'preview-ready');
 assert.deepEqual(tree(dir),before);assert.equal(preview.canTrade,false);
 assert.equal(fs.existsSync(config.outputDir),false);
});
test('perceive, execute, reflect and immutable memory remain idempotent across restart',t=>{
 const {dir,config}=setup(t),first=runAgent(config,{apply:true,now});
 assert.equal(first.status,'research-cycle-completed-not-certified');assert.equal(first.captureDays,1);
 assert.equal(first.shadowStatus,'skipped-insufficient-matured-h5-days');
 assert.equal(first.nextAction,'await-next-source-or-research-lineage');
 const before=tree(dir),status=readAgentStatus(config.outputDir);
 assert.equal(status.eventFingerprint,first.eventFingerprint);
 assert.equal(runAgent(config,{apply:true,now:now+1}).status,'unchanged');
 const key=require.resolve('../src/core/factor-research-agent');delete require.cache[key];
 const restarted=require(key).runAgent(config,{apply:true,now:now+2});
 assert.equal(restarted.eventFingerprint,first.eventFingerprint);assert.deepEqual(tree(dir),before);
 for(const name of fs.readdirSync(config.outputDir))assert.equal(fs.statSync(path.join(config.outputDir,name)).mode&0o777,0o600);
 assert.equal(JSON.stringify(status).includes(dir),false);
});
test('changed sealed preregistration lineage revisits even when source is unchanged',t=>{
 const {config}=setup(t);runAgent(config,{apply:true,now});
 fs.mkdirSync(config.cycle.modelDir);
 const frozen=JSON.parse(fs.readFileSync(path.join(config.cycle.captureDir,'features-2026-09-21.json'),'utf8'));
 const features=Array.from({length:36},(_,i)=>({...frozen,
  signalDay:new Date(now-(36-i)*86400000).toISOString().slice(0,10),fingerprint:hash(i)}));
 const weights=Object.fromEntries(frozen.factors.map(f=>[f.id,f.baseWeight]));
 const prereg=preregisterCandidate({features,candidateWeights:weights,acceptedWeights:weights,
  registeredAt:now,packFingerprint:frozen.packFingerprint});
 const file=path.join(config.cycle.modelDir,'prereg-'+prereg.fingerprint.slice(0,12)+'.json');
 fs.writeFileSync(file,JSON.stringify(prereg));
 const next=runAgent(config,{apply:true,now:now+1});
 assert.equal(next.status,'research-cycle-completed-not-certified');
 assert.equal(fs.readdirSync(config.outputDir).length,2);
 const event=JSON.parse(fs.readFileSync(path.join(config.outputDir,fs.readdirSync(config.outputDir).sort()[1]),'utf8'));
 assert.equal(event.sequence,2);assert.equal(event.action,'observe');assert.ok(event.parentMemory);
});
test('H5 payloads are never opened by perception or preview',t=>{
 const {config}=setup(t);runAgent(config,{apply:true,now});
 const archives=path.join(config.cycle.trackingDir,'2026-09-21','forward-tracking-history');
 fs.mkdirSync(archives,{recursive:true});
 fs.writeFileSync(path.join(archives,'00000002-2026-09-21.json'),'INVALID FORWARD RETURN JSON MUST NOT BE READ');
 const result=runAgent(config,{now:now+1});
 assert.equal(result.status,'preview-ready');assert.equal(result.nextAction,'run-observe-research-cycle');
});
test('missing current-day data gives actionable needs-data status with no provider/path leakage',t=>{
 const {config,dir}=setup(t);fs.unlinkSync(config.cycle.historyFile);
 assert.equal(runAgent(config,{now}).status,'needs-data');
 const result=runAgent(config,{apply:true,now});
 assert.equal(result.nextAction,'provide-current-day-authorized-source');
 assert.equal(JSON.stringify(result).includes(dir),false);assert.equal(fs.existsSync(config.cycle.captureDir),false);
 assert.equal(runAgent(config,{apply:true,now:now+1}).status,'unchanged');
});
test('journal tampering, conflicting lineage, locks, overlap and aliases fail closed',t=>{
 const {config,dir}=setup(t);runAgent(config,{apply:true,now});
 const event=path.join(config.outputDir,fs.readdirSync(config.outputDir)[0]);fs.appendFileSync(event,'tamper');
 assert.throws(()=>runAgent(config,{now}),/stopped-check-private/);
 assert.equal(readAgentStatus(config.outputDir).status,'blocked-invalid-agent-journal');
 assert.throws(()=>validateConfig({...config,outputDir:path.join(config.cycle.captureDir,'agent')}),/overlap/);
 assert.throws(()=>validateConfig({...config,outputDir:dir}),/overlap/);
 assert.throws(()=>validateConfig({...config,outputDir:path.join(dir,'config','agent')}),/private-path/);
 const alias=path.join(dir,'alias');fs.symlinkSync(dir,alias);
 assert.throws(()=>validateConfig({...config,outputDir:path.join(alias,'agent2')}),/符号链接/);
});
test('lock and sealed model tampering are rejected before worker execution',t=>{
 const {config}=setup(t);fs.mkdirSync(config.outputDir);
 const lock=path.join(config.outputDir,'.factor-agent.lock');fs.writeFileSync(lock,'existing');
 assert.throws(()=>runAgent(config,{apply:true,now}),/stopped-check-private/);
 assert.equal(fs.readFileSync(lock,'utf8'),'existing');fs.unlinkSync(lock);
 fs.mkdirSync(config.cycle.modelDir);fs.writeFileSync(path.join(config.cycle.modelDir,'prereg-aaaaaaaaaaaa.json'),JSON.stringify({mode:'v6-shadow-candidate-prereg-v1',fingerprint:'a'.repeat(64)}));
 assert.throws(()=>runAgent(config,{apply:true,now}),/stopped-check-private/);
 assert.equal(fs.existsSync(config.cycle.captureDir),false);
});
test('execution failure is reflected without raw errors and never becomes a cached success',t=>{
 const {config,dir}=setup(t);
 const lock=path.join(dir,'.factor-research-cycle.lock');fs.writeFileSync(lock,'provider payload /secret');
 const result=runAgent(config,{apply:true,now});
 assert.equal(result.status,'failed-stop-and-audit-before-retry');
 assert.equal(result.nextAction,'audit-private-research-artifacts-before-retry');
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.equal(readAgentStatus(config.outputDir).status,result.status);
 assert.equal(runAgent(config,{apply:true,now:now+1}).status,result.status);
 assert.equal(fs.readFileSync(lock,'utf8'),'provider payload /secret');
 assert.equal(fs.existsSync(config.cycle.captureDir),false);
});
test('partial writes latch a failure across evidence changes and restart until exact manual acknowledgment',t=>{
 const {config,file}=setup(t);
 // The maturity writer fails after real market and capture archives have
 // been published, exercising an interrupted multi-file cycle.
 fs.mkdirSync(config.cycle.trackingDir);
 const maturityLock=path.join(config.cycle.trackingDir,'.factor-maturity-link.lock');
 fs.writeFileSync(maturityLock,'fixture active maturity writer');
 const failed=runAgent(config,{apply:true,now});
 assert.equal(failed.status,'failed-stop-and-audit-before-retry');
 assert.ok(fs.existsSync(path.join(config.cycle.captureDir,'receipt-2026-09-21.json')));
 assert.ok(fs.existsSync(config.cycle.marketFile));
 const firstFile=path.join(config.outputDir,fs.readdirSync(config.outputDir)[0]);
 const firstBytes=fs.readFileSync(firstFile);
 fs.unlinkSync(maturityLock);
 const before=tree(config.outputDir);
 assert.equal(runAgent(config,{apply:true,now:now+1}).status,failed.status);
 // A new source revision/date does not authorize another attempt either.
 const sourceBytes=fs.readFileSync(config.cycle.historyFile);
 const input=JSON.parse(sourceBytes);
 input.observedAt=now-30000;fs.writeFileSync(config.cycle.historyFile,JSON.stringify(input));
 const key=require.resolve('../src/core/factor-research-agent');delete require.cache[key];
 const restarted=require(key).runAgent;
 assert.equal(restarted(config,{apply:true,now:now+86400000}).status,failed.status);
 assert.equal(restarted(config,{now:now+2}).status,failed.status);
 assert.deepEqual(tree(config.outputDir),before);
 assert.equal(fs.existsSync(config.cycle.neutralDir),false);
 assert.throws(()=>main(['once',file,'--apply','--ack-failure','0'.repeat(64)],{now:now+3}),/stopped-check-private/);
 assert.deepEqual(tree(config.outputDir),before);
 fs.writeFileSync(config.cycle.historyFile,sourceBytes);
 const recovered=main(['once',file,'--apply','--ack-failure',failed.eventFingerprint],{now:now+4});
 assert.equal(recovered.status,'research-cycle-completed-not-certified');
 assert.ok(fs.statSync(config.cycle.neutralDir).isDirectory());
 assert.deepEqual(fs.readFileSync(firstFile),firstBytes);
 const files=fs.readdirSync(config.outputDir).sort();assert.equal(files.length,2);
 const secondFile=path.join(config.outputDir,files[1]);
 const second=JSON.parse(fs.readFileSync(secondFile,'utf8'));
 assert.equal(second.parentMemory,failed.eventFingerprint);
 assert.equal(second.acknowledgedFailure,failed.eventFingerprint);
 assert.equal(readAgentStatus(config.outputDir).eventFingerprint,recovered.eventFingerprint);
 assert.throws(()=>main(['once',file,'--apply','--ack-failure',failed.eventFingerprint],{now:now+5}),/stopped-check-private/);
 // Rehashing an event cannot erase the required failed-parent acknowledgment.
 second.acknowledgedFailure=null;delete second.fingerprint;second.fingerprint=hash(second);
 const renamed=path.join(config.outputDir,'event-00000002-'+second.fingerprint.slice(0,12)+'.json');
 fs.renameSync(secondFile,renamed);fs.writeFileSync(renamed,JSON.stringify(second));
 assert.equal(readAgentStatus(config.outputDir).status,'blocked-invalid-agent-journal');
});
test('watch stops immediately when execution returns a failed reflection',t=>{
 const {config,file,dir}=setup(t);
 fs.writeFileSync(path.join(dir,'.factor-research-cycle.lock'),'fixture active writer');
 const priorSetTimeout=global.setTimeout,priorNow=Date.now,outputs=[];let scheduled=0;
 global.setTimeout=()=>{scheduled++;return 1;};
 Date.now=()=>now;
 try{
  const watch=main(['watch',file,'--apply'],{emit:value=>outputs.push(value)});
  assert.equal(outputs.length,1);
  assert.equal(outputs[0].status,'failed-stop-and-audit-before-retry');
  assert.equal(scheduled,0);watch.stop();
  assert.equal(fs.existsSync(config.cycle.captureDir),false);
 }finally{global.setTimeout=priorSetTimeout;Date.now=priorNow;}
});
test('watch requires opt-in and bounded interval; aborted watch starts no execution',t=>{
 const {config,file}=setup(t);
 assert.throws(()=>parse(['watch',file]),/explicit-apply/);
 assert.throws(()=>parse(['watch',file,'--apply','--interval','29999']),/minimum/);
 assert.throws(()=>parse(['once',file,'--apply','--interval','30000']),/usage/);
 assert.equal(parse(['watch',file,'--apply']).interval,30000);
 const controller=new AbortController();controller.abort();
 const watch=main(['watch',file,'--apply'],{signal:controller.signal,emit:()=>assert.fail('aborted')});
 watch.stop();assert.equal(fs.existsSync(config.outputDir),false);
 assert.equal(readAgentStatus().status,'unconfigured');
 assert.throws(()=>parse(['watch',file,'--apply','--ack-failure','a'.repeat(64)]),/usage/);
 assert.throws(()=>parse(['once',file,'--ack-failure','a'.repeat(64)]),/requires-explicit-apply/);
 assert.throws(()=>parse(['once',file,'--apply','--ack-failure','invalid']),/ack-rejected/);
 assert.throws(()=>parse(['once',file,'--apply','--ack-failure','a'.repeat(64),'--ack-failure','a'.repeat(64)]),/usage/);
});

test('watch rejects timer-overflow intervals instead of polling every millisecond',()=>{
 assert.throws(()=>parse(['watch','/tmp/agent-config.json','--apply','--interval','2147483648']),/maximum/);
});
