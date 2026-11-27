'use strict';
// Original server/authorization/clients, isolated synthetic historical and fresh observations only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname;fs.mkdirSync(out,{recursive:true});if(fs.existsSync(path.join(out,'archive')))throw Error('Use a new evidence output directory; existing archive receipts are preserved');
const today=Date.parse('2026-11-27T10:00:00+08:00'),dates=[];
for(let t=today-86400000;dates.length<20;t-=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.unshift(t);
const day=at=>new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');
const stateFiles=['src/core/index-window-history.js','src/core/index-window-research.js','server.js','public/nova/index-continuity-view.mjs','public/nova/market.js'];
(async()=>{const results=[];for(const kind of ['restored','empty','corrupt']){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'index-history-browser-')),clock=path.join(dir,'clock');fs.writeFileSync(clock,String(today));
 let source=fs.readFileSync('server.js','utf8');const anchor='const indexWindowResearch=createIndexWindowResearch({';assert.equal(source.split(anchor).length,2);
 const seed=`{let now=${dates[0]};const dir=path.join(__dirname,'data','index-window-research');const testRadar=createIndexWindowResearch({historyRoot:dir,clock:()=>now,canPersist:()=>true});const dates=${JSON.stringify(dates)};for(const start of dates){for(let m=0;m<6;m++){now=start+m*60000;const day=new Date(now+28800000).toISOString().slice(0,10).replaceAll('-','');testRadar.observe({day,indices:[{code:'1.000001',price:100+m/10,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}]},{day,trading:true},now);}now=start+301*60000;const day=new Date(now+28800000).toISOString().slice(0,10).replaceAll('-','');testRadar.observe({day,indices:[]},{day,trading:false},now);} ${kind==='corrupt'?`const file=path.join(dir,'${day(dates[0])}','000001.json');const value=JSON.parse(fs.readFileSync(file));value.data.algorithm='corrupted';fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});`:''}}\n`;
 source=source.replace(anchor,(kind==='empty'?'':seed)+anchor);
 const after='const sessionIndices=require(\'./src/core/session-index-feed\').createSessionIndexFeed({';assert.equal(source.split(after).length,2);
 const fresh=`{for(let m=0;m<6;m++){const now=${today}+m*60000;const file=${JSON.stringify(clock)};fs.writeFileSync(file+'.tmp',String(now));fs.renameSync(file+'.tmp',file);const day=new Date(now+28800000).toISOString().slice(0,10).replaceAll('-','');indexWindowResearch.observe({day,indices:[{code:'1.000001',price:m===5?110:100+m/10,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}]},{day,trading:true},now);}}\n`;
 source=source.replace(after,fresh+after);
 const f=await createFixture({count:0,serverSource:source,clockFile:clock});try{
  const r=await f.request('/api/state');assert.equal(r.status,200);const value=r.body.indexWindowResearch;assert.ok(value,JSON.stringify(r.body).slice(0,300));
  assert.equal(value.history.daysLoaded,kind==='restored'?20:0);assert.equal(value.events.length,kind==='restored'?2:0);assert.equal(value.history.status,kind==='restored'?'restored':kind==='empty'?'empty':'unavailable');
  assert.ok(value.events.every(e=>e.canTrade===false&&e.canNotify===false&&e.attribution==='unknown'));assert.equal(value.canTrade,false);
  const viewer=await f.request('/api/state','GET',null,f.viewerToken);assert.equal(viewer.body.indexWindowResearch,undefined);
  const archive=[];if(kind==='restored'){
   const journal=require(path.resolve('src/core/research-workspace-store')),target=path.join(out,'archive');fs.mkdirSync(target,{mode:0o700});
   for(const date of dates){const d=day(date),src=path.join(f.tmp,'data','index-window-research',d),event=journal.readEvents(src)[0],dest=path.join(target,d);fs.mkdirSync(dest,{mode:0o700});const raw=fs.readFileSync(path.join(src,'000001.json'));fs.writeFileSync(path.join(dest,'000001.json'),raw,{mode:0o600});archive.push({day:d,eventHash:event.hash,fileSha256:crypto.createHash('sha256').update(raw).digest('hex'),bytes:raw.length});}
   assert.ok(value.events.every(e=>e.references.every(r=>archive.some(a=>a.day===r.date&&a.eventHash===r.archiveHash))));
  }
  const label=kind==='restored'?'已恢复 20 日已封存的分钟研究样本':kind==='empty'?'尚无可恢复的分钟研究样本':'分钟研究档案不可用，基准需重新积累';
  if(process.env.FAYO_INDEX_BROWSER){const b=spawnSync('python',[process.env.FAYO_INDEX_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out,case:kind,now:today+5*60000,label}),encoding:'utf8',timeout:180000});assert.equal(b.status,0,b.stderr.slice(-2000));}
  results.push({case:kind,http:r.status,projection:value,archive,viewerExcluded:true,fixtureServerSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(f.tmp,'server.js'))).digest('hex'),browserInputClock:today+5*60000,syntheticInputs:true});
 }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
 let base=null;try{base=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify({scope:'isolated original server plus controlled synthetic observations; production not changed',base,fileSha256:Object.fromEntries(stateFiles.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),results},null,2)+'\n');
 console.log(JSON.stringify({cases:results.map(r=>({case:r.case,http:r.http,days:r.projection.history.daysLoaded,events:r.projection.events.length})),browser:!!process.env.FAYO_INDEX_BROWSER}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
