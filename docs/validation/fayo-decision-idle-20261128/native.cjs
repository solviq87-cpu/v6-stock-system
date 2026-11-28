'use strict';
// Original authenticated service, isolated empty account and synthetic clock.
// There are no invented candidates, supplier calls, messages or transactions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS;assert.ok(out);fs.mkdirSync(out,{recursive:true});
const now=Date.parse('2026-11-27T10:00:00+08:00'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-idle-clock-')),clock=path.join(dir,'clock');fs.writeFileSync(clock,String(now));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),base='86da6ec5064e5e5eee048f4a17900f2c41d361b9';
(async()=>{const f=await createFixture({count:0,clockFile:clock});try{
 if(process.env.FAYO_IDLE_BASELINE==='1')fs.writeFileSync(path.join(f.tmp,'public/nova/decision-view.mjs'),execFileSync('git',['show',base+':V6_BO/public/nova/decision-view.mjs']));
 const http=await f.request('/api/decision-center');assert.equal(http.status,200);assert.equal(http.body.cards.length,0);
 const r=spawnSync('python',[path.join(__dirname,'browser.py')],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,now,output:out,baseline:process.env.FAYO_IDLE_BASELINE==='1'}),encoding:'utf8',timeout:180000});assert.equal(r.status,0,r.stderr.slice(-3000));
 const files=['public/nova/decision-view.mjs','public/nova/app.js','public/nova/ui.js','public/nova/client.js'];
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineRef:base,baseline:process.env.FAYO_IDLE_BASELINE==='1',decisionHttp:http.status,noCandidates:true,syntheticClock:true,sourceHashes:Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(p))])),servedViewSha256:sha(fs.readFileSync(path.join(f.tmp,'public/nova/decision-view.mjs')))},null,2)+'\n');
 console.log(fs.readFileSync(path.join(out,'browser.json'),'utf8'));
 }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});
