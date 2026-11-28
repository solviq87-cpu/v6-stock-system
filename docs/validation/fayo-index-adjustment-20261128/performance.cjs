'use strict';
// Paired local cost probe; not a production speedup or an investment-value claim.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{performance}=require('node:perf_hooks');
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname;
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-index-cost-'));try{
 const parent='a3c189692f932915b13f29bf60fadf09a63fd27c',file='V6_BO/public/nova/event-research.mjs';
 const baselineFile=path.join(tmp,'baseline.mjs');fs.writeFileSync(baselineFile,execFileSync('git',['show',parent+':'+file]));
 const baseline=(await import(pathToFileURL(baselineFile).href)).projectNewsEvents,current=(await import(pathToFileURL(path.resolve('public/nova/event-research.mjs')).href)).projectNewsEvents;
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,'news-input.json')))[0],now=Date.now();
 const rows=Array.from({length:200},(_,i)=>({eventHash:(i+1).toString(16).padStart(64,'0'),sequence:i+1,recordedAt:now,evidence:{...input,eventId:'paired-cost-'+i}}));
 const samples={baseline:[],current:[]};let measuredTables=0;
 for(let i=0;i<45;i++)for(const [name,project] of i%2?[['current',current],['baseline',baseline]]:[['baseline',baseline],['current',current]]){
  const started=performance.now(),r=project(rows,now,now),elapsed=performance.now()-started;
  assert.equal(r.rows.length,200);assert.ok(r.rows.every(x=>x.canTrade===false&&x.canNotify===false));
  if(name==='current'){assert.ok(r.rows.every(x=>x.indexAdjustment.tables[0].additions.length===5));measuredTables=r.rows.length;}
  if(i>=5)samples[name].push(elapsed);
 }
 const stats=a=>{const v=a.slice().sort((a,b)=>a-b);return {n:v.length,p50Ms:v[Math.ceil(v.length*.5)-1],p95Ms:v[Math.ceil(v.length*.95)-1],maxMs:v.at(-1)};};
 const receipt={scope:'Same actual excerpt repeated as 200 distinct synthetic events; paired interleaved local warm-process projection cost, 5 warmups + 40 samples per version. Not real-time production latency or a speedup claim.',parent,rowsPerCall:200,tablesPerCurrentCall:measuredTables,baseline:stats(samples.baseline),current:stats(samples.current),samples,hardware:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem()},externalCalls:0,unmeasured:['GPU/VRAM','disk/database load','supplier and queue latency','real mainland/physical device performance']};
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({baseline:receipt.baseline,current:receipt.current}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
