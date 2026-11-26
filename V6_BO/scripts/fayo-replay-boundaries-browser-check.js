#!/usr/bin/env node
'use strict';
// Real native UI + original read-only handlers over isolated synthetic archives.
// Only loopback static files and archive reads are allowed in this acceptance.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{createReplayFixture}=require('../tests/helpers/fayo-replay-boundaries-fixture');
const W=require('../src/core/research-interaction-workbench'),J=require('../src/core/news-evidence-journal'),{handle}=require('../src/server/research-interaction-http');
const x=createReplayFixture(),root=fs.realpathSync(path.resolve(__dirname,'../public')),requests=[];
const nativeHTML=fs.readFileSync(path.join(root,'nova/index.html'),'utf8'),version=nativeHTML.match(/name="application-version" content="([\w-]+)"/)?.[1],revision=nativeHTML.match(/name="frontend-revision" content="([\w-]+)"/)?.[1];
assert.ok(version&&revision,'current native application metadata is required');
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
 if(p.startsWith('/api/'))requests.push({path:p,method:req.method,query:Object.fromEntries(url.searchParams)});
 if(p==='/api/research/evidence-workbench')return handle(req,res,url,'',{authorize:()=>req.headers['x-fixture-role']==='edit',primary:()=>true,sameOrigin:()=>true,roots:x.roots,
  job:async({query,input})=>{try{return {ok:true,result:await W.run(x.roots,query,input)};}catch(error){return {ok:false,error:error.message};}}});
 if(p==='/api/research/news-evidence'){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'||req.headers['x-fixture-role']!=='edit'){res.writeHead(403);return res.end('{"ok":false}');}
  try{const result=J.queryAt(x.roots.newsRoot,{symbol:url.searchParams.get('symbol')||null,asOf:Number(url.searchParams.get('asOf')),offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||50)});return res.end(JSON.stringify({ok:true,result}));}
  catch(error){res.writeHead(422);return res.end(JSON.stringify({ok:false,error:error.message}));}
 }
 if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="application-version" content="'+version+'"><meta name="frontend-revision" content="'+revision+'"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main id="mount" style="max-width:1200px;margin:auto;padding:12px"></main></body></html>');}
 if(!p.startsWith('/nova/')||!/^[-\w/.]+$/.test(p)){res.writeHead(404);return res.end();}
 try{const file=fs.realpathSync(path.resolve(root,'.'+p));if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error();
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 const report={fixtureOnly:true,realArchiveReaders:true,timingScope:'local loopback UI and original archive handlers; not production latency',version,revision,externalRequests:[],viewports:[]};
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [320,390,1440]){
   const page=await browser.newPage({viewport:{width,height:960}}),errors=[],timings={};page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(report.externalRequests.push(route.request().url()),route.abort()));await page.goto(origin);
   assert.equal(await page.locator('meta[name="application-version"]').getAttribute('content'),version);assert.equal(await page.locator('meta[name="frontend-revision"]').getAttribute('content'),revision);
   await page.evaluate(async fixture=>{
    const {renderResearch}=await import('/nova/research.js'),{createResearchReplay}=await import('/nova/evidence-workbench.mjs');
    window.fixture=fixture;window.controls={wrongCutoff:false,hold:false,pending:[]};window.apiCalls=[];window.memory={};
    const api=async(url,options={})=>{
     if(options.method&&options.method!=='GET')throw Error('replay attempted a mutation');
     window.apiCalls.push({url,method:options.method||'GET'});
     const response=await fetch(url,{signal:options.signal,headers:{'x-fixture-role':window.ctx.role}});
     if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{status:response.status});const value=await response.json();
     if(window.controls.wrongCutoff&&url.startsWith('/api/research/news-evidence'))value.result.asOf+=1000;
     if(window.controls.hold)await new Promise(resolve=>window.controls.pending.push(resolve));return value;
    };
    window.renderFixture=(mode='news',role='edit')=>{
     window.abort?.abort();window.abort=new AbortController();window.ctx={role,canEdit:role==='edit',stock:'600000',state:{closeSession:{day:fixture.day}},signal:window.abort.signal,viewMemory:window.memory,api,navigate:()=>{},onState:()=>{}};
     document.getElementById('mount').replaceChildren(mode==='news'?renderResearch({sub:'evidence'},window.ctx):createResearchReplay(window.ctx,{symbol:'600000',asOf:fixture.asOf,memory:window.memory}));
    };window.renderFixture();
   },{day:x.day,asOf:x.asOf,firstReportHash:x.reports[1].reportHash});
   const code=page.getByLabel('证券代码（留空查看全部）'),cutoff=page.getByLabel('历史截点（北京时间，留空查看当前）'),read=page.getByRole('button',{name:'读取新闻与公告证据',exact:true});
   const cutoffText=new Date(x.asOf+28800000).toISOString().slice(0,23);
   assert.deepEqual(await page.evaluate(()=>window.apiCalls),[]);await cutoff.fill(cutoffText);
   await page.evaluate(()=>{window.controls.wrongCutoff=true;});await read.click();await page.getByText('新闻回执未通过截点核验',{exact:true}).waitFor();
   assert.equal(await page.locator('[data-evidence-replay]').count(),0,'a mismatched first cutoff cannot render private data');
   await page.evaluate(()=>{window.controls.wrongCutoff=false;});let started=performance.now();await read.click();await page.getByText(/版本 55 条/).waitFor();
   timings.newsFirstPageMs=Math.round(performance.now()-started);
   await page.getByRole('button',{name:'更早版本',exact:true}).click();await page.getByText('隔离新闻撤稿',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'更早版本',exact:true}).count(),0);
   const pages=await page.evaluate(()=>window.apiCalls.filter(c=>c.url.startsWith('/api/research/news-evidence')).map(c=>Object.fromEntries(new URL(c.url,location.origin).searchParams)));
   assert.equal(pages.at(-1).offset,'50');assert.equal(pages.at(-1).asOf,pages.at(-2).asOf);
   let replay=page.locator('[data-evidence-replay]');
   assert.equal(await replay.getByLabel('回放截点 北京时间').inputValue(),cutoffText);
   started=performance.now();await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await replay.getByRole('img').waitFor();
   timings.replayReadMs=Math.round(performance.now()-started);
   const chartHeight=(await replay.getByRole('img').boundingBox()).height;assert.ok(chartHeight>=219,'mobile chart must retain readable height');
   assert.equal(await replay.locator('svg line[stroke="#68d4df"]').count(),1,'only the two matching index identities connect');
   started=performance.now();await replay.getByRole('button',{name:x.day+' 证据',exact:true}).click();
   assert.match(await replay.innerText(),/模拟成交 · buy/);assert.match(await replay.innerText(),/15:30:00/);assert.match(await replay.innerText(),new RegExp(x.reports[1].reportHash));
   timings.eventDetailMs=Math.round(performance.now()-started);
   const olderDay=new Date(x.runs[1].recordedAt+28800000).toISOString().slice(0,10);await replay.getByRole('button',{name:olderDay+' 证据',exact:true}).click();
   assert.match(await replay.innerText(),/隔离迟到新闻1亿元/);assert.match(await replay.innerText(),/10:00:00/);assert.match(await replay.innerText(),/14:00:00/);
   const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=1,'replay must fit viewport '+width+' / '+overflow);
   if(process.env.V6_UI_QA_DIR&&process.env.V6_UI_SCREENSHOTS!=='0'){fs.mkdirSync(process.env.V6_UI_QA_DIR,{recursive:true});await replay.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(process.env.V6_UI_QA_DIR,'fayo-replay-boundaries-'+width+'.png')});}
   await replay.getByLabel('回放截点 北京时间').fill(x.day+'T15:20:00.123');await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await replay.getByRole('img').waitFor();
   await replay.getByRole('button',{name:x.day+' 证据',exact:true}).click();assert.doesNotMatch(await replay.innerText(),/模拟成交 · buy/,'a later sealed fill cannot appear before its first report');
   await page.evaluate(()=>{window.controls.hold=true;});await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await page.waitForFunction(()=>window.controls.pending.length===1);
   await code.fill('600001');await page.evaluate(()=>{delete window.memory.replayContext;window.controls.hold=false;window.controls.pending.splice(0).forEach(fn=>fn());});
   assert.equal(await page.locator('[data-evidence-replay]').count(),0);assert.deepEqual(await page.evaluate(()=>window.memory),{},'detached replay cannot persist an obsolete selection');
   await code.fill('600000');await read.click();await page.getByText(/版本 55 条/).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
   assert.equal(await page.locator('[data-evidence-replay]').count(),0);assert.equal(await page.getByText(/版本 55 条/).count(),0,'offline clears original news page too');
   await page.evaluate(()=>window.renderFixture('replay'));replay=page.locator('[data-evidence-replay]');await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await replay.getByRole('img').waitFor();
   await replay.getByLabel('缩放可见日期范围').evaluate(node=>{node.value='7';node.dispatchEvent(new Event('input',{bubbles:true}));});
   await replay.getByRole('button',{name:'板块',exact:true}).click();
   await replay.getByRole('button',{name:x.day+' 证据',exact:true}).click();
   const saved=await page.evaluate(()=>({...window.memory.replayContext}));assert.equal(saved.zoom,7);assert.equal(saved.selectedDay,x.day);assert.equal(saved.enabled.includes('sector'),false);
   const beforeReturn=await page.evaluate(()=>window.apiCalls.length);await page.evaluate(()=>window.renderFixture('replay'));
   assert.equal(await page.evaluate(()=>window.apiCalls.length),beforeReturn,'returning restores only view controls, never automatically reads or executes');
   assert.equal(await replay.getByRole('img').count(),0,'private evidence is reread, not restored from a stale DOM cache');
   started=performance.now();await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await replay.getByRole('img').waitFor();
   assert.equal(await replay.getByLabel('缩放可见日期范围').inputValue(),'7');
   assert.equal(await replay.getByRole('button',{name:'板块',exact:true}).getAttribute('aria-pressed'),'false');
   assert.match(await replay.locator('h3').last().innerText(),new RegExp('^'+x.day+' · \\d+ 条原档案标记$'));
   timings.returnAndRereadMs=Math.round(performance.now()-started);
   await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await replay.getByRole('img').count(),0);assert.match(await replay.innerText(),/私有回放已清空/);
   await replay.getByRole('button',{name:'读取联动回放',exact:true}).click();await replay.getByRole('img').waitFor();await page.evaluate(()=>window.abort.abort());assert.equal(await replay.getByRole('img').count(),0);
   await page.evaluate(()=>{window.apiCalls=[];window.renderFixture('replay','view');});assert.equal(await page.getByRole('button',{name:'读取联动回放',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.apiCalls),[]);
   assert.deepEqual(errors,[]);report.viewports.push({width,overflow,chartHeight,timings,firstCutoffChecked:true,newsPagingFrozen:true,identityBoundary:true,earliestFillReceipt:true,sourceNewsClock:true,viewControlsRestored:true,staleDetachedSuppressed:true,offlineCleared:true,abortCleared:true,viewerPrivate:true,pageErrors:errors});await page.close();
  }
  assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(report.externalRequests,[]);report.archiveReadRequests=requests.length;
  if(process.env.V6_UI_QA_DIR){fs.mkdirSync(process.env.V6_UI_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.V6_UI_QA_DIR,'fayo-replay-boundaries-report.json'),JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));x.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
