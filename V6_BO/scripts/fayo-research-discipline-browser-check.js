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
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[],screenshots={},timings={};
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
    const row={code:'600000',source:'原模拟执行日报',date:'2026-11-06',accountId:'pool',knownAt:now-100,planFrozenAt:now-200,ref:'c'.repeat(64),planId:'plan-original',planVersion:version,
     ruleVersion:'original-paper-score-v1',rule:'按计划止损',status:'触发',evidence:'原日报止损窗口事实',refs:['original-fill','original-observation'],evidenceRefs:['original-fill','original-observation']};
    const nextPlanCheck={status:'observed',label:'后续计划原核验符合',scope:'read-archive-window-same-account-source-symbol',accountId:'pool',source:row.source,code:row.code,
     planId:'plan-next',planVersion:'e'.repeat(64),planFrozenAt:now-50,rule:row.rule,ruleVersion:row.ruleVersion,date:'2026-11-10',knownAt:now-20,ref:'f'.repeat(64),
     refs:['next-fill','next-observation'],evidence:'后续新计划按原冻结止损核验的原日报事实',reason:'同来源、账户与规则的原始核验',
     note:'仅在已读取原档案范围核对后续计划，不认证完整交易覆盖；保留原日事实，不证明用户看过建议或习惯改善。'};
    window.calls=[];window.mode='failed';window.disciplineMode='observed';window.controller=new AbortController();
    const ctx={role:'edit',stock:'600000',state:{},signal:window.controller.signal,onState:()=>{},notify:()=>{},api:async(p,o={})=>{
     window.calls.push({path:p,method:o.method||'GET',body:o.body});
     if(p.startsWith('/api/research/workspace?'))return {ok:true,result:view};
     const query=new URL(p,location.origin).searchParams;
     if(query.get('mode')==='model-status')return {ok:true,result:{...flags,configured:false,reason:'隔离模型未配置'}};
     if(query.get('mode')==='similar')return {ok:true,result:{...flags,runId:hash,symbol:'600000',asOf:now,reason:'原前向条件分组，不是个股预测',similarCases:{status:'pending-integration',reason:'原五维相似样本接口待统一集成'},groups:[{
      system:'fourteen',version,regime:'回暖',provider:'tencent',horizon:5,conditionSignature:'d'.repeat(64),matchedRuns:2,matured:2,modeled:2,
      independentDays:2,distinctSymbols:1,nonOverlappingWindows:1,status:'descriptive-only',averageNetReturnPct:1,positiveFractionPct:50,samples:[]}]}};
     if(query.get('mode')==='discipline'){
      const asOf=Number(query.get('asOf')),next={...nextPlanCheck};
      if(window.disciplineMode==='cross-account')next.accountId='pre';
      if(window.disciplineMode==='future')next.knownAt=asOf+1;
      if(window.disciplineMode==='different-rule-version'){next.status='unknown';next.ruleVersion='original-paper-score-v2';next.reason='后续计划采用不同规则版本，不能直接比较';}
      if(window.disciplineMode==='not-observed-next-plan')Object.assign(next,{status:'unknown',planId:null,planVersion:null,planFrozenAt:null,knownAt:null,date:null,ref:null,refs:[],evidence:null,
       reason:'已读取范围内没有在本条原核验记录之后冻结的后续计划；不推断范围外交易'});
      return {ok:true,result:{...flags,asOf,symbol:query.get('symbol')||null,scope:'最近20份原日报',rows:[row],rowTotal:1,
       missing:['不同计划不能证明原问题已改善'],followups:[{...row,nextCheck:'核对原止损与可成交窗口',followup:null,nextPlanCheck:next}]}};
     }
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
   let started=performance.now();await page.getByRole('button',{name:'读取研究档案',exact:true}).click();
   await page.getByRole('button',{name:'为什么入选？',exact:true}).click();
   assert.equal(await page.locator('[aria-live=polite]').filter({hasText:'原判断截点'}).count()>0,true);
   timings.archiveAndRuleExplanationMs=Math.round(performance.now()-started);
   await page.locator('.fy-record-detail details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   const support=await page.locator('.fy-record-detail').innerText();
   assert.match(support,/original-ref/);assert.match(support,/原观察值/);assert.match(support,/当前是否失效\s*未知/);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.method==='POST')),false,'opening rule evidence makes no model call');
   started=performance.now();await page.getByRole('button',{name:'检查模型配置',exact:true}).click();await page.getByText('隔离模型未配置',{exact:true}).waitFor();
   timings.modelStatusMs=Math.round(performance.now()-started);
   started=performance.now();await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).click();
   await page.getByText('隔离调用失败，保留原规则解释 · isolated-local',{exact:true}).waitFor();
   timings.failedModelFallbackMs=Math.round(performance.now()-started);
   assert.match(await page.locator('.fy-record-detail').innerText(),/original-ref/);
   const questions=page.getByRole('heading',{name:'研究证据五问',exact:true});
   await capture('research-questions',questions);
   await capture('research-questions-region',questions.locator('..'),{region:true});
   await page.evaluate(()=>{window.mode='delayed';});await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).click();
   await page.waitForFunction(()=>typeof window.resolveModel==='function');
   assert.equal(await page.getByRole('button',{name:'检查模型配置',exact:true}).isDisabled(),true,'configuration reads cannot invalidate a pending model request');
   assert.equal(await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).isDisabled(),true,'duplicate model calls are disabled while pending');
   const pendingCalls=await page.evaluate(()=>window.calls.length);
   await page.getByRole('button',{name:'检查模型配置',exact:true}).evaluate(node=>node.click());
   assert.equal(await page.evaluate(()=>window.calls.length),pendingCalls,'disabled configuration check makes no request');
   started=performance.now();await page.getByRole('button',{name:'最强的反对理由是什么？',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'检查模型配置',exact:true}).isDisabled(),false,'changing question releases the previous operation');
   assert.equal(await page.getByRole('button',{name:'明确调用已授权模型',exact:true}).isDisabled(),false,'model button cannot stay locked after invalidation');
   await page.evaluate(()=>window.resolveModel());timings.changedQuestionMs=Math.round(performance.now()-started);
   assert.equal(await page.getByText('过期模型内容不应显示',{exact:true}).count(),0,'changed question excludes stale model response');
   await page.getByRole('button',{name:'同类历史样本后来怎样？',exact:true}).click();
   await page.getByText('原五维相似样本接口待统一集成',{exact:true}).waitFor();
   await page.locator('.fy-record-detail details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   assert.match(await page.locator('.fy-record-detail').innerText(),/非重叠窗口\s*1/);
   await page.evaluate(()=>window.showDiscipline('edit'));await page.locator('#mount>details').evaluate(n=>{n.open=true;});
   started=performance.now();await page.getByRole('button',{name:'读取个人纪律与后续落实',exact:true}).click();
   await page.getByText('最近20份原日报',{exact:true}).waitFor();await page.locator('#mount details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   timings.disciplineReadMs=Math.round(performance.now()-started);
   const discipline=await page.locator('#mount').innerText();assert.match(discipline,/original-observation/);assert.match(discipline,/计划版本/);assert.match(discipline,/规则版本/);assert.match(discipline,/待后续证据/);
   assert.match(discipline,/原结论\s*触发/,'a later plan cannot replace the original incident');
   const nextPlan=page.locator('[data-next-plan-check]');assert.equal(await nextPlan.getAttribute('data-next-plan-check'),'observed');
   assert.match(await nextPlan.innerText(),/后续计划原核验符合/);assert.match(await nextPlan.innerText(),/next-observation/);
   assert.match(await nextPlan.innerText(),/不认证完整交易覆盖/);assert.match(await nextPlan.innerText(),/不证明用户看过建议或习惯改善/);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'no page overflow at '+width);
   await capture('discipline-review',page.locator('#mount>details'));
   await capture('discipline-next-plan-region',nextPlan,{region:true});
   for(const [mode,expected]of [['cross-account','not-ready'],['future','not-ready'],['different-rule-version','unknown'],['not-observed-next-plan','unknown']]){
    await page.evaluate(value=>{window.disciplineMode=value;},mode);
    await page.getByRole('button',{name:'读取个人纪律与后续落实',exact:true}).click();
    await page.waitForFunction(value=>document.querySelector('[data-next-plan-check]')?.dataset.nextPlanCheck===value,expected);
    await page.locator('#mount details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
    assert.doesNotMatch(await nextPlan.innerText(),/后续计划原核验符合|后续新计划按原冻结止损核验的原日报事实/,'unverified optional receipt cannot claim compliance: '+mode);
    assert.match(await page.locator('#mount').innerText(),/原结论\s*触发/,'optional failure retains the original incident: '+mode);
    assert.match(await page.locator('#mount').innerText(),/原日报止损窗口事实/);
    if(mode==='different-rule-version')assert.match(await nextPlan.innerText(),/不同规则版本/);
    if(mode==='not-observed-next-plan')assert.match(await nextPlan.innerText(),/已读取范围内没有在本条原核验记录之后冻结的后续计划；不推断范围外交易/);
   }
   const count=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.showDiscipline('view'));await page.locator('#mount>details').evaluate(n=>{n.open=true;});
   assert.equal(await page.getByRole('button',{name:'读取个人纪律与后续落实',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.showViewerModels());assert.equal(await page.getByRole('button',{name:'检查模型配置',exact:true}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>window.calls.length),count,'viewer controls issue no private requests');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='POST').every(c=>c.body.action==='explain')),true);
   // Exercise native action consumption, including a response without a
   // close-review attachment and the automatic market fallback on cold start.
   const market=await require('../src/core/live-market-research').researchLiveMarket({
    now:Date.parse('2026-11-05T10:00:00+08:00'),
    fetchSnapshot:async()=>({source:'browser-fixture',date:'2026-11-05',universeSize:3,
      retrievedAt:new Date('2026-11-05T10:00:00+08:00').toISOString(),startedAt:new Date('2026-11-05T09:59:58+08:00').toISOString(),stocks:[-2,-1,5].map((pctChange,i)=>({
       code:String(i+1).padStart(6,'0'),pctChange,amount:i+1,vendorQuoteAt:Date.parse('2026-11-05T09:59:59+08:00')
      }))})
   });
   assert.equal(market.recentStructure.status,'observed-unverified');assert.equal(market.recentStructure.observed,3);assert.equal(market.recentStructure.medianReturnPct,-1);assert.equal(market.recentStructure.canTrade,false);
   await page.evaluate(async market=>{
     const {renderResearch}=await import('/nova/research.js');
     const ctx={role:'edit',state:{},api:async path=>path.endsWith('decision-pipeline')?{market,ranked:[]}:market};
     document.querySelector('#mount').replaceChildren(renderResearch({sub:'desk'},ctx));
   },market);
   const structure=page.getByRole('heading',{name:'近期报价股票结构',exact:true});
   await structure.nth(1).waitFor();
   assert.equal(await structure.count(),2);
   assert.match(await page.locator('#mount').innerText(),/涨跌幅中位数\s*-1%/);
   await page.getByRole('button',{name:'只看公开市场交集',exact:true}).click();
   await structure.first().waitFor();
   assert.deepEqual(errors,[]);
   await capture('recent-market-structure',structure.first().locator('..'),{region:true});
   assert.deepEqual(external,[]);
   await page.evaluate(async()=>{
    const {renderResearch}=await import('/nova/research.js');
    const ctx={role:'edit',canEdit:true,signal:new AbortController().signal,state:{},
     navigate:()=>{},selectStock:()=>{},notify:()=>{},api:async()=>({ok:true,result:{
      mode:'integrated-research',canTrade:false,tradeDate:'2026-11-16',publicReview:{day:'2026-11-16'},selectionEvidence:{status:'evaluated'}}})};
    document.getElementById('mount').replaceChildren(renderResearch({view:'lab',sub:'backtest'},ctx));
   });
   const historical=page.locator('section').filter({has:page.getByRole('heading',{name:'历史实验',exact:true})}).first();
   await historical.locator('details:has(textarea) > summary').first().click();
   await historical.getByText('或粘贴完整证据',{exact:true}).click();
   await historical.locator('textarea').first().fill('{}');
   await historical.getByRole('button',{name:'运行完整实验',exact:true}).click();
   await historical.getByText('已读取研究结果',{exact:true}).waitFor();
   await historical.getByText('完整证据与检验链',{exact:true}).click();
   assert.equal(await historical.getByText('选股证据',{exact:true}).count(),1,'a historical result without a public review renders its evidence');
   report.push({width,passed:true,timings,screenshots,genericHistoricalReportRendered:true,nextPlanChecks:['original incident retained','separate later-plan original fact','same-account-source-symbol binding','future receipt rejected','different rule version stays unknown','no selected next plan retains the original coverage reason','no added mutation request']});await page.close();
  }
  const result={scope:'native modules, synthetic read-only APIs and optional-model fixtures; timings are local interaction measurements, not production or live-model certification',report};
  if(output)fs.writeFileSync(path.join(output,'fayo-research-discipline-report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
