#!/usr/bin/env node
'use strict';
// Real native UI, isolated synthetic API; no account writer or model service.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const output=process.env.V6_UI_QA_DIR||null;
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main id="mount" style="padding:16px;max-width:1400px;margin:auto"></main></body></html>');}
 if(!/^\/nova\/[\w/.-]+$/.test(p)||p.includes('..')){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,p)));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/tmp/chromium',args:['--no-sandbox']});
  const origin='http://127.0.0.1:'+server.address().port,report=[];
  if(output)fs.mkdirSync(output,{recursive:true});
  for(const width of [1366,390]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[],screenshots={};
   async function capture(name,locator,{region=false}={}){
    if(!output||process.env.V6_UI_SCREENSHOTS==='0')return;
    await locator.evaluate(async node=>{node.scrollIntoView({block:'start',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(resolve));});
    const file=path.join(output,'fayo-'+name+'-'+width+'.png');
    if(region)await locator.screenshot({path:file});else await page.screenshot({path:file});screenshots[name]=file;
   }
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(external.push(r.request().url()),r.abort()));
   await page.goto(origin);
   await page.evaluate(async()=>{
    const {renderRecords}=await import('/nova/research-records.js'),{createDisciplineWorkbench,createModelTools}=await import('/nova/evidence-workbench.mjs');
    const now=Date.parse('2026-11-10T15:30:00+08:00'),hash='a'.repeat(64),version='b'.repeat(64);
    const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false};
    const run={id:hash,symbol:'600000',name:'隔离合成记录',tradeDate:'2026-11-10',provider:'tencent',regime:'回暖',asOf:now-10,recordedAt:now,
     systems:[{id:'fourteen',version,verdict:'pass'}],conditions:[{id:'original-condition',system:'fourteen',name:'原冻结评分',field:'score',op:'>=',threshold:70,value:80,
      version,status:'pass',evidenceIds:['original-evidence'],invalidation:'原评分低于门槛时复查'}],
     evidence:[{id:'original-evidence',symbol:'600000',field:'score',value:80,source:'隔离原档案',availableAt:now-30,receivedAt:now-20,sourceTimestamp:now-40,periodEnd:now-40,evidenceRef:'original-ref',status:'observed-unverified'}]};
    const view={asOf:now,selectedRun:run,runs:{total:1,rows:[run]},preferences:{revision:0,value:{},history:[]},screenRuns:[],presets:[]};
    const row={code:'600000',source:'原模拟执行日报',date:'2026-11-06',knownAt:now-100,ref:'c'.repeat(64),planId:'plan-original',planVersion:version,
     ruleVersion:'original-paper-score-v1',rule:'按计划止损',status:'触发',evidence:'原日报止损窗口事实',refs:['original-fill','original-observation'],evidenceRefs:['original-fill','original-observation']};
    window.calls=[];window.mode='failed';window.controller=new AbortController();
    const ctx={role:'edit',stock:'600000',state:{},signal:window.controller.signal,onState:()=>{},notify:()=>{},api:async(p,o={})=>{
     window.calls.push({path:p,method:o.method||'GET',body:o.body});
     if(p.startsWith('/api/research/workspace?'))return {ok:true,result:view};
     const query=new URL(p,location.origin).searchParams;
     if(query.get('mode')==='model-status')return {ok:true,result:{...flags,configured:false,reason:'隔离模型未配置'}};
     if(query.get('mode')==='similar')return {ok:true,result:{...flags,runId:hash,symbol:'600000',asOf:now,reason:'原前向条件分组，不是个股预测',similarCases:{status:'pending-integration',reason:'原五维相似样本接口待统一集成'},groups:[{
      system:'fourteen',version,regime:'回暖',provider:'tencent',horizon:5,conditionSignature:'d'.repeat(64),matchedRuns:2,matured:2,modeled:2,
      independentDays:2,distinctSymbols:1,nonOverlappingWindows:1,status:'descriptive-only',averageNetReturnPct:1,positiveFractionPct:50,samples:[]}]}};
     if(query.get('mode')==='discipline')return {ok:true,result:{...flags,asOf:Number(query.get('asOf')),symbol:query.get('symbol')||null,scope:'最近20份原日报',rows:[row],rowTotal:1,
      missing:['不同计划不能证明原问题已改善'],followups:[{...row,nextCheck:'核对原止损与可成交窗口',followup:null}]}};
     if(o.method==='POST'&&o.body.action==='explain'){
      if(window.mode==='delayed')return new Promise(resolve=>{window.resolveModel=()=>resolve({ok:true,result:{...flags,symbol:run.symbol,runId:run.id,asOf:now,question:o.body.question,
       status:'completed',modelCalled:true,model:'isolated-local',answer:'过期模型内容不应显示',citations:[]}});});
      return {ok:true,result:{...flags,symbol:run.symbol,runId:run.id,asOf:now,question:o.body.question,status:'failed',modelCalled:true,model:'isolated-local',reason:'隔离调用失败，保留原规则解释'}};
     }
     throw Error('Unexpected synthetic route '+p);
    }};
    window.ctx=ctx;
    document.querySelector('#mount').replaceChildren(renderRecords(ctx));
    window.showDiscipline=role=>{ctx.role=role;document.querySelector('#mount').replaceChildren(createDisciplineWorkbench(ctx,{symbol:'600000'}));};
    window.showViewerModels=()=>{ctx.role='view';document.querySelector('#mount').replaceChildren(createModelTools(ctx,{run,asOf:now,question:()=> 'support'}).node);};
   });
   await page.getByRole('button',{name:'读取研究档案',exact:true}).click();
   await page.getByRole('button',{name:'为什么入选？',exact:true}).click();
   assert.equal(await page.locator('[aria-live=polite]').filter({hasText:'原判断截点'}).count()>0,true);
   await page.locator('.fy-record-detail details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   const support=await page.locator('.fy-record-detail').innerText();
   assert.match(support,/original-ref/);assert.match(support,/原观察值/);assert.match(support,/当前是否失效\s*未知/);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.method==='POST')),false,'opening rule evidence makes no model call');
   await page.getByRole('button',{name:'检查模型配置',exact:true}).click();await page.getByText('隔离模型未配置',{exact:true}).waitFor();
   await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).click();
   await page.getByText('隔离调用失败，保留原规则解释 · isolated-local',{exact:true}).waitFor();
   assert.match(await page.locator('.fy-record-detail').innerText(),/original-ref/);
   const questions=page.getByRole('heading',{name:'研究证据五问',exact:true});
   await capture('research-questions',questions);
   await capture('research-questions-region',questions.locator('..'),{region:true});
   await page.evaluate(()=>{window.mode='delayed';});await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).click();
   await page.waitForFunction(()=>typeof window.resolveModel==='function');
   await page.getByRole('button',{name:'最强的反对理由是什么？',exact:true}).click();await page.evaluate(()=>window.resolveModel());
   assert.equal(await page.getByText('过期模型内容不应显示',{exact:true}).count(),0,'changed question excludes stale model response');
   await page.getByRole('button',{name:'同类历史样本后来怎样？',exact:true}).click();
   await page.getByText('原五维相似样本接口待统一集成',{exact:true}).waitFor();
   await page.locator('.fy-record-detail details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   assert.match(await page.locator('.fy-record-detail').innerText(),/非重叠窗口\s*1/);
   await page.evaluate(()=>window.showDiscipline('edit'));await page.locator('#mount>details').evaluate(n=>{n.open=true;});
   await page.getByRole('button',{name:'读取个人纪律与后续落实',exact:true}).click();
   await page.getByText('最近20份原日报',{exact:true}).waitFor();await page.locator('#mount details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   const discipline=await page.locator('#mount').innerText();assert.match(discipline,/original-observation/);assert.match(discipline,/计划版本/);assert.match(discipline,/规则版本/);assert.match(discipline,/待后续证据/);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'no page overflow at '+width);
   await capture('discipline-review',page.locator('#mount>details'));
   const count=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.showDiscipline('view'));await page.locator('#mount>details').evaluate(n=>{n.open=true;});
   assert.equal(await page.getByRole('button',{name:'读取个人纪律与后续落实',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.showViewerModels());assert.equal(await page.getByRole('button',{name:'检查模型配置',exact:true}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>window.calls.length),count,'viewer controls issue no private requests');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='POST').every(c=>c.body.action==='explain')),true);
   report.push({width,passed:true,screenshots});await page.close();
  }
  const result={scope:'native modules, synthetic read-only APIs and optional-model fixtures; no live evidence certification',report};
  if(output)fs.writeFileSync(path.join(output,'fayo-research-discipline-report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
