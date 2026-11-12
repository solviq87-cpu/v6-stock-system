'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net'),{spawn,spawnSync}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
function request(p,url,method='GET',data=null,token=''){
 return new Promise((resolve,reject)=>{
  const body=data===null?'':JSON.stringify(data),req=http.request({host:'127.0.0.1',port:p,path:url,method,timeout:4000,agent:false,
   headers:{...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{
    let raw='';res.on('data',d=>raw+=d);res.on('end',()=>{let result;try{result=JSON.parse(raw);}catch{}resolve({status:res.statusCode,body:result,raw,headers:res.headers});});
   });req.on('error',e=>{e.message=method+' '+url+' '+e.message;reject(e);});req.on('timeout',()=>req.destroy(Error('HTTP timeout')));req.end(body);
 });
}
test('real server editor-only reads, explicit CLI writes, unknown failure and persistent restart', {timeout:45000},async t=>{
 const source=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-news-http-'));
 const copy=rel=>{fs.mkdirSync(path.dirname(path.join(tmp,rel)),{recursive:true});fs.cpSync(path.join(source,rel),path.join(tmp,rel),{recursive:true});};
 for(const rel of ['server.js','src','strategies','public','package.json','scripts/news-evidence.js','config/data-source-catalog.json','config/six-photo-sources.json'])copy(rel);
 for(const file of fs.readdirSync(source))if(file.endsWith('.js')&&file!=='server.js')copy(file);
 const salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync('fixture-news-editor',salt,32).toString('hex'),devices:{}}));
 const root=path.join(tmp,'data','news-evidence'),p=await port();let child,logs='';
 const env={...process.env,HOST:'127.0.0.1',PORT:String(p),QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_NEWS_EVIDENCE_DIR:root};
 const start=async()=>{
  child=spawn(process.execPath,['server.js'],{cwd:tmp,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('isolated server exited '+logs.slice(-1000));
   try{if((await request(p,'/api/lock/status')).status===200)return;}catch{}
   await delay(50);
  }throw Error('server not ready '+logs.slice(-1000));
 };
 const stop=async()=>{
  const target=child;if(!target||target.exitCode!==null)return;
  await new Promise(resolve=>{
   const watchdog=setTimeout(()=>{if(target.exitCode===null)target.kill('SIGKILL');},500);
   target.once('exit',()=>{clearTimeout(watchdog);resolve();});target.kill('SIGTERM');
  });
 };
 t.after(async()=>{await stop();fs.rmSync(tmp,{recursive:true,force:true});});
 fs.writeFileSync(path.join(tmp,'news.json'),JSON.stringify({goodAll:[{id:'http-event',title:'withdrawn cached positive',t:'2026-11-12 12:00:00',codes:['600000'],sectors:['fixture-sector'],stocks:[],type:'good'}],badAll:[{id:'http-event',title:'withdrawn cached risk',t:'2026-11-12 12:00:00',codes:['600000'],sectors:['fixture-sector'],stocks:[],type:'bad'}],neutralAll:[{id:'http-event',title:'withdrawn cached neutral',t:'2026-11-12 12:00:00',codes:['600000'],sectors:['fixture-sector'],stocks:[],type:'neutral'}]}));
 await start();const endpoint='/api/research/news-evidence';
 assert.notEqual((await request(p,endpoint)).body?.ok,true);assert.notEqual((await request(p,endpoint,'GET',null,'invalid-token')).body?.ok,true);
 const login=async()=>{const r=await request(p,'/api/lock/unlock','POST',{role:'edit',password:'fixture-news-editor',fp:'news-fixture'});assert.equal(r.body?.ok,true,r.raw);return r.body.token;};
 let token=await login();const empty=await request(p,endpoint,'GET',null,token);assert.equal(empty.body.ok,true);assert.equal(empty.body.result.total,0);assert.equal(empty.headers['cache-control'],'no-store');assert.equal(fs.existsSync(root),false);
 assert.equal((await request(p,endpoint,'POST',{},token)).status,405);
 assert.equal((await request(p,endpoint+'?root=/etc','GET',null,token)).status,400);
 const now=Date.now()-3000,input=path.join(tmp,'operator-input.json');
 const original={schemaVersion:1,source:'eastmoney-fast-news',eventId:'http-event',sourceRevisionId:'first',kind:'original',supersedes:null,url:'https://example.test/original',title:'<img src=x onerror=alert(1)>',body:'fixture original',securities:['600000'],publishedAt:now-1000,receivedAt:now,revisedAt:null};
 const cli=evidence=>{fs.writeFileSync(input,JSON.stringify(evidence));const r=spawnSync(process.execPath,['scripts/news-evidence.js','import',input],{cwd:tmp,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).results[0];};
 const first=cli(original);let q=await request(p,endpoint+'?symbol=600000&limit=1','GET',null,token);
 assert.equal(q.body.result.summary.eligibleForResearchSupport,1);assert.equal(q.body.result.rows[0].evidence.title,original.title);
 const r2=cli({...original,kind:'revised',sourceRevisionId:'second',supersedes:first.eventHash,body:'corrected',receivedAt:now+1000,revisedAt:now+500});
 cli({...original,kind:'retracted',sourceRevisionId:'third',supersedes:r2.eventHash,body:'withdrawn',receivedAt:now+2000,revisedAt:now+1500});
 q=await request(p,endpoint+'?limit=1','GET',null,token);assert.deepEqual(q.body.result.summary,{totalRevisions:3,currentEvents:1,retractedEvents:1,eligibleForResearchSupport:0,unknownEvents:0});assert.equal(q.body.result.rows.length,1);
 const state=await request(p,'/api/state','GET',null,token);assert.ok(state.body?.goodNews,state.raw+'\n'+logs.slice(-2000));
 assert.equal(state.body.goodNews.items.length,0,'withdrawn cached positive and neutral rows cannot remain in public state');
 assert.equal(state.body.goodNews.hotStocks.length,0);assert.equal(state.body.goodNews.hotSectors.length,0);assert.equal(state.body.badNews.items.length,0);assert.equal(state.body.badNews.codes.length,0);
 assert.ok(state.body.dashboard.riskEvidence.news.every(n=>!n.title.startsWith('withdrawn cached')),'dashboard risk evidence must use the same retraction view');
 await stop();await start();token=await login();q=await request(p,endpoint,'GET',null,token);assert.equal(q.body.result.total,3);assert.ok(q.body.result.rows.every(r=>!r.eligibleForResearchSupport));
 const viewPassword=await request(p,'/api/lock/change','POST',{role:'view',newPassword:'fixture-news-viewer',token},token);assert.equal(viewPassword.body.ok,true,viewPassword.raw);
 const view=await request(p,'/api/lock/unlock','POST',{role:'view',password:'fixture-news-viewer',fp:'viewer-news-fixture'});assert.equal(view.body.pending,true,view.raw);
 const approved=await request(p,'/api/lock/pending-approve','POST',{req:view.body.req,allow:true},token);assert.equal(approved.body.state,'allowed',approved.raw);
 const poll=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(view.body.req));assert.ok(poll.body.token,poll.raw);
 assert.notEqual((await request(p,endpoint,'GET',null,poll.body.token)).body?.ok,true);
 const file=path.join(root,'000002.json'),before=fs.readFileSync(file);fs.writeFileSync(file,'{}');
 const broken=await request(p,endpoint,'GET',null,token);assert.equal(broken.status,422);assert.equal(broken.body.status,'unknown');assert.equal(broken.body.result,undefined);fs.writeFileSync(file,before);
 const asset=await request(p,'/assets/news-evidence-workbench.js');assert.equal(asset.status,200);assert.match(asset.raw,/textContent/);
 assert.equal(fs.existsSync(path.join(tmp,'paper.json')),false,'no account or trade should be written');
});
