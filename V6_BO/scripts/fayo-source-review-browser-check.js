#!/usr/bin/env node
'use strict';
// Synthetic, local-only source-pool and public-announcement consumer acceptance.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=fs.realpathSync(path.resolve(__dirname,'../public'));
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main id="mount" style="max-width:1200px;margin:auto;padding:12px"></main></body></html>');}
 if(!pathname.startsWith('/nova/')||!/^[-\w/.]+$/.test(pathname)){res.writeHead(404);return res.end();}
 try{
  const file=fs.realpathSync(path.resolve(root,'.'+pathname));
  if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('outside public root');
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 const report={offline:true,fixtureOnly:true,viewports:[],unexpectedRequests:[]};
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [320,390,1440]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(report.unexpectedRequests.push(new URL(route.request().url()).origin),route.abort()));
   await page.goto(origin);
   await page.evaluate(async()=>{
    const {renderDailyReview}=await import('/nova/market.js');
    const quoteAt=Date.parse('2026-11-13T07:00:00Z');
    const rows=Array.from({length:97},(_,i)=>({code:String(600000+i),name:i===96?'ST合成末页票':'合成样本'+i,isST:i===96,sector:i%2?'甲板块':'乙板块',sectorTags:[i%2?'甲板块':'乙板块',...([0,96].includes(i)?['补充板块']:[])],sources:i===96?['cls']:['eastmoney','cls'],limitUpCount:i%3+1,tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',reason:'完整来源原因'+i,reasonTradeDate:'2026-11-13',reasonDateStatus:'matched',reasonSource:'合成来源',price:10+i/100,pct:10,quoteAt,vendorQuoteAt:quoteAt,quoteSource:'fixture',receivedAt:quoteAt+1000}));
    Object.assign(rows[0],{heldRecord:true,currentSourceConfirmed:false,heldSources:['cls'],sourceStatuses:{cls:'retained'},reasonSourceStatus:'retained',sourceEventAt:quoteAt-1000});
    const meta={tradeDate:'2026-11-13',status:'ready',uniqueCount:97,intersectionCount:96,eastmoneyOnlyCount:0,clsOnlyCount:1,heldRecordCount:1,retainedSources:['cls'],sources:[{source:'eastmoney',tradeDate:'2026-11-13',totalCount:96,fetchedCount:96,providerComplete:true,includesST:false},{source:'cls',tradeDate:'2026-11-13',totalCount:97,fetchedCount:97,providerComplete:true,includesST:true,status:'retained'}]};
    const abort=new AbortController();window.calls=[];window.listeners=[];window.selected=null;
    window.context={state:{ztDay:'20261113',ztReviewPool:rows,ztReviewPoolMeta:meta,review:{date:'20261113',items:rows.slice(0,2)}},role:'view',signal:abort.signal,selectStock:(code,row)=>window.selected={code,row},navigate:()=>{},refresh:async()=>{},onState:fn=>window.listeners.push(fn),api:async url=>{window.calls.push(url);throw Error('source review must not request API');}};
    document.getElementById('mount').replaceChildren(renderDailyReview(window.context));
   });
   const source=page.locator('[data-source-review]');
   assert.equal(await source.getAttribute('open'),null,'the source module starts folded');
   await source.locator(':scope > summary').click();
   await source.getByRole('status').filter({hasText:'可见复盘池'}).waitFor();
   assert.match(await source.innerText(),/可见复盘池 97/);
   assert.match(await source.innerText(),/同日来源原因已匹配 97/);
   assert.match(await source.innerText(),/东方财富 · 来源日 2026-11-13 · 声明总量 96/);
   assert.match(await source.innerText(),/财联社 · 来源日 2026-11-13 · 声明总量 97/);
   assert.match(await source.innerText(),/未认证交易所全部股票/);
   const visible=new Set();
   for(let index=0;index<4;index++){
    const codes=await source.locator('[data-code]').evaluateAll(nodes=>nodes.map(node=>node.dataset.code));
    assert.equal(codes.length,index<3?25:22);codes.forEach(code=>visible.add(code));
    if(index<3)await source.getByRole('button',{name:'下一页',exact:true}).click();
   }
   assert.equal(visible.size,97);
   const search=source.getByRole('searchbox',{name:'搜索每日复盘'});
   await search.fill('600096');assert.equal(await source.locator('[data-code]').count(),1);
   await source.locator('[data-code="600096"]').click();
   assert.equal(await page.evaluate(()=>window.selected.code),'600096');
   assert.equal(await page.evaluate(()=>window.selected.row.vendorQuoteAt),Date.parse('2026-11-13T07:00:00Z'));
   await search.fill('完整来源原因96');assert.equal(await source.locator('[data-code]').count(),1);
   await search.fill('');await source.getByRole('combobox',{name:'筛选复盘板块'}).selectOption('补充板块');
   assert.equal(await source.locator('[data-code]').count(),2);
   await source.getByRole('combobox',{name:'筛选复盘 ST 范围'}).selectOption('st');assert.equal(await source.locator('[data-code]').count(),1);
   assert.match(await source.innerText(),/ST合成末页票/);
   await page.evaluate(()=>window.listeners.forEach(fn=>fn()));
   assert.equal(await source.getAttribute('open'),'');assert.equal(await source.getByRole('combobox',{name:'筛选复盘 ST 范围'}).inputValue(),'st');
   await source.getByRole('combobox',{name:'筛选复盘 ST 范围'}).selectOption('all');
   await source.getByRole('combobox',{name:'筛选复盘板块'}).selectOption('');await search.fill('600000');
   const toggleRace=await page.evaluate(()=>{
    const pool=document.querySelector('[data-source-review]');
    const current=()=>[...pool.querySelectorAll('details')].find(node=>node.querySelector(':scope > summary')?.textContent.startsWith('乙板块 · '));
    const update=()=>window.listeners.forEach(fn=>fn());
    const check=(value,message)=>{if(!value)throw Error('deterministic details toggle race: '+message);};
    const suppress=node=>node.addEventListener('toggle',event=>event.stopImmediatePropagation(),{capture:true});
    let node=current();check(node&&!node.open,'sector starts folded');suppress(node);
    const obsolete=node;node.open=true;update();
    check(current().open,'opening survives synchronous refresh before toggle is delivered');
    update();check(current().open,'opening survives consecutive refreshes');
    node=current();suppress(node);node.open=false;update();
    check(!current().open,'manual close survives synchronous refresh');
    // A replaced element can still receive its queued toggle. It must not
    // restore a stale expansion after the user closed the current element.
    obsolete.open=true;obsolete.dispatchEvent(new Event('toggle'));update();
    check(!current().open,'detached old toggle does not reopen a closed section');
    node=current();suppress(node);node.open=true;update();update();
    check(current().open,'reopening survives immediate consecutive refreshes');
    node=current();suppress(node);node.open=false;update();
    check(!current().open,'second close is retained');
    pool.open=false;update();check(!pool.open,'module manual fold is retained');pool.open=true;
    return {notificationSuppressed:true,consecutiveRefreshes:true,manualClose:true,lateDetachedToggle:false,moduleFold:true};
   });
   const peerDetails=source.locator('details').filter({has:page.locator('summary',{hasText:'同板块关联涨停股 48 只'})});
   await peerDetails.locator(':scope > summary').click();
   assert.equal(await peerDetails.getByRole('button').count(),48);
   assert.equal(await peerDetails.getByRole('button',{name:/ST合成末页票 600096/}).count(),1);
   assert.match(await source.innerText(),/保留旧来源证据，本次未确认/);
   assert.match(await source.innerText(),/不能据此断言当前仍封板/);
   assert.doesNotMatch(await source.innerText(),/原因已核验/);
   await page.evaluate(()=>window.listeners.forEach(fn=>fn()));assert.equal(await peerDetails.getAttribute('open'),'');
   toggleRace.lateDetachedToggle=await page.evaluate(()=>{
    const pool=document.querySelector('[data-source-review]');
    const peer=()=>[...pool.querySelectorAll('details')].find(node=>node.querySelector(':scope > summary')?.textContent.startsWith('同板块关联涨停股 48 只'));
    const update=()=>window.listeners.forEach(fn=>fn()),search=pool.querySelector('input[type="search"]');
    const obsolete=peer();obsolete.open=false;update();
    search.value='600096';search.dispatchEvent(new Event('input'));
    // No notification is suppressed on this detached stock-card element.
    // A stale toggle must not resurrect its expansion when the card returns.
    obsolete.open=true;obsolete.dispatchEvent(new Event('toggle'));
    search.value='600000';search.dispatchEvent(new Event('input'));
    if(peer().open)throw Error('detached toggle resurrected a manually closed hidden stock section');
    peer().open=true;update();return true;
   });
   const sourceOverflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(sourceOverflow<=1,'source review must fit viewport: '+width+' / '+sourceOverflow);
   if(process.env.V6_UI_QA_DIR&&process.env.V6_UI_SCREENSHOTS!=='0'){
    fs.mkdirSync(process.env.V6_UI_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.V6_UI_QA_DIR,'fayo-source-pool-'+width+'.png'),fullPage:true});
   }
   await page.evaluate(async()=>{
    const {renderOperations}=await import('/nova/operations.js');
    const item={title:'合成巨潮原始公告',source:'巨潮资讯 · 未独立核验',publishedAt:'2026-11-13T07:00:00Z',codes:['600001'],url:'https://static.cninfo.com.cn/finalpage/2026-11-13/123.pdf'};
    window.context.state={goodNews:{items:[{title:'合成既有新闻',publishedAt:'2026-11-12T07:00:00Z'}]},badNews:{items:[]},dashboard:{riskEvidence:{news:[item,item,{...item,title:'未知原时点',publishedAt:'2026-11-13'},{...item,title:'未来原时点',publishedAt:'2099-01-01T00:00:00Z'},{...item,title:'未知来源',source:'未知'}]}},signals:[{code:'600001',type:'策略甲'},{code:'600001',type:'策略乙'}]};
    document.getElementById('mount').replaceChildren(renderOperations({view:'inbox',sub:'all'},window.context));
   });
   assert.equal(await page.locator('.fy-news-feed .fy-news-item').count(),2);
   assert.equal(await page.getByRole('link',{name:'合成巨潮原始公告'}).count(),1);
   assert.doesNotMatch(await page.locator('#mount').innerText(),/未知原时点|未来原时点|未知来源/);
   await page.evaluate(async()=>{const {renderOperations}=await import('/nova/operations.js');document.getElementById('mount').replaceChildren(renderOperations({view:'inbox',sub:'signals'},window.context));});
   assert.equal(await page.locator('.fy-news-feed .fy-news-item').count(),2);
   assert.deepEqual(await page.evaluate(()=>window.calls),[]);
   const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=1,'news view must fit viewport');
   if(process.env.V6_UI_QA_DIR&&process.env.V6_UI_SCREENSHOTS!=='0'){
    fs.mkdirSync(process.env.V6_UI_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.V6_UI_QA_DIR,'fayo-source-review-'+width+'.png'),fullPage:true});
   }
   assert.deepEqual(errors,[]);report.viewports.push({width,uniqueSourceStocks:visible.size,pageSize:25,relatedStocks:48,newsItems:2,distinctSignalEvents:2,toggleRace,sourceOverflow,newsOverflow:overflow,apiRequests:0,pageErrors:errors});await page.close();
  }
  assert.deepEqual(report.unexpectedRequests,[]);
  if(process.env.V6_UI_QA_DIR){fs.mkdirSync(process.env.V6_UI_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.V6_UI_QA_DIR,'fayo-source-review-report.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
