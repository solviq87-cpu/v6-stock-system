#!/usr/bin/env node
'use strict';
// Isolated upstream fixtures exercise the real server projection, decision
// endpoint, native / and /m application, and original account services. No test
// prices or fixture endpoints are added to production. Browser transport is
// altered only in explicitly named rejection and late-response experiments.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');
const root=path.resolve(__dirname,'..'),day='2026-11-16',now=Date.parse(day+'T14:00:00+08:00');
const output=process.env.FAYO_DECISION_QA_DIR||(process.env.V6_UI_QA_DIR?path.join(process.env.V6_UI_QA_DIR,'decision-center'):
 fs.mkdtempSync(path.join(os.tmpdir(),'fayo-decision-browser-')));
fs.mkdirSync(output,{recursive:true});

function seedSource(){
 const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const entry='function handle(req, res, u, body) {',projection="const display=sharedMarketRead('state',includePrivate),now=Date.now();";
 assert.equal(source.split(entry).length,2,'single disposable handle seed');
 assert.equal(source.split(projection).length,2,'single upstream weather projection');
 return source.replace(entry,entry+`
    // The isolated boot disables normal jobs. Exercise only the actual readonly
    // execution cache here; this timer and seed exist solely in this temp copy.
    if(!S.decisionBrowserExecutionTimer){
      S.decisionBrowserExecutionTimer=setInterval(()=>{void executionChecklistCache().tick().catch(()=>{});},50);
      S.decisionBrowserExecutionTimer.unref();
    }
    if(!S.decisionBrowserSeedRows){
      const day='${day}',at=Date.now();
      const rows=Array.from({length:3},(_,i)=>({code:String(600000+i),name:'隔离决策验证'+(i+1),price:10.4+i,pct:4,
        preClose:10+i,open:10.3+i,high:10.4+i,low:10.2+i,volume:1000000,amount:(10.4+i)*1000000,
        score:88-i,paths:['横盘放量'],pathWhy:{横盘放量:'隔离验证中的原策略量价依据'},poolDay:day,sector:i===1?'银行':'芯片',themes:i===1?['消费电子']:[],
        baziDims:{trend:82,fund:78},baziWhy:{trend:['原均线方向向上','原量价条件成立']},
        quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,canNotify:true,quoteAt:at-1000,receivedAt:at-500}));
      S.decisionBrowserSeedRows=rows;S.stocks=rows;S.stocksAt=at-500;ingestPx(rows);
      S.sectors=[{code:'BK1034',name:'芯片',pct:1.2,mainInflow:300000000},
        ...Array.from({length:20},(_,i)=>({code:'BK'+(3000+i),name:'其他板块'+i,pct:1,mainInflow:200000000-i*1000000})),
        {code:'BK0475',name:'银行',pct:.8,mainInflow:126000000},{code:'BK0937',name:'消费电子',pct:-.4,mainInflow:-20000000}]
        .map(row=>({...row,source:'eastmoney',upstream:'eastmoney',fundsUnit:'CNY',unit:'CNY',
          fundsMethod:'vendor-order-size-estimate',retrievedAt:at-1000,sourceTimestamp:null,tradeDate:null}));
      S.sectorsDay=day.replaceAll('-','');S.sectorsAt=at-1000;
      for(const [i,row] of rows.entries()){
        const bars=Array.from({length:30},(_,n)=>({date:new Date(Date.parse(day)-(29-n)*86400000).toISOString().slice(0,10),
          open:10.2+i,high:n===29?row.high:11.6+i,low:10+i,close:10.2+i,volume:100000,amount:(10.2+i)*100000}));
        klineSet(row.code,{rows:bars,src:'tencent',adjust:'qfq',receivedAt:at-2000});
      }
    }
    const decisionBrowserControl=path.join(__dirname,'decision-browser-phase.json');
    const decisionBrowserPhase=fs.existsSync(decisionBrowserControl)?JSON.parse(fs.readFileSync(decisionBrowserControl,'utf8')).phase:'valid';
    S.candidatePool=decisionBrowserPhase==='empty'?[]:S.decisionBrowserSeedRows;
  `).replace(projection,`const now=Date.now(),display={...sharedMarketRead('state',includePrivate),
    marketDistribution:{kind:'market-distribution-intraday',source:'打板客',scope:'沪深京 A 股',day:'${day}',
      quoteAt:now-30000,knownAt:now-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
    dabanke:{day:'${day}',knownAt:now-20000,ecology:[{label:'当日封板',success:70,total:90}]}};`);
}

async function run(){
 const clockDir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-decision-clock-')),clockFile=path.join(clockDir,'clock');
 fs.writeFileSync(clockFile,String(now));
 let fixture,browser,fixtureNow=now;
 const environment={node:process.version,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,tz:process.env.TZ||null};
 const report={fixtureOnly:true,backend:'native decisionCenterInput / buildDecisionCenter',day,environment,views:[],rejections:[],races:[],conditionalOrders:[],privateViews:[]};
 try{
  fixture=await createFixture({count:3,serverSource:seedSource(),clockFile});
  fs.copyFileSync(path.join(root,'config/intelligence-center.json'),path.join(fixture.tmp,'config/intelligence-center.json'));
  const phaseFile=path.join(fixture.tmp,'decision-browser-phase.json');
  const phase=value=>fs.writeFileSync(phaseFile,JSON.stringify({phase:value}));
  const origin='http://127.0.0.1:'+fixture.port;
  const ledgerPaths=['pool','pre'].map(key=>path.join(fixture.tmp,'data/order-accounts',key+'.json'));
  await fixture.request('/api/paper');
  const ledgers=ledgerPaths.map(file=>fs.readFileSync(file));
  const authority=(await fixture.request('/api/decision-center')).body;
  assert.equal(authority.authority,'fayo-decision-center');assert.equal(authority.cards.length,3,JSON.stringify(authority.reasons));
  // The successful browser fixtures must qualify through original levels, not
  // merely through fabricated UI cards or a relaxed chase-risk gate.
  for(const card of authority.cards){
   assert.equal(card.plan.riskReward.status,'meets-gross-discipline');
   assert.ok(card.plan.riskReward.ratio>=2);
   assert.equal(card.plan.buyHigh,card.quoteBasis.price);
  }
  const brief=(await fixture.request('/api/state')).body;
  assert.equal(brief.sectors.some(row=>row.name==='银行'),false,'selected bank is outside the original top-20 brief');
  const complete=(await fixture.request('/api/decision-sector-context?date='+day)).body;
  assert.equal(complete.rows.some(row=>row.name==='银行'&&row.mainInflow===126000000),true,'real readonly endpoint returns the complete same-day source rows');
  const historical=(await fixture.request('/api/decision-sector-context?date=2026-11-13')).body;
  assert.equal(historical.rows.length,0,'missing historical evidence never borrows today’s sector rows');
  const expected=new Map(authority.cards.map(card=>[card.code,card]));
  function setFixtureTime(at){
   assert.ok(at>=fixtureNow,'the shared fixture clock never runs backwards');
   for(const card of expected.values())assert.ok(at-card.quoteBasis.quoteAt<=15000,'original quote timestamps remain inside the unchanged 15 s gate');
   fixtureNow=at;fs.writeFileSync(clockFile,String(at));
  }
  async function advanceReadClock(page){
   assert.equal(await page.evaluate(()=>Date.now()),fixtureNow,'browser and server use the same causal clock');
   setFixtureTime(fixtureNow+3000);
   await page.evaluate(at=>{window.__decisionTestNow=at;sessionStorage.setItem('fayo-decision-test-clock',String(at));},fixtureNow);
  }
  async function waitExecution(state,orderId){
   const transitions=[];
   let last;
   for(let attempt=0;attempt<100;attempt++){
    const response=await fixture.request('/api/decision-center'),current=response.body?.executionChecklist;
    last={status:response.status,error:response.body?.error||null,checklist:current||null};
    const observed={status:current?.status,missing:current?.missing,cache:current?.cache,
     items:current?.items?.filter(item=>item.code==='600001').map(item=>({state:item.state,reason:item.reason,planId:item.planId,intent:item.intent}))};
    if(JSON.stringify(transitions.at(-1))!==JSON.stringify(observed)){transitions.push(observed);if(transitions.length>8)transitions.shift();}
    if(current?.items?.some(item=>item.code==='600001'&&item.state===state&&item.intent?.id===orderId))return;
    await new Promise(resolve=>setTimeout(resolve,30));
   }
   const orders=(await fixture.request('/api/paper/conditional-orders')).body;
   const diagnostic={expected:{code:'600001',state,orderId},environment,fixtureNow:Number(fs.readFileSync(clockFile,'utf8')),
    transitions,last,conditionalOrders:{ok:orders?.ok,error:orders?.error||null,orders:orders?.orders?.map(order=>({
     id:order.id,planId:order.planId,code:order.code,day:order.day,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,
     expiresAt:order.expiresAt,lastReason:order.lastReason}))}};
   fs.writeFileSync(path.join(output,'execution-cache-failure-'+state+'.json'),JSON.stringify(diagnostic,null,2));
   assert.fail('real execution cache did not reach '+state+' for '+orderId+'; '+JSON.stringify(diagnostic));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const [scenario,viewport] of [{width:1366,height:900,path:'/'},{width:390,height:844,path:'/m'}].entries()){
   // The previous browser advances twice by 3 s below. Start the next causal
   // create/cancel sequence after it, using the same server and browser clock.
   // Original quotes stay untouched; even the final browser read is <15 s old.
   const scenarioAt=now+scenario*7000;setFixtureTime(scenarioAt);
   phase('valid');
   // Keep interception on the page transport for the explicit tamper/race cases.
   // The general product browser suite separately exercises the normal worker.
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block'});
   await context.addInitScript(({token,at})=>{
    localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','edit');
    const OriginalDate=Date,retained=Number(sessionStorage.getItem('fayo-decision-test-clock'));
    window.__decisionTestNow=Number.isSafeInteger(retained)&&retained>=at?retained:at;
    window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.__decisionTestNow]));}static now(){return window.__decisionTestNow;}};
   },{token:fixture.token,at:fixtureNow});
   const page=await context.newPage(),errors=[],external=[],writes=[],reads=[];
   let mode='valid',holdCode=null,held=null;
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>{const url=new URL(request.url());if(request.method()==='POST')writes.push({path:url.pathname,body:request.postDataJSON()});
    else if(url.pathname==='/api/kline')reads.push(url.pathname+url.search);});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(url.pathname==='/api/decision-center'&&mode!=='valid'){
     const response=await route.fetch(),payload=await response.json();
     if(mode==='tampered-plan'&&payload.cards[0])payload.cards[0].plan.stop=payload.cards[0].plan.target+1;
     if(mode==='stale-package')payload.calculatedAt=now-15001;
     return route.fulfill({response,json:payload});
    }
    if(url.pathname==='/api/kline'&&url.searchParams.get('code')===holdCode&&url.searchParams.get('n')==='240'){
     holdCode=null;held={route};return;
    }
    return route.continue();
   });
   try{
    const started=performance.now();
    await page.goto(origin+viewport.path,{waitUntil:'domcontentloaded'});
    await page.locator('.fy-decision-card').first().waitFor({timeout:5000});
    const elapsed=performance.now()-started;
    assert.ok(elapsed<5000,viewport.path+' actionable plans appear within five seconds: '+elapsed);
    assert.equal(await page.locator('.fy-decision-card').count(),3);
    try{
     await page.locator('.fy-decision-checklist [data-execution-code="600000"][data-execution-state="not-planned"]').waitFor({timeout:7000});
    }catch(error){
     const reply=await fixture.request('/api/decision-center'),check=reply.body?.executionChecklist;
     const diagnostic={status:reply.status,checklistStatus:check?.status,missing:check?.missing,cache:check?.cache,
      items:check?.items?.map(item=>({code:item.code,state:item.state,reason:item.reason})),browserErrors:errors,
      rendered:await page.locator('.fy-decision-checklist').innerText()};
     fs.writeFileSync(path.join(output,'initial-checklist-failure-'+viewport.width+'.json'),JSON.stringify(diagnostic,null,2));
     console.error('Initial checklist diagnostic (isolated fixture): '+JSON.stringify(diagnostic));
     throw error;
    }
    const shape=await page.locator('.fy-decision-card').first().evaluate(node=>{
     const plan=node.querySelector('.fy-decision-plan').getBoundingClientRect(),title=node.querySelector('.fy-decision-stock').getBoundingClientRect();
     const checklist=node.closest('.fy-decision-board').querySelector('.fy-decision-checklist li').getBoundingClientRect();
     const dock=document.querySelector('.fy-dock')?.getBoundingClientRect();
     return {titleTop:title.top,planBottom:plan.bottom,checklistTop:checklist.top,checklistBottom:checklist.bottom,
      usableBottom:dock?.height>0?Math.min(innerHeight,dock.top):innerHeight,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(shape.titleTop>=0&&shape.planBottom<=shape.height,viewport.path+' first plan is visible without scrolling: '+JSON.stringify(shape));
    assert.ok(shape.checklistTop>=0&&shape.checklistBottom<=shape.usableBottom,viewport.path+' first execution checklist item is visible above navigation: '+JSON.stringify(shape));
    assert.ok(shape.overflow<=1,viewport.path+' no horizontal overflow');
    await page.locator('.fy-decision-card [data-mini-code] svg').first().waitFor({timeout:5000});
    assert.match(await page.locator('.fy-decision-board').innerText(),/未配置/);
    await page.screenshot({path:path.join(output,'decision-'+viewport.width+'-initial.png'),fullPage:true});
    const card=page.locator('.fy-decision-card[data-code="600001"]'),button=card.locator('.fy-decision-stock');
    const quality=card.locator('[aria-label="五维数据质量"]');
    assert.equal(await quality.count(),1,'five-dimensional quality is retained in the evidence disclosure');
    if(expected.get('600001').centerQuality?.qScore==null)assert.match(await quality.textContent(),/数据质量 Q · 分量未齐/,'missing quality is not rendered as a zero score');
    await page.locator('#fy-decision-rules summary').click();
    await button.scrollIntoViewIfNeeded();const savedScroll=await page.evaluate(()=>scrollY);
    const savedHorizontal=await page.locator('.fy-decision-cards').evaluate(node=>node.scrollLeft);
    if(viewport.width<600)assert.ok(savedHorizontal>0,'mobile second card selects an actual horizontal position');
    await button.click();
    const drawer=page.locator('.fy-stock-drawer');
    await drawer.waitFor({state:'visible'});
    assert.match(await drawer.locator('.fy-drawer-title').innerText(),/600001/);
    const selected=expected.get('600001');
    await drawer.locator('[data-decision-sector="600001"][data-day="'+day+'"]').waitFor();
    await drawer.locator('[data-decision-paper="600001"][data-day="'+day+'"]').waitFor();
    assert.equal(await drawer.locator('[data-conclusion]').getAttribute('data-conclusion'),'可关注');
    await drawer.getByRole('button',{name:'查看板块资金',exact:true}).click();
    await page.locator('.fy-main [data-decision-sector="600001"][data-day="'+day+'"]').waitFor();
    const linked=page.locator('[data-sector-selection="600001"][data-day="'+day+'"]');
    await linked.locator('[data-selected-sector="BK0475"]').waitFor();
    assert.match(await linked.innerText(),/银行.*1\.26 亿/s);
    assert.match(await linked.innerText(),/eastmoney/);assert.match(await linked.innerText(),/源端资金时刻\s*未提供/);
    assert.equal(await linked.locator('[data-selected-sector] > dl').evaluate(node=>
      [...node.querySelectorAll('dd')].every(value=>value.scrollWidth<=value.clientWidth+1)),true,'sector provenance fits its responsive columns');
    const sectorPicker=linked.getByRole('combobox',{name:'当前股票对应板块'});
    assert.deepEqual(await sectorPicker.locator('option').allTextContents(),['银行 · BK0475','消费电子 · BK0937']);
    await sectorPicker.selectOption('BK0937');
    await linked.locator('[data-selected-sector="BK0937"]').waitFor();
    assert.match(await linked.innerText(),/-2,000\.00 万元/);
    await linked.getByText('查看板块资金原始记录',{exact:true}).click();
    const expanded=linked.locator('details');
    assert.equal(await expanded.evaluate(node=>node.open),true);
    await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state',{timeout:12000});
    assert.equal(await expanded.evaluate(node=>node.open),true,'sector evidence stays expanded through background state reads');
    assert.equal(await sectorPicker.inputValue(),'BK0937','background state does not reset the selected related sector');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,'decision-sector-'+viewport.width+'-linked.png'),fullPage:true});
    await page.locator('.fy-main').getByRole('button',{name:'查看模拟盘预填',exact:true}).click();
    const draft=page.locator('[data-paper-plan][data-code="600001"][data-day="'+day+'"]');
    await draft.waitFor();
    for(const key of ['buyLow','buyHigh','stop','target','positionPct']){
     assert.equal(Number(await draft.locator('[name="'+key+'"]').inputValue()),selected.plan[key],key+' stays server-owned');
     assert.equal(await draft.locator('[name="'+key+'"]').getAttribute('readonly'),'');
    }
    assert.equal(await draft.locator('[name="planDay"]').inputValue(),day);
    await draft.getByRole('button',{name:'返回今日作战台',exact:true}).click();
    await page.locator('.fy-decision-card[data-code="600001"][data-selected="true"]').waitFor();
    await page.waitForFunction(top=>Math.abs(scrollY-top)<4,savedScroll);
    await page.waitForFunction(left=>Math.abs((document.querySelector('.fy-decision-cards')?.scrollLeft??-10000)-left)<3,savedHorizontal);
    assert.equal(await page.locator('#fy-decision-rules').evaluate(node=>node.open),true,'expanded reasoning restored');
    assert.equal(writes.filter(r=>r.path==='/api/paper').length,0,'linking and prefilling do not purchase or freeze a plan');

    // These are explicit, reversible intentions in this disposable server.
    // Creation must not immediately call executePlan/paperBuy or touch either
    // account. Cancellation uses the latest returned store revision.
    await button.click();
    await drawer.getByRole('button',{name:'查看模拟盘预填',exact:true}).click();
    await draft.locator('[data-create-conditional]').waitFor();
    await page.locator('[data-conditional-orders]').waitFor();
    await draft.locator('[data-create-conditional]').click();
    const queueReview=page.getByRole('alertdialog');
    assert.match(await queueReview.innerText(),/14:57/);
    assert.match(await queueReview.innerText(),/实际退出仍遵守原账户规则及T\+1/);
    await queueReview.getByRole('button',{name:'确认执行',exact:true}).click();
    await queueReview.waitFor({state:'detached',timeout:10000});
    const pending=page.locator('[data-conditional-id][data-conditional-status="pending"]').last();
    await pending.waitFor({timeout:10000});
    const orderId=await pending.getAttribute('data-conditional-id');
    assert.match(await page.locator('[data-conditional-orders]').innerText(),/私密飞书 · 未配置/);
    await waitExecution('waiting-condition',orderId);
    // Advance both test clocks beyond the real 2.5 s shared read cache.
    // Source timestamps stay fixed and within the original 15 s gate.
    await advanceReadClock(page);
    await draft.getByRole('button',{name:'返回今日作战台',exact:true}).click();
    await page.locator('.fy-decision-checklist [data-execution-code="600001"][data-execution-state="waiting-condition"]').waitFor({timeout:10000});
    await page.locator('#fy-execution-evidence summary').click();
    const proof=page.locator('#fy-execution-evidence [data-execution-code="600001"][data-execution-state="waiting-condition"]').last();
    assert.match(await proof.innerText(),/条件意图.*等待条件/);
    assert.equal(await page.locator('#fy-execution-evidence h4').innerText(),'操作提示','static suggestions are distinct from backend execution state');
    await page.locator('.fy-decision-card[data-code="600001"] .fy-decision-stock').click();
    await drawer.getByRole('button',{name:'查看模拟盘预填',exact:true}).click();
    await pending.waitFor();
    await pending.locator('[data-cancel-conditional]').click();
    await page.getByRole('alertdialog').getByRole('button',{name:'确认执行',exact:true}).click();
    await page.getByRole('alertdialog').waitFor({state:'detached',timeout:10000});
    await page.locator('[data-conditional-id="'+orderId+'"][data-conditional-status="cancelled"]').waitFor();
    const conditionalState=(await fixture.request('/api/paper/conditional-orders')).body;
    const savedOrder=conditionalState.orders.find(row=>row.id===orderId);
    assert.equal(savedOrder.status,'cancelled');assert.equal(savedOrder.fill,null);
    assert.equal(savedOrder.createdAt,scenarioAt,'each viewport creates at its own original server observation time');
    assert.equal(savedOrder.updatedAt,fixtureNow,'cancellation retains its later original server time');
    if(report.conditionalOrders.length)assert.ok(savedOrder.createdAt>report.conditionalOrders.at(-1).createdAt,
     'a later viewport intent is causally later than the earlier cancelled intent');
    const mutations=writes.filter(r=>r.path==='/api/paper');
    assert.deepEqual(mutations.map(r=>r.body.action),['preparePlan','queuePlan','cancelConditionalOrder']);
    assert.match(mutations[1].body.requestId,/^[A-Za-z0-9_-]{8,100}$/);
    assert.ok(Number.isSafeInteger(mutations[2].body.expectedRevision),'cancellation carries the live store revision');
    for(const [i,file] of ledgerPaths.entries())assert.deepEqual(fs.readFileSync(file),ledgers[i],'intent create/cancel never changes original account ledger');
    report.conditionalOrders.push({path:viewport.path,code:'600001',day,status:savedOrder.status,createdAt:savedOrder.createdAt,
     explicitCreate:true,explicitCancel:true,originalAccountLedgerUnchanged:true,actions:mutations.map(r=>r.body.action)});
    await waitExecution('frozen',orderId);await advanceReadClock(page);
    await draft.getByRole('button',{name:'返回今日作战台',exact:true}).click();
    await page.locator('.fy-decision-card[data-code="600001"][data-selected="true"]').waitFor();
    await page.locator('.fy-decision-checklist [data-execution-code="600001"][data-execution-state="frozen"]').waitFor({timeout:10000});

    // A late, aborted original-stock request may not repaint the newly selected
    // code/date or the linked sector and paper plan.
    const lateHistory=(await fixture.request('/api/kline?code=600000&n=28&end=2026-11-17')).body;
    assert.equal(lateHistory.code,'600000');holdCode='600000';
    await page.locator('.fy-decision-card[data-code="600000"] .fy-decision-stock').click();
    await page.waitForFunction(()=>document.querySelector('.fy-drawer-title')?.textContent.includes('600000'));
    for(let n=0;n<100&&!held;n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(held,'first stock request held: '+JSON.stringify(reads));
    await drawer.getByRole('button',{name:'关闭股票研究面板',exact:true}).click();
    await page.locator('.fy-decision-card[data-code="600002"] .fy-decision-stock').click();
    await page.waitForFunction(()=>document.querySelector('.fy-drawer-title')?.textContent.includes('600002'));
    try{await held.route.fulfill({json:{...lateHistory,offlineTheme:'晚到的 A 股票不得覆盖 B'}});}catch{/* aborted transport is an expected safe result */}
    held=null;
    await drawer.locator('[data-decision-paper="600002"][data-day="'+day+'"]').waitFor();
    assert.equal((await drawer.innerText()).includes('晚到的 A 股票不得覆盖 B'),false);
    assert.equal(await drawer.locator('[data-decision-sector="600001"]').count(),0);
    await drawer.getByRole('button',{name:'关闭股票研究面板',exact:true}).click();
    report.races.push({path:viewport.path,status:'old stock reply rejected; selected code and day retained'});

    for(const rejected of ['tampered-plan','stale-package']){
     mode=rejected;await page.reload({waitUntil:'domcontentloaded'});
     await page.locator('.fy-decision-empty').waitFor({timeout:5000});
     const reason=rejected==='stale-package'?'日期或时点已失效':'完整计划未通过复核';
     await page.waitForFunction(message=>document.querySelector('.fy-decision-empty')?.textContent.includes(message),reason,{timeout:5000});
     assert.equal(await page.locator('.fy-decision-card').count(),0,rejected+' never produces cards');
     report.rejections.push({path:viewport.path,case:rejected,text:await page.locator('.fy-decision-empty').innerText()});
    }
    mode='valid';phase('empty');await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('.fy-decision-empty')?.textContent.includes('没有源端策略候选'),null,{timeout:5000});
    assert.equal(await page.locator('.fy-decision-card').count(),0,'empty upstream remains empty');
    assert.match(await page.locator('.fy-decision-empty').innerText(),/今天空仓，等待信号/);
    await page.screenshot({path:path.join(output,'decision-'+viewport.width+'-empty.png'),fullPage:true});
    assert.deepEqual(errors,[],'no browser errors');assert.deepEqual(external,[],'no external browser requests');
    report.views.push({...viewport,firstPlanMs:Math.round(elapsed),shape,linkedCode:'600001',linkedDay:day,scrollRestored:true,horizontalScrollRestored:true,savedHorizontal,
     reasoningRestored:true,sectorBeyondBrief:true,sectorPickerAligned:true,sectorDisclosurePreserved:true,
     fundsOriginalTimeUnknown:true,executionStates:['not-planned','waiting-condition','frozen'],linkingPaperMutations:0,paperMutations:writes.filter(r=>r.path==='/api/paper').length,errors});
   }catch(error){
    fs.writeFileSync(path.join(output,'failure-'+viewport.width+'.txt'),String(error.stack)+'\n'+await page.locator('body').innerText()+'\n'+JSON.stringify(errors));
    await page.screenshot({path:path.join(output,'failure-'+viewport.width+'.png'),fullPage:true});throw error;
   }finally{if(held)try{await held.route.abort();}catch{}await context.close();}
  }
  const viewerDecision=(await fixture.request('/api/decision-center','GET',null,fixture.viewerToken)).body;
  assert.equal(Object.hasOwn(viewerDecision,'executionChecklist'),false,'the real public decision endpoint omits private execution facts');
  for(const endpoint of ['/api/paper/execution-score?date='+day,'/api/paper/execution-report?date='+day]){
   const denied=await fixture.request(endpoint,'GET',null,fixture.viewerToken);
   assert.equal(denied.body?.ok,false,'the original editor gate denies '+endpoint);
   assert.equal(denied.body?.dailyReport,undefined);assert.equal(denied.body?.report,undefined);
   assert.equal(denied.body?.checklist,undefined);assert.equal(denied.body?.paper,undefined);
  }
  for(const viewport of [{width:1366,height:900,path:'/'},{width:390,height:844,path:'/m'}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block'});
   await context.addInitScript(({token,at})=>{localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','view');
    const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
   },{token:fixture.viewerToken,at:fixtureNow});
   const page=await context.newPage(),privateReads=[];
   page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/paper/'))privateReads.push(new URL(request.url()).pathname);});
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   try{
    await page.goto(origin+viewport.path,{waitUntil:'domcontentloaded'});
    await page.getByText('编辑身份可查看执行状态',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-execution-code]').count(),0,'viewer home has no private stock states');
    await page.goto(origin+viewport.path+'#/assets/paper',{waitUntil:'domcontentloaded'});
    await page.getByText('这是你的私人工作区',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-execution-evidence]').count(),0);
    assert.deepEqual(privateReads,[],'viewer navigation never requests private paper evidence');
    report.privateViews.push({path:viewport.path,width:viewport.width,privateReads:0,privateExecutionRows:0});
   }finally{await context.close();}
  }
  for(const [i,file] of ledgerPaths.entries())assert.deepEqual(fs.readFileSync(file),ledgers[i],'browser verification cannot change '+path.basename(file));
  report.ledgerUnchanged=true;report.passed=true;
  for(const width of [1366,390])for(const extension of ['txt','png'])fs.rmSync(path.join(output,'failure-'+width+'.'+extension),{force:true});
  fs.writeFileSync(path.join(output,'decision-browser-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify({passed:true,output,views:report.views,rejections:report.rejections.length,races:report.races.length,
   conditionalOrders:report.conditionalOrders,privateViews:report.privateViews,ledgerUnchanged:true},null,2)+'\n');
 }catch(error){
  fs.writeFileSync(path.join(output,'decision-browser-report.json'),JSON.stringify({...report,passed:false,error:String(error.message||error)},null,2));
  throw error;
 }finally{
  if(browser)await browser.close();if(fixture)await fixture.close();fs.rmSync(clockDir,{recursive:true,force:true});
 }
}
run().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
