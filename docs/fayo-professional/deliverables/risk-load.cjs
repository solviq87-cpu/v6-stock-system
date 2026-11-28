'use strict';
// Synthetic CPU contention on the existing two background leases. Risk reads the original paper ledger.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {once}=require('node:events'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
if(!isMainThread){
 const stop=new Int32Array(workerData.stop);parentPort.postMessage('ready');let acc=0,loops=0;const end=performance.now()+12000;
 while(!Atomics.load(stop,0)&&performance.now()<end){for(let i=1;i<=8192;i++)acc+=Math.sqrt(i);loops++;}
 parentPort.postMessage({loops,finite:Number.isFinite(acc)});
}else main().catch(e=>{console.error(e.stack);process.exitCode=1;});
async function main(){
 const load=n=>require(path.resolve(n)),budget=load('src/server/worker-admission-budget'),{runAdvancedAccountRiskJob}=load('src/server/advanced-account-risk-job');
 const {runWorkspaceJob}=load('src/server/research-workspace-job'),{aShareCalendarDate}=load('src/core/a-share-calendar');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-s32-'));const file=path.join(dir,'pool.json');
 const data=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 try{
  const app=load('src/core/paper-application-service').createPaperApplicationService({file});app.initialize(10000);const before=data();
  fs.writeFileSync(path.join(dir,'pre.json'),'invalid peer fixture',{mode:0o600});const samples={idle:[],loaded:[]},rejections=[],endings=[];
  async function risk(tag){const requestAt=Date.now(),start=performance.now();
   const pending=runAdvancedAccountRiskJob({root:dir,day:aShareCalendarDate(requestAt),requestAt,marketOpen:false,continuous:false,quotes:{},replica:false});
   const active=budget.stats();assert.equal(active.risk.active,1);assert.equal(active.background.active,tag==='loaded'?2:0);
   const r=await pending;assert.equal(r.accounts[0].cash,10000);assert.equal(r.accounts[1].status,'unknown');assert.equal(r.status,'incomplete');assert.equal(r.canTrade,false);
   samples[tag].push({ms:+(performance.now()-start).toFixed(3),riskSlots:active.risk.active,backgroundSlots:active.background.active,peer:r.accounts[1].reason});}
  async function underLoad(){const flag=new Int32Array(new SharedArrayBuffer(4)),leases=[],threads=[],completions=[];
   try {for(const kind of ['research','adaptive-research']){const lease=budget.tryAcquire(kind);assert.ok(lease);leases.push(lease);
    const thread=lease.watch(new Worker(__filename,lease.options({stop:flag.buffer})));threads.push(thread);assert.equal((await once(thread,'message'))[0],'ready');completions.push(once(thread,'message'));}
    const t=performance.now(),rejected=await runWorkspaceJob({action:'shortline',root:path.join(dir,'unissued-archive')});
    assert.equal(rejected.ok,false);assert.equal(rejected.httpStatus,503);rejections.push({code:rejected.code,ms:+(performance.now()-t).toFixed(3)});
    await risk('loaded');
   }finally{Atomics.store(flag,0,1);const finished=await Promise.all(completions);for(const [r] of finished){assert.ok(r.finite&&r.loops>0);endings.push(r.loops);}await Promise.all(leases.map(l=>l.stop()));}
  }
  for(let i=0;i<8;i++){if(i%2){await underLoad();await risk('idle');}else{await risk('idle');await underLoad();}}
  assert.equal(data(),before);assert.equal(budget.stats().risk.active,0);assert.equal(budget.stats().background.active,0);
  const q=(a,r)=>[...a].map(x=>x.ms).sort((a,b)=>a-b)[Math.ceil(a.length*r)-1];
  const report={scope:'controlled CPU workers with original admission leases, actual reserved risk worker, isolated cash-only paper account, unreadable peer, declared closed session',node:process.version,cpu:os.cpus()[0].model,sourceTree:require('node:child_process').execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),rejections,workerLoops:endings,samples,latencyMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,{p50:q(v,.5),p95:q(v,.95),n:v.length}])),unchangedAccount:true,published:false,realTraining:false,realMarket:false};
  fs.writeFileSync(path.join(process.env.FAYO_STUDY_RECEIPTS||__dirname,'risk-load.json'),JSON.stringify(report,null,2)+'\n');console.log(report.latencyMs);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
